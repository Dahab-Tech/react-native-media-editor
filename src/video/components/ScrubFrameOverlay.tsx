import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import type { CropRect, VideoInfo } from '../../types';
import { getVideoThumbnail } from '../api';

// Android fallback: pre-extracted frames swapped on drag; backbone→densifier→exact-on-rest — drag seeks only position for release.

/** Preview frame cadence along the timeline; also the finest motion granularity. */
const FRAME_SLICE_MS = 500;
/** Evenly spaced slots extracted up front — bounded upfront work for any duration. */
const BACKBONE_FRAMES = 40;
const MIN_FRAMES = 12;
const FRAME_MAX_WIDTH = 480;
/** Slots around the finger the densifier fills while scrubbing (±6s of video). */
const DENSIFY_RADIUS = 12;
/** Lets the trim-strip thumbnails extract first so the visible UI fills in before this cache. */
const EXTRACTION_START_DELAY_MS = 800;
/** Quiet time before extracting the exact frame under a resting finger (latest-wins). */
const EXACT_FRAME_DELAY_MS = 200;

/** Failed slots are marked so the densifier never retries them in a loop. */
const FAILED = '';

export interface ScrubFrameOverlayProps {
  source: string;
  durationMs: number;
  info: VideoInfo;
  /** Committed crop in source pixels, or null for the full frame (mirrors CropAwareVideo). */
  crop: CropRect | null;
  displayRect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  /** Hands the parent a per-tick time callback; called with null on unmount. */
  registerListener: (cb: ((timeMs: number) => void) | null) => void;
}

