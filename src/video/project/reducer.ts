import { useMemo, useReducer } from 'react';

import {
  adjustmentMeta,
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  type PhotoAdjustmentKey,
  type PhotoFilterId,
} from '../../photo/color';
import type { DrawStroke } from '../../photo/draw/types';
import {
  duplicateLayer as duplicateLayerOp,
  LAYER_SCALE_MAX,
  LAYER_SCALE_MIN,
  reorderLayer as reorderLayerOp,
  type PhotoLayer,
  type PhotoLayerPatch,
  type ReorderDirection,
} from '../../photo/layers';
import type { PhotoOverlayId } from '../../photo/overlays';
import type { AspectRatio } from '../../photo/state/photoEditorState';
import type { CropRect, VideoInfo } from '../../types';
import { clamp } from '../format';
import {
  createPipTrack,
  findClip,
  generateProjectId,
  OVERLAY_END_UNBOUNDED,
  videoTrack,
  type Clip,
  type ClipEdits,
  type PipPlacement,
  type PipTransform,
  type Project,
  type TimedOverlay,
} from './model';

/** Every toolbar tab id the VideoEditor understands. */
export type VideoToolId =
  'crop' | 'adjust' | 'effects' | 'speed' | 'pip' | 'text' | 'stickers' | 'draw' | 'cover';

/** Default toolbar tab order — the fallback when `videoTools` is omitted. */
export const VIDEO_TOOL_IDS: readonly VideoToolId[] = [
  'crop',
  'adjust',
  'effects',
  'speed',
  'pip',
  'text',
  'stickers',
  'draw',
  'cover',
] as const;

/** Minimum playback speed the SpeedTool exposes. */
export const VIDEO_SPEED_MIN = 0.5;
/** Maximum playback speed the SpeedTool exposes. */
export const VIDEO_SPEED_MAX = 2.0;
/** Neutral / default speed — 1.0× real-time. */
export const VIDEO_SPEED_DEFAULT = 1.0;
/** Discrete speed chip presets. */
export const VIDEO_SPEED_PRESETS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/** Minimum pip scale — fraction of the canvas after aspect-fit. */
export const PIP_SCALE_MIN = 0.05;
/** Maximum pip scale — >1 lets a pip overfill the canvas. */
export const PIP_SCALE_MAX = 2;

const HISTORY_LIMIT = 100;

/** Undoable document = the project; tool/selection state is ephemeral and excluded from history. */
export interface ProjectEditorState {
  project: Project;
  activeTool: VideoToolId | null;
  selectedClipId: string;
  selectedLayerId: string | null;
  past: Project[];
  future: Project[];
}

