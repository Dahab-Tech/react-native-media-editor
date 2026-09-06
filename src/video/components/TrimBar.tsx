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

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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

  const latest = useRef({
    durationMs,
    startMs,
    endMs,
    minDurationMs,
    trackWidth,
    onChange,
    onScrub,
    onScrubEnd,
  });
  useEffect(() => {
    latest.current = {
      durationMs,
      startMs,
      endMs,
      minDurationMs,
      trackWidth,
      onChange,
      onScrub,
      onScrubEnd,
    };
  });

  const dragOriginMs = useRef(0);

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [startHandle] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginMs.current = latest.current.startMs;
        latest.current.onScrub?.(latest.current.startMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        const usable = s.trackWidth - HANDLE_WIDTH * 2;
        if (usable <= 0 || s.durationMs <= 0) {
          return;
        }
        const deltaMs = (gesture.dx / usable) * s.durationMs;
        const next = clamp(dragOriginMs.current + deltaMs, 0, s.endMs - s.minDurationMs);
        s.onChange(next, s.endMs);
        s.onScrub?.(next);
      },
      onPanResponderRelease: () => {
        latest.current.onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        latest.current.onScrubEnd?.();
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
        latest.current.onScrub?.(latest.current.endMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        const usable = s.trackWidth - HANDLE_WIDTH * 2;
        if (usable <= 0 || s.durationMs <= 0) {
          return;
        }
        const deltaMs = (gesture.dx / usable) * s.durationMs;
        const next = clamp(
          dragOriginMs.current + deltaMs,
          s.startMs + s.minDurationMs,
          s.durationMs
        );
        s.onChange(s.startMs, next);
        s.onScrub?.(next);
      },
      onPanResponderRelease: () => {
        latest.current.onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        latest.current.onScrubEnd?.();
      },
    })
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const usable = trackWidth - HANDLE_WIDTH * 2;
  const startX = durationMs > 0 ? (startMs / durationMs) * usable : 0;
  const endX = durationMs > 0 ? (endMs / durationMs) * usable : 0;
  const selectionWidth = Math.max(0, endX - startX);
  const tileWidth = usable > 0 ? usable / THUMBNAIL_COUNT : 0;

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}>
      <View style={[styles.labels, { marginBottom: theme.spacing.xs }]}>
        <Text style={[styles.timeLabel, { color: theme.colors.textMuted }]}>
          {formatMs(startMs)}
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
            {t('trim')} {formatMs(endMs - startMs)}
          </Text>
        </View>
        <Text style={[styles.timeLabel, { color: theme.colors.textMuted }]}>{formatMs(endMs)}</Text>
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
              accessibilityLabel={`${t('trim')} ${formatMs(startMs)}`}
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
              accessibilityLabel={`${t('trim')} ${formatMs(endMs)}`}
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
