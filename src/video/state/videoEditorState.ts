import { useMemo, useReducer } from 'react';

import {
  adjustmentMeta,
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  type PhotoAdjustmentKey,
  type PhotoAdjustments,
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
import type { CropRect } from '../../types';
import { clamp } from '../format';

/** Every toolbar tab id the VideoEditor understands. */
export type VideoToolId =
  'trim' | 'crop' | 'adjust' | 'effects' | 'speed' | 'text' | 'stickers' | 'draw' | 'cover';

/** Default toolbar tab order — the fallback when `videoTools` is omitted. */
export const VIDEO_TOOL_IDS: readonly VideoToolId[] = [
  'trim',
  'crop',
  'adjust',
  'effects',
  'speed',
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

const HISTORY_LIMIT = 100;

/** Trim range in milliseconds. */
export interface VideoTrimRange {
  startMs: number;
  endMs: number;
}

/** Undoable document state — ephemeral UI (activeTool, selection, pending crop) is intentionally excluded. */
export interface VideoDocumentState {
  range: VideoTrimRange;
  /** Committed crop in display-space pixels, or null for the full frame. */
  crop: CropRect | null;
  /** Selected crop aspect preset; `'free'` drops the constraint. */
  aspect: AspectRatio;
  /** Overlay layers, array order = z-order. */
  layers: PhotoLayer[];
  /** Draw-tool brush strokes normalized over the video's displayed rect. */
  strokes: DrawStroke[];
  /** 15-slider color adjustments (see photo/color/adjustments.ts). */
  adjustments: PhotoAdjustments;
  /** Active filter id; `'original'` skips the filter stage. */
  filterId: PhotoFilterId;
  /** Filter strength in [0, 1]. Reset to 1 on every `setFilter`. */
  filterIntensity: number;
  /** Active overlay id; `null` = none. */
  overlayId: PhotoOverlayId;
  /** Overlay strength in [0, 1]. */
  overlayIntensity: number;
  /** Playback speed multiplier in [VIDEO_SPEED_MIN..VIDEO_SPEED_MAX]. */
  speed: number;
}

export interface VideoEditorState extends VideoDocumentState {
  activeTool: VideoToolId | null;
  /** Ephemeral — kept out of history. */
  selectedLayerId: string | null;
  past: VideoDocumentState[];
  future: VideoDocumentState[];
}

export const INITIAL_VIDEO_STATE: VideoEditorState = {
  activeTool: null,
  range: { startMs: 0, endMs: 0 },
  crop: null,
  aspect: 'free',
  layers: [],
  strokes: [],
  adjustments: NEUTRAL_ADJUSTMENTS,
  filterId: ORIGINAL_FILTER_ID,
  filterIntensity: 1,
  overlayId: null,
  overlayIntensity: 1,
  speed: VIDEO_SPEED_DEFAULT,
  selectedLayerId: null,
  past: [],
  future: [],
};

export type VideoEditorAction =
  | { type: 'setTool'; tool: VideoToolId | null }
  | { type: 'setRange'; startMs: number; endMs: number }
  | { type: 'setCrop'; crop: CropRect | null }
  /** Discrete aspect-chip pick, auto-checkpointed. */
  | { type: 'setAspect'; aspect: AspectRatio }
  | { type: 'addLayer'; layer: PhotoLayer }
  | { type: 'updateLayer'; id: string; patch: PhotoLayerPatch }
  | {
      type: 'setLayerTransform';
      id: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    }
  | { type: 'removeLayer'; id: string }
  | { type: 'selectLayer'; id: string | null }
  | { type: 'duplicateLayer'; id: string }
  | { type: 'reorderLayer'; id: string; direction: ReorderDirection }
  | { type: 'addStroke'; stroke: DrawStroke }
  | { type: 'clearStrokes' }
  /** Continuous slider action — caller dispatches `checkpoint` at drag start. */
  | { type: 'setAdjustment'; key: PhotoAdjustmentKey; value: number }
  /** Reset every adjustment back to neutral. */
  | { type: 'resetAdjustments' }
  /** Discrete filter pick, auto-checkpointed. Resets intensity to 1. */
  | { type: 'setFilter'; id: PhotoFilterId }
  /** Continuous filter-strength slider. */
  | { type: 'setFilterIntensity'; value: number }
  /** Discrete overlay pick, auto-checkpointed. `null` clears. */
  | { type: 'setOverlay'; id: PhotoOverlayId; defaultIntensity?: number }
  /** Continuous overlay-strength slider. */
  | { type: 'setOverlayIntensity'; value: number }
  /** Speed pick — chip taps auto-checkpoint; the fine slider dispatches its own checkpoint. */
  | { type: 'setSpeed'; value: number }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

/** Discrete actions the reducer implicitly checkpoints. Continuous actions rely on a caller-driven `checkpoint` at interaction start. */
const AUTO_CHECKPOINT_ACTIONS: ReadonlySet<VideoEditorAction['type']> = new Set([
  'addLayer',
  'removeLayer',
  'setLayerTransform',
  'duplicateLayer',
  'reorderLayer',
  'addStroke',
  'clearStrokes',
  'setAspect',
  'resetAdjustments',
  'setFilter',
  'setOverlay',
  'setSpeed',
]);

function reducer(state: VideoEditorState, action: VideoEditorAction): VideoEditorState {
  if (action.type === 'checkpoint') {
    return pushCheckpoint(state);
  }
  if (action.type === 'undo') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      ...state,
      ...previous,
      past: state.past.slice(0, -1),
      future: [...state.future, extractDocument(state)],
    };
  }
  if (action.type === 'redo') {
    if (state.future.length === 0) return state;
    const next = state.future[state.future.length - 1];
    return {
      ...state,
      ...next,
      past: [...state.past, extractDocument(state)],
      future: state.future.slice(0, -1),
    };
  }
  const base = AUTO_CHECKPOINT_ACTIONS.has(action.type) ? pushCheckpoint(state) : state;
  return applyAction(base, action);
}