export type ProjectEditorAction =
  | { type: 'setTool'; tool: VideoToolId | null }
  | { type: 'selectClip'; id: string }
  /** Appends clips (after `afterId` when given) and selects the last one. Auto-checkpointed. */
  | { type: 'addClips'; clips: Clip[]; afterId?: string }
  /** No-op on the last remaining clip. Auto-checkpointed. */
  | { type: 'removeClip'; id: string }
  | { type: 'moveClip'; id: string; toIndex: number }
  /** Committed trim — caller dispatches `checkpoint` first (draft handles are UI-local). */
  | { type: 'trimClip'; id: string; sourceStartMs: number; sourceEndMs: number }
  /** Splits at a source-time position; no-op when either half would play shorter than `minDurationMs`. Auto-checkpointed. */
  | { type: 'splitClip'; id: string; sourceMs: number; minDurationMs: number }
  | { type: 'setCrop'; crop: CropRect | null }
  /** Discrete aspect-chip pick, auto-checkpointed. */
  | { type: 'setAspect'; aspect: AspectRatio }
  /** Continuous slider action — caller dispatches `checkpoint` at drag start. */
  | { type: 'setAdjustment'; key: PhotoAdjustmentKey; value: number }
  | { type: 'resetAdjustments' }
  /** Discrete filter pick, auto-checkpointed. Resets intensity to 1. */
  | { type: 'setFilter'; id: PhotoFilterId }
  | { type: 'setFilterIntensity'; value: number }
  /** Discrete color-wash pick, auto-checkpointed. `null` clears. */
  | { type: 'setOverlay'; id: PhotoOverlayId; defaultIntensity?: number }
  | { type: 'setOverlayIntensity'; value: number }
  | { type: 'setSpeed'; value: number }
  | { type: 'addLayer'; layer: PhotoLayer }
  | { type: 'updateLayer'; id: string; patch: PhotoLayerPatch }
  | { type: 'setLayerTransform'; id: string; x: number; y: number; scale: number; rotation: number }
  | { type: 'removeLayer'; id: string }
  | { type: 'selectLayer'; id: string | null }
  | { type: 'duplicateLayer'; id: string }
  | { type: 'reorderLayer'; id: string; direction: ReorderDirection }
  | { type: 'addStroke'; stroke: DrawStroke }
  | { type: 'clearStrokes' }
  | { type: 'setOverlayTiming'; overlayId: string; timelineStartMs: number; timelineEndMs: number }
  /** New pip track over the main video, selected on add. Auto-checkpointed. */
  | { type: 'addPip'; source: string; info: VideoInfo; timelineStartMs: number }
  | { type: 'removePip'; trackId: string }
  /** Committed lane drag — draft positions are UI-local. `toIndex` reorders within the pip stack (z = pip order). Auto-checkpointed. */
  | { type: 'setPipWindow'; trackId: string; timelineStartMs: number; toIndex?: number }
  /** Committed ghost-gesture transform, applied on release. Auto-checkpointed. */
  | { type: 'setPipTransform'; trackId: string; transform: PipTransform }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

/** Discrete actions the reducer implicitly checkpoints. Continuous actions rely on a caller-driven `checkpoint` at interaction start. */
const AUTO_CHECKPOINT_ACTIONS: ReadonlySet<ProjectEditorAction['type']> = new Set([
  'addClips',
  'removeClip',
  'moveClip',
  'splitClip',
  'setAspect',
  'resetAdjustments',
  'setFilter',
  'setOverlay',
  'setSpeed',
  'addLayer',
  'removeLayer',
  'setLayerTransform',
  'duplicateLayer',
  'reorderLayer',
  'addStroke',
  'clearStrokes',
  'setOverlayTiming',
  'addPip',
  'removePip',
  'setPipWindow',
  'setPipTransform',
]);

export function selectedClip(state: ProjectEditorState): Clip {
  return findClip(state.project, state.selectedClipId)?.clip ?? videoTrack(state.project).clips[0];
}

export function selectedEdits(state: ProjectEditorState): ClipEdits {
  return selectedClip(state).edits;
}

/** CapCut-style: every layer element is its own TimedOverlay; strokes share one draw overlay. */
export function overlayForLayer(project: Project, layerId: string): TimedOverlay | null {
  return project.overlays.find((o) => o.layers.some((l) => l.id === layerId)) ?? null;
}

export function drawOverlay(project: Project): TimedOverlay | null {
  return project.overlays.find((o) => o.strokes.length > 0) ?? null;
}

// WeakMap caches keep the flattened arrays referentially stable per project version.
const layersCache = new WeakMap<TimedOverlay[], PhotoLayer[]>();
const strokesCache = new WeakMap<TimedOverlay[], DrawStroke[]>();

export function overlayLayers(project: Project): PhotoLayer[] {
  let layers = layersCache.get(project.overlays);
  if (!layers) {
    layers = project.overlays.flatMap((o) => o.layers);
    layersCache.set(project.overlays, layers);
  }
  return layers;
}

export function overlayStrokes(project: Project): DrawStroke[] {
  let strokes = strokesCache.get(project.overlays);
  if (!strokes) {
    strokes = project.overlays.flatMap((o) => o.strokes);
    strokesCache.set(project.overlays, strokes);
  }
  return strokes;
}

