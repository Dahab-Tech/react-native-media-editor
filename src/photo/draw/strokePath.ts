import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { DrawPoint } from './types';

export interface StrokeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Quadratic-midpoint smoothed path; pure fn ⇒ live and export land identical geometry. */
export function buildStrokePath(points: readonly DrawPoint[], rect: StrokeRect): SkPath {
  const builder = Skia.PathBuilder.Make();
  if (points.length === 0) return builder.detach();

  const px = (p: DrawPoint) => ({
    x: rect.x + p.x * rect.width,
    y: rect.y + p.y * rect.height,
  });

  const first = px(points[0]);
  builder.moveTo(first.x, first.y);

  if (points.length === 1) {
    // Round caps render this as a visible dot.
    builder.lineTo(first.x + 0.01, first.y);
    return builder.detach();
  }
  if (points.length === 2) {
    const second = px(points[1]);
    builder.lineTo(second.x, second.y);
    return builder.detach();
  }

  // points[i] is the control; midpoints are on-curve. First/last hit exactly via moveTo + closing lineTo.
  for (let i = 1; i < points.length - 1; i++) {
    const control = px(points[i]);
    const next = px(points[i + 1]);
    const midX = (control.x + next.x) / 2;
    const midY = (control.y + next.y) / 2;
    builder.quadTo(control.x, control.y, midX, midY);
  }
  const last = px(points[points.length - 1]);
  builder.lineTo(last.x, last.y);
  return builder.detach();
}

/** Fraction of min(width, height) so portrait and landscape read the same weight. */
export function strokeWidthPx(size: number, rect: StrokeRect): number {
  return size * Math.min(rect.width, rect.height);
}
