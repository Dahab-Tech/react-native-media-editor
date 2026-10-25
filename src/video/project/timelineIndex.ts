import type { Clip } from './model';

/** Output duration of one clip: trimmed source range divided by speed. */
export function clipDurationMs(clip: Clip): number {
  return (clip.sourceEndMs - clip.sourceStartMs) / clip.edits.speed;
}

export interface TimelinePosition {
  clipIndex: number;
  /** Position inside the clip's output (speed-adjusted) time, in ms. */
  clipOutputMs: number;
  /** Corresponding source timestamp inside the clip, in ms. */
  sourceMs: number;
}

/**
 * Precomputed prefix sums mapping global timeline positions to (clip, source time) and back.
 * Same formulas exist natively (TimelineIndex.kt / ProjectRecords.swift); keep them in sync.
 */
export class TimelineIndex {
  private readonly clips: readonly Clip[];
  /** startsMs[i] = timeline start of clip i; startsMs[n] = total duration. */
  private readonly startsMs: number[];

  constructor(clips: readonly Clip[]) {
    this.clips = clips;
    this.startsMs = new Array(clips.length + 1);
    this.startsMs[0] = 0;
    for (let i = 0; i < clips.length; i += 1) {
      this.startsMs[i + 1] = this.startsMs[i] + clipDurationMs(clips[i]);
    }
  }

  get totalDurationMs(): number {
    return this.startsMs[this.startsMs.length - 1];
  }

  clipStartMs(clipIndex: number): number {
    return this.startsMs[clipIndex];
  }

  /** Maps a global timeline position to its clip; positions at a boundary belong to the later clip. */
  positionToClip(positionMs: number): TimelinePosition {
    if (this.clips.length === 0) return { clipIndex: 0, clipOutputMs: 0, sourceMs: 0 };
    const clamped = Math.max(0, Math.min(positionMs, this.totalDurationMs));
    let index = this.clips.length - 1;
    for (let i = 0; i < this.clips.length; i += 1) {
      if (clamped < this.startsMs[i + 1]) {
        index = i;
        break;
      }
    }
    const clip = this.clips[index];
    const clipOutputMs = clamped - this.startsMs[index];
    return {
      clipIndex: index,
      clipOutputMs,
      sourceMs: clip.sourceStartMs + clipOutputMs * clip.edits.speed,
    };
  }

  /** Maps a source timestamp inside a clip back to the global timeline. */
  clipToPosition(clipIndex: number, sourceMs: number): number {
    const clip = this.clips[clipIndex];
    return this.startsMs[clipIndex] + (sourceMs - clip.sourceStartMs) / clip.edits.speed;
  }
}
