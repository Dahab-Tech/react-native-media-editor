import {
  Group,
  LinearGradient,
  RadialGradient,
  Rect,
  Image as SkiaImage,
  vec,
  type SkImage,
} from '@shopify/react-native-skia';
import React from 'react';

import type { PhotoOverlayDefinition } from './types';

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayLayerProps {
  definition: PhotoOverlayDefinition | null;
  rect: OverlayRect;
  intensity: number;
  /** Resolved by the parent's useImage; null while loading or when procedural. */
  image: SkImage | null;
}

/** Renders between the photo Paint and the annotation layers so overlays wash the photo, not the user's marks. */
export function OverlayLayer({ definition, rect, intensity, image }: OverlayLayerProps) {
  if (definition == null) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const opacity = clamp01(intensity);
  if (opacity <= 0) return null;

  if (definition.kind === 'procedural') {
    return (
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        opacity={opacity}
        blendMode={definition.blendMode}>
        <OverlayShader shape={definition.shape} rect={rect} />
      </Rect>
    );
  }

  if (!image) return null;
  return (
    <Group clip={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}>
      <SkiaImage
        image={image}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fit="cover"
        opacity={opacity}
        blendMode={definition.blendMode}
      />
    </Group>
  );
}

function OverlayShader({
  shape,
  rect,
}: {
  shape: Extract<PhotoOverlayDefinition, { kind: 'procedural' }>['shape'];
  rect: OverlayRect;
}) {
  if (shape.kind === 'linear') {
    return (
      <LinearGradient
        start={vec(rect.x + shape.start[0] * rect.width, rect.y + shape.start[1] * rect.height)}
        end={vec(rect.x + shape.end[0] * rect.width, rect.y + shape.end[1] * rect.height)}
        colors={shape.colors as string[]}
        positions={shape.positions ? (shape.positions as number[]) : undefined}
      />
    );
  }
  if (shape.kind === 'radial') {
    const longEdge = Math.max(rect.width, rect.height);
    return (
      <RadialGradient
        c={vec(rect.x + shape.center[0] * rect.width, rect.y + shape.center[1] * rect.height)}
        r={shape.radius * longEdge}
        colors={shape.colors as string[]}
        positions={shape.positions ? (shape.positions as number[]) : undefined}
      />
    );
  }
  // Solid fill via a degenerate LinearGradient — cheaper than reaching for a Color paint.
  return (
    <LinearGradient
      start={vec(rect.x, rect.y)}
      end={vec(rect.x + rect.width, rect.y + rect.height)}
      colors={[shape.color, shape.color]}
    />
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
