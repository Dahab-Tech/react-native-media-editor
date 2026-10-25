import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { OverlayLane, type OverlayLaneModel } from './OverlayLane';
import { PipLane, type PipLaneModel } from './PipLane';
import { TimeRuler } from './TimeRuler';
import { TIMELINE_TRACK_HEIGHT, TimelineClip } from './TimelineClip';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import type { PlaybackClock } from '../player/TimelinePlayer';
import type { Clip } from '../project/model';
import { clipDurationMs } from '../project/timelineIndex';

const DEFAULT_PX_PER_SECOND = 48;
const MIN_PX_PER_SECOND = 12;
const MAX_PX_PER_SECOND = 240;
/** Zoom updates below this relative change are dropped to keep re-renders sparse. */
const ZOOM_EPSILON = 0.02;
const ADD_TILE_WIDTH = 44;
/** Clock-vs-displayed gaps beyond this snap (seeks, zoom anchors); smaller gaps blend out. */
const FOLLOW_SNAP_PX = 56;
/** Per-frame fraction of the clock error folded into the dead-reckoned position. */
const FOLLOW_CORRECTION = 0.12;
/** Consecutive motionless frames (finger up) before the scrub settles. */
const SETTLE_STILL_FRAMES = 5;
/**
 * Offset changes below this don't emit a scrub. Finger tremor jitters the offset ±1px, making
 * seek targets non-monotonic; a backward wiggle across a source-frame boundary flashes the
 * previous frame (the slow-scrub twitch). The band is in px because tremor is.
 */
const SCRUB_DEADBAND_PX = 2;

export interface TimelineAreaProps {
  clips: readonly Clip[];
  selectedClipId: string;
  /** Clip sub-toolbar open — the selected clip shows trim handles. */
  clipFocused: boolean;
  /** Playback clock the area follows; scrolling scrubs back through `onScrub` seeks. */
  clock: SharedValue<PlaybackClock | null>;
  /**
   * UI-thread scrub channel (TimelinePlayer's `scrubMs`). When set, scroll-scrub positions are
   * written here from the scroll worklet — seeks reach native without touching the JS thread —
   * and `onScrub` is skipped for scroll scrubs. `onScrubBegin`/`onScrubEnd` still fire on JS.
   */
  scrubMs?: SharedValue<number>;
  /** Fires once per touch-down on the scroll surface, before any scrub position is emitted. */
  onScrubBegin?: () => void;
  overlays: readonly OverlayLaneModel[];
  selectedOverlayId: string | null;
  pips: readonly PipLaneModel[];
  minDurationMs: number;
  onSelectClip: (id: string) => void;
  onMoveClip: (id: string, toIndex: number) => void;
  onAddPress?: () => void;
  /** Continuous during a user scroll-scrub or lane drag, in timeline ms. */
  onScrub: (timelineMs: number) => void;
  onScrubEnd: (timelineMs: number) => void;
  /** Fires once per handle release with the final trimmed window, in source ms. */
  onTrimCommit: (clipId: string, sourceStartMs: number, sourceEndMs: number) => void;
  /** Frame preview at a dragged trim edge, in the clip's source-time domain. */
  onTrimScrub: (sourceMs: number) => void;
  onTrimScrubEnd: () => void;
  onSelectOverlay: (overlayId: string) => void;
  onOverlayWindowCommit: (overlayId: string, startMs: number, endMs: number) => void;
  onPipWindowCommit: (trackId: string, timelineStartMs: number, laneDelta: number) => void;
  onPipTrimCommit: (
    trackId: string,
    clipId: string,
    sourceStartMs: number,
    sourceEndMs: number,
    timelineStartMs: number
  ) => void;
}

