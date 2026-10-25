import { Canvas, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { VideoOverlayRender } from './VideoOverlayRender';
import type { DrawStroke } from '../../photo/draw/types';
import type { PhotoLayer, PhotoStickerPack } from '../../photo/layers';
import type { PhotoCustomFont } from '../../photo/text';

export interface GatedOverlayCanvasProps {
  /** When false the canvas is always visible; when true the playhead gates opacity. */
  gated: boolean;
  startMs: number;
  endMs: number;
  /** Timeline-position clock the gate compares against on the UI thread. */
  playheadMs: SharedValue<number>;
  displayRect: { x: number; y: number; width: number; height: number };
  layers: readonly PhotoLayer[];
  strokes: readonly DrawStroke[];
  baseFontSize: number;
  baseStickerSize: number;
  stickerImages: Readonly<Record<string, SkImage>>;
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
  stickerPacks?: readonly PhotoStickerPack[];
}

/** One timed overlay's Skia canvas, shown/hidden on the UI thread as the playhead crosses its window. */
export function GatedOverlayCanvas({
  gated,
  startMs,
  endMs,
  playheadMs,
  displayRect,
  layers,
  strokes,
  baseFontSize,
  baseStickerSize,
  stickerImages,
  customFonts,
  customFontTypefaces,
  stickerPacks,
}: GatedOverlayCanvasProps) {
  const gateStyle = useAnimatedStyle(() => ({
    opacity: !gated || (playheadMs.value >= startMs && playheadMs.value <= endMs) ? 1 : 0,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          left: displayRect.x,
          top: displayRect.y,
          width: displayRect.width,
          height: displayRect.height,
        },
        gateStyle,
      ]}>
      <Canvas style={styles.fill} pointerEvents="none">
        <VideoOverlayRender
          outputWidth={displayRect.width}
          outputHeight={displayRect.height}
          layers={layers}
          strokes={strokes}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerImages={stickerImages}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
          stickerPacks={stickerPacks}
        />
      </Canvas>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute' },
  fill: { flex: 1 },
});
