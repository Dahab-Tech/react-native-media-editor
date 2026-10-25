import React, { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, PixelRatio, Pressable, StyleSheet, View } from 'react-native';

import { createRafCoalescer } from '../../core/hooks/rafCoalescer';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { clamp } from '../format';
import { useVideoThumbnailStrip } from '../hooks/useVideoThumbnailStrip';
import type { Clip } from '../project/model';

export const PIP_LANE_HEIGHT = 32;
const LANE_GAP = 4;
const EDGE_HANDLE_WIDTH = 16;
const MIN_BAR_WIDTH = 24;
const DRAG_SLOP_PX = 4;
const THUMB_TILE_WIDTH = 48;
const MAX_THUMBS_PER_LANE = 20;

export interface PipLaneModel {
  trackId: string;
  /** The pip track's single clip; `placement` is always present. */
  clip: Clip;
}

export interface PipLaneProps {
  lane: PipLaneModel;
  pxPerMs: number;
  /** Main-track output duration — pip windows render clamped to it. */
  durationMs: number;
  minDurationMs: number;
  selected: boolean;
  onSelect: (clipId: string) => void;
  /** Body drag released — new timeline window start plus rows moved vertically (+1 = one lane down). */
  onWindowCommit: (trackId: string, timelineStartMs: number, laneDelta: number) => void;
  /** Edge drag released — trimmed source window plus the (start-edge-shifted) timeline start. */
  onTrimCommit: (
    trackId: string,
    clipId: string,
    sourceStartMs: number,
    sourceEndMs: number,
    timelineStartMs: number
  ) => void;
  onScrub: (timelineMs: number) => void;
  onScrubEnd: (timelineMs: number) => void;
  /** Locks the timeline scroll while a bar/handle drag is live. */
  onDragChange: (dragging: boolean) => void;
}

