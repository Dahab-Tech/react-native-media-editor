import { NEUTRAL_CLIP_EDITS, OVERLAY_END_UNBOUNDED, type Clip, type Project } from '../model';
import { serializeProject } from '../serialize';

function makeFractionalClip(id: string): Clip {
  return {
    id,
    source: `file:///${id}.mp4`,
    sourceDurationMs: 14875.708333,
    info: {
      durationMs: 14875.708333,
      width: 1919.9999,
      height: 1080.0001,
      rotation: 0,
      fps: 29.97,
    },
    sourceStartMs: 100.4,
    sourceEndMs: 14875.708333,
    edits: { ...NEUTRAL_CLIP_EDITS, speed: 3 },
  };
}

function makeProject(clips: Clip[], overlays: Project['overlays'] = []): Project {
  return { schemaVersion: 1, tracks: [{ id: 't1', kind: 'video', clips }], overlays };
}

describe('serializeProject integer wire contract', () => {
  it('rounds all ms and pixel fields (iOS decodes them as Int64/Int)', () => {
    const overlay = {
      id: 'o1',
      timelineStartMs: 10.6,
      timelineEndMs: OVERLAY_END_UNBOUNDED,
      layers: [],
      strokes: [],
    };
    const wire = serializeProject(makeProject([makeFractionalClip('a')], [overlay]), {
      overlayPngs: new Map([['o1', 'file:///o1.png']]),
    });

    const clip = wire.tracks[0].clips[0];
    for (const value of [
      clip.sourceDurationMs,
      clip.sourceStartMs,
      clip.sourceEndMs,
      clip.width,
      clip.height,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }

    const timedOverlay = wire.overlays![0];
    expect(Number.isInteger(timedOverlay.timelineStartMs)).toBe(true);
    expect(Number.isInteger(timedOverlay.timelineEndMs)).toBe(true);
    expect(Number.isFinite(timedOverlay.timelineEndMs)).toBe(true);
  });

  it('survives JSON round-trip without fractional or non-finite numbers', () => {
    const wire = serializeProject(makeProject([makeFractionalClip('a')]));
    const parsed = JSON.parse(JSON.stringify(wire));
    const clip = parsed.tracks[0].clips[0];
    expect(clip.sourceDurationMs).toBe(14876);
    expect(clip.sourceStartMs).toBe(100);
    expect(clip.sourceEndMs).toBe(14876);
    expect(clip.width).toBe(1920);
    expect(clip.height).toBe(1080);
  });
});

describe('serializeProject pip tracks', () => {
  function makePipProject(): Project {
    const project = makeProject([makeFractionalClip('a')]);
    const pipClip: Clip = {
      ...makeFractionalClip('p'),
      placement: {
        timelineStartMs: 1000.6,
        transform: { x: 0.25, y: 0.75, scale: 0.4, rotation: 12.5, opacity: 0.8 },
      },
    };
    return { ...project, tracks: [...project.tracks, { id: 't2', kind: 'pip', clips: [pipClip] }] };
  }

  it('serializes every track, marking pip tracks and omitting kind on the main track', () => {
    const wire = serializeProject(makePipProject());
    expect(wire.tracks).toHaveLength(2);
    expect(wire.tracks[0].kind).toBeUndefined();
    expect(wire.tracks[1].kind).toBe('pip');
    expect(wire.tracks[1].clips[0].id).toBe('p');
  });

  it('rounds placement ms to integers and passes transform floats through', () => {
    const placement = serializeProject(makePipProject()).tracks[1].clips[0].placement!;
    expect(placement.timelineStartMs).toBe(1001);
    expect(placement.x).toBe(0.25);
    expect(placement.y).toBe(0.75);
    expect(placement.scale).toBe(0.4);
    expect(placement.rotation).toBe(12.5);
    expect(placement.opacity).toBe(0.8);
  });

  it('leaves placement undefined for main-track clips', () => {
    const wire = serializeProject(makePipProject());
    expect(wire.tracks[0].clips[0].placement).toBeUndefined();
  });
});
