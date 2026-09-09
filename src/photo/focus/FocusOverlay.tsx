import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  focusMaskParams,
  moveFocusCenter,
  rotateFocusBand,
  scaleFocusRegion,
  type FocusRect,
} from './focusMath';
import type { PhotoFocus } from './types';

const GUIDE_COLOR = 'rgba(255,255,255,0.9)';
const GUIDE_COLOR_FAINT = 'rgba(255,255,255,0.35)';
const GUIDE_LINE_WIDTH = 1.5;

export interface FocusOverlayProps {
  displayRect: FocusRect;
  focus: PhotoFocus;
  /** Fired at gesture start; parent checkpoints so pan+pinch+rotate collapse to one undo. */
  onInteractionStart: () => void;
  onChange: (focus: PhotoFocus) => void;
}

/** Simultaneous pan+pinch+rotate; each applies its delta against a per-gesture snapshot so composition doesn't clobber. */
export function FocusOverlay({
  displayRect,
  focus,
  onInteractionStart,
  onChange,
}: FocusOverlayProps) {
  const latest = useRef({ displayRect, focus, onInteractionStart, onChange });
  useEffect(() => {
    latest.current = { displayRect, focus, onInteractionStart, onChange };
  });

  const [activeGestures, setActiveGestures] = useState(0);

  const panStart = useRef<PhotoFocus | null>(null);
  const pinchStart = useRef<PhotoFocus | null>(null);
  const rotateStart = useRef<PhotoFocus | null>(null);

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [gesture] = useState(() => {
    const begin = (slot: React.RefObject<PhotoFocus | null>) => {
      slot.current = latest.current.focus;
      latest.current.onInteractionStart();
      setActiveGestures((n) => n + 1);
    };
    const end = (slot: React.RefObject<PhotoFocus | null>) => {
      if (slot.current == null) return;
      slot.current = null;
      setActiveGestures((n) => Math.max(0, n - 1));
    };

    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .onBegin(() => begin(panStart))
      .onUpdate((e) => {
        const start = panStart.current;
        const s = latest.current;
        if (!start || start.mode === 'off') return;
        const moved = moveFocusCenter(start, e.translationX, e.translationY, s.displayRect);
        if (moved.mode === 'off' || s.focus.mode === 'off') return;
        // Own field from snapshot; others from live so concurrent gestures don't clobber.
        s.onChange({ ...s.focus, centerX: moved.centerX, centerY: moved.centerY });
      })
      .onFinalize(() => end(panStart));

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => begin(pinchStart))
      .onUpdate((e) => {
        const start = pinchStart.current;
        const s = latest.current;
        if (!start || start.mode === 'off' || s.focus.mode === 'off') return;
        const scaled = scaleFocusRegion(start, e.scale);
        if (scaled.mode === 'radial' && s.focus.mode === 'radial') {
          s.onChange({ ...s.focus, radius: scaled.radius });
        } else if (scaled.mode === 'linear' && s.focus.mode === 'linear') {
          s.onChange({ ...s.focus, halfWidth: scaled.halfWidth });
        }
      })
      .onFinalize(() => end(pinchStart));

    const rotate = Gesture.Rotation()
      .runOnJS(true)
      .onBegin(() => begin(rotateStart))
      .onUpdate((e) => {
        const start = rotateStart.current;
        const s = latest.current;
        if (!start || start.mode !== 'linear' || s.focus.mode !== 'linear') return;
        const rotated = rotateFocusBand(start, e.rotation);
        if (rotated.mode !== 'linear') return;
        s.onChange({ ...s.focus, angle: rotated.angle });
      })
      .onFinalize(() => end(rotateStart));

    return Gesture.Simultaneous(pan, pinch, rotate);
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {activeGestures > 0 && focus.mode !== 'off' && (
          <FocusGuide focus={focus} rect={displayRect} />
        )}
      </View>
    </GestureDetector>
  );
}

function FocusGuide({
  focus,
  rect,
}: {
  focus: Exclude<PhotoFocus, { mode: 'off' }>;
  rect: FocusRect;
}) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const mask = focusMaskParams(focus, rect);

  if (focus.mode === 'radial') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <GuideCircle cx={mask.centerX} cy={mask.centerY} r={mask.innerEdge} color={GUIDE_COLOR} />
        <GuideCircle
          cx={mask.centerX}
          cy={mask.centerY}
          r={mask.innerEdge + mask.feather}
          color={GUIDE_COLOR_FAINT}
        />
      </View>
    );
  }

  // Rotated container; lines span past the diagonal so they cross the full photo.
  const span = 2 * Math.hypot(rect.width, rect.height);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          left: mask.centerX - span / 2,
          top: mask.centerY - span / 2,
          width: span,
          height: span,
          transform: [{ rotate: `${focus.angle}rad` }],
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <GuideLine offset={-mask.innerEdge} span={span} color={GUIDE_COLOR} />
        <GuideLine offset={mask.innerEdge} span={span} color={GUIDE_COLOR} />
        <GuideLine
          offset={-(mask.innerEdge + mask.feather)}
          span={span}
          color={GUIDE_COLOR_FAINT}
        />
        <GuideLine offset={mask.innerEdge + mask.feather} span={span} color={GUIDE_COLOR_FAINT} />
      </View>
    </View>
  );
}

function GuideCircle({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        borderWidth: GUIDE_LINE_WIDTH,
        borderColor: color,
      }}
    />
  );
}

function GuideLine({ offset, span, color }: { offset: number; span: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: span / 2 + offset - GUIDE_LINE_WIDTH / 2,
        left: 0,
        width: span,
        height: GUIDE_LINE_WIDTH,
        backgroundColor: color,
      }}
    />
  );
}