export function projectEditorReducer(
  state: ProjectEditorState,
  action: ProjectEditorAction
): ProjectEditorState {
  if (action.type === 'checkpoint') return pushCheckpoint(state);
  if (action.type === 'undo') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return normalizeSelection({
      ...state,
      project: previous,
      past: state.past.slice(0, -1),
      future: [...state.future, state.project],
    });
  }
  if (action.type === 'redo') {
    if (state.future.length === 0) return state;
    const next = state.future[state.future.length - 1];
    return normalizeSelection({
      ...state,
      project: next,
      past: [...state.past, state.project],
      future: state.future.slice(0, -1),
    });
  }
  const base = AUTO_CHECKPOINT_ACTIONS.has(action.type) ? pushCheckpoint(state) : state;
  const next = applyAction(base, action);
  // Drop the auto checkpoint when the action was refused or a no-op.
  return next.project === state.project && base !== state ? state : next;
}

function applyAction(state: ProjectEditorState, action: ProjectEditorAction): ProjectEditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, activeTool: action.tool };
    case 'selectClip':
      return { ...state, selectedClipId: action.id };
    case 'addClips': {
      if (action.clips.length === 0) return state;
      const clips = videoTrack(state.project).clips;
      const anchor = action.afterId
        ? clips.findIndex((c) => c.id === action.afterId)
        : clips.length - 1;
      const at = anchor === -1 ? clips.length : anchor + 1;
      const next = [...clips.slice(0, at), ...action.clips, ...clips.slice(at)];
      return {
        ...withClips(state, next),
        selectedClipId: action.clips[action.clips.length - 1].id,
      };
    }
    case 'removeClip': {
      const clips = videoTrack(state.project).clips;
      if (clips.length <= 1) return state;
      const index = clips.findIndex((c) => c.id === action.id);
      if (index === -1) return state;
      const next = clips.filter((c) => c.id !== action.id);
      const selected =
        state.selectedClipId === action.id
          ? next[Math.min(index, next.length - 1)].id
          : state.selectedClipId;
      return { ...withClips(state, next), selectedClipId: selected };
    }
    case 'moveClip': {
      const clips = videoTrack(state.project).clips;
      const from = clips.findIndex((c) => c.id === action.id);
      const to = clamp(action.toIndex, 0, clips.length - 1);
      if (from === -1 || from === to) return state;
      const next = [...clips];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return withClips(state, next);
    }
    case 'trimClip':
      return updateClip(state, action.id, (clip) => ({
        ...clip,
        sourceStartMs: clamp(action.sourceStartMs, 0, clip.sourceDurationMs),
        sourceEndMs: clamp(action.sourceEndMs, 0, clip.sourceDurationMs),
      }));
    case 'splitClip': {
      const clips = videoTrack(state.project).clips;
      const index = clips.findIndex((c) => c.id === action.id);
      if (index === -1) return state;
      const clip = clips[index];
      const speed = clip.edits.speed;
      const headMs = (action.sourceMs - clip.sourceStartMs) / speed;
      const tailMs = (clip.sourceEndMs - action.sourceMs) / speed;
      if (headMs < action.minDurationMs || tailMs < action.minDurationMs) return state;
      const head: Clip = { ...clip, sourceEndMs: action.sourceMs };
      const tail: Clip = {
        ...clip,
        id: generateProjectId('c'),
        sourceStartMs: action.sourceMs,
        edits: { ...clip.edits },
      };
      const next = [...clips.slice(0, index), head, tail, ...clips.slice(index + 1)];
      return withClips(state, next);
    }
    case 'setCrop':
      return updateSelectedEdits(state, { crop: action.crop });
    case 'setAspect':
      return updateSelectedEdits(state, { aspect: action.aspect });
    case 'setAdjustment': {
      const { min, max } = adjustmentMeta(action.key);
      const edits = selectedEdits(state);
      return updateSelectedEdits(state, {
        adjustments: { ...edits.adjustments, [action.key]: clamp(action.value, min, max) },
      });
    }
    case 'resetAdjustments':
      return updateSelectedEdits(state, { adjustments: NEUTRAL_ADJUSTMENTS });
    case 'setFilter':
      return updateSelectedEdits(state, { filterId: action.id, filterIntensity: 1 });
    case 'setFilterIntensity':
      return updateSelectedEdits(state, { filterIntensity: clamp(action.value, 0, 1) });
    case 'setOverlay':
      return updateSelectedEdits(state, {
        overlayId: action.id,
        overlayIntensity: clamp(action.defaultIntensity ?? 1, 0, 1),
      });
    case 'setOverlayIntensity':
      return updateSelectedEdits(state, { overlayIntensity: clamp(action.value, 0, 1) });
    case 'setSpeed':
      return updateSelectedEdits(state, {
        speed: clamp(action.value, VIDEO_SPEED_MIN, VIDEO_SPEED_MAX),
      });
    case 'addLayer':
      return {
        ...withProject(state, {
          ...state.project,
          overlays: [...state.project.overlays, createLayerOverlay([action.layer])],
        }),
        selectedLayerId: action.layer.id,
      };
    case 'updateLayer':
      return updateLayerIn(state, action.id, (layer) => applyPatch(layer, action.id, action.patch));
    case 'setLayerTransform':
      return updateLayerIn(state, action.id, (layer) => ({
        ...layer,
        x: clamp(action.x, 0, 1),
        y: clamp(action.y, 0, 1),
        scale: clamp(action.scale, LAYER_SCALE_MIN, LAYER_SCALE_MAX),
        rotation: action.rotation,
      }));
    case 'removeLayer': {
      const overlays = state.project.overlays
        .map((o) =>
          o.layers.some((l) => l.id === action.id)
            ? { ...o, layers: o.layers.filter((l) => l.id !== action.id) }
            : o
        )
        .filter((o) => o.layers.length > 0 || o.strokes.length > 0);
      if (!overlayForLayer(state.project, action.id)) return state;
      return {
        ...withProject(state, { ...state.project, overlays }),
        selectedLayerId: state.selectedLayerId === action.id ? null : state.selectedLayerId,
      };
    }
    case 'selectLayer':
      return { ...state, selectedLayerId: action.id };
    case 'duplicateLayer': {
      const source = overlayForLayer(state.project, action.id);
      const layer = source?.layers.find((l) => l.id === action.id);
      if (!source || !layer) return state;
      const copy = duplicateLayerOp(layer);
      // The clone inherits the source element's timing window.
      const clone: TimedOverlay = { ...source, id: generateProjectId('o'), layers: [copy] };
      const overlays = [...state.project.overlays];
      overlays.splice(overlays.indexOf(source) + 1, 0, clone);
      return {
        ...withProject(state, { ...state.project, overlays }),
        selectedLayerId: copy.id,
      };
    }
    case 'reorderLayer': {
      const overlays = state.project.overlays;
      const index = overlays.findIndex((o) => o.layers.some((l) => l.id === action.id));
      if (index === -1) return state;
      // Overlay array order = z-order, so elements reorder as whole overlays.
      const next = reorderLayerOp(overlays, index, action.direction);
      if (next === overlays) return state;
      return withProject(state, { ...state.project, overlays: next as TimedOverlay[] });
    }
    case 'addStroke': {
      const existing = drawOverlay(state.project);
      const overlays = existing
        ? state.project.overlays.map((o) =>
            o === existing ? { ...o, strokes: [...o.strokes, action.stroke] } : o
          )
        : [...state.project.overlays, { ...createLayerOverlay([]), strokes: [action.stroke] }];
      return withProject(state, { ...state.project, overlays });
    }
    case 'clearStrokes': {
      const existing = drawOverlay(state.project);
      if (!existing) return state;
      return withProject(state, {
        ...state.project,
        overlays: state.project.overlays.filter((o) => o !== existing),
      });
    }
    case 'setOverlayTiming':
      return withProject(state, {
        ...state.project,
        overlays: state.project.overlays.map((overlay) =>
          overlay.id === action.overlayId
            ? {
                ...overlay,
                timelineStartMs: Math.max(0, action.timelineStartMs),
                timelineEndMs: action.timelineEndMs,
              }
            : overlay
        ),
      });
    case 'addPip': {
      const track = createPipTrack(action.source, action.info, Math.max(0, action.timelineStartMs));
      return {
        ...withProject(state, {
          ...state.project,
          tracks: [...state.project.tracks, track],
        }),
        selectedClipId: track.clips[0].id,
      };
    }
    case 'removePip': {
      const track = state.project.tracks.find((t) => t.id === action.trackId);
      if (!track || track.kind !== 'pip') return state;
      return normalizeSelection(
        withProject(state, {
          ...state.project,
          tracks: state.project.tracks.filter((t) => t !== track),
        })
      );
    }
    case 'setPipWindow': {
      const moved = updatePipPlacement(state, action.trackId, (placement) => ({
        ...placement,
        timelineStartMs: Math.max(0, action.timelineStartMs),
      }));
      if (action.toIndex == null) return moved;
      // Reorder within the pip stack only — the main track stays tracks[0]. Later pip = on top.
      const pips = moved.project.tracks.filter((t) => t.kind === 'pip');
      const fromIndex = pips.findIndex((t) => t.id === action.trackId);
      const toIndex = clamp(Math.round(action.toIndex), 0, pips.length - 1);
      if (fromIndex < 0 || fromIndex === toIndex) return moved;
      const reordered = [...pips];
      const [track] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, track);
      return withProject(moved, {
        ...moved.project,
        tracks: [...moved.project.tracks.filter((t) => t.kind !== 'pip'), ...reordered],
      });
    }
    case 'setPipTransform':
      return updatePipPlacement(state, action.trackId, (placement) => ({
        ...placement,
        transform: {
          x: clamp(action.transform.x, 0, 1),
          y: clamp(action.transform.y, 0, 1),
          scale: clamp(action.transform.scale, PIP_SCALE_MIN, PIP_SCALE_MAX),
          rotation: action.transform.rotation,
          opacity: clamp(action.transform.opacity, 0, 1),
        },
      }));
    default:
      return state;
  }
}

