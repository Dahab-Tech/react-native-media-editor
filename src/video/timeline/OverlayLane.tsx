import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { createRafCoalescer } from '../../core/hooks/rafCoalescer';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { clamp } from '../format';

export const LANE_HEIGHT = 22;
export const LANE_GAP = 4;
const EDGE_HANDLE_WIDTH = 16;
const MIN_WINDOW_MS = 100;
const MIN_BAR_WIDTH = 24;
const DRAG_SLOP_PX = 4;

export interface OverlayLaneModel {
  id: string;
  kind: 'text' | 'sticker' | 'draw';
  label: string;
  startMs: number;
  /** Bounded window end (unbounded windows arrive clamped to the project duration). */
  endMs: number;
}

export interface OverlayLaneProps {
  lane: OverlayLaneModel;
  pxPerMs: number;
  durationMs: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onWindowCommit: (id: string, startMs: number, endMs: number) => void;
  onScrub: (timelineMs: number) => void;
  onScrubEnd: (timelineMs: number) => void;
  /** Locks the timeline scroll while a bar/handle drag is live. */
  onDragChange: (dragging: boolean) => void;
}

const LANE_ICON: Record<OverlayLaneModel['kind'], EditorIconName> = {
  text: 'text',
  sticker: 'stickers',
  draw: 'draw',
};

