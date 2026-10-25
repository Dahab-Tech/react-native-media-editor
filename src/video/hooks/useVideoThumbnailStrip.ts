import { useEffect, useState } from 'react';

import { getVideoThumbnailStrip } from '../api';

/** One slot in the strip — `null` while decoding or after a failure. Order-preserved. */
export interface VideoThumbnailSlot {
  /** File URI from the native thumbnail extractor. */
  uri: string;
  /** Timestamp (ms) the frame was sampled at. */
  timeMs: number;
}

export interface UseVideoThumbnailStripResult {
  /** Length always equals the requested `count`. */
  thumbnails: readonly (VideoThumbnailSlot | null)[];
  /** True once the strip has resolved. */
  isReady: boolean;
}

/** One native batch call, nearest-keyframe frames sampled at midpoints of `count` evenly-spaced slices starting at `offsetMs`. */
export function useVideoThumbnailStrip(
  source: string,
  durationMs: number,
  count: number,
  maxWidth?: number,
  offsetMs = 0
): UseVideoThumbnailStripResult {
  // Reset slots on input change via adjust-during-render pattern.
  const key = `${source}|${durationMs}|${count}|${maxWidth ?? ''}|${offsetMs}`;
  const [prevKey, setPrevKey] = useState(key);
  const [thumbnails, setThumbnails] = useState<readonly (VideoThumbnailSlot | null)[]>(() =>
    Array<VideoThumbnailSlot | null>(Math.max(0, count)).fill(null)
  );
  const [isReady, setIsReady] = useState(false);
  if (prevKey !== key) {
    setPrevKey(key);
    setThumbnails(Array<VideoThumbnailSlot | null>(Math.max(0, count)).fill(null));
    setIsReady(false);
  }

  useEffect(() => {
    if (!source || durationMs <= 0 || count <= 0) return;

    let cancelled = false;
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      timestamps.push(offsetMs + (durationMs * (i + 0.5)) / count);
    }

    getVideoThumbnailStrip(source, {
      timesMs: timestamps,
      ...(maxWidth != null ? { maxWidth } : null),
    })
      .then((uris) => {
        if (cancelled || uris.length !== count) return;
        setThumbnails(uris.map((uri, i) => (uri != null ? { uri, timeMs: timestamps[i] } : null)));
        setIsReady(true);
      })
      .catch(() => {
        // Swallow — slots stay null.
      });

    return () => {
      cancelled = true;
    };
  }, [source, durationMs, count, maxWidth, offsetMs]);

  return { thumbnails, isReady };
}