function withProject(state: ProjectEditorState, project: Project): ProjectEditorState {
  return project === state.project ? state : { ...state, project };
}

/** Replaces the main track's clips; pip tracks pass through untouched. */
function withClips(state: ProjectEditorState, clips: Clip[]): ProjectEditorState {
  const [track, ...pips] = state.project.tracks;
  return withProject(state, {
    ...state.project,
    tracks: [{ ...track, clips }, ...pips],
  });
}

function updateClip(
  state: ProjectEditorState,
  clipId: string,
  update: (clip: Clip) => Clip
): ProjectEditorState {
  const found = findClip(state.project, clipId);
  if (!found) return state;
  const next = update(found.clip);
  if (next === found.clip) return state;
  return withProject(state, {
    ...state.project,
    tracks: state.project.tracks.map((track) =>
      track === found.track
        ? { ...track, clips: track.clips.map((c) => (c === found.clip ? next : c)) }
        : track
    ),
  });
}

function updatePipPlacement(
  state: ProjectEditorState,
  trackId: string,
  update: (placement: PipPlacement) => PipPlacement
): ProjectEditorState {
  const track = state.project.tracks.find((t) => t.id === trackId);
  const clip = track?.kind === 'pip' ? track.clips[0] : undefined;
  if (!track || !clip?.placement) return state;
  const placement = update(clip.placement);
  return withProject(state, {
    ...state.project,
    tracks: state.project.tracks.map((t) =>
      t === track ? { ...t, clips: [{ ...clip, placement }] } : t
    ),
  });
}

