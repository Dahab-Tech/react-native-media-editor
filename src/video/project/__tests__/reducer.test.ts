import type { DrawStroke } from '../../../photo/draw';
import type { PhotoLayer } from '../../../photo/layers';
import {
  DEFAULT_PIP_TRANSFORM,
  NEUTRAL_CLIP_EDITS,
  OVERLAY_END_UNBOUNDED,
  pipTracks,
  videoTrack,
  type Clip,
  type Project,
} from '../model';
import {
  createProjectEditorState,
  drawOverlay,
  overlayForLayer,
  overlayLayers,
  PIP_SCALE_MAX,
  PIP_SCALE_MIN,
  projectEditorReducer,
  selectedClip,
  type ProjectEditorAction,
  type ProjectEditorState,
} from '../reducer';

function makeClip(id: string, durationMs: number): Clip {
  return {
    id,
    source: `file:///${id}.mp4`,
    sourceDurationMs: durationMs,
    info: { durationMs, width: 1920, height: 1080, rotation: 0, fps: 30 },
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    edits: NEUTRAL_CLIP_EDITS,
  };
}

function makeProject(clips: Clip[]): Project {
  return { schemaVersion: 1, tracks: [{ id: 't1', kind: 'video', clips }], overlays: [] };
}

function run(state: ProjectEditorState, ...actions: ProjectEditorAction[]): ProjectEditorState {
  return actions.reduce(projectEditorReducer, state);
}

const textLayer: PhotoLayer = {
  kind: 'text',
  id: 'l1',
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  text: 'HELLO',
  color: '#fff',
  bold: false,
  italic: false,
  align: 'center',
  background: null,
  fontId: 'system',
};

function initial(): ProjectEditorState {
  return createProjectEditorState(makeProject([makeClip('a', 10000), makeClip('b', 6000)]));
}

describe('clip operations', () => {
  it('adds clips after the selected anchor and selects the last added', () => {
    const next = run(initial(), { type: 'addClips', clips: [makeClip('c', 4000)], afterId: 'a' });
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(next.selectedClipId).toBe('c');
  });

  it('appends when no anchor is given', () => {
    const next = run(initial(), { type: 'addClips', clips: [makeClip('c', 4000)] });
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes a clip and moves selection to the nearest survivor', () => {
    const next = run(initial(), { type: 'selectClip', id: 'b' }, { type: 'removeClip', id: 'b' });
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['a']);
    expect(next.selectedClipId).toBe('a');
  });

  it('refuses to remove the last clip', () => {
    const one = createProjectEditorState(makeProject([makeClip('a', 10000)]));
    expect(run(one, { type: 'removeClip', id: 'a' })).toBe(one);
  });

  it('moves a clip and clamps the target index', () => {
    const next = run(initial(), { type: 'moveClip', id: 'a', toIndex: 99 });
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('clamps trim to the source duration', () => {
    const next = run(initial(), {
      type: 'trimClip',
      id: 'a',
      sourceStartMs: -500,
      sourceEndMs: 99999,
    });
    const clip = videoTrack(next.project).clips[0];
    expect(clip.sourceStartMs).toBe(0);
    expect(clip.sourceEndMs).toBe(10000);
  });

  it('splits a clip into two halves sharing source and edits', () => {
    const withSpeed = run(initial(), { type: 'setSpeed', value: 2 });
    const next = run(withSpeed, { type: 'splitClip', id: 'a', sourceMs: 4000, minDurationMs: 100 });
    const clips = videoTrack(next.project).clips;
    expect(clips).toHaveLength(3);
    const [head, tail] = clips;
    expect(head.id).toBe('a');
    expect(head.sourceStartMs).toBe(0);
    expect(head.sourceEndMs).toBe(4000);
    expect(tail.id).not.toBe('a');
    expect(tail.sourceStartMs).toBe(4000);
    expect(tail.sourceEndMs).toBe(10000);
    expect(tail.source).toBe(head.source);
    expect(tail.edits.speed).toBe(2);
  });

  it('refuses a split when either half would play shorter than the minimum', () => {
    const state = initial();
    expect(run(state, { type: 'splitClip', id: 'a', sourceMs: 50, minDurationMs: 100 })).toBe(
      state
    );
    expect(run(state, { type: 'splitClip', id: 'a', sourceMs: 9950, minDurationMs: 100 })).toBe(
      state
    );
  });

  it('undoes a split back to the original clip', () => {
    const next = run(
      initial(),
      { type: 'splitClip', id: 'a', sourceMs: 4000, minDurationMs: 100 },
      { type: 'undo' }
    );
    const clips = videoTrack(next.project).clips;
    expect(clips.map((c) => c.id)).toEqual(['a', 'b']);
    expect(clips[0].sourceEndMs).toBe(10000);
  });

  it('applies per-clip edits to the selected clip only', () => {
    const next = run(initial(), { type: 'selectClip', id: 'b' }, { type: 'setSpeed', value: 2 });
    const [a, b] = videoTrack(next.project).clips;
    expect(a.edits.speed).toBe(1);
    expect(b.edits.speed).toBe(2);
  });
});

describe('history', () => {
  it('auto-checkpoints discrete actions and supports undo/redo', () => {
    const afterSpeed = run(initial(), { type: 'setSpeed', value: 2 });
    expect(afterSpeed.past).toHaveLength(1);

    const undone = run(afterSpeed, { type: 'undo' });
    expect(selectedClip(undone).edits.speed).toBe(1);

    const redone = run(undone, { type: 'redo' });
    expect(selectedClip(redone).edits.speed).toBe(2);
  });

  it('relies on caller checkpoints for continuous actions', () => {
    const trimmedWithout = run(initial(), {
      type: 'trimClip',
      id: 'a',
      sourceStartMs: 1000,
      sourceEndMs: 9000,
    });
    expect(trimmedWithout.past).toHaveLength(0);

    const trimmedWith = run(
      initial(),
      { type: 'checkpoint' },
      { type: 'trimClip', id: 'a', sourceStartMs: 1000, sourceEndMs: 9000 },
      { type: 'undo' }
    );
    expect(videoTrack(trimmedWith.project).clips[0].sourceStartMs).toBe(0);
  });

  it('repairs clip selection when undo removes the selected clip', () => {
    const next = run(
      initial(),
      { type: 'addClips', clips: [makeClip('c', 4000)] },
      { type: 'undo' }
    );
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['a', 'b']);
    expect(next.selectedClipId).toBe('a');
  });
});

