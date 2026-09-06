import { Group, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import React from 'react';

import { LayerGlyph } from '../../photo/components/PhotoRenderLayers';
import { DrawStrokesLayer } from '../../photo/draw/DrawStrokesLayer';
import type { DrawStroke } from '../../photo/draw/types';
import type { PhotoLayer, PhotoStickerPack } from '../../photo/layers';
import { OverlayLayer, type PhotoOverlayDefinition } from '../../photo/overlays';
import type { PhotoCustomFont } from '../../photo/text';

export interface VideoOverlayRenderProps {
  /** Size of the render rect in pixels — display rect for preview, post-crop output for export. */
  outputWidth: number;
  outputHeight: number;
  /** Overlay layers, drawn in array order (last = topmost). */
  layers: readonly PhotoLayer[];
  /** Draw-tool strokes normalized over the same rect. */
  strokes: readonly DrawStroke[];
  /** Base font size, multiplied per-layer by `scale`. */
  baseFontSize: number;
  /** Base sticker size, multiplied per-layer by `scale`. */
  baseStickerSize: number;
  /** Resolved image-sticker SkImages. */
  stickerImages: Readonly<Record<string, SkImage>>;
  /** Consumer custom fonts. */
  customFonts?: readonly PhotoCustomFont[];
  /** Consumer custom-font typeface provider — null when none. */
  customFontTypefaces: SkTypefaceFontProvider | null;
  /** Consumer sticker packs. */
  stickerPacks?: readonly PhotoStickerPack[];
  /** Optional color-overlay wash baked below layers in the export raster. */
  overlayDefinition?: PhotoOverlayDefinition | null;
  /** Overlay strength in [0, 1]. */
  overlayIntensity?: number;
  /** Resolved SkImage for image-variant overlays. */
  overlayImage?: SkImage | null;
}

/** Skia render tree for the video overlay stack. Reused for both live canvas and export raster. */
export function VideoOverlayRender({
  outputWidth,
  outputHeight,
  layers,
  strokes,
  baseFontSize,
  baseStickerSize,
  stickerImages,
  customFonts,
  customFontTypefaces,
  stickerPacks,
  overlayDefinition,
  overlayIntensity = 1,
  overlayImage,
}: VideoOverlayRenderProps) {
  const drawRect = { x: 0, y: 0, width: outputWidth, height: outputHeight };
  return (
    <Group>
      {overlayDefinition != null && (
        <OverlayLayer
          definition={overlayDefinition}
          rect={drawRect}
          intensity={overlayIntensity}
          image={overlayImage ?? null}
        />
      )}
      <DrawStrokesLayer strokes={strokes} rect={drawRect} />
      {layers.map((layer) => (
        <LayerGlyph
          key={layer.id}
          layer={layer}
          drawRect={drawRect}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerImages={stickerImages}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
          stickerPacks={stickerPacks}
        />
      ))}
    </Group>
  );
}
