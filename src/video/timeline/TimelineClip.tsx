import React, { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { createRafCoalescer } from '../../core/hooks/rafCoalescer';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { clamp } from '../format';
import { useVideoThumbnailStrip } from '../hooks/useVideoThumbnailStrip';
import type { Clip } from '../project/model';

export const TIMELINE_TRACK_HEIGHT = 52;
const REORDER_HOLD_MS = 250;
const THUMB_TILE_WIDTH = 48;
/** Long clips stretch tiles wider instead of requesting hundreds of frames. */
const MAX_THUMBS_PER_CLIP = 20;
const TRIM_HANDLE_WIDTH = 18;

export interface TimelineClipProps {
  clip: Clip;
  index: number;
  width: number;
  pxPerMs: number;
  selected: boolean;
  /** Trim handles active — selected clip while the clip sub-toolbar is open. */
  trimming: boolean;
  /** Smallest playable output duration a trim may leave, in ms. */
  minDurationMs: number;
  /** This segment is being drag-reordered. */
  lifted: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, translationX: number) => void;
  /** Fires once on handle release with the final trimmed window, in source ms. */
  onTrimCommit: (id: string, sourceStartMs: number, sourceEndMs: number) => void;
  /** Locks the timeline scroll while an edge drag is live. */
  onTrimDragChange: (dragging: boolean) => void;
  /** Frame preview at the dragged edge, in the clip's source-time domain. */
  onTrimScrub: (sourceMs: number) => void;
  onTrimScrubEnd: () => void;
}

