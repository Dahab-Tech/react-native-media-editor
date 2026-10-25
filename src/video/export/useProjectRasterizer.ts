import {
  drawAsImage,
  ImageFormat,
  Skia,
  type SkImage,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import React, { useCallback, useMemo } from 'react';
import { Image } from 'react-native';

import MediaEditorModule from '../../native/MediaEditorModule';
import type { PhotoStickerPack } from '../../photo/layers';
import {
  OverlayLayer,
  resolveOverlay,
  type PhotoOverlayPack,
  PhotoOverlayId,
} from '../../photo/overlays';
import type { PhotoCustomFont } from '../../photo/text';
import { VideoOverlayRender } from '../components/VideoOverlayRender';
import type { TimedOverlay } from '../project/model';
import type { ClipWashAsset } from '../project/serialize';

/** Base on-canvas text size as a fraction of the shorter output dimension. Multiplied by layer.scale. */
export const TEXT_BASE_RATIO = 0.06;
/** Base sticker size as a fraction of the shorter output dimension. */
export const STICKER_BASE_RATIO = 0.2;

export interface ProjectRasterizerDeps {
  stickerImages: Readonly<Record<string, SkImage>>;
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
  stickerPacks?: readonly PhotoStickerPack[];
  overlayPacks?: readonly PhotoOverlayPack[];
}

export interface ProjectRasterizer {
  /** Rasterizes one timed overlay (layers + strokes) to a cache PNG at the given output size. */
  rasterizeOverlayPng(overlay: TimedOverlay, outW: number, outH: number): Promise<string | null>;
  /** Rasterizes a color wash at full strength; native blends it per frame with mode + intensity. */
  rasterizeWashPng(
    overlayId: PhotoOverlayId,
    outW: number,
    outH: number
  ): Promise<ClipWashAsset | null>;
}

/** Imperative twin of `useImage` — export must load wash images for clips that aren't selected. */
async function loadSkImage(source: unknown): Promise<SkImage | null> {
  const uri =
    typeof source === 'number'
      ? Image.resolveAssetSource(source)?.uri
      : typeof source === 'string'
        ? source
        : null;
  if (!uri) return null;
  const data = await Skia.Data.fromURI(uri);
  return data ? Skia.Image.MakeImageFromEncoded(data) : null;
}

async function encodeToCachePng(snapshot: SkImage | null): Promise<string | null> {
  if (!snapshot) return null;
  // PNG so alpha travels through the file.
  const encoded = snapshot.encodeToBase64(ImageFormat.PNG, 100);
  if (!encoded) return null;
  return await MediaEditorModule.writeCacheFile(encoded, 'png');
}

export function useProjectRasterizer({
  stickerImages,
  customFonts,
  customFontTypefaces,
  stickerPacks,
  overlayPacks,
}: ProjectRasterizerDeps): ProjectRasterizer {
  const rasterizeOverlayPng = useCallback(
    async (overlay: TimedOverlay, outW: number, outH: number): Promise<string | null> => {
      if (overlay.layers.length === 0 && overlay.strokes.length === 0) return null;
      if (outW <= 0 || outH <= 0) return null;
      const snapshot = await drawAsImage(
        React.createElement(VideoOverlayRender, {
          outputWidth: outW,
          outputHeight: outH,
          layers: overlay.layers,
          strokes: overlay.strokes,
          baseFontSize: Math.min(outW, outH) * TEXT_BASE_RATIO,
          baseStickerSize: Math.min(outW, outH) * STICKER_BASE_RATIO,
          stickerImages,
          customFonts,
          customFontTypefaces,
          stickerPacks,
        }),
        { width: outW, height: outH }
      );
      return encodeToCachePng(snapshot);
    },
    [stickerImages, customFonts, customFontTypefaces, stickerPacks]
  );

  const rasterizeWashPng = useCallback(
    async (
      overlayId: PhotoOverlayId,
      outW: number,
      outH: number
    ): Promise<ClipWashAsset | null> => {
      const definition = resolveOverlay(overlayId, overlayPacks);
      if (definition == null || outW <= 0 || outH <= 0) return null;
      const image = definition.kind === 'image' ? await loadSkImage(definition.source) : null;
      const snapshot = await drawAsImage(
        React.createElement(OverlayLayer, {
          definition,
          rect: { x: 0, y: 0, width: outW, height: outH },
          intensity: 1,
          image,
        }),
        { width: outW, height: outH }
      );
      const uri = await encodeToCachePng(snapshot);
      return uri ? { uri, blendMode: definition.blendMode } : null;
    },
    [overlayPacks]
  );

  return useMemo(
    () => ({ rasterizeOverlayPng, rasterizeWashPng }),
    [rasterizeOverlayPng, rasterizeWashPng]
  );
}
