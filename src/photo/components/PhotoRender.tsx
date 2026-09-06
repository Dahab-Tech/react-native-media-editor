import {
  ColorMatrix,
  Group,
  ImageFilter,
  Image as SkiaImage,
  Paint,
  RuntimeShader,
  useImage,
  type SkImage,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import React, { useMemo } from 'react';

import {
  anyNonNeutral,
  buildColorShaderUniforms,
  buildLutImageFilter,
  composeAdjustmentMatrix,
  composeFilterMatrix,
  getColorShader,
  isIdentityMatrix,
  ORIGINAL_FILTER_ID,
  resolveFilter,
  SHADER_KEYS,
  type PhotoAdjustments,
  type PhotoFilterId,
  type PhotoFilterPack,
} from '../color';
import { DrawStrokesLayer } from '../draw/DrawStrokesLayer';
import { type DrawStroke } from '../draw/types';
import { buildFocusImageFilter } from '../focus/focusShader';
import { type PhotoFocus } from '../focus/types';
import { type PhotoLayer } from '../layers';
import {
  OverlayLayer,
  resolveOverlay,
  type PhotoOverlayId,
  type PhotoOverlayPack,
} from '../overlays';
import { type NormalizedCrop } from '../state/photoEditorState';
import { type PhotoCustomFont } from '../text';
import { EmojiStickerGlyph, LayerGlyph } from './PhotoRenderLayers';

export { EmojiStickerGlyph };

export interface PhotoRenderProps {
  image: SkImage;
  outputWidth: number;
  outputHeight: number;
  crop: NormalizedCrop;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  /** Fine-angle straighten in degrees applied about the crop center, after 90°-step + flip. */
  straighten?: number;
  adjustments: PhotoAdjustments;
  filterId: PhotoFilterId;
  /** Filter strength [0, 1]. */
  filterIntensity: number;
  filterPacks?: readonly PhotoFilterPack[];
  overlayId: PhotoOverlayId;
  /** Overlay strength [0, 1]. */
  overlayIntensity: number;
  overlayPacks?: readonly PhotoOverlayPack[];
  /** Rendered in array order (last = topmost). */
  layers: PhotoLayer[];
  /** Rendered above the photo/color pipeline and below `layers`. */
  strokes: readonly DrawStroke[];
  /** Selective blur; attached as the last image-filter stage so strokes/layers stay sharp. */
  focus: PhotoFocus;
  baseFontSize: number;
  baseStickerSize: number;
  /** SkImages for image-variant stickers, keyed by `${packId}::${stickerId}` (rules of hooks — resolved one level up). */
  stickerImages: Readonly<Record<string, SkImage>>;
  customFonts?: readonly PhotoCustomFont[];
  /** Paragraph typeface provider for consumer custom fonts; built-ins use the system font manager. */
  customFontTypefaces: SkTypefaceFontProvider | null;
}

/** Draws the full editor pipeline into a Skia tree; same subtree drives preview and export. */
export function PhotoRender({
  image,
  outputWidth,
  outputHeight,
  crop,
  rotation,
  flipHorizontal,
  straighten = 0,
  adjustments,
  filterId,
  filterIntensity,
  filterPacks,
  overlayId,
  overlayIntensity,
  overlayPacks,
  layers,
  strokes,
  focus,
  baseFontSize,
  baseStickerSize,
  stickerImages,
  customFonts,
  customFontTypefaces,
}: PhotoRenderProps) {
  const filterDefinition = useMemo(
    () => resolveFilter(filterId, filterPacks),
    [filterId, filterPacks]
  );

  // Matrix filters fold onto the adjustments matrix; LUT filters apply as a later ImageFilter stage.
  const composedMatrix = useMemo(() => {
    const adj = composeAdjustmentMatrix(adjustments);
    if (filterDefinition.kind === 'matrix' && filterDefinition.id !== ORIGINAL_FILTER_ID) {
      return composeFilterMatrix(filterDefinition.matrix, adj, filterIntensity);
    }
    return adj;
  }, [adjustments, filterDefinition, filterIntensity]);
  const matrixIsIdentity = isIdentityMatrix(composedMatrix);
  const matrix = composedMatrix as number[];

  // Skipped entirely when neutral to avoid precision drift on untouched photos.
  const shaderStageActive = anyNonNeutral(SHADER_KEYS, adjustments);
  const runtimeEffect = shaderStageActive ? getColorShader() : null;

  const srcW = crop.width * image.width();
  const srcH = crop.height * image.height();
  const srcX = crop.x * image.width();
  const srcY = crop.y * image.height();

  const rotated = rotation === 90 || rotation === 270;
  const contentPxW = rotated ? srcH : srcW;
  const contentPxH = rotated ? srcW : srcH;

  const scale = Math.min(outputWidth / contentPxW, outputHeight / contentPxH);
  const drawW = contentPxW * scale;
  const drawH = contentPxH * scale;
  const offsetX = (outputWidth - drawW) / 2;
  const offsetY = (outputHeight - drawH) / 2;

  const rotationRad = (rotation * Math.PI) / 180;
  const straightenRad = (straighten * Math.PI) / 180;
  const centerX = offsetX + drawW / 2;
  const centerY = offsetY + drawH / 2;

  const imagePxScale = scale;
  const rectW = srcW * imagePxScale;
  const rectH = srcH * imagePxScale;

  // Grain seed is doc-invariant so preview and export match and gestures don't jitter.
  const shaderUniforms = useMemo(
    () =>
      runtimeEffect
        ? buildColorShaderUniforms(
            adjustments,
            { x: offsetX, y: offsetY, width: drawW, height: drawH },
            1
          )
        : null,
    [runtimeEffect, adjustments, offsetX, offsetY, drawW, drawH]
  );

  // LUT stage: useImage called unconditionally; undefined source is a no-op fetch.
  const lutSource = filterDefinition.kind === 'lut' ? filterDefinition.source : undefined;
  const lutImage = useImage(lutSource);
  const lutImageFilter = useMemo(() => {
    if (filterDefinition.kind !== 'lut' || !lutImage) return null;
    return buildLutImageFilter(lutImage, filterIntensity);
  }, [filterDefinition, lutImage, filterIntensity]);

  const focusImageFilter = useMemo(
    () => buildFocusImageFilter(focus, { x: offsetX, y: offsetY, width: drawW, height: drawH }),
    [focus, offsetX, offsetY, drawW, drawH]
  );

  // Stable identity so per-stroke path memos keyed on the rect survive unrelated re-renders.
  const strokeRect = useMemo(
    () => ({ x: offsetX, y: offsetY, width: drawW, height: drawH }),
    [offsetX, offsetY, drawW, drawH]
  );

  const overlayDefinition = useMemo(
    () => resolveOverlay(overlayId, overlayPacks),
    [overlayId, overlayPacks]
  );
  const overlayImageSource =
    overlayDefinition?.kind === 'image' ? overlayDefinition.source : undefined;
  const overlayImage = useImage(overlayImageSource);

  // Neutral path stays a plain Group so untouched photos pay zero layer cost.
  const layerActive =
    !matrixIsIdentity ||
    runtimeEffect != null ||
    lutImageFilter != null ||
    focusImageFilter != null;
  const layer = layerActive ? (
    <Paint>
      {!matrixIsIdentity && <ColorMatrix matrix={matrix} />}
      {runtimeEffect && shaderUniforms && (
        <RuntimeShader source={runtimeEffect} uniforms={shaderUniforms} />
      )}
      {/* LUT + focus attached last so they run after matrix + shader adjustments. */}
      {lutImageFilter && <ImageFilter filter={lutImageFilter} />}
      {focusImageFilter && <ImageFilter filter={focusImageFilter} />}
    </Paint>
  ) : undefined;

  return (
    <>
      <Group clip={{ x: offsetX, y: offsetY, width: drawW, height: drawH }} layer={layer}>
        <Group
          origin={{ x: centerX, y: centerY }}
          // Skia post-multiplies with column vectors, so the applied per-point mapping is
          // R_straighten · R_90 · F (flip → 90°-step → straighten).
          transform={[
            { rotate: straightenRad },
            { rotate: rotationRad },
            { scaleX: flipHorizontal ? -1 : 1 },
          ]}>
          <Group
            transform={[{ translateX: centerX - rectW / 2 }, { translateY: centerY - rectH / 2 }]}>
            <SkiaImage
              image={image}
              x={-srcX * imagePxScale}
              y={-srcY * imagePxScale}
              width={image.width() * imagePxScale}
              height={image.height() * imagePxScale}
            />
          </Group>
        </Group>
      </Group>

      <OverlayLayer
        definition={overlayDefinition}
        rect={strokeRect}
        intensity={overlayIntensity}
        image={overlayImage}
      />

      <DrawStrokesLayer strokes={strokes} rect={strokeRect} />

      {layers.map((layer) => (
        <LayerGlyph
          key={layer.id}
          layer={layer}
          drawRect={{ x: offsetX, y: offsetY, width: drawW, height: drawH }}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerImages={stickerImages}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
        />
      ))}
    </>
  );
}