/** One timeline lane per pip track: thumbnail bar, tap selects, body-drag moves the window, edge-drag trims. */
export function PipLane({
  lane,
  pxPerMs,
  durationMs,
  minDurationMs,
  selected,
  onSelect,
  onWindowCommit,
  onTrimCommit,
  onScrub,
  onScrubEnd,
  onDragChange,
}: PipLaneProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const { clip } = lane;
  const speed = clip.edits.speed;
  const placementStartMs = clip.placement?.timelineStartMs ?? 0;

  const [dragging, setDragging] = useState(false);
  const [liveStartMs, setLiveStartMs] = useState(placementStartMs);
  const [liveSrcStartMs, setLiveSrcStartMs] = useState(clip.sourceStartMs);
  const [liveSrcEndMs, setLiveSrcEndMs] = useState(clip.sourceEndMs);
  // Vertical travel of a live body drag — rides over sibling lanes, folds into laneDelta on release.
  const [liveDy, setLiveDy] = useState(0);
  const [seeded, setSeeded] = useState({
    startMs: placementStartMs,
    srcStartMs: clip.sourceStartMs,
    srcEndMs: clip.sourceEndMs,
  });
  if (
    !dragging &&
    (seeded.startMs !== placementStartMs ||
      seeded.srcStartMs !== clip.sourceStartMs ||
      seeded.srcEndMs !== clip.sourceEndMs)
  ) {
    setSeeded({
      startMs: placementStartMs,
      srcStartMs: clip.sourceStartMs,
      srcEndMs: clip.sourceEndMs,
    });
    setLiveStartMs(placementStartMs);
    setLiveSrcStartMs(clip.sourceStartMs);
    setLiveSrcEndMs(clip.sourceEndMs);
  }

  const latest = useRef({
    lane,
    pxPerMs,
    durationMs,
    minDurationMs,
    selected,
    speed,
    startMs: liveStartMs,
    srcStartMs: liveSrcStartMs,
    srcEndMs: liveSrcEndMs,
    dy: liveDy,
    onWindowCommit,
    onTrimCommit,
    onScrub,
    onScrubEnd,
    onDragChange,
  });
  useEffect(() => {
    latest.current = {
      lane,
      pxPerMs,
      durationMs,
      minDurationMs,
      selected,
      speed,
      startMs: liveStartMs,
      srcStartMs: liveSrcStartMs,
      srcEndMs: liveSrcEndMs,
      dy: liveDy,
      onWindowCommit,
      onTrimCommit,
      onScrub,
      onScrubEnd,
      onDragChange,
    };
  });

  const origin = useRef({ startMs: 0, srcStartMs: 0, srcEndMs: 0 });
  const coalescer = useRef(createRafCoalescer());
  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  /** Rendered bar length: output duration clamped at the main-track end (matches the native clamp). */
  const visibleMs = (startMs: number, srcStartMs: number, srcEndMs: number) =>
    Math.max(0, Math.min((srcEndMs - srcStartMs) / latest.current.speed, durationMs - startMs));

  // Body drags never scrub (null): seeking to the moved window start yanked the playhead there.
  const begin = (scrubAtMs: number | null) => {
    const s = latest.current;
    origin.current = { startMs: s.startMs, srcStartMs: s.srcStartMs, srcEndMs: s.srcEndMs };
    setDragging(true);
    s.onDragChange(true);
    if (scrubAtMs != null) s.onScrub(scrubAtMs);
  };

  const endScrubMs = () => {
    const s = latest.current;
    return s.startMs + visibleMs(s.startMs, s.srcStartMs, s.srcEndMs);
  };

  const release = (edge: 'body' | 'start' | 'end') => {
    coalescer.current.flush();
    const s = latest.current;
    if (edge === 'body') {
      // Vertical rows travelled → z-order lane delta; the parent maps display rows to track order.
      const laneDelta = Math.round(s.dy / (PIP_LANE_HEIGHT + LANE_GAP));
      s.onWindowCommit(s.lane.trackId, Math.round(s.startMs), laneDelta);
    } else {
      s.onTrimCommit(
        s.lane.trackId,
        s.lane.clip.id,
        Math.round(s.srcStartMs),
        Math.round(s.srcEndMs),
        Math.round(s.startMs)
      );
    }
    latest.current.dy = 0;
    setLiveDy(0);
    setDragging(false);
    // Settle (park clock + exact seek) BEFORE re-arming auto-follow, or a UI frame
    // can scroll the timeline to the stale pre-trim clock position.
    if (edge !== 'body') s.onScrubEnd(edge === 'end' ? endScrubMs() : s.startMs);
    s.onDragChange(false);
  };

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [bodyResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        latest.current.selected &&
        (Math.abs(gesture.dx) > DRAG_SLOP_PX || Math.abs(gesture.dy) > DRAG_SLOP_PX),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => begin(null),
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.pxPerMs <= 0) return;
        const windowMs = Math.min(
          (origin.current.srcEndMs - origin.current.srcStartMs) / s.speed,
          s.durationMs
        );
        const nextStart = clamp(
          origin.current.startMs + gesture.dx / s.pxPerMs,
          0,
          Math.max(0, s.durationMs - windowMs)
        );
        latest.current.startMs = nextStart;
        latest.current.dy = gesture.dy;
        // One re-render per frame — move events outpace rAF and pile up renders otherwise.
        coalescer.current.schedule(() => {
          const l = latest.current;
          setLiveStartMs(l.startMs);
          setLiveDy(l.dy);
        });
      },
      onPanResponderRelease: () => release('body'),
      onPanResponderTerminate: () => release('body'),
    })
  );

  const makeEdgeResponder = (edge: 'start' | 'end') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => begin(edge === 'start' ? latest.current.startMs : endScrubMs()),
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.pxPerMs <= 0) return;
        // Trim math lives in the source-time domain, so handle travel scales with clip speed.
        const deltaSourceMs = (gesture.dx / s.pxPerMs) * s.speed;
        const minSourceMs = s.minDurationMs * s.speed;
        if (edge === 'start') {
          // Head trim slides the window start with it; the floor keeps the window start at >= 0.
          const low = Math.max(0, origin.current.srcStartMs - origin.current.startMs * s.speed);
          const next = clamp(
            origin.current.srcStartMs + deltaSourceMs,
            low,
            s.srcEndMs - minSourceMs
          );
          latest.current.srcStartMs = next;
          latest.current.startMs =
            origin.current.startMs + (next - origin.current.srcStartMs) / s.speed;
        } else {
          const next = clamp(
            origin.current.srcEndMs + deltaSourceMs,
            s.srcStartMs + minSourceMs,
            s.lane.clip.sourceDurationMs
          );
          latest.current.srcEndMs = next;
        }
        coalescer.current.schedule(() => {
          const l = latest.current;
          setLiveStartMs(l.startMs);
          setLiveSrcStartMs(l.srcStartMs);
          setLiveSrcEndMs(l.srcEndMs);
          l.onScrub(edge === 'start' ? l.startMs : endScrubMs());
        });
      },
      onPanResponderRelease: () => release(edge),
      onPanResponderTerminate: () => release(edge),
    });

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [startResponder] = useState(() => makeEdgeResponder('start'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [endResponder] = useState(() => makeEdgeResponder('end'));

  const left = liveStartMs * pxPerMs;
  // Same clamp as visibleMs, from render-scope values — refs stay out of render.
  const shownMs = Math.max(
    0,
    Math.min((liveSrcEndMs - liveSrcStartMs) / speed, durationMs - liveStartMs)
  );
  const width = Math.max(shownMs * pxPerMs, MIN_BAR_WIDTH);

  const thumbCount = Math.min(
    MAX_THUMBS_PER_LANE,
    Math.max(1, Math.round(width / THUMB_TILE_WIDTH))
  );
  const { thumbnails } = useVideoThumbnailStrip(
    clip.source,
    clip.sourceEndMs - clip.sourceStartMs,
    thumbCount,
    Math.round(THUMB_TILE_WIDTH * 2 * PixelRatio.get()),
    clip.sourceStartMs
  );

  return (
    <View style={[styles.lane, dragging ? styles.laneRaised : null]}>
      {/* Explicit left/width px — Fabric collapses inset-stretched absolutes in horizontal scroll content. */}
      <View
        {...bodyResponder.panHandlers}
        style={[
          styles.bar,
          { left, width, borderRadius: 5, backgroundColor: theme.colors.surface },
          { transform: [{ translateY: liveDy }] },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pip')}
          accessibilityState={{ selected }}
          onPress={() => onSelect(clip.id)}
          style={styles.barContent}>
          <View style={styles.thumbRow} pointerEvents="none">
            {thumbnails.map((slot, i) => (
              <View key={i} style={styles.thumbTile}>
                {slot != null && (
                  <Image
                    source={{ uri: slot.uri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                )}
              </View>
            ))}
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.selection,
              {
                borderColor: selected ? theme.colors.accent : `${theme.colors.accent}55`,
                borderWidth: selected ? 2 : 1,
              },
            ]}
          />
        </Pressable>
        {selected && (
          <>
            <View
              {...startResponder.panHandlers}
              style={[
                styles.edgeHandle,
                styles.edgeStart,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
              ]}>
              <View style={[styles.edgeGrip, { backgroundColor: theme.colors.onAccent }]} />
            </View>
            <View
              {...endResponder.panHandlers}
              style={[
                styles.edgeHandle,
                styles.edgeEnd,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
              ]}>
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
    height: PIP_LANE_HEIGHT,
    marginTop: LANE_GAP,
  },
  // The dragged bar rides over sibling lanes instead of sliding under them.
  laneRaised: {
    zIndex: 10,
    elevation: 10,
  },
  bar: {
    position: 'absolute',
    top: 0,
    height: PIP_LANE_HEIGHT,
  },
  barContent: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 5,
  },
  thumbRow: {
    flex: 1,
    flexDirection: 'row',
  },
  thumbTile: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
  },
  selection: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    borderRadius: 5,
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
    height: 12,
    borderRadius: 1.5,
  },
});
