import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { CropOverlay as SharedCropOverlay, CROP_FRAME_MARGIN } from '../../core/crop/CropOverlay';
import { type NormalizedCrop } from '../../core/crop/types';
import type { CropRect } from '../../types';

export interface CropOverlayProps {
  /** Display-space video dimensions (rotation applied). */
  videoWidth: number;
  videoHeight: number;
  /** Current crop in display-space pixels, or null to fill the frame. */
  value: CropRect | null;
  onChange: (value: CropRect) => void;
  /** Optional pixel aspect (w/h) constraining resize. `null` = free-drag. */
  aspectRatio?: number | null;
}

/** Breathing room around the video while crop-editing so corner handles never sit at the screen edge (Android back-gesture strip, parent clipping). Must match the inset `VideoEditor` applies to `videoDisplayRect` when crop is active. */
export const CROP_EDIT_MARGIN = 32;

/** Video crop overlay — thin adapter around the shared `core/crop/CropOverlay`. Handles letterbox math and CropRect ↔ NormalizedCrop conversion. */
export function CropOverlay({
  videoWidth,
  videoHeight,
  value,
  onChange,
  aspectRatio,
}: CropOverlayProps) {
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);

  // Contain-fit inside the container minus CROP_EDIT_MARGIN per side — must mirror the
  // crop-active branch of `videoDisplayRect` in VideoEditor so the frame lands on the video.
  const displayRect = useMemo(() => {
    if (!container || videoWidth <= 0 || videoHeight <= 0) return null;
    const availWidth = Math.max(1, container.width - CROP_EDIT_MARGIN * 2);
    const availHeight = Math.max(1, container.height - CROP_EDIT_MARGIN * 2);
    const scale = Math.min(availWidth / videoWidth, availHeight / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    return {
      left: (container.width - width) / 2,
      top: (container.height - height) / 2,
      width,
      height,
    };
  }, [container, videoWidth, videoHeight]);

  // CropRect (display px) → NormalizedCrop ([0..1]). `null` = whole frame.
  const normalizedCrop: NormalizedCrop = useMemo(() => {
    if (!value || videoWidth <= 0 || videoHeight <= 0) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    return {
      x: value.x / videoWidth,
      y: value.y / videoHeight,
      width: value.width / videoWidth,
      height: value.height / videoHeight,
    };
  }, [value, videoWidth, videoHeight]);

  const imageAspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 1;

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setContainer((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height }
      );
    }
  }, []);

  const handleChange = useCallback(
    (next: NormalizedCrop) => {
      onChange({
        x: next.x * videoWidth,
        y: next.y * videoHeight,
        width: next.width * videoWidth,
        height: next.height * videoHeight,
      });
    },
    [onChange, videoWidth, videoHeight]
  );

  // Expand region by CROP_FRAME_MARGIN so the shared overlay's inset falls outside the video edge — otherwise full-crop shrinks 16pt inside each edge.
  const overlayRegion = useMemo(() => {
    if (!displayRect) return null;
    const inset = CROP_FRAME_MARGIN;
    return {
      left: displayRect.left - inset,
      top: displayRect.top - inset,
      width: displayRect.width + 2 * inset,
      height: displayRect.height + 2 * inset,
    };
  }, [displayRect]);

  return (
    <View pointerEvents="box-none" onLayout={handleLayout} style={StyleSheet.absoluteFill}>
      {overlayRegion && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: overlayRegion.left,
            top: overlayRegion.top,
            width: overlayRegion.width,
            height: overlayRegion.height,
          }}>
          <SharedCropOverlay
            region={{ width: overlayRegion.width, height: overlayRegion.height }}
            crop={normalizedCrop}
            imageAspect={imageAspect}
            aspectRatio={aspectRatio ?? null}
            onChange={handleChange}
            // Anchored mode: no refit on lift (VideoView doesn't scale during interaction).
            mode="anchored"
          />
        </View>
      )}
    </View>
  );
}
