import { Canvas } from '@shopify/react-native-skia';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { DrawStrokesLayer } from './DrawStrokesLayer';
import type { StrokeRect } from './strokePath';
import { generateStrokeId, type DrawBrush, type DrawStroke } from './types';

// Thinning threshold — move events arrive much denser than the curve needs.
const MIN_POINT_DISTANCE_PX = 2;

export interface DrawOverlayProps {
  displayRect: StrokeRect;
  brush: DrawBrush;
  color: string;
  /** Normalized to the photo rect min dimension. */
  size: number;
  /** Fires per point for ERASER only — live-erase must composite against committed strokes in the parent's saveLayer; paint brushes preview locally. */
  onStrokeUpdate?: (stroke: DrawStroke) => void;
  onStrokeEnd: (stroke: DrawStroke) => void;
}

/** Full-canvas pan capture; live stroke lives in a leaf Skia canvas so per-point updates re-render only this component. Finalize commits once via onStrokeEnd (one undo entry). */
export function DrawOverlay({
  displayRect,
  brush,
  color,
  size,
  onStrokeUpdate,
  onStrokeEnd,
}: DrawOverlayProps) {
  const latest = useRef({ displayRect, brush, color, size, onStrokeUpdate, onStrokeEnd });
  useEffect(() => {
    latest.current = { displayRect, brush, color, size, onStrokeUpdate, onStrokeEnd };
  });

  // Live stroke lives locally — only this leaf re-renders while the finger moves.
  const [liveStroke, setLiveStroke] = useState<DrawStroke | null>(null);
  const draft = useRef<{ stroke: DrawStroke; lastX: number; lastY: number } | null>(null);

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [gesture] = useState(() => {
    const publish = (stroke: DrawStroke) => {
      // New array + object identity so DrawStrokesLayer's per-stroke path memo invalidates.
      const copy = { ...stroke, points: [...stroke.points] };
      if (stroke.brush === 'eraser') {
        // See onStrokeUpdate docs — live-erase needs the parent's committed-strokes layer.
        latest.current.onStrokeUpdate?.(copy);
      } else {
        setLiveStroke(copy);
      }
    };

    const appendPoint = (x: number, y: number) => {
      const current = draft.current;
      const rect = latest.current.displayRect;
      if (!current || rect.width <= 0 || rect.height <= 0) return;
      const dx = x - current.lastX;
      const dy = y - current.lastY;
      if (dx * dx + dy * dy < MIN_POINT_DISTANCE_PX * MIN_POINT_DISTANCE_PX) return;
      current.lastX = x;
      current.lastY = y;
      current.stroke.points.push({
        x: (x - rect.x) / rect.width,
        y: (y - rect.y) / rect.height,
      });
      publish(current.stroke);
    };

    return Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(0)
      .onBegin((e) => {
        const s = latest.current;
        if (s.displayRect.width <= 0 || s.displayRect.height <= 0) return;
        const stroke: DrawStroke = {
          id: generateStrokeId(),
          brush: s.brush,
          color: s.color,
          size: s.size,
          points: [
            {
              x: (e.x - s.displayRect.x) / s.displayRect.width,
              y: (e.y - s.displayRect.y) / s.displayRect.height,
            },
          ],
        };
        draft.current = { stroke, lastX: e.x, lastY: e.y };
        publish(stroke);
      })
      .onUpdate((e) => {
        appendPoint(e.x, e.y);
      })
      .onFinalize(() => {
        const current = draft.current;
        draft.current = null;
        if (!current) return;
        // Parent commits to reducer (one addStroke = one undo entry); clear the local preview so both stacks don't stack.
        latest.current.onStrokeEnd({
          ...current.stroke,
          points: [...current.stroke.points],
        });
        setLiveStroke(null);
      });
  });

  // Live-stroke strokes list is memo-stable per push so DrawStrokesLayer's map key is trivial.
  const liveStrokes = liveStroke ? [liveStroke] : [];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Paint-brush live stroke in isolated canvas — per-point updates re-render only this leaf; eraser bypasses to the parent. */}
      {liveStroke && displayRect.width > 0 && displayRect.height > 0 && (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <DrawStrokesLayer strokes={liveStrokes} rect={displayRect} />
        </Canvas>
      )}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
    </View>
  );
}
