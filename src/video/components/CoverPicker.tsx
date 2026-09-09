import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  PixelRatio,
  Pressable,
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

export interface CoverPickerProps {
  source: string;
  durationMs: number;
  /** Called continuously as the playhead drags. */
  onScrub: (timeMs: number) => void;
  /** Called at drag release. */
  onScrubEnd?: () => void;
  /** Called when the user commits with the picked timestamp. */
  onSave: (timeMs: number) => void;
  /** Called to close without saving. */
  onCancel: () => void;
  /** Disables Save while extraction is in flight. */
  busy?: boolean;
}

const STRIP_HEIGHT = 60;
const THUMBNAIL_COUNT = 8;
const PLAYHEAD_WIDTH = 3;
const PLAYHEAD_HANDLE_WIDTH = 18;
const PLAYHEAD_HANDLE_HEIGHT = 20;
const PLAYHEAD_HIT_INFLATE = 12;

/** Bottom-panel cover picker: thumbnail strip + draggable playhead + Cancel/Save row. Time axis stays LTR (matches iOS Photos / Instagram). */
export function CoverPicker({
  source,
  durationMs,
  onScrub,
  onScrubEnd,
  onSave,
  onCancel,
  busy = false,
}: CoverPickerProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();

  const [trackWidth, setTrackWidth] = useState(0);
  // Seeded to video midpoint so the strip opens on a representative frame (not a black first frame).
  const [markerMs, setMarkerMs] = useState(() => durationMs / 2);

  // Reseed via adjust-during-render pattern if duration lands after mount.
  const [lastSeededDuration, setLastSeededDuration] = useState(durationMs);
  if (lastSeededDuration !== durationMs) {
    setLastSeededDuration(durationMs);
    setMarkerMs(durationMs / 2);
  }

  const dpr = PixelRatio.get();
  const thumbnailMaxWidth = Math.round(160 * dpr);
  const { thumbnails, isReady } = useVideoThumbnailStrip(
    source,
    durationMs,
    THUMBNAIL_COUNT,
    thumbnailMaxWidth
  );

  // Snapshot ref for PanResponder callbacks.
  const latest = useRef({ trackWidth, durationMs, markerMs, onScrub, onScrubEnd });
  useEffect(() => {
    latest.current = { trackWidth, durationMs, markerMs, onScrub, onScrubEnd };
  });

  const dragOriginMs = useRef(0);
  // Coalesce onScrub only — setMarkerMs stays sync so the playhead tracks the finger; onScrub hits the native bridge and needs rate-limiting.
  const coalescer = useRef(createRafCoalescer());

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginMs.current = latest.current.markerMs;
        latest.current.onScrub(latest.current.markerMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.trackWidth <= 0 || s.durationMs <= 0) return;
        const deltaMs = (gesture.dx / s.trackWidth) * s.durationMs;
        const next = clamp(dragOriginMs.current + deltaMs, 0, s.durationMs);
        setMarkerMs(next);
        coalescer.current.schedule(() => latest.current.onScrub(next));
      },
      onPanResponderRelease: () => {
        coalescer.current.flush();
        latest.current.onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        coalescer.current.flush();
        latest.current.onScrubEnd?.();
      },
    })
  );

  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const markerX =
    trackWidth > 0 && durationMs > 0
      ? clamp((markerMs / durationMs) * trackWidth, 0, trackWidth)
      : 0;
  const tileWidth = trackWidth > 0 ? trackWidth / THUMBNAIL_COUNT : 0;

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.sm }}>
      <View
        style={[
          styles.headerRow,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            paddingHorizontal: theme.spacing.md,
          },
        ]}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t('pickCover')}</Text>
        <View
          style={[
            styles.timePill,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.accent,
              borderRadius: theme.radius.sm,
              paddingHorizontal: theme.spacing.sm,
            },
          ]}>
          <Text style={[styles.timeText, { color: theme.colors.accent }]}>
            {formatMs(markerMs)}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: EDGE_GESTURE_MARGIN ?? theme.spacing.md }}>
        <View
          onLayout={handleTrackLayout}
          style={[
            styles.strip,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
            },
          ]}>
          {trackWidth > 0 && (
            <>
              <View pointerEvents="none" style={styles.stripRow}>
                {thumbnails.map((slot, index) => (
                  <View
                    key={index}
                    style={[styles.tile, { width: tileWidth, height: STRIP_HEIGHT }]}>
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
                {...responder.panHandlers}
                accessibilityRole="adjustable"
                accessibilityLabel={`${t('pickCover')} ${formatMs(markerMs)}`}
                style={[
                  styles.playheadHit,
                  {
                    left: markerX - PLAYHEAD_HIT_INFLATE - PLAYHEAD_WIDTH / 2,
                    width: PLAYHEAD_HIT_INFLATE * 2 + PLAYHEAD_WIDTH,
                  },
                ]}>
                <View
                  pointerEvents="none"
                  style={[styles.playheadBar, { backgroundColor: theme.colors.accent }]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.playheadCap,
                    styles.playheadCapTop,
                    {
                      backgroundColor: theme.colors.accent,
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.playheadCap,
                    styles.playheadCapBottom,
                    {
                      backgroundColor: theme.colors.accent,
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                />
              </View>
            </>
          )}
          {!isReady && (
            <View pointerEvents="none" style={styles.stripSpinner}>
              <ActivityIndicator color={theme.colors.accent} size="small" />
            </View>
          )}
        </View>
      </View>

      <View
        style={[
          styles.actions,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            paddingHorizontal: theme.spacing.md,
          },
        ]}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              opacity: busy ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.secondaryLabel, { color: theme.colors.text }]}>{t('cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(markerMs)}
          disabled={busy || !isReady}
          accessibilityRole="button"
          accessibilityLabel={t('saveCover')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              opacity: busy || !isReady ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.primaryLabel, { color: theme.colors.onAccent }]}>
            {t('saveCover')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  timePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  strip: {
    height: STRIP_HEIGHT,
    width: '100%',
    overflow: 'hidden',
  },
  stripRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  tile: {
    overflow: 'hidden',
  },
  stripSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playheadHit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playheadBar: {
    width: PLAYHEAD_WIDTH,
    height: '100%',
  },
  playheadCap: {
    position: 'absolute',
    width: PLAYHEAD_HANDLE_WIDTH,
    height: PLAYHEAD_HANDLE_HEIGHT / 2,
  },
  playheadCapTop: {
    top: 0,
  },
  playheadCapBottom: {
    bottom: 0,
  },
  actions: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
});
