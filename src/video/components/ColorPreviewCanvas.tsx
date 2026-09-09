import {
  Canvas,
  ColorMatrix,
  fitbox,
  Group,
  ImageFilter,
  Image as SkiaImage,
  Paint,
  rect as skRect,
  RuntimeShader,
  useImage,
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import {
  anyNonNeutral,
  buildColorShaderUniforms,
  buildLutImageFilter,
  composeAdjustmentMatrix,
  composeFilterMatrix,
  getColorShader,
  isIdentityMatrix,
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  resolveFilter,
  SHADER_KEYS,
  type PhotoAdjustments,
  type PhotoFilterId,
  type PhotoFilterPack,
} from '../../photo/color';
import {
  OverlayLayer,
  resolveOverlay,
  type PhotoOverlayId,
  type PhotoOverlayPack,
} from '../../photo/overlays';
import type { CropRect } from '../../types';
import { useVideoPreviewFrames } from '../hooks/useVideoPreviewFrames';

export interface ColorPreviewCanvasProps {
  /** Video source URI. */
  source: string;
  /** View-space rect the color-graded sample paints into. */
  rect: { x: number; y: number; width: number; height: number };
  /** Playback paused flag. */
  paused: boolean;
  /** Seek command for the preview decoder; each new object triggers a seek, even to the same position. */
  seek: { seconds: number } | null;
  /** Full source video dimensions (post-rotation). */
  videoWidth: number;
  videoHeight: number;
  /** Committed crop rect in source-pixel space, or `null` for the full frame. */
  crop: CropRect | null;
  /** Color pipeline inputs — same fields PhotoRender consumes. */
  adjustments: PhotoAdjustments;
  filterId: PhotoFilterId;
  filterIntensity: number;
  overlayId: PhotoOverlayId;
  overlayIntensity: number;
  filterPacks?: readonly PhotoFilterPack[];
  overlayPacks?: readonly PhotoOverlayPack[];
}

/** WYSIWYG color-graded video preview. Applies the same color pipeline as PhotoRender so preview matches export. */
export function ColorPreviewCanvas({
  source,
  rect,
  paused,
  seek,
  videoWidth,
  videoHeight,
  crop,
  adjustments,
  filterId,
  filterIntensity,
  overlayId,
  overlayIntensity,
  filterPacks,
  overlayPacks,
}: ColorPreviewCanvasProps) {
  const pausedSv = useSharedValue(paused);
  const seekSv = useSharedValue<number | null>(null);
  useEffect(() => {
    pausedSv.value = paused;
  }, [paused, pausedSv]);
  const { currentFrame, rotation, size, duration } = useVideoPreviewFrames(source, {
    paused: pausedSv,
    seek: seekSv,
  });

  // Seeks issued before the decoder loads are dropped natively; the ready dep re-applies the last one.
  const decoderReady = duration > 0;
  useEffect(() => {
    if (seek != null && decoderReady) seekSv.value = seek.seconds * 1000; // Skia.Video.seek takes ms.
  }, [seek, seekSv, decoderReady]);

  const filterDefinition = useMemo(
    () => resolveFilter(filterId, filterPacks),
    [filterId, filterPacks]
  );

  const composedMatrix = useMemo(() => {
    const adj = composeAdjustmentMatrix(adjustments);
    if (filterDefinition.kind === 'matrix' && filterDefinition.id !== ORIGINAL_FILTER_ID) {
      return composeFilterMatrix(filterDefinition.matrix, adj, filterIntensity);
    }
    return adj;
  }, [adjustments, filterDefinition, filterIntensity]);
  const matrixIsIdentity = isIdentityMatrix(composedMatrix);
  const matrix = composedMatrix as number[];

  const shaderStageActive = anyNonNeutral(SHADER_KEYS, adjustments);
  const runtimeEffect = shaderStageActive ? getColorShader() : null;

  const lutSource = filterDefinition.kind === 'lut' ? filterDefinition.source : undefined;
  const lutImage = useImage(lutSource);
  const lutImageFilter = useMemo(() => {
    if (filterDefinition.kind !== 'lut' || !lutImage) return null;
    return buildLutImageFilter(lutImage, filterIntensity);
  }, [filterDefinition, lutImage, filterIntensity]);

  // Placement math mirrors CropAwareVideo: letterbox with no crop; scale + translate so crop.origin lands at rect origin when set.
  const fit = useMemo(() => {
    if (videoWidth <= 0 || videoHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    if (crop && crop.width > 0 && crop.height > 0) {
      const cropScale = rect.width / crop.width;
      return {
        x: rect.x + -crop.x * cropScale,
        y: rect.y + -crop.y * cropScale,
        width: videoWidth * cropScale,
        height: videoHeight * cropScale,
      };
    }
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const w = videoWidth * scale;
    const h = videoHeight * scale;
    return {
      x: rect.x + (rect.width - w) / 2,
      y: rect.y + (rect.height - h) / 2,
      width: w,
      height: h,
    };
  }, [rect.x, rect.y, rect.width, rect.height, videoWidth, videoHeight, crop]);

  const shaderUniforms = useMemo(
    () => (runtimeEffect ? buildColorShaderUniforms(adjustments, fit, 1) : null),
    [runtimeEffect, adjustments, fit]
  );

  const overlayDefinition = useMemo(
    () => resolveOverlay(overlayId, overlayPacks),
    [overlayId, overlayPacks]
  );
  const overlayImageSource =
    overlayDefinition?.kind === 'image' ? overlayDefinition.source : undefined;
  const overlayImage = useImage(overlayImageSource);

  const layerActive = !matrixIsIdentity || runtimeEffect != null || lutImageFilter != null;

  // useVideo emits unrotated coded frames; fitbox maps them onto the display-oriented fit rect (fill exact — dst aspect already matches post-rotation).
  const frameTransform = useMemo(() => {
    if (size.width <= 0 || size.height <= 0 || fit.width <= 0 || fit.height <= 0) return [];
    return fitbox(
      'fill',
      skRect(0, 0, size.width, size.height),
      skRect(fit.x - rect.x, fit.y - rect.y, fit.width, fit.height),
      rotation
    );
  }, [size.width, size.height, fit, rect.x, rect.y, rotation]);

  return (
    // pointerEvents="none" — canvas is presentational; touches route to layer/draw/crop overlays above.
    <Canvas
      pointerEvents="none"
      style={[
        styles.canvas,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
      ]}>
      <Group
        clip={{ x: 0, y: 0, width: rect.width, height: rect.height }}
        layer={
          layerActive ? (
            <Paint>
              {!matrixIsIdentity && <ColorMatrix matrix={matrix} />}
              {runtimeEffect && shaderUniforms && (
                <RuntimeShader source={runtimeEffect} uniforms={shaderUniforms} />
              )}
              {lutImageFilter && <ImageFilter filter={lutImageFilter} />}
            </Paint>
          ) : undefined
        }>
        <Group transform={frameTransform}>
          <SkiaImage
            image={currentFrame}
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            fit="fill"
          />
        </Group>
      </Group>

      <OverlayLayer
        definition={overlayDefinition}
        rect={{ x: fit.x - rect.x, y: fit.y - rect.y, width: fit.width, height: fit.height }}
        intensity={overlayIntensity}
        image={overlayImage}
      />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute',
  },
});

/** True when any color-pipeline field is dialed away from neutral. */
export function needsColorPreview(args: {
  adjustments: PhotoAdjustments;
  filterId: PhotoFilterId;
  overlayId: PhotoOverlayId;
}): boolean {
  if (args.filterId !== ORIGINAL_FILTER_ID) return true;
  if (args.overlayId != null) return true;
  // Reducer creates a fresh object per setAdjustment, so ref-equality against NEUTRAL_ADJUSTMENTS won't work.
  const adj = args.adjustments;
  const neutral = NEUTRAL_ADJUSTMENTS;
  return (
    adj.exposure !== neutral.exposure ||
    adj.brightness !== neutral.brightness ||
    adj.contrast !== neutral.contrast ||
    adj.highlights !== neutral.highlights ||
    adj.shadows !== neutral.shadows ||
    adj.whites !== neutral.whites ||
    adj.blacks !== neutral.blacks ||
    adj.temperature !== neutral.temperature ||
    adj.tint !== neutral.tint ||
    adj.saturation !== neutral.saturation ||
    adj.vibrance !== neutral.vibrance ||
    adj.hue !== neutral.hue ||
    adj.sharpness !== neutral.sharpness ||
    adj.vignette !== neutral.vignette ||
    adj.grain !== neutral.grain
  );
}
