/* eslint-disable react-hooks/immutability -- Reanimated shared values are hook-owned mutable containers. Worklets assign to `.value` on the UI thread; that is the intended API and not a component-prop mutation. */
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
// Reanimated 4 deprecates its `runOnJS` re-export; use `scheduleOnRN` from react-native-worklets (uncurried).
import { scheduleOnRN } from 'react-native-worklets';

import { useEditorTheme } from '../../core/theming/ThemeContext';
import type { Clip, PipTransform } from '../project/model';
import { PIP_SCALE_MAX, PIP_SCALE_MIN } from '../project/reducer';

// Position: 2% of canvas dim; rotation snaps to quarter turns within ~3°.
const POSITION_SNAP = 0.02;
const ROTATION_SNAP_DEG = 3;
const ROTATION_ANCHORS_DEG = [-180, -90, 0, 90, 180];
const HANDLE_SIZE = 12;

export interface PipGhostOverlayProps {
  /** The selected pip clip; `placement` is always present. */
  clip: Clip;
  /** Canvas content rect in view px — normalized pip coordinates map onto it. */
  displayRect: { x: number; y: number; width: number; height: number };
  /** Fired on gesture release with the full next transform (ghost pattern: video moves on recompile). */
  onCommit: (transform: PipTransform) => void;
}