function applyAction(state: VideoEditorState, action: VideoEditorAction): VideoEditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, activeTool: action.tool };
    case 'setRange':
      return { ...state, range: { startMs: action.startMs, endMs: action.endMs } };
    case 'setCrop':
      return { ...state, crop: action.crop };
    case 'setAspect':
      return { ...state, aspect: action.aspect };
    case 'addLayer':
      return {
        ...state,
        layers: [...state.layers, action.layer],
        selectedLayerId: action.layer.id,
      };
    case 'updateLayer':
      return {
        ...state,
        layers: state.layers.map((layer) => applyPatch(layer, action.id, action.patch)),
      };
    case 'setLayerTransform':
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id
            ? {
                ...layer,
                x: clamp(action.x, 0, 1),
                y: clamp(action.y, 0, 1),
                scale: clamp(action.scale, LAYER_SCALE_MIN, LAYER_SCALE_MAX),
                rotation: action.rotation,
              }
            : layer
        ),
      };
    case 'removeLayer':
      return {
        ...state,
        layers: state.layers.filter((layer) => layer.id !== action.id),
        selectedLayerId: state.selectedLayerId === action.id ? null : state.selectedLayerId,
      };
    case 'selectLayer':
      return { ...state, selectedLayerId: action.id };
    case 'duplicateLayer': {
      const source = state.layers.find((layer) => layer.id === action.id);
      if (!source) return state;
      const copy = duplicateLayerOp(source);
      return {
        ...state,
        layers: [...state.layers, copy],
        selectedLayerId: copy.id,
      };
    }
    case 'reorderLayer': {
      const index = state.layers.findIndex((layer) => layer.id === action.id);
      if (index === -1) return state;
      const next = reorderLayerOp(state.layers, index, action.direction);
      if (next === state.layers) return state;
      return { ...state, layers: next as PhotoLayer[] };
    }
    case 'addStroke':
      return { ...state, strokes: [...state.strokes, action.stroke] };
    case 'clearStrokes':
      return state.strokes.length === 0 ? state : { ...state, strokes: [] };
    case 'setAdjustment': {
      // Per-key clamp: bipolar keys are [-1, 1], unipolar (sharpness/vignette/grain) are [0, 1].
      const { min, max } = adjustmentMeta(action.key);
      return {
        ...state,
        adjustments: { ...state.adjustments, [action.key]: clamp(action.value, min, max) },
      };
    }
    case 'resetAdjustments':
      return { ...state, adjustments: NEUTRAL_ADJUSTMENTS };
    case 'setFilter':
      return { ...state, filterId: action.id, filterIntensity: 1 };
    case 'setFilterIntensity':
      return { ...state, filterIntensity: clamp(action.value, 0, 1) };
    case 'setOverlay': {
      const nextIntensity = clamp(action.defaultIntensity ?? 1, 0, 1);
      return { ...state, overlayId: action.id, overlayIntensity: nextIntensity };
    }
    case 'setOverlayIntensity':
      return { ...state, overlayIntensity: clamp(action.value, 0, 1) };
    case 'setSpeed':
      return { ...state, speed: clamp(action.value, VIDEO_SPEED_MIN, VIDEO_SPEED_MAX) };
    default:
      return state;
  }
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