/** CapCut-style timeline: one scroll surface with a fixed center playhead — ruler, clip track, overlay lanes. Scroll scrubs, pinch zooms, playback auto-follows. */
export function TimelineArea({
  clips,
  selectedClipId,
  clipFocused,
  clock,
  scrubMs,
  onScrubBegin,
  overlays,
  selectedOverlayId,
  pips,
  minDurationMs,
  onSelectClip,
  onMoveClip,
  onAddPress,
  onScrub,
  onScrubEnd,
  onTrimCommit,
  onTrimScrub,
  onTrimScrubEnd,
  onSelectOverlay,
  onOverlayWindowCommit,
  onPipWindowCommit,
  onPipTrimCommit,
}: TimelineAreaProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const userScrubbing = useSharedValue(false);
  const lastAutoX = useSharedValue(-1);
  const [dragClipId, setDragClipId] = useState<string | null>(null);
  const dragClipRef = useRef<string | null>(null);
  // Edge/lane drags and pinches lock scrolling so the surface doesn't pan underneath.
  const [handleDragging, setHandleDragging] = useState(false);
  // Worklet mirror, written before the grant-time scrub seek — the follow callback would
  // otherwise center the dragged edge before the React effect deactivates it.
  const handleDraggingSv = useSharedValue(false);
  const [pinching, setPinching] = useState(false);
  const setHandleDrag = (dragging: boolean) => {
    handleDraggingSv.value = dragging;
    setHandleDragging(dragging);
  };

  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const pxPerMs = pxPerSecond / 1000;

  const durationMs = clips.reduce((sum, clip) => sum + clipDurationMs(clip), 0);
  const widths = clips.map((clip) => Math.max(clipDurationMs(clip) * pxPerMs, 8));
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  // Worklet-readable mirrors for the follow callback and pinch anchoring.
  const pxPerMsSv = useSharedValue(pxPerMs);
  const totalWidthSv = useSharedValue(totalWidth);
  useEffect(() => {
    pxPerMsSv.value = pxPerMs;
    totalWidthSv.value = totalWidth;
  }, [pxPerMs, totalWidth, pxPerMsSv, totalWidthSv]);

  const offsetToMs = (offsetX: number) =>
    pxPerMs > 0 ? Math.min(Math.max(offsetX, 0), totalWidth) / pxPerMs : 0;
  const emitScrub = (offsetX: number) => onScrub(offsetToMs(offsetX));
  const emitScrubEnd = (offsetX: number) => onScrubEnd(offsetToMs(offsetX));

  // Follow must stay parked until the settle seek writes the clock: clearing the flag on the
  // UI thread re-enabled it against the stale in-scrub clock (the last throttled seek), so the
  // surface snapped back and then forward once the settle landed — the post-fling stutter.
  const scrubSeq = useSharedValue(0);
  const finishScrub = (offsetX: number, seq: number) => {
    emitScrubEnd(offsetX);
    if (scrubSeq.value === seq) userScrubbing.value = false;
  };

  // Settle detection is quiescence-based: momentum events and end-drag velocities are not
  // trustworthy across platforms (Android reports velocity 0 mid-fling; a momentum-begin
  // grace window raced event delivery), and any early settle re-enables follow, whose first
  // scrollTo cancels the live momentum — the post-fling jump-back. "Finger up + offset
  // motionless for N frames" cannot fire early by construction.
  const fingerDown = useSharedValue(false);
  const scrollX = useSharedValue(0);
  const stillFrames = useSharedValue(0);
  const lastStillX = useSharedValue(-1);
  const lastScrubX = useSharedValue(Number.NEGATIVE_INFINITY);

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      scrubSeq.value += 1;
      userScrubbing.value = true;
      fingerDown.value = true;
      lastScrubX.value = Number.NEGATIVE_INFINITY;
      // Pause + native scrub mode engage on touch-down, ahead of the first position write.
      if (onScrubBegin) runOnJS(onScrubBegin)();
    },
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      if (!userScrubbing.value) return;
      if (Math.abs(event.contentOffset.x - lastScrubX.value) < SCRUB_DEADBAND_PX) return;
      lastScrubX.value = event.contentOffset.x;
      if (scrubMs) {
        const ms =
          pxPerMsSv.value > 0
            ? Math.min(Math.max(event.contentOffset.x, 0), totalWidthSv.value) / pxPerMsSv.value
            : 0;
        // eslint-disable-next-line react-hooks/immutability -- worklet shared-value write is the reanimated UI-thread API; feeds the native scrub prop.
        scrubMs.value = ms;
        // Keep gates and the time label live during native-channel scrubs; rate 0 makes the
        // epoch irrelevant (no extrapolation).
        // eslint-disable-next-line react-hooks/immutability -- same: UI-thread clock write while scrubbing.
        clock.value = { positionMs: ms, epochMs: 0, rate: 0 };
      } else {
        runOnJS(emitScrub)(event.contentOffset.x);
      }
    },
    onEndDrag: (event) => {
      fingerDown.value = false;
      scrollX.value = event.contentOffset.x;
      lastStillX.value = event.contentOffset.x;
      stillFrames.value = 0;
    },
  });

  // Auto-follow doubles as the zoom anchor: x recomputes from the playhead time at the current scale.
  // While playing, the surface dead-reckons at the clock rate and only *blends* toward the
  // extrapolated clock: each native tick rebases epochMs at JS handling time, so raw targets
  // jitter by the (variable) delivery latency — hard-snapping them jiggled the timeline at tick
  // cadence. Discontinuities (seeks, zoom re-anchors, resume catch-up) still snap.
  const followX = useSharedValue(-1);
  const follow = useFrameCallback((frame) => {
    'worklet';
    if (userScrubbing.value && !fingerDown.value) {
      if (scrollX.value !== lastStillX.value) {
        lastStillX.value = scrollX.value;
        stillFrames.value = 0;
      } else {
        stillFrames.value += 1;
        if (stillFrames.value === SETTLE_STILL_FRAMES) {
          runOnJS(finishScrub)(scrollX.value, scrubSeq.value);
        }
      }
    }
    if (userScrubbing.value || handleDraggingSv.value) {
      followX.value = -1;
      return;
    }
    const snap = clock.value;
    if (snap == null) return;
    const positionMs = snap.positionMs + (frame.timestamp - snap.epochMs) * snap.rate;
    const target = Math.min(Math.max(positionMs * pxPerMsSv.value, 0), totalWidthSv.value);
    let x = target;
    if (
      snap.rate !== 0 &&
      followX.value >= 0 &&
      Math.abs(target - followX.value) <= FOLLOW_SNAP_PX
    ) {
      const dt = frame.timeSincePreviousFrame ?? 16.7;
      const reckoned = followX.value + snap.rate * pxPerMsSv.value * dt;
      x = Math.min(
        Math.max(reckoned + (target - reckoned) * FOLLOW_CORRECTION, 0),
        totalWidthSv.value
      );
    }
    followX.value = x;
    if (Math.abs(x - lastAutoX.value) < 0.5) return;
    lastAutoX.value = x;
    scrollTo(scrollRef, x, 0, false);
  }, false);
  // Auto-follow yields while a segment reorder or handle drag is live.
  useEffect(() => {
    follow.setActive(dragClipId == null && !handleDragging);
  }, [dragClipId, handleDragging, follow]);

  const pinchBase = useSharedValue(DEFAULT_PX_PER_SECOND);
  const lastSentZoom = useSharedValue(DEFAULT_PX_PER_SECOND);
  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchBase.value = pxPerMsSv.value * 1000;
      lastSentZoom.value = pinchBase.value;
      runOnJS(setPinching)(true);
    })
    .onUpdate((event) => {
      const next = Math.min(
        Math.max(pinchBase.value * event.scale, MIN_PX_PER_SECOND),
        MAX_PX_PER_SECOND
      );
      if (Math.abs(next - lastSentZoom.value) / lastSentZoom.value < ZOOM_EPSILON) return;
      lastSentZoom.value = next;
      runOnJS(setPxPerSecond)(next);
    })
    .onFinalize(() => {
      runOnJS(setPinching)(false);
    });

  const beginDrag = (id: string) => {
    dragClipRef.current = id;
    setDragClipId(id);
  };

  const endDrag = (id: string, translationX: number) => {
    if (dragClipRef.current !== id) return;
    dragClipRef.current = null;
    setDragClipId(null);
    const from = clips.findIndex((clip) => clip.id === id);
    if (from === -1 || translationX === 0) return;
    const originCenter = widths.slice(0, from).reduce((sum, w) => sum + w, 0) + widths[from] / 2;
    const target = originCenter + translationX;
    let acc = 0;
    let to = clips.length - 1;
    for (let i = 0; i < widths.length; i += 1) {
      if (target < acc + widths[i]) {
        to = i;
        break;
      }
      acc += widths[i];
    }
    if (to !== from) onMoveClip(id, to);
  };

  return (
    <GestureDetector gesture={pinch}>
      <View
        style={{ paddingVertical: theme.spacing.sm }}
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
        <View>
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={dragClipId == null && !handleDragging && !pinching}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.content, { paddingHorizontal: containerWidth / 2 }]}>
            <View>
              <TimeRuler durationMs={durationMs} pxPerSecond={pxPerSecond} />
              <View style={styles.clipRow}>
                {clips.map((clip, index) => (
                  <TimelineClip
                    key={clip.id}
                    clip={clip}
                    index={index}
                    width={widths[index]}
                    pxPerMs={pxPerMs}
                    selected={clip.id === selectedClipId}
                    trimming={clipFocused && clip.id === selectedClipId}
                    minDurationMs={minDurationMs}
                    lifted={clip.id === dragClipId}
                    onSelect={onSelectClip}
                    onDragStart={beginDrag}
                    onDragEnd={endDrag}
                    onTrimCommit={onTrimCommit}
                    onTrimDragChange={setHandleDrag}
                    onTrimScrub={onTrimScrub}
                    onTrimScrubEnd={onTrimScrubEnd}
                  />
                ))}
                {onAddPress && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('addClip')}
                    onPress={onAddPress}
                    style={[
                      styles.addTile,
                      {
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radius.sm,
                        marginStart: theme.spacing.xs,
                      },
                    ]}>
                    <EditorIcon name="add" size={20} color={theme.colors.accent} />
                  </Pressable>
                )}
              </View>
              {pips.length > 0 && (
                <View style={{ width: totalWidth }}>
                  {pips.map((lane) => (
                    <PipLane
                      key={lane.trackId}
                      lane={lane}
                      pxPerMs={pxPerMs}
                      durationMs={durationMs}
                      minDurationMs={minDurationMs}
                      selected={lane.clip.id === selectedClipId}
                      onSelect={onSelectClip}
                      onWindowCommit={onPipWindowCommit}
                      onTrimCommit={onPipTrimCommit}
                      onScrub={onScrub}
                      onScrubEnd={onScrubEnd}
                      onDragChange={setHandleDrag}
                    />
                  ))}
                </View>
              )}
              {overlays.length > 0 && (
                <View style={{ width: totalWidth }}>
                  {overlays.map((lane) => (
                    <OverlayLane
                      key={lane.id}
                      lane={lane}
                      pxPerMs={pxPerMs}
                      durationMs={durationMs}
                      selected={lane.id === selectedOverlayId}
                      onSelect={onSelectOverlay}
                      onWindowCommit={onOverlayWindowCommit}
                      onScrub={onScrub}
                      onScrubEnd={onScrubEnd}
                      onDragChange={setHandleDrag}
                    />
                  ))}
                </View>
              )}
            </View>
          </Animated.ScrollView>
          <View pointerEvents="none" style={styles.playhead} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Time axis stays LTR in RTL locales (matches platform video players).
  content: {
    direction: 'ltr',
    alignItems: 'flex-start',
  },
  clipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TIMELINE_TRACK_HEIGHT,
  },
  addTile: {
    width: ADD_TILE_WIDTH,
    height: TIMELINE_TRACK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pinned white over video thumbnails (theme-independent, like platform players).
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    marginLeft: -1.5,
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.35)',
  },
});