/** Manipulation frame over the preview at the pip's transform: drag/pinch/rotate live, commit on release. */
export function PipGhostOverlay({ clip, displayRect, onCommit }: PipGhostOverlayProps) {
  const theme = useEditorTheme();
  const transform = clip.placement?.transform;
  const crop = clip.edits.crop;
  const contentW = crop ? crop.width : clip.info.width;
  const contentH = crop ? crop.height : clip.info.height;
  // Scale-1 box = the pip aspect-fitted into the canvas, matching the native compilers' fitted rect.
  const fit = Math.min(displayRect.width / contentW, displayRect.height / contentH);
  const baseW = contentW * fit;
  const baseH = contentH * fit;

  const x = transform?.x ?? 0.5;
  const y = transform?.y ?? 0.5;
  const committedScale = transform?.scale ?? 1;
  const committedRotation = transform?.rotation ?? 0;
  const opacity = transform?.opacity ?? 1;

  // Live center in view px — UI-thread SoT; commit the normalized value on release with no reset, dodging reducer round-trip flicker.
  const centerXPx = useSharedValue(displayRect.x + x * displayRect.width);
  const centerYPx = useSharedValue(displayRect.y + y * displayRect.height);

  // Last-committed normalized + cached rect so the sync effect distinguishes "reducer echoed our commit" from "container resized".
  const lastCommittedX = useSharedValue(x);
  const lastCommittedY = useSharedValue(y);
  const lastRectX = useSharedValue(displayRect.x);
  const lastRectY = useSharedValue(displayRect.y);
  const lastRectW = useSharedValue(displayRect.width);
  const lastRectH = useSharedValue(displayRect.height);

  const scale = useSharedValue(committedScale);
  const rotationDeg = useSharedValue(committedRotation);
  const scaleStart = useSharedValue(committedScale);
  const rotationStart = useSharedValue(committedRotation);

  // Raw finger travel + pan start so snap can override applied position without eating subsequent movement.
  const rawTranslateX = useSharedValue(0);
  const rawTranslateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  const showVerticalGuide = useSharedValue(0);
  const showHorizontalGuide = useSharedValue(0);

  // Re-project position only on external updates or rect resize — never on our own reducer echo (release flicker).
  useEffect(() => {
    const rectChanged =
      lastRectX.value !== displayRect.x ||
      lastRectY.value !== displayRect.y ||
      lastRectW.value !== displayRect.width ||
      lastRectH.value !== displayRect.height;
    if (x !== lastCommittedX.value || rectChanged) {
      centerXPx.value = displayRect.x + x * displayRect.width;
      lastCommittedX.value = x;
    }
    if (y !== lastCommittedY.value || rectChanged) {
      centerYPx.value = displayRect.y + y * displayRect.height;
      lastCommittedY.value = y;
    }
    lastRectX.value = displayRect.x;
    lastRectY.value = displayRect.y;
    lastRectW.value = displayRect.width;
    lastRectH.value = displayRect.height;
    scale.value = committedScale;
    rotationDeg.value = committedRotation;
  }, [
    x,
    y,
    committedScale,
    committedRotation,
    displayRect.x,
    displayRect.y,
    displayRect.width,
    displayRect.height,
    centerXPx,
    centerYPx,
    scale,
    rotationDeg,
    lastCommittedX,
    lastCommittedY,
    lastRectX,
    lastRectY,
    lastRectW,
    lastRectH,
  ]);

  // Simultaneous pinch/rotate/pan finalize together; drop the duplicate near-identical commits.
  const lastSentRef = useRef<PipTransform | null>(null);
  useEffect(() => {
    lastSentRef.current = null;
  }, [x, y, committedScale, committedRotation]);

  const rectX = displayRect.x;
  const rectY = displayRect.y;
  const rectW = displayRect.width;
  const rectH = displayRect.height;

  const gestures = useMemo(() => {
    const commit = (cxPx: number, cyPx: number, s: number, rDeg: number) => {
      const next: PipTransform = {
        x: clamp01((cxPx - rectX) / rectW),
        y: clamp01((cyPx - rectY) / rectH),
        scale: s,
        rotation: rDeg,
        opacity,
      };
      const last = lastSentRef.current ?? {
        x,
        y,
        scale: committedScale,
        rotation: committedRotation,
        opacity,
      };
      if (
        Math.abs(next.x - last.x) <= 1e-4 &&
        Math.abs(next.y - last.y) <= 1e-4 &&
        Math.abs(next.scale - last.scale) <= 1e-4 &&
        Math.abs(next.rotation - last.rotation) <= 1e-2
      ) {
        return;
      }
      lastSentRef.current = next;
      onCommit(next);
    };

    const finalize = () => {
      'worklet';
      showVerticalGuide.value = withTiming(0, { duration: 160 });
      showHorizontalGuide.value = withTiming(0, { duration: 160 });
      // Pre-write the committed normalized values so the sync effect no-ops on the reducer round-trip.
      lastCommittedX.value = clamp01((centerXPx.value - rectX) / rectW);
      lastCommittedY.value = clamp01((centerYPx.value - rectY) / rectH);
      scheduleOnRN(commit, centerXPx.value, centerYPx.value, scale.value, rotationDeg.value);
    };

    const pan = Gesture.Pan()
      .minDistance(2)
      .onStart(() => {
        panStartX.value = centerXPx.value;
        panStartY.value = centerYPx.value;
        rawTranslateX.value = 0;
        rawTranslateY.value = 0;
      })
      .onChange((e) => {
        rawTranslateX.value += e.changeX;
        rawTranslateY.value += e.changeY;

        const proposedX = panStartX.value + rawTranslateX.value;
        const proposedY = panStartY.value + rawTranslateY.value;

        const rectCenterX = rectX + rectW / 2;
        const rectCenterY = rectY + rectH / 2;

        if (Math.abs(proposedX - rectCenterX) < POSITION_SNAP * rectW) {
          centerXPx.value = rectCenterX;
          showVerticalGuide.value = withTiming(1, { duration: 90 });
        } else {
          centerXPx.value = proposedX;
          showVerticalGuide.value = withTiming(0, { duration: 140 });
        }
        if (Math.abs(proposedY - rectCenterY) < POSITION_SNAP * rectH) {
          centerYPx.value = rectCenterY;
          showHorizontalGuide.value = withTiming(1, { duration: 90 });
        } else {
          centerYPx.value = proposedY;
          showHorizontalGuide.value = withTiming(0, { duration: 140 });
        }
      })
      // eslint-disable-next-line react-hooks/refs -- lastSentRef is read at gesture end, never during render.
      .onFinalize(finalize);

    const pinch = Gesture.Pinch()
      .onStart(() => {
        scaleStart.value = scale.value;
      })
      .onChange((e) => {
        scale.value = Math.min(PIP_SCALE_MAX, Math.max(PIP_SCALE_MIN, scaleStart.value * e.scale));
      })
      // eslint-disable-next-line react-hooks/refs -- lastSentRef is read at gesture end, never during render.
      .onFinalize(finalize);

    const rotate = Gesture.Rotation()
      .onStart(() => {
        rotationStart.value = rotationDeg.value;
      })
      .onChange((e) => {
        let next = rotationStart.value + (e.rotation * 180) / Math.PI;
        for (const anchor of ROTATION_ANCHORS_DEG) {
          if (Math.abs(next - anchor) < ROTATION_SNAP_DEG) {
            next = anchor;
            break;
          }
        }
        rotationDeg.value = next;
      })
      // eslint-disable-next-line react-hooks/refs -- lastSentRef is read at gesture end, never during render.
      .onFinalize(finalize);

    return Gesture.Simultaneous(pan, pinch, rotate);
  }, [
    rectX,
    rectY,
    rectW,
    rectH,
    x,
    y,
    committedScale,
    committedRotation,
    opacity,
    onCommit,
    centerXPx,
    centerYPx,
    rawTranslateX,
    rawTranslateY,
    panStartX,
    panStartY,
    scale,
    rotationDeg,
    scaleStart,
    rotationStart,
    lastCommittedX,
    lastCommittedY,
    showVerticalGuide,
    showHorizontalGuide,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    left: centerXPx.value - baseW / 2,
    top: centerYPx.value - baseH / 2,
    transform: [{ rotate: `${rotationDeg.value}deg` }, { scale: scale.value }],
  }));

  const verticalStyle = useAnimatedStyle(() => ({ opacity: showVerticalGuide.value }));
  const horizontalStyle = useAnimatedStyle(() => ({ opacity: showHorizontalGuide.value }));

  const dotStyle = {
    position: 'absolute' as const,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: theme.colors.accent,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  };
  const dotOffset = -HANDLE_SIZE / 2;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.guide,
          {
            left: rectX + rectW / 2 - 0.5,
            top: rectY,
            width: 1,
            height: rectH,
            backgroundColor: theme.colors.accent,
          },
          verticalStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.guide,
          {
            left: rectX,
            top: rectY + rectH / 2 - 0.5,
            width: rectW,
            height: 1,
            backgroundColor: theme.colors.accent,
          },
          horizontalStyle,
        ]}
      />
      <GestureDetector gesture={gestures}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: baseW,
              height: baseH,
              borderWidth: 1.5,
              borderColor: theme.colors.accent,
              borderStyle: 'dashed',
            },
            animatedStyle,
          ]}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[dotStyle, { top: dotOffset, left: dotOffset }]} />
            <View style={[dotStyle, { top: dotOffset, right: dotOffset }]} />
            <View style={[dotStyle, { bottom: dotOffset, left: dotOffset }]} />
            <View style={[dotStyle, { bottom: dotOffset, right: dotOffset }]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function clamp01(v: number): number {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

const styles = StyleSheet.create({
  guide: {
    position: 'absolute',
  },
});
