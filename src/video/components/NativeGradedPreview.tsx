import { requireNativeView } from 'expo';
import React, { useEffect, useMemo, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { CropRect, VideoInfo } from '../../types';

// Native rate-controlled graded playback (AVPlayerLooper / ExoPlayer) running the export's own color
// pipeline — replaces the seek-driven Skia preview at speed ≠ 1, which is capped by seek throughput.

interface NativeGradedPreviewViewProps {
  sourceUri: string;
  startMs: number;
  endMs: number;
  colorMatrix: number[] | null;
  lutUri: string | null;
  lutIntensity: number;
  washUri: string | null;
  washBlendMode: string | null;
  washIntensity: number;
  /** Cap on the native effect-chain render height; 0 = source resolution. */
  renderHeight: number;
  rate: number;
  paused: boolean;
  /** Absolute position in ms; consumed once per distinct value (transition sync, not a continuous drive). */
  positionMs: number;
  onPreviewError?: (event: { nativeEvent: { message: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

const NativeGradedPreviewView = requireNativeView(
  'MediaEditor',
  'GradedPreviewView'
) as React.ComponentType<NativeGradedPreviewViewProps>;

export interface NativeGradedPreviewProps {
  source: string;
  info: VideoInfo;
  /** Committed crop in display pixels, or null for the full frame (mirrors CropAwareVideo). */
  crop: CropRect | null;
  displayRect: { x: number; y: number; width: number; height: number };
  startMs: number;
  endMs: number;
  colorMatrix?: readonly number[];
  lutUri?: string;
  lutIntensity?: number;
  /** Overlay wash PNG blended natively with `washBlendMode` at `washIntensity` — same stage the export runs. */
  washUri?: string;
  washBlendMode?: string;
  washIntensity?: number;
  rate: number;
  paused: boolean;
  positionMs: number;
  /** Triggered once on any native playback error; caller falls back to the seek-driven Skia path. */
  onFallback: () => void;
}

export function NativeGradedPreview({
  source,
  info,
  crop,
  displayRect,
  startMs,
  endMs,
  colorMatrix,
  lutUri,
  lutIntensity,
  washUri,
  washBlendMode,
  washIntensity,
  rate,
  paused,
  positionMs,
  onFallback,
}: NativeGradedPreviewProps) {
  const fallbackFiredRef = useRef(false);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  // Native output is display-oriented (rotation applied by the composition/effects pipeline), so size
  // with the display dims. Same math as ScrubEnginePreview: the TextureView stretches its bounds, so JS
  // computes contain-fit; crop clips via an overflow-hidden container.
  const displayStyles = useMemo(() => {
    if (displayRect.width <= 0) return null;
    if (!crop) {
      const rect = containFit(info.width, info.height, displayRect);
      return {
        container: { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 },
        inner: {
          position: 'absolute' as const,
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    }
    const scale = displayRect.width / crop.width;
    return {
      container: {
        position: 'absolute' as const,
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        overflow: 'hidden' as const,
      },
      inner: {
        position: 'absolute' as const,
        left: -crop.x * scale,
        top: -crop.y * scale,
        width: info.width * scale,
        height: info.height * scale,
      },
    };
  }, [info.width, info.height, crop, displayRect]);

  if (!displayStyles) return null;

  return (
    <View pointerEvents="none" style={displayStyles.container}>
      <NativeGradedPreviewView
        sourceUri={source}
        startMs={startMs}
        endMs={endMs}
        colorMatrix={colorMatrix ? [...colorMatrix] : null}
        lutUri={lutUri ?? null}
        lutIntensity={lutIntensity ?? 1}
        washUri={washUri ?? null}
        washBlendMode={washBlendMode ?? null}
        washIntensity={washIntensity ?? 1}
        // Grade GL passes run per source pixel on Android; cap at 720p (never upscale small sources).
        renderHeight={info.height > 0 ? Math.min(720, info.height) : 0}
        rate={rate}
        paused={paused}
        positionMs={positionMs}
        onPreviewError={() => {
          if (fallbackFiredRef.current) return;
          fallbackFiredRef.current = true;
          onFallbackRef.current();
        }}
        style={displayStyles.inner}
      />
    </View>
  );
}

// Contain-fit inside a rect (mirrors CropAwareVideo's contentFit="contain" branch).
function containFit(
  srcW: number,
  srcH: number,
  rect: { x: number; y: number; width: number; height: number }
) {
  if (srcW <= 0 || srcH <= 0) return rect;
  const scale = Math.min(rect.width / srcW, rect.height / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + (rect.height - h) / 2,
    width: w,
    height: h,
  };
}