const secondLayer: PhotoLayer = { ...textLayer, id: 'l2', text: 'WORLD' };

const stroke: DrawStroke = {
  id: 's1',
  brush: 'pen',
  color: '#fff',
  size: 0.014,
  points: [{ x: 0.1, y: 0.1 }],
};

describe('timed overlays', () => {
  it('gives each added layer its own overlay spanning the whole project', () => {
    const next = run(
      initial(),
      { type: 'addLayer', layer: textLayer },
      { type: 'addLayer', layer: secondLayer }
    );
    expect(next.project.overlays).toHaveLength(2);
    const first = overlayForLayer(next.project, 'l1')!;
    const second = overlayForLayer(next.project, 'l2')!;
    expect(first.id).not.toBe(second.id);
    expect(first.timelineStartMs).toBe(0);
    expect(first.timelineEndMs).toBe(OVERLAY_END_UNBOUNDED);
    expect(next.selectedLayerId).toBe('l2');
  });

  it('times each element independently and clamps the start to zero', () => {
    const withLayers = run(
      initial(),
      { type: 'addLayer', layer: textLayer },
      { type: 'addLayer', layer: secondLayer }
    );
    const next = run(withLayers, {
      type: 'setOverlayTiming',
      overlayId: overlayForLayer(withLayers.project, 'l1')!.id,
      timelineStartMs: -200,
      timelineEndMs: 8000,
    });
    const first = overlayForLayer(next.project, 'l1')!;
    expect(first.timelineStartMs).toBe(0);
    expect(first.timelineEndMs).toBe(8000);
    expect(overlayForLayer(next.project, 'l2')!.timelineEndMs).toBe(OVERLAY_END_UNBOUNDED);
  });

  it('duplicating a layer copies its timing window into a new overlay', () => {
    const withLayer = run(initial(), { type: 'addLayer', layer: textLayer });
    const timed = run(withLayer, {
      type: 'setOverlayTiming',
      overlayId: overlayForLayer(withLayer.project, 'l1')!.id,
      timelineStartMs: 1000,
      timelineEndMs: 5000,
    });
    const next = run(timed, { type: 'duplicateLayer', id: 'l1' });
    expect(next.project.overlays).toHaveLength(2);
    const copyId = overlayLayers(next.project).find((l) => l.id !== 'l1')!.id;
    const copyOverlay = overlayForLayer(next.project, copyId)!;
    expect(copyOverlay.id).not.toBe(overlayForLayer(next.project, 'l1')!.id);
    expect(copyOverlay.timelineStartMs).toBe(1000);
    expect(copyOverlay.timelineEndMs).toBe(5000);
  });

  it('removing a layer drops its now-empty overlay', () => {
    const next = run(
      initial(),
      { type: 'addLayer', layer: textLayer },
      { type: 'addLayer', layer: secondLayer },
      { type: 'removeLayer', id: 'l1' }
    );
    expect(next.project.overlays).toHaveLength(1);
    expect(overlayForLayer(next.project, 'l1')).toBeNull();
    expect(overlayForLayer(next.project, 'l2')).not.toBeNull();
  });

  it('reorders elements by moving their overlays in the stack', () => {
    const next = run(
      initial(),
      { type: 'addLayer', layer: textLayer },
      { type: 'addLayer', layer: secondLayer },
      { type: 'reorderLayer', id: 'l1', direction: 'bringToFront' }
    );
    expect(overlayLayers(next.project).map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('collects strokes into a single draw overlay and clears it entirely', () => {
    const withStrokes = run(
      initial(),
      { type: 'addLayer', layer: textLayer },
      { type: 'addStroke', stroke },
      { type: 'addStroke', stroke: { ...stroke, id: 's2' } }
    );
    expect(withStrokes.project.overlays).toHaveLength(2);
    expect(drawOverlay(withStrokes.project)!.strokes).toHaveLength(2);

    const cleared = run(withStrokes, { type: 'clearStrokes' });
    expect(drawOverlay(cleared.project)).toBeNull();
    expect(overlayForLayer(cleared.project, 'l1')).not.toBeNull();
  });
});

const pipInfo = { durationMs: 5000, width: 1280, height: 720, rotation: 0, fps: 30 };

function withPip(state: ProjectEditorState = initial()): ProjectEditorState {
  return run(state, {
    type: 'addPip',
    source: 'file:///pip.mp4',
    info: pipInfo,
    timelineStartMs: 2000,
  });
}

describe('pip tracks', () => {
  it('adds a pip track with the default transform and selects its clip', () => {
    const next = withPip();
    const pips = pipTracks(next.project);
    expect(pips).toHaveLength(1);
    expect(next.project.tracks[0].kind).toBe('video');
    const clip = pips[0].clips[0];
    expect(clip.placement).toEqual({ timelineStartMs: 2000, transform: DEFAULT_PIP_TRANSFORM });
    expect(next.selectedClipId).toBe(clip.id);
  });

  it('stacks multiple pips in add order', () => {
    const next = run(withPip(), {
      type: 'addPip',
      source: 'file:///pip2.mp4',
      info: pipInfo,
      timelineStartMs: 0,
    });
    expect(pipTracks(next.project)).toHaveLength(2);
    expect(videoTrack(next.project).clips.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('moves the pip window and clamps the start to zero', () => {
    const state = withPip();
    const trackId = pipTracks(state.project)[0].id;
    const next = run(state, { type: 'setPipWindow', trackId, timelineStartMs: -300 });
    expect(pipTracks(next.project)[0].clips[0].placement!.timelineStartMs).toBe(0);
  });

  it('reorders the pip stack via toIndex in the same undo step as the window move', () => {
    const state = run(
      withPip(),
      { type: 'addPip', source: 'file:///pip2.mp4', info: pipInfo, timelineStartMs: 0 },
      { type: 'addPip', source: 'file:///pip3.mp4', info: pipInfo, timelineStartMs: 500 }
    );
    const [p0, p1, p2] = pipTracks(state.project).map((tk) => tk.id);
    const next = run(state, {
      type: 'setPipWindow',
      trackId: p0,
      timelineStartMs: 1000,
      toIndex: 2,
    });
    expect(pipTracks(next.project).map((tk) => tk.id)).toEqual([p1, p2, p0]);
    expect(pipTracks(next.project)[2].clips[0].placement!.timelineStartMs).toBe(1000);
    expect(next.project.tracks[0].kind).toBe('video');

    const undone = run(next, { type: 'undo' });
    expect(pipTracks(undone.project).map((tk) => tk.id)).toEqual([p0, p1, p2]);
    expect(pipTracks(undone.project)[0].clips[0].placement!.timelineStartMs).toBe(2000);
  });

  it('clamps toIndex to the pip stack bounds', () => {
    const state = run(withPip(), {
      type: 'addPip',
      source: 'file:///pip2.mp4',
      info: pipInfo,
      timelineStartMs: 0,
    });
    const [p0, p1] = pipTracks(state.project).map((tk) => tk.id);
    const next = run(state, {
      type: 'setPipWindow',
      trackId: p0,
      timelineStartMs: 2000,
      toIndex: 9,
    });
    expect(pipTracks(next.project).map((tk) => tk.id)).toEqual([p1, p0]);
    const back = run(next, {
      type: 'setPipWindow',
      trackId: p0,
      timelineStartMs: 2000,
      toIndex: -5,
    });
    expect(pipTracks(back.project).map((tk) => tk.id)).toEqual([p0, p1]);
  });

  it('clamps the committed transform to valid ranges', () => {
    const state = withPip();
    const trackId = pipTracks(state.project)[0].id;
    const next = run(state, {
      type: 'setPipTransform',
      trackId,
      transform: { x: 1.4, y: -0.2, scale: 99, rotation: -45, opacity: 2 },
    });
    expect(pipTracks(next.project)[0].clips[0].placement!.transform).toEqual({
      x: 1,
      y: 0,
      scale: PIP_SCALE_MAX,
      rotation: -45,
      opacity: 1,
    });
    const floor = run(next, {
      type: 'setPipTransform',
      trackId,
      transform: { x: 0.5, y: 0.5, scale: 0, rotation: 0, opacity: 0.5 },
    });
    expect(pipTracks(floor.project)[0].clips[0].placement!.transform.scale).toBe(PIP_SCALE_MIN);
  });

  it('ignores pip actions aimed at the main track or unknown tracks', () => {
    const state = withPip();
    expect(run(state, { type: 'setPipWindow', trackId: 't1', timelineStartMs: 100 })).toBe(state);
    expect(run(state, { type: 'removePip', trackId: 'nope' })).toBe(state);
  });

  it('trims and edits pip clips through the shared clip actions', () => {
    const state = withPip();
    const pipClipId = pipTracks(state.project)[0].clips[0].id;
    const next = run(
      state,
      { type: 'trimClip', id: pipClipId, sourceStartMs: 500, sourceEndMs: 9999 },
      { type: 'setSpeed', value: 2 }
    );
    const pipClip = pipTracks(next.project)[0].clips[0];
    expect(pipClip.sourceStartMs).toBe(500);
    expect(pipClip.sourceEndMs).toBe(5000);
    expect(pipClip.edits.speed).toBe(2);
    expect(videoTrack(next.project).clips.every((c) => c.edits.speed === 1)).toBe(true);
  });

  it('keeps pip clips out of main-track structural ops', () => {
    const state = withPip();
    const pipClipId = pipTracks(state.project)[0].clips[0].id;
    expect(run(state, { type: 'removeClip', id: pipClipId })).toBe(state);
    expect(
      run(state, { type: 'splitClip', id: pipClipId, sourceMs: 2500, minDurationMs: 100 })
    ).toBe(state);
  });

  it('removes a pip and repairs the selection', () => {
    const state = withPip();
    const trackId = pipTracks(state.project)[0].id;
    const next = run(state, { type: 'removePip', trackId });
    expect(pipTracks(next.project)).toHaveLength(0);
    expect(next.selectedClipId).toBe('a');
  });

  it('undoes addPip and removePip as single steps', () => {
    const added = withPip();
    expect(pipTracks(run(added, { type: 'undo' }).project)).toHaveLength(0);

    const trackId = pipTracks(added.project)[0].id;
    const removed = run(added, { type: 'removePip', trackId });
    const restored = run(removed, { type: 'undo' });
    expect(pipTracks(restored.project)).toHaveLength(1);
    expect(pipTracks(restored.project)[0].id).toBe(trackId);
  });
});