/** One clip segment: trimmed-window thumbnails, tap-select, long-press drag reorder, edge-drag trim. */
export function TimelineClip({
  clip,
  index,
  width,
  pxPerMs,
  selected,
  trimming,
  minDurationMs,
  lifted,
  onSelect,
  onDragStart,
  onDragEnd,
  onTrimCommit,
  onTrimDragChange,
  onTrimScrub,
  onTrimScrubEnd,
}: TimelineClipProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const translateX = useSharedValue(0);

  const thumbCount = Math.min(
    MAX_THUMBS_PER_CLIP,
    Math.max(1, Math.round(width / THUMB_TILE_WIDTH))
  );
  const { thumbnails } = useVideoThumbnailStrip(
    clip.source,
    clip.sourceEndMs - clip.sourceStartMs,
    thumbCount,
    Math.round(THUMB_TILE_WIDTH * 2 * PixelRatio.get()),
    clip.sourceStartMs
  );

  const pan = Gesture.Pan()
    .enabled(!trimming)
    .activateAfterLongPress(REORDER_HOLD_MS)
    .onStart(() => {
      translateX.value = 0;
      runOnJS(onDragStart)(clip.id);
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onFinalize((event, success) => {
      // Fires for failed touches too; the parent ignores ends without a matching start.
      runOnJS(onDragEnd)(clip.id, success ? event.translationX : 0);
      translateX.value = 0;
    });

  const liftedStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: translateX.value }, { scale: lifted ? 1.04 : 1 }],
    }),
    [lifted]
  );

  // ---- Edge-drag trim (PanResponders claim on touch start, before the scroll can) ----
  // Layout stays frozen during the drag: handles/masks move on shared values, the trim commits once on release.
  const startDxPx = useSharedValue(0);
  const endDxPx = useSharedValue(0);
  // Committed trim landing (or zoom relayout) is the moment the draft visuals fold into real widths.
  useEffect(() => {
    startDxPx.value = 0;
    endDxPx.value = 0;
  }, [clip.sourceStartMs, clip.sourceEndMs, width, startDxPx, endDxPx]);

  const latest = useRef({
    clip,
    pxPerMs,
    minDurationMs,
    startMs: clip.sourceStartMs,
    endMs: clip.sourceEndMs,
    onTrimCommit,
    onTrimDragChange,
    onTrimScrub,
    onTrimScrubEnd,
  });
  useEffect(() => {
    latest.current = {
      clip,
      pxPerMs,
      minDurationMs,
      startMs: latest.current.startMs,
      endMs: latest.current.endMs,
      onTrimCommit,
      onTrimDragChange,
      onTrimScrub,
      onTrimScrubEnd,
    };
  });

  const origin = useRef({ startMs: 0, endMs: 0 });
  const coalescer = useRef(createRafCoalescer());
  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  const makeTrimResponder = (edge: 'start' | 'end') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const s = latest.current;
        s.startMs = s.clip.sourceStartMs;
        s.endMs = s.clip.sourceEndMs;
        origin.current = { startMs: s.startMs, endMs: s.endMs };
        startDxPx.value = 0;
        endDxPx.value = 0;
        s.onTrimDragChange(true);
        s.onTrimScrub(edge === 'start' ? s.startMs : s.endMs);
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        if (s.pxPerMs <= 0) return;
        const speed = s.clip.edits.speed;
        const deltaSourceMs = (gesture.dx / s.pxPerMs) * speed;
        const minSourceMs = s.minDurationMs * speed;
        const next =
          edge === 'start'
            ? clamp(origin.current.startMs + deltaSourceMs, 0, s.endMs - minSourceMs)
            : clamp(
                origin.current.endMs + deltaSourceMs,
                s.startMs + minSourceMs,
                s.clip.sourceDurationMs
              );
        const clampedPx =
          ((next - (edge === 'start' ? origin.current.startMs : origin.current.endMs)) / speed) *
          s.pxPerMs;
        if (edge === 'start') {
          s.startMs = next;
          startDxPx.value = clampedPx;
        } else {
          s.endMs = next;
          endDxPx.value = clampedPx;
        }
        coalescer.current.schedule(() => latest.current.onTrimScrub(next));
      },
      onPanResponderRelease: () => releaseTrim(),
      onPanResponderTerminate: () => releaseTrim(),
    });

  const releaseTrim = () => {
    coalescer.current.flush();
    const s = latest.current;
    const startMs = Math.round(s.startMs);
    const endMs = Math.round(s.endMs);
    if (startMs === s.clip.sourceStartMs && endMs === s.clip.sourceEndMs) {
      // Nothing committed, so no relayout will fold the draft back — reset it here.
      // eslint-disable-next-line react-hooks/immutability -- shared-value write is the reanimated JS→UI API
      startDxPx.value = 0;
      // eslint-disable-next-line react-hooks/immutability -- shared-value write is the reanimated JS→UI API
      endDxPx.value = 0;
    } else {
      s.onTrimCommit(s.clip.id, startMs, endMs);
    }
    // Settle (park clock + exact seek) BEFORE re-arming auto-follow, or a UI frame
    // can scroll the timeline to the stale pre-trim clock position.
    s.onTrimScrubEnd();
    s.onTrimDragChange(false);
  };

  const startHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: startDxPx.value }],
  }));
  const endHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: endDxPx.value }],
  }));
  const startMaskStyle = useAnimatedStyle(() => ({
    width: Math.max(startDxPx.value, 0),
  }));
  const endMaskStyle = useAnimatedStyle(() => ({
    width: Math.max(-endDxPx.value, 0),
  }));

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [startResponder] = useState(() => makeTrimResponder('start'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [endResponder] = useState(() => makeTrimResponder('end'));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          { width, height: TIMELINE_TRACK_HEIGHT },
          lifted && styles.liftedWrapper,
          trimming && styles.trimmingWrapper,
          liftedStyle,
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('clipLabel')} ${index + 1}`}
          accessibilityState={{ selected }}
          onPress={() => onSelect(clip.id)}
          style={[
            styles.body,
            { backgroundColor: theme.colors.surface, borderRightColor: theme.colors.background },
          ]}>
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
          {selected && (
            <View
              pointerEvents="none"
              style={[
                styles.selection,
                { borderColor: theme.colors.accent, borderRadius: theme.radius.sm },
              ]}
            />
          )}
        </Pressable>
        {trimming && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.trimMask, styles.trimMaskStart, startMaskStyle]}
            />
            <Animated.View
              pointerEvents="none"
              style={[styles.trimMask, styles.trimMaskEnd, endMaskStyle]}
            />
            <Animated.View
              {...startResponder.panHandlers}
              style={[
                styles.trimHandle,
                styles.trimHandleStart,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
                startHandleStyle,
              ]}>
              <View style={[styles.trimGrip, { backgroundColor: theme.colors.onAccent }]} />
            </Animated.View>
            <Animated.View
              {...endResponder.panHandlers}
              style={[
                styles.trimHandle,
                styles.trimHandleEnd,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
                endHandleStyle,
              ]}>
              <View style={[styles.trimGrip, { backgroundColor: theme.colors.onAccent }]} />
            </Animated.View>
          </>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  liftedWrapper: { zIndex: 10, elevation: 4 },
  trimmingWrapper: { zIndex: 5 },
  body: {
    flex: 1,
    overflow: 'hidden',
    borderRightWidth: 1,
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
    borderWidth: 2,
  },
  // Dims the region a live handle drag is trimming away; layout folds it in on commit.
  trimMask: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  trimMaskStart: { left: 0 },
  trimMaskEnd: { right: 0 },
  trimHandle: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: TRIM_HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trimHandleStart: { left: -TRIM_HANDLE_WIDTH / 2 },
  trimHandleEnd: { right: -TRIM_HANDLE_WIDTH / 2 },
  trimGrip: {
    width: 3,
    height: 16,
    borderRadius: 1.5,
  },
});