function extractDocument(state: VideoEditorState): VideoDocumentState {
  return {
    range: state.range,
    crop: state.crop,
    aspect: state.aspect,
    layers: state.layers,
    strokes: state.strokes,
    adjustments: state.adjustments,
    filterId: state.filterId,
    filterIntensity: state.filterIntensity,
    overlayId: state.overlayId,
    overlayIntensity: state.overlayIntensity,
    speed: state.speed,
  };
}

function documentsEqual(a: VideoDocumentState, b: VideoDocumentState): boolean {
  return (
    a.range === b.range &&
    a.crop === b.crop &&
    a.aspect === b.aspect &&
    a.layers === b.layers &&
    a.strokes === b.strokes &&
    a.adjustments === b.adjustments &&
    a.filterId === b.filterId &&
    a.filterIntensity === b.filterIntensity &&
    a.overlayId === b.overlayId &&
    a.overlayIntensity === b.overlayIntensity &&
    a.speed === b.speed
  );
}

function pushCheckpoint(state: VideoEditorState): VideoEditorState {
  const current = extractDocument(state);
  const top = state.past[state.past.length - 1];
  if (top && documentsEqual(top, current)) {
    if (state.future.length === 0) return state;
    return { ...state, future: [] };
  }
  const trimmed =
    state.past.length >= HISTORY_LIMIT
      ? state.past.slice(state.past.length - HISTORY_LIMIT + 1)
      : state.past;
  return {
    ...state,
    past: [...trimmed, current],
    future: [],
  };
}

export interface VideoEditorController {
  state: VideoEditorState;
  dispatch: React.Dispatch<VideoEditorAction>;
}

export function useVideoEditorState(): VideoEditorController {
  const [state, dispatch] = useReducer(reducer, INITIAL_VIDEO_STATE);
  return useMemo(() => ({ state, dispatch }), [state]);
}

export function canUndo(state: VideoEditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: VideoEditorState): boolean {
  return state.future.length > 0;
}

/** True when the editor has any static overlay work — layers or strokes. */
export function hasOverlayEdits(state: VideoEditorState): boolean {
  return state.layers.length > 0 || state.strokes.length > 0;
}

/** True when the document has non-neutral adjustments, a non-original filter, or an active overlay. */
export function hasColorEdits(state: VideoDocumentState): boolean {
  if (state.filterId !== ORIGINAL_FILTER_ID) return true;
  if (state.overlayId != null) return true;
  if (state.adjustments !== NEUTRAL_ADJUSTMENTS) {
    for (const key of Object.keys(NEUTRAL_ADJUSTMENTS) as PhotoAdjustmentKey[]) {
      if (state.adjustments[key] !== NEUTRAL_ADJUSTMENTS[key]) return true;
    }
  }
  return false;
}

/** True when the document's speed is anything other than 1.0×. */
export function hasSpeedEdit(state: VideoDocumentState): boolean {
  return state.speed !== VIDEO_SPEED_DEFAULT;
}
