import { BlurMask, Group, Path } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';

import { buildStrokePath, strokeWidthPx, type StrokeRect } from './strokePath';
import type { DrawStroke } from './types';

const MARKER_OPACITY = 0.5;
// Neon pass geometry, all relative to stroke width so the glow scales with size + resolution.
const NEON_HALO_WIDTH_RATIO = 2.2;
const NEON_HALO_BLUR_RATIO = 0.9;
const NEON_HALO_OPACITY = 0.85;
const NEON_CORE_WIDTH_RATIO = 0.45;
const NEON_CORE_COLOR = '#FFFFFF';

export interface DrawStrokesLayerProps {
  strokes: readonly DrawStroke[];
  rect: StrokeRect;
}

/** One saveLayer for the whole stack so the eraser's BlendMode.Clear scopes to strokes, not the photo. */
export function DrawStrokesLayer({ strokes, rect }: DrawStrokesLayerProps) {
  if (strokes.length === 0 || rect.width <= 0 || rect.height <= 0) return null;
  return (
    <Group layer clip={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}>
      {strokes.map((stroke) => (
        <StrokeGlyph key={stroke.id} stroke={stroke} rect={rect} />
      ))}
    </Group>
  );
}

function StrokeGlyph({ stroke, rect }: { stroke: DrawStroke; rect: StrokeRect }) {
  const path = useMemo(() => buildStrokePath(stroke.points, rect), [stroke.points, rect]);
  const width = strokeWidthPx(stroke.size, rect);
  const common = {
    path,
    style: 'stroke',
    strokeCap: 'round',
    strokeJoin: 'round',
  } as const;

  switch (stroke.brush) {
    case 'pen':
      return <Path {...common} strokeWidth={width} color={stroke.color} />;
    case 'marker':
      return <Path {...common} strokeWidth={width} color={stroke.color} opacity={MARKER_OPACITY} />;
    case 'neon':
      // Three passes bottom-up: halo → body → hot core.
      return (
        <>
          <Path
            {...common}
            strokeWidth={width * NEON_HALO_WIDTH_RATIO}
            color={stroke.color}
            opacity={NEON_HALO_OPACITY}>
            <BlurMask blur={width * NEON_HALO_BLUR_RATIO} style="normal" />
          </Path>
          <Path {...common} strokeWidth={width} color={stroke.color} />
          <Path {...common} strokeWidth={width * NEON_CORE_WIDTH_RATIO} color={NEON_CORE_COLOR} />
        </>
      );
    case 'eraser':
      // Clears within the enclosing saveLayer; color is ignored by BlendMode.Clear.
      return <Path {...common} strokeWidth={width} color="#000000" blendMode="clear" />;
  }
}
