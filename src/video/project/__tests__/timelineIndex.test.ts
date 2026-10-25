import { NEUTRAL_CLIP_EDITS, type Clip } from '../model';
import { clipDurationMs, TimelineIndex } from '../timelineIndex';

function makeClip(id: string, sourceStartMs: number, sourceEndMs: number, speed = 1): Clip {
  return {
    id,
    source: `file:///${id}.mp4`,
    sourceDurationMs: sourceEndMs,
    info: { durationMs: sourceEndMs, width: 1920, height: 1080, rotation: 0, fps: 30 },
    sourceStartMs,
    sourceEndMs,
    edits: { ...NEUTRAL_CLIP_EDITS, speed },
  };
}

describe('clipDurationMs', () => {
  it('returns the trimmed range at 1x', () => {
    expect(clipDurationMs(makeClip('a', 1000, 6000))).toBe(5000);
  });

  it('divides by speed', () => {
    expect(clipDurationMs(makeClip('a', 0, 8000, 2))).toBe(4000);
    expect(clipDurationMs(makeClip('a', 0, 8000, 0.5))).toBe(16000);
  });
});

describe('TimelineIndex', () => {
  const clips = [
    makeClip('a', 1000, 6000), // 5000ms output, timeline [0, 5000)
    makeClip('b', 0, 8000, 2), // 4000ms output, timeline [5000, 9000)
    makeClip('c', 500, 3500, 0.5), // 6000ms output, timeline [9000, 15000)
  ];
  const index = new TimelineIndex(clips);

  it('computes prefix sums and total duration', () => {
    expect(index.clipStartMs(0)).toBe(0);
    expect(index.clipStartMs(1)).toBe(5000);
    expect(index.clipStartMs(2)).toBe(9000);
    expect(index.totalDurationMs).toBe(15000);
  });

  it('maps positions to clips with boundaries owned by the later clip', () => {
    expect(index.positionToClip(0)).toEqual({ clipIndex: 0, clipOutputMs: 0, sourceMs: 1000 });
    expect(index.positionToClip(4999).clipIndex).toBe(0);
    expect(index.positionToClip(5000)).toEqual({ clipIndex: 1, clipOutputMs: 0, sourceMs: 0 });
    expect(index.positionToClip(9000).clipIndex).toBe(2);
  });

  it('applies speed when mapping output position to source time', () => {
    // 1000ms into clip b at 2x = source 2000ms.
    expect(index.positionToClip(6000).sourceMs).toBe(2000);
    // 2000ms into clip c at 0.5x = source 500 + 1000.
    expect(index.positionToClip(11000).sourceMs).toBe(1500);
  });

  it('clamps positions outside the timeline', () => {
    expect(index.positionToClip(-50)).toEqual({ clipIndex: 0, clipOutputMs: 0, sourceMs: 1000 });
    const end = index.positionToClip(99999);
    expect(end.clipIndex).toBe(2);
    expect(end.sourceMs).toBe(3500);
  });

  it('round-trips clipToPosition with positionToClip', () => {
    for (const positionMs of [0, 2500, 5000, 6500, 9000, 12000, 14999]) {
      const at = index.positionToClip(positionMs);
      expect(index.clipToPosition(at.clipIndex, at.sourceMs)).toBeCloseTo(positionMs, 6);
    }
  });

  it('handles an empty clip list', () => {
    const empty = new TimelineIndex([]);
    expect(empty.totalDurationMs).toBe(0);
    expect(empty.positionToClip(1000)).toEqual({ clipIndex: 0, clipOutputMs: 0, sourceMs: 0 });
  });
});