function updateSelectedEdits(
  state: ProjectEditorState,
  patch: Partial<ClipEdits>
): ProjectEditorState {
  return updateClip(state, selectedClip(state).id, (clip) => ({
    ...clip,
    edits: { ...clip.edits, ...patch },
  }));
}

function createLayerOverlay(layers: PhotoLayer[]): TimedOverlay {
  return {
    id: generateProjectId('o'),
    timelineStartMs: 0,
    timelineEndMs: OVERLAY_END_UNBOUNDED,
    layers,
    strokes: [],
  };
}

function updateLayerIn(
  state: ProjectEditorState,
  layerId: string,
  update: (layer: PhotoLayer) => PhotoLayer
): ProjectEditorState {
  const overlays = state.project.overlays;
  const index = overlays.findIndex((o) => o.layers.some((l) => l.id === layerId));
  if (index === -1) return state;
  const overlay = overlays[index];
  const layers = overlay.layers.map((l) => (l.id === layerId ? update(l) : l));
  if (layers.every((l, i) => l === overlay.layers[i])) return state;
  return withProject(state, {
    ...state.project,
    overlays: overlays.map((o, i) => (i === index ? { ...overlay, layers } : o)),
  });
}

function applyPatch(layer: PhotoLayer, id: string, patch: PhotoLayerPatch): PhotoLayer {
  if (layer.id !== id) return layer;
  const scaled =
    patch.scale != null ? clamp(patch.scale, LAYER_SCALE_MIN, LAYER_SCALE_MAX) : layer.scale;
  switch (layer.kind) {
    case 'text':
      return { ...layer, ...(patch as PhotoLayerPatch<typeof layer>), scale: scaled };
    case 'sticker':
      return { ...layer, ...(patch as PhotoLayerPatch<typeof layer>), scale: scaled };
  }
}

