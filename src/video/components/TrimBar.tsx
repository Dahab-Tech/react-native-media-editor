import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { createRafCoalescer } from '../../core/hooks/rafCoalescer';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EDGE_GESTURE_MARGIN } from '../../core/systemGestures';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { clamp, formatMs } from '../format';
import { useVideoThumbnailStrip } from '../hooks/useVideoThumbnailStrip';

export interface TrimBarProps {
  /** Video source URI (for the thumbnail strip). */
  source: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  onChange: (startMs: number, endMs: number) => void;
  /** Called continuously during a handle drag with the current position. */
  onScrub?: (timeMs: number) => void;
  /** Called at PanResponder release. */
  onScrubEnd?: () => void;
  /** Smallest selectable range. Defaults to 1000 ms. */
  minDurationMs?: number;
}

const HANDLE_WIDTH = 20;
const HANDLE_GRIP_HEIGHT = 24;
const TRACK_HEIGHT = 52;
const THUMBNAIL_COUNT = 8;

export function TrimBar({
  source,
  durationMs,
  startMs,
  endMs,
  onChange,
  onScrub,
  onScrubEnd,
  minDurationMs = 1000,
}: TrimBarProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const [trackWidth, setTrackWidth] = useState(0);

  // Cap decode width to tile pixel size so 1080p sources don't decode full-res.
  const dpr = PixelRatio.get();
  const thumbnailMaxWidth = Math.round(120 * dpr);
  const { thumbnails } = useVideoThumbnailStrip(
    source,
    durationMs,
    THUMBNAIL_COUNT,
    thumbnailMaxWidth
  );

  // Local drag state so handles track the finger without a parent-state round-trip; onChange only fires on release.
  const [dragging, setDragging] = useState(false);
  const [liveStartMs, setLiveStartMs] = useState(startMs);
  const [liveEndMs, setLiveEndMs] = useState(endMs);
  const [seededStart, setSeededStart] = useState(startMs);
  const [seededEnd, setSeededEnd] = useState(endMs);
  if (!dragging && (seededStart !== startMs || seededEnd !== endMs)) {
    setSeededStart(startMs);
    setSeededEnd(endMs);
    setLiveStartMs(startMs);
    setLiveEndMs(endMs);
  }

  const latest = useRef({
    durationMs,
    startMs: liveStartMs,
    endMs: liveEndMs,
    minDurationMs,
    trackWidth,
    onChange,
    onScrub,
    onScrubEnd,
  });
  useEffect(() => {
    latest.current = {
      durationMs,
      startMs: liveStartMs,
      endMs: liveEndMs,
      minDurationMs,
      trackWidth,
      onChange,
      onScrub,
      onScrubEnd,
    };
  });

  const dragOriginMs = useRef(0);
  // Coalesce onScrub only — setLive*Ms stays sync so the handle tracks the finger; only one handle owns the gesture at a time.
  const coalescer = useRef(createRafCoalescer());

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [startHandle] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginMs.current = latest.current.startMs;
        setDragging(true);
        latest.current.onScrub?.(latest.current.startMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        const usable = s.trackWidth - HANDLE_WIDTH * 2;
        if (usable <= 0 || s.durationMs <= 0) {
          return;
        }
        const deltaMs = (gesture.dx / usable) * s.durationMs;
        // Clamp against the LIVE endMs so the min-duration rule tracks the current drag state.
        const next = clamp(dragOriginMs.current + deltaMs, 0, s.endMs - s.minDurationMs);
        setLiveStartMs(next);
        // Sync the ref now — release can fire before the post-render effect updates it.
        latest.current.startMs = next;
        coalescer.current.schedule(() => latest.current.onScrub?.(next));
      },
      onPanResponderRelease: () => {
        coalescer.current.flush();
        const l = latest.current;
        l.onChange(l.startMs, l.endMs);
        setDragging(false);
        l.onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        coalescer.current.flush();
        const l = latest.current;
        l.onChange(l.startMs, l.endMs);
        setDragging(false);
        l.onScrubEnd?.();
      },
    })
  );

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [endHandle] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginMs.current = latest.current.endMs;
        setDragging(true);
        latest.current.onScrub?.(latest.current.endMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        const usable = s.trackWidth - HANDLE_WIDTH * 2;
        if (usable <= 0 || s.durationMs <= 0) {
          return;
        }
        const deltaMs = (gesture.dx / usable) * s.durationMs;
        // Clamp against the LIVE startMs so the min-duration rule tracks the current drag state.
        const next = clamp(
          dragOriginMs.current + deltaMs,
          s.startMs + s.minDurationMs,
          s.durationMs
        );
        setLiveEndMs(next);
        // Sync the ref now — release can fire before the post-render effect updates it.
        latest.current.endMs = next;
        coalescer.current.schedule(() => latest.current.onScrub?.(next));
      },
      onPanResponderRelease: () => {
        coalescer.current.flush();
        const l = latest.current;
        l.onChange(l.startMs, l.endMs);
        setDragging(false);
        l.onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        coalescer.current.flush();
        const l = latest.current;
        l.onChange(l.startMs, l.endMs);
        setDragging(false);
        l.onScrubEnd?.();
      },
    })
  );

  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const usable = trackWidth - HANDLE_WIDTH * 2;
  const startX = durationMs > 0 ? (liveStartMs / durationMs) * usable : 0;
  const endX = durationMs > 0 ? (liveEndMs / durationMs) * usable : 0;
  const selectionWidth = Math.max(0, endX - startX);
  const tileWidth = usable > 0 ? usable / THUMBNAIL_COUNT : 0;

  return (
    <View
      style={{
        paddingHorizontal: EDGE_GESTURE_MARGIN ?? theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}>
      <View style={[styles.labels, { marginBottom: theme.spacing.xs }]}>
        <Text style={[styles.timeLabel, { color: theme.colors.textMuted }]}>
          {formatMs(liveStartMs)}
        </Text>
        <View
          style={[
            styles.durationPill,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.accent,
              borderRadius: theme.radius.sm,
              paddingHorizontal: theme.spacing.sm,
            },
          ]}>
          <Text style={[styles.durationText, { color: theme.colors.accent }]}>
            {t('trim')} {formatMs(liveEndMs - liveStartMs)}
          </Text>
        </View>
        <Text style={[styles.timeLabel, { color: theme.colors.textMuted }]}>
          {formatMs(liveEndMs)}
        </Text>
      </View>
      {/* Time axis stays LTR in RTL locales (matches platform video players). */}
      <View
        onLayout={handleLayout}
        style={[
          styles.track,
          { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
        ]}>
        {usable > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[styles.thumbnailStrip, { left: HANDLE_WIDTH, width: usable }]}>
              {thumbnails.map((slot, index) => (
                <View key={index} style={[styles.thumbnailTile, { width: tileWidth }]}>
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
                  left: HANDLE_WIDTH + startX,
                  width: selectionWidth,
                  borderColor: theme.colors.accent,
                  backgroundColor: `${theme.colors.accent}22`,
                },
              ]}
            />
            <View
              {...startHandle.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel={`${t('trim')} ${formatMs(liveStartMs)}`}
              style={[
                styles.handle,
                {
                  left: startX,
                  backgroundColor: theme.colors.accent,
                  borderTopLeftRadius: theme.radius.md,
                  borderBottomLeftRadius: theme.radius.md,
                },
              ]}>
              <View
                style={[
                  styles.handleGrip,
                  { backgroundColor: theme.colors.onAccent, borderRadius: theme.radius.sm },
                ]}
              />
            </View>
            <View
              {...endHandle.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel={`${t('trim')} ${formatMs(liveEndMs)}`}
              style={[
                styles.handle,
                {
                  left: HANDLE_WIDTH + endX,
                  backgroundColor: theme.colors.accent,
                  borderTopRightRadius: theme.radius.md,
                  borderBottomRightRadius: theme.radius.md,
                },
              ]}>
              <View
                style={[
                  styles.handleGrip,
                  { backgroundColor: theme.colors.onAccent, borderRadius: theme.radius.sm },
                ]}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeLabel: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  durationPill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: TRACK_HEIGHT,
    overflow: 'hidden',
  },
  thumbnailStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  thumbnailTile: {
    height: '100%',
    overflow: 'hidden',
  },
  selection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderTopWidth: 2,
    borderBottomWidth: 2,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGrip: {
    width: 3,
    height: HANDLE_GRIP_HEIGHT,
  },
});