export function ScrubFrameOverlay({
  source,
  durationMs,
  info,
  crop,
  displayRect,
  visible,
  registerListener,
}: ScrubFrameOverlayProps) {
  const count = Math.max(MIN_FRAMES, Math.ceil(durationMs / FRAME_SLICE_MS));
  // Extracted URIs live in a ref: filling the cache must not re-render anything.
  const framesRef = useRef<(string | null)[]>([]);
  // Previous frame stays mounted under current so a swap never flashes blank while the incoming file decodes.
  const [display, setDisplay] = useState<{ cur: string | null; prev: string | null }>({
    cur: null,
    prev: null,
  });

  useEffect(() => {
    if (!source || durationMs <= 0) return;
    framesRef.current = Array<string | null>(count).fill(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      const backbone = Math.min(count, BACKBONE_FRAMES);
      const order: number[] = [];
      const queued = new Set<number>();
      for (let k = 0; k < backbone; k++) {
        const i = backbone === 1 ? 0 : Math.round(((count - 1) * k) / (backbone - 1));
        if (!queued.has(i)) {
          queued.add(i);
          order.push(i);
        }
      }
      // Sequential — a parallel burst of native extractions starves UI and player on low-end devices.
      (async () => {
        for (const i of order) {
          if (cancelled) return;
          const timeMs = (durationMs * (i + 0.5)) / count;
          try {
            const result = await getVideoThumbnail(source, {
              timeMs,
              maxWidth: FRAME_MAX_WIDTH,
            });
            if (!cancelled) framesRef.current[i] = result.uri;
          } catch {
            if (!cancelled) framesRef.current[i] = FAILED;
          }
        }
      })();
    }, EXTRACTION_START_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, durationMs, count]);

  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refineSeqRef = useRef(0);
  const focusSlotRef = useRef<number | null>(null);
  const densifyBusyRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    // Fill the nearest empty slot to the finger, self-chaining until ±DENSIFY_RADIUS is dense.
    const densifyNext = () => {
      if (stopped || densifyBusyRef.current) return;
      const frames = framesRef.current;
      const focus = focusSlotRef.current;
      if (focus == null || frames.length === 0) return;
      let target = -1;
      for (let d = 0; d <= DENSIFY_RADIUS && target < 0; d++) {
        for (const candidate of d === 0 ? [focus] : [focus - d, focus + d]) {
          if (candidate >= 0 && candidate < frames.length && frames[candidate] == null) {
            target = candidate;
            break;
          }
        }
      }
      if (target < 0) return;
      densifyBusyRef.current = true;
      const timeMs = (durationMs * (target + 0.5)) / frames.length;
      getVideoThumbnail(source, { timeMs, maxWidth: FRAME_MAX_WIDTH })
        .then((result) => {
          if (!stopped) framesRef.current[target] = result.uri;
        })
        .catch(() => {
          if (!stopped) framesRef.current[target] = FAILED;
        })
        .finally(() => {
          densifyBusyRef.current = false;
          if (!stopped) densifyNext();
        });
    };

    const onScrubTime = (timeMs: number) => {
      const frames = framesRef.current;
      if (frames.length === 0 || durationMs <= 0) return;
      const exact = Math.min(
        frames.length - 1,
        Math.max(0, Math.floor((timeMs / durationMs) * frames.length))
      );
      focusSlotRef.current = exact;
      densifyNext();
      // Search out to half a backbone gap so the sparse first pass bridges unfilled stretches; beyond that keep the native player's frame.
      const searchRadius = Math.max(2, Math.ceil(frames.length / BACKBONE_FRAMES / 2) + 1);
      let uri: string | null = null;
      for (let d = 0; d <= searchRadius && uri == null; d++) {
        for (const candidate of d === 0 ? [exact] : [exact - d, exact + d]) {
          if (candidate >= 0 && candidate < frames.length && frames[candidate]) {
            uri = frames[candidate];
            break;
          }
        }
      }
      if (uri != null) {
        setDisplay((d) => (d.cur === uri ? d : { cur: uri, prev: d.cur }));
      }
      // Debounced latest-wins refine on rest — matches iOS exact-seek precision without queuing behind slow extractions.
      if (refineTimerRef.current != null) clearTimeout(refineTimerRef.current);
      const seq = ++refineSeqRef.current;
      refineTimerRef.current = setTimeout(() => {
        refineTimerRef.current = null;
        getVideoThumbnail(source, { timeMs, maxWidth: FRAME_MAX_WIDTH })
          .then((result) => {
            if (refineSeqRef.current !== seq) return;
            setDisplay((d) => (d.cur === result.uri ? d : { cur: result.uri, prev: d.cur }));
          })
          .catch(() => {
            // Nearest cached slot stays on screen.
          });
      }, EXACT_FRAME_DELAY_MS);
    };
    registerListener(onScrubTime);
    return () => {
      stopped = true;
      registerListener(null);
    };
  }, [registerListener, durationMs, source]);

  useEffect(() => {
    if (visible) return;
    // Release: drop pending refines so a late result can't overwrite the settled player frame on next drag's first paint.
    refineSeqRef.current++;
    if (refineTimerRef.current != null) {
      clearTimeout(refineTimerRef.current);
      refineTimerRef.current = null;
    }
  }, [visible]);

  if (!visible || display.cur == null || displayRect.width <= 0) return null;

  if (!crop) {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {display.prev != null && (
          <Image
            source={{ uri: display.prev }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            fadeDuration={0}
          />
        )}
        <Image
          source={{ uri: display.cur }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          fadeDuration={0}
        />
      </View>
    );
  }

  // Placement mirrors CropAwareVideo — scale crop.width to fill displayRect, translate so crop origin lands at rect origin.
  const scale = displayRect.width / crop.width;
  const innerStyle = {
    position: 'absolute' as const,
    left: -crop.x * scale,
    top: -crop.y * scale,
    width: info.width * scale,
    height: info.height * scale,
  };
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        overflow: 'hidden',
      }}>
      {display.prev != null && (
        <Image
          source={{ uri: display.prev }}
          style={innerStyle}
          resizeMode="stretch"
          fadeDuration={0}
        />
      )}
      <Image
        source={{ uri: display.cur }}
        style={innerStyle}
        resizeMode="stretch"
        fadeDuration={0}
      />
    </View>
  );
}