/** Every mutation replaces the project object, so undo/redo can leave stale clip/layer selections. */
function normalizeSelection(state: ProjectEditorState): ProjectEditorState {
  const clipOk = findClip(state.project, state.selectedClipId) != null;
  const layerOk =
    state.selectedLayerId == null ||
    overlayLayers(state.project).some((l) => l.id === state.selectedLayerId);
  if (clipOk && layerOk) return state;
  return {
    ...state,
    selectedClipId: clipOk ? state.selectedClipId : videoTrack(state.project).clips[0].id,
    selectedLayerId: layerOk ? state.selectedLayerId : null,
  };
}

function pushCheckpoint(state: ProjectEditorState): ProjectEditorState {
  const top = state.past[state.past.length - 1];
  // Immutable updates — identical reference means nothing changed since the last checkpoint.
  if (top === state.project) {
    if (state.future.length === 0) return state;
    return { ...state, future: [] };
  }
  const trimmed =
    state.past.length >= HISTORY_LIMIT
      ? state.past.slice(state.past.length - HISTORY_LIMIT + 1)
      : state.past;
  return { ...state, past: [...trimmed, state.project], future: [] };
}

export interface ProjectEditorController {
  state: ProjectEditorState;
  dispatch: React.Dispatch<ProjectEditorAction>;
}

export function createProjectEditorState(project: Project): ProjectEditorState {
  return {
    project,
    activeTool: null,
    selectedClipId: videoTrack(project).clips[0]?.id ?? '',
    selectedLayerId: null,
    past: [],
    future: [],
  };
}

export function useProjectEditorState(initialProject: Project): ProjectEditorController {
  const [state, dispatch] = useReducer(
    projectEditorReducer,
    initialProject,
    createProjectEditorState
  );
  return useMemo(() => ({ state, dispatch }), [state]);
}

export function canUndo(state: ProjectEditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: ProjectEditorState): boolean {
  return state.future.length > 0;
}

/** True when any project overlay carries layers or strokes. */
export function hasOverlayEdits(project: Project): boolean {
  return project.overlays.some((o) => o.layers.length > 0 || o.strokes.length > 0);
}

/** True when the clip has non-neutral adjustments, a non-original filter, or an active wash. */
export function hasColorEdits(edits: ClipEdits): boolean {
  if (edits.filterId !== ORIGINAL_FILTER_ID) return true;
  if (edits.overlayId != null) return true;
  if (edits.adjustments !== NEUTRAL_ADJUSTMENTS) {
    for (const key of Object.keys(NEUTRAL_ADJUSTMENTS) as PhotoAdjustmentKey[]) {
      if (edits.adjustments[key] !== NEUTRAL_ADJUSTMENTS[key]) return true;
    }
  }
  return false;
}

/** True when the clip's speed is anything other than 1.0×. */
export function hasSpeedEdit(edits: ClipEdits): boolean {
  return edits.speed !== VIDEO_SPEED_DEFAULT;
}
