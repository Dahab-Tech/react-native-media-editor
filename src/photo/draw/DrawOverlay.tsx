import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

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
  onStrokeUpdate: (stroke: DrawStroke) => void;
  onStrokeEnd: (stroke: DrawStroke) => void;
}

/** Full-canvas pan capture; JS-paced so live stroke + committed strokes share one pipeline. */
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

  const draft = useRef<{ stroke: DrawStroke; lastX: number; lastY: number } | null>(null);

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [gesture] = useState(() => {
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
      latest.current.onStrokeUpdate({ ...current.stroke, points: [...current.stroke.points] });
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
        s.onStrokeUpdate({ ...stroke, points: [...stroke.points] });
      })
      .onUpdate((e) => {
        appendPoint(e.x, e.y);
      })
      .onFinalize(() => {
        const current = draft.current;
        draft.current = null;
        if (!current) return;
        latest.current.onStrokeEnd({
          ...current.stroke,
          points: [...current.stroke.points],
        });
      });
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false} />
    </GestureDetector>
  );
}
