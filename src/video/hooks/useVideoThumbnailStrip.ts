import { useEffect, useState } from 'react';

import { getVideoThumbnail } from '../api';

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
  /** True once at least one thumbnail has resolved. */
  isReady: boolean;
}

/** Async parallel thumbnail extraction. Sampling is at midpoints of `count` evenly-spaced slices. Failures resolve to `null`. */
export function useVideoThumbnailStrip(
  source: string,
  durationMs: number,
  count: number,
  maxWidth?: number
): UseVideoThumbnailStripResult {
  // Reset slots on input change via adjust-during-render pattern.
  const key = `${source}|${durationMs}|${count}|${maxWidth ?? ''}`;
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
      timestamps.push((durationMs * (i + 0.5)) / count);
    }

    // Slot by index so partial failures leave holes rather than shifting the strip.
    timestamps.forEach((timeMs, index) => {
      getVideoThumbnail(source, { timeMs, ...(maxWidth != null ? { maxWidth } : null) })
        .then((result) => {
          if (cancelled) return;
          setThumbnails((prev) => {
            if (prev.length !== count) return prev;
            const next = prev.slice();
            next[index] = { uri: result.uri, timeMs };
            return next;
          });
          setIsReady(true);
        })
        .catch(() => {
          // Swallow — leave the slot null.
        });
    });

    return () => {
      cancelled = true;
    };
  }, [source, durationMs, count, maxWidth]);

  return { thumbnails, isReady };
}