/** One timeline lane bar per TimedOverlay: tap selects, body-drag moves, edge-drag trims the window. */
export function OverlayLane({
  lane,
  pxPerMs,
  durationMs,
  selected,
  onSelect,
  onWindowCommit,
  onScrub,
  onScrubEnd,
  onDragChange,
}: OverlayLaneProps) {
  const theme = useEditorTheme();

  const [dragging, setDragging] = useState(false);
  const [liveStartMs, setLiveStartMs] = useState(lane.startMs);
  const [liveEndMs, setLiveEndMs] = useState(lane.endMs);
  const [seeded, setSeeded] = useState({ startMs: lane.startMs, endMs: lane.endMs });
  if (!dragging && (seeded.startMs !== lane.startMs || seeded.endMs !== lane.endMs)) {
    setSeeded({ startMs: lane.startMs, endMs: lane.endMs });
    setLiveStartMs(lane.startMs);
    setLiveEndMs(lane.endMs);
  }

  const latest = useRef({
    lane,
    pxPerMs,
    durationMs,
    selected,
    startMs: liveStartMs,
    endMs: liveEndMs,
    onSelect,
    onWindowCommit,
    onScrub,
    onScrubEnd,
    onDragChange,
  });
  useEffect(() => {
    latest.current = {
      lane,
      pxPerMs,
      durationMs,
      selected,
      startMs: liveStartMs,
      endMs: liveEndMs,
      onSelect,
      onWindowCommit,
      onScrub,
      onScrubEnd,
      onDragChange,
    };
  });

  const origin = useRef({ startMs: 0, endMs: 0 });
  const coalescer = useRef(createRafCoalescer());
  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  // Body drags never scrub (null): seeking to the moved window start yanked the playhead there.
  const begin = (scrubAtMs: number | null) => {
    const s = latest.current;
    origin.current = { startMs: s.startMs, endMs: s.endMs };
    setDragging(true);
    s.onDragChange(true);
    if (scrubAtMs != null) s.onScrub(scrubAtMs);
  };

  const release = (scrubAtMs: number | null) => {
    coalescer.current.flush();
    const s = latest.current;
    s.onWindowCommit(s.lane.id, Math.round(s.startMs), Math.round(s.endMs));
    setDragging(false);
    // Settle (park clock + exact seek) BEFORE re-arming auto-follow, or a UI frame
    // can scroll the timeline to the stale clock position.
    if (scrubAtMs != null) s.onScrubEnd(scrubAtMs);
    s.onDragChange(false);
  };

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [bodyResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        latest.current.selected && Math.abs(gesture.dx) > DRAG_SLOP_PX,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => begin(null),
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.pxPerMs <= 0) return;
        const windowMs = origin.current.endMs - origin.current.startMs;
        const deltaMs = gesture.dx / s.pxPerMs;
        const nextStart = clamp(origin.current.startMs + deltaMs, 0, s.durationMs - windowMs);
        latest.current.startMs = nextStart;
        latest.current.endMs = nextStart + windowMs;
        // One re-render per frame — move events outpace rAF and pile up renders otherwise.
        coalescer.current.schedule(() => {
          const l = latest.current;
          setLiveStartMs(l.startMs);
          setLiveEndMs(l.endMs);
        });
      },
      onPanResponderRelease: () => release(null),
      onPanResponderTerminate: () => release(null),
    })
  );

  const makeEdgeResponder = (edge: 'start' | 'end') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () =>
        begin(edge === 'start' ? latest.current.startMs : latest.current.endMs),
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.pxPerMs <= 0) return;
        const deltaMs = gesture.dx / s.pxPerMs;
        const next =
          edge === 'start'
            ? clamp(origin.current.startMs + deltaMs, 0, s.endMs - MIN_WINDOW_MS)
            : clamp(origin.current.endMs + deltaMs, s.startMs + MIN_WINDOW_MS, s.durationMs);
        if (edge === 'start') latest.current.startMs = next;
        else latest.current.endMs = next;
        coalescer.current.schedule(() => {
          const l = latest.current;
          if (edge === 'start') setLiveStartMs(l.startMs);
          else setLiveEndMs(l.endMs);
          l.onScrub(edge === 'start' ? l.startMs : l.endMs);
        });
      },
      onPanResponderRelease: () =>
        release(edge === 'start' ? latest.current.startMs : latest.current.endMs),
      onPanResponderTerminate: () =>
        release(edge === 'start' ? latest.current.startMs : latest.current.endMs),
    });

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [startResponder] = useState(() => makeEdgeResponder('start'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [endResponder] = useState(() => makeEdgeResponder('end'));

  const left = liveStartMs * pxPerMs;
  const width = Math.max((liveEndMs - liveStartMs) * pxPerMs, MIN_BAR_WIDTH);
  const barColor = selected ? theme.colors.accent : `${theme.colors.accent}55`;
  const contentColor = selected ? theme.colors.onAccent : theme.colors.text;

  return (
    <View style={styles.lane}>
      {/* Explicit left/width px — Fabric collapses inset-stretched absolutes in horizontal scroll content. */}
      <View
        {...bodyResponder.panHandlers}
        style={[styles.bar, { left, width, backgroundColor: barColor, borderRadius: 5 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lane.label}
          accessibilityState={{ selected }}
          onPress={() => onSelect(lane.id)}
          style={styles.barContent}>
          <EditorIcon name={LANE_ICON[lane.kind]} size={11} color={contentColor} />
          {lane.label.length > 0 && (
            <Text numberOfLines={1} style={[styles.barLabel, { color: contentColor }]}>
              {lane.label}
            </Text>
          )}
        </Pressable>
        {selected && (
          <>
            <View {...startResponder.panHandlers} style={[styles.edgeHandle, styles.edgeStart]}>
              <View style={[styles.edgeGrip, { backgroundColor: theme.colors.onAccent }]} />
            </View>
            <View {...endResponder.panHandlers} style={[styles.edgeHandle, styles.edgeEnd]}>
              <View style={[styles.edgeGrip, { backgroundColor: theme.colors.onAccent }]} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    height: LANE_HEIGHT,
    marginTop: LANE_GAP,
  },
  bar: {
    position: 'absolute',
    top: 0,
    height: LANE_HEIGHT,
  },
  barContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: EDGE_HANDLE_WIDTH / 2 + 2,
    gap: 3,
    overflow: 'hidden',
  },
  barLabel: {
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 1,
  },
  edgeHandle: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    width: EDGE_HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeStart: { left: -EDGE_HANDLE_WIDTH / 2 },
  edgeEnd: { right: -EDGE_HANDLE_WIDTH / 2 },
  edgeGrip: {
    width: 3,
    height: 10,
    borderRadius: 1.5,
  },
});
