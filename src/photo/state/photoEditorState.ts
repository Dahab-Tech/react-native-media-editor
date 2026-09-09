import { useMemo, useReducer } from 'react';

import { clampCropForAngle, fitCropForAngle } from '../../core/crop/straightenMath';
import type { NormalizedCrop } from '../../core/crop/types';
import {
  adjustmentMeta,
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  type PhotoAdjustmentKey,
  type PhotoAdjustments,
  type PhotoFilterId,
} from '../color';
import type { DrawStroke } from '../draw/types';
import { clampFocus } from '../focus/focusMath';
import { FOCUS_OFF, focusForMode, type FocusMode, type PhotoFocus } from '../focus/types';
import {
  duplicateLayer,
  LAYER_SCALE_MAX,
  LAYER_SCALE_MIN,
  reorderLayer,
  type PhotoLayer,
  type PhotoLayerPatch,
  type ReorderDirection,
} from '../layers';
import type { PhotoOverlayId } from '../overlays';

/** Straighten dial range in degrees (matches iOS Photos ±45° span). */
export const STRAIGHTEN_MIN = -45;
export const STRAIGHTEN_MAX = 45;

const HISTORY_LIMIT = 100;

/** Toolbar tab ids the PhotoEditor understands. */
export type PhotoToolId =
  'crop' | 'adjust' | 'effects' | 'focus' | 'draw' | 'text' | 'stickers' | 'ai';

/** Default toolbar tab order; fallback when no allowlist is passed. */
export const PHOTO_TOOL_IDS: readonly PhotoToolId[] = [
  'crop',
  'adjust',
  'effects',
  'focus',
  'draw',
  'stickers',
  'text',
  'ai',
] as const;

export const ASPECT_RATIO_PRESETS = ['free', 'original', '1:1', '4:3', '16:9', '9:16'] as const;

export type AspectRatio = (typeof ASPECT_RATIO_PRESETS)[number];

export type { NormalizedCrop };

/** Undoable subset of editor state. Ephemeral UI (activeTool, selectedLayerId) is excluded. */
export interface PhotoDocumentState {
  crop: NormalizedCrop;
  aspect: AspectRatio;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  /** Fine-angle rotation about the crop center, clamped to [STRAIGHTEN_MIN..STRAIGHTEN_MAX]. */
  straighten: number;
  adjustments: PhotoAdjustments;
  filterId: PhotoFilterId;
  /** Filter strength [0, 1]; reset to 1 on every setFilter. */
  filterIntensity: number;
  /** Active overlay id; resolves against built-ins then consumer packs. `null` = none. */
  overlayId: PhotoOverlayId;
  /** Overlay strength [0, 1]. */
  overlayIntensity: number;
  /** Array order = z-order (0 = back, last = top). */
  layers: PhotoLayer[];
  /** Brush strokes normalized over the displayed (post-crop) rect; array order = paint order. */
  strokes: DrawStroke[];
  /** Selective blur config (off / radial / linear); geometry normalized over post-crop rect. */
  focus: PhotoFocus;
  /** AI background-removal override; pixel dimensions must match the original. */
  backgroundRemovedUri: string | null;
}

export interface PhotoEditorState extends PhotoDocumentState {
  activeTool: PhotoToolId | null;
  selectedLayerId: string | null;
  past: PhotoDocumentState[];
  future: PhotoDocumentState[];
}

export const FULL_CROP: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 };

export const INITIAL_STATE: PhotoEditorState = {
  activeTool: null,
  crop: FULL_CROP,
  aspect: 'free',
  rotation: 0,
  flipHorizontal: false,
  straighten: 0,
  adjustments: NEUTRAL_ADJUSTMENTS,
  filterId: ORIGINAL_FILTER_ID,
  filterIntensity: 1,
  overlayId: null,
  overlayIntensity: 1,
  layers: [],
  strokes: [],
  focus: FOCUS_OFF,
  backgroundRemovedUri: null,
  selectedLayerId: null,
  past: [],
  future: [],
};

export type PhotoEditorAction =
  | { type: 'setTool'; tool: PhotoToolId | null }
  // Continuous crop commit; at straighten≠0, `imageAspect` (pre-rotation) clamps so frame resize can't commit a crop the rotated image doesn't cover.
  | { type: 'setCrop'; crop: NormalizedCrop; imageAspect?: number }
  | { type: 'setAspect'; aspect: AspectRatio }
  // Lock crop to `aspect` and re-fit WITHOUT creating a history entry (initial-mount lock only).
  | { type: 'lockAspect'; aspect: AspectRatio; imageAspect: number }
  | { type: 'rotate' }
  | { type: 'flip' }
  // Continuous straighten. `imageAspect` is pre-rotation; coverage constraint is 90°-invariant.
  | { type: 'setStraighten'; value: number; imageAspect: number }
  // Reset crop / rotation / flip / straighten. With aspect+imageAspect, refits to the constraint.
  | { type: 'resetCrop'; aspect?: AspectRatio; imageAspect?: number }
  // Crop-mode cancel: restore geometry to a pre-entry snapshot; `pastLength` truncates in-session checkpoints so undo can't resurrect drafts.
  | {
      type: 'restoreCropState';
      crop: NormalizedCrop;
      aspect: AspectRatio;
      rotation: 0 | 90 | 180 | 270;
      flipHorizontal: boolean;
      straighten: number;
      pastLength?: number;
    }
  | { type: 'setAdjustment'; key: PhotoAdjustmentKey; value: number }
  | { type: 'resetAdjustments' }
  | { type: 'setFilter'; id: PhotoFilterId }
  | { type: 'setFilterIntensity'; value: number }
  | { type: 'setOverlay'; id: PhotoOverlayId; defaultIntensity?: number }
  | { type: 'setOverlayIntensity'; value: number }
  | { type: 'addLayer'; layer: PhotoLayer }
  // Continuous; callers checkpoint at edit-start.
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
  | { type: 'setFocusMode'; mode: FocusMode }
  // Continuous; callers checkpoint at interaction-start.
  | { type: 'setFocus'; focus: PhotoFocus }
  // Override MUST have identical pixel dims to the original (engine contract).
  | { type: 'setBackgroundRemoved'; uri: string | null }
  // Push current doc onto `past` and clear `future`; dispatched at the start of each continuous session.
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

/** Discrete actions that auto-checkpoint. Continuous actions checkpoint at interaction-start. */
const AUTO_CHECKPOINT_ACTIONS: ReadonlySet<PhotoEditorAction['type']> = new Set([
  'rotate',
  'flip',
  'resetCrop',
  'resetAdjustments',
  'setFilter',
  'setOverlay',
  'setAspect',
  'addLayer',
  'removeLayer',
  'setLayerTransform',
  'duplicateLayer',
  'reorderLayer',
  'addStroke',
  'clearStrokes',
  'setFocusMode',
  'setBackgroundRemoved',
]);

function reducer(state: PhotoEditorState, action: PhotoEditorAction): PhotoEditorState {
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

function applyAction(state: PhotoEditorState, action: PhotoEditorAction): PhotoEditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, activeTool: action.tool };
    case 'restoreCropState':
      return {
        ...state,
        past:
          action.pastLength != null && action.pastLength < state.past.length
            ? state.past.slice(0, action.pastLength)
            : state.past,
        crop: action.crop,
        aspect: action.aspect,
        rotation: action.rotation,
        flipHorizontal: action.flipHorizontal,
        straighten: action.straighten,
      };
    case 'setCrop': {
      // fitCropForAngle is translate-first (shrink only when the bbox can't fit anywhere); setStraighten uses clampCropForAngle to preserve center.
      const angleClamped =
        action.imageAspect != null && action.imageAspect > 0 && state.straighten !== 0
          ? fitCropForAngle(action.crop, action.imageAspect, state.straighten)
          : action.crop;
      return { ...state, crop: clampCrop(angleClamped) };
    }
    case 'setAspect':
      return { ...state, aspect: action.aspect };
    case 'lockAspect': {
      const next = { ...state, aspect: action.aspect };
      if (action.imageAspect <= 0) return next;
      // Resolve preset against SEEN (post-rotation) aspect, then invert back to pre-rotation space.
      const rotated = state.rotation === 90 || state.rotation === 270;
      const seenImageAspect = rotated ? 1 / action.imageAspect : action.imageAspect;
      const seenAspect = aspectRatioValue(action.aspect, {
        imageAspect: seenImageAspect,
      });
      if (seenAspect == null) return next;
      const fitted = fitCropToAspect(
        state.crop,
        rotated ? 1 / seenAspect : seenAspect,
        action.imageAspect
      );
      const angleClamped =
        state.straighten !== 0
          ? fitCropForAngle(fitted, action.imageAspect, state.straighten)
          : fitted;
      return { ...next, crop: clampCrop(angleClamped) };
    }
    case 'rotate':
      return { ...state, rotation: nextRotation(state.rotation) };
    case 'flip':
      return { ...state, flipHorizontal: !state.flipHorizontal };
    case 'resetCrop': {
      const aspect = action.aspect ?? 'free';
      const reset: PhotoEditorState = {
        ...state,
        crop: FULL_CROP,
        aspect,
        rotation: 0,
        flipHorizontal: false,
        straighten: 0,
      };
      const ratio =
        action.aspect != null && action.imageAspect != null && action.imageAspect > 0
          ? aspectRatioValue(aspect, { imageAspect: action.imageAspect })
          : null;
      if (ratio == null || action.imageAspect == null) return reset;
      return { ...reset, crop: clampCrop(fitCropToAspect(FULL_CROP, ratio, action.imageAspect)) };
    }
    case 'setStraighten': {
      const nextAngle = clamp(action.value, STRAIGHTEN_MIN, STRAIGHTEN_MAX);
      const nextCrop = clampCropForAngle(state.crop, action.imageAspect, nextAngle);
      return { ...state, straighten: nextAngle, crop: clampCrop(nextCrop) };
    }
    case 'setAdjustment': {
      const { min, max } = adjustmentMeta(action.key);
      return {
        ...state,
        adjustments: { ...state.adjustments, [action.key]: clamp(action.value, min, max) },
      };
    }
    case 'resetAdjustments':
      return { ...state, adjustments: NEUTRAL_ADJUSTMENTS };
    case 'setFilter':
      // Reset intensity so a new filter starts at full strength.
      return { ...state, filterId: action.id, filterIntensity: 1 };
    case 'setFilterIntensity':
      return { ...state, filterIntensity: clamp(action.value, 0, 1) };
    case 'setOverlay': {
      const nextIntensity = clamp(action.defaultIntensity ?? 1, 0, 1);
      return { ...state, overlayId: action.id, overlayIntensity: nextIntensity };
    }
    case 'setOverlayIntensity':
      return { ...state, overlayIntensity: clamp(action.value, 0, 1) };
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
      const copy = duplicateLayer(source);
      return {
        ...state,
        layers: [...state.layers, copy],
        selectedLayerId: copy.id,
      };
    }
    case 'reorderLayer': {
      const index = state.layers.findIndex((layer) => layer.id === action.id);
      if (index === -1) return state;
      const next = reorderLayer(state.layers, index, action.direction);
      if (next === state.layers) return state;
      return { ...state, layers: next as PhotoLayer[] };
    }
    case 'addStroke':
      return { ...state, strokes: [...state.strokes, action.stroke] };
    case 'clearStrokes':
      return state.strokes.length === 0 ? state : { ...state, strokes: [] };
    case 'setFocusMode':
      return state.focus.mode === action.mode
        ? state
        : { ...state, focus: clampFocus(focusForMode(action.mode, state.focus)) };
    case 'setFocus':
      return { ...state, focus: clampFocus(action.focus) };
    case 'setBackgroundRemoved':
      return state.backgroundRemovedUri === action.uri
        ? state
        : { ...state, backgroundRemovedUri: action.uri };
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

function extractDocument(state: PhotoEditorState): PhotoDocumentState {
  return {
    crop: state.crop,
    aspect: state.aspect,
    rotation: state.rotation,
    flipHorizontal: state.flipHorizontal,
    straighten: state.straighten,
    adjustments: state.adjustments,
    filterId: state.filterId,
    filterIntensity: state.filterIntensity,
    overlayId: state.overlayId,
    overlayIntensity: state.overlayIntensity,
    layers: state.layers,
    strokes: state.strokes,
    focus: state.focus,
    backgroundRemovedUri: state.backgroundRemovedUri,
  };
}

function documentsEqual(a: PhotoDocumentState, b: PhotoDocumentState): boolean {
  return (
    a.crop === b.crop &&
    a.aspect === b.aspect &&
    a.rotation === b.rotation &&
    a.flipHorizontal === b.flipHorizontal &&
    a.straighten === b.straighten &&
    a.adjustments === b.adjustments &&
    a.filterId === b.filterId &&
    a.filterIntensity === b.filterIntensity &&
    a.overlayId === b.overlayId &&
    a.overlayIntensity === b.overlayIntensity &&
    a.layers === b.layers &&
    a.strokes === b.strokes &&
    a.focus === b.focus &&
    a.backgroundRemovedUri === b.backgroundRemovedUri
  );
}

function pushCheckpoint(state: PhotoEditorState): PhotoEditorState {
  const current = extractDocument(state);
  const top = state.past[state.past.length - 1];
  if (top && documentsEqual(top, current)) {
    // Still clear future so a fresh interaction after undo severs the redo branch.
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

function nextRotation(current: PhotoEditorState['rotation']): PhotoEditorState['rotation'] {
  const map: Record<PhotoEditorState['rotation'], PhotoEditorState['rotation']> = {
    0: 90,
    90: 180,
    180: 270,
    270: 0,
  };
  return map[current];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampCrop(crop: NormalizedCrop): NormalizedCrop {
  const width = clamp(crop.width, 0.05, 1);
  const height = clamp(crop.height, 0.05, 1);
  const x = clamp(crop.x, 0, 1 - width);
  const y = clamp(crop.y, 0, 1 - height);
  return { x, y, width, height };
}

/** Largest rect of target pixel aspect fitting [0..1]², centered on current crop; `pixelAspect` is pre-rotation. */
export function fitCropToAspect(
  current: NormalizedCrop,
  pixelAspect: number,
  imageAspect: number
): NormalizedCrop {
  let width = 1;
  let height = (width * imageAspect) / pixelAspect;
  if (height > 1) {
    height = 1;
    width = (height * pixelAspect) / imageAspect;
  }
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const x = Math.min(Math.max(centerX - width / 2, 0), 1 - width);
  const y = Math.min(Math.max(centerY - height / 2, 0), 1 - height);
  return { x, y, width, height };
}

export interface PhotoEditorController {
  state: PhotoEditorState;
  dispatch: React.Dispatch<PhotoEditorAction>;
}

/** Init arg (lazy-init only). `{ aspect }` seeds a fresh state; `{ state }` hydrates from a snapshot. */
export type PhotoEditorInit =
  { readonly aspect: AspectRatio } | { readonly state: PhotoEditorState };

export function usePhotoEditorState(init?: PhotoEditorInit): PhotoEditorController {
  const [state, dispatch] = useReducer(reducer, init, (arg) => {
    if (arg == null) return INITIAL_STATE;
    if ('state' in arg) return arg.state;
    return { ...INITIAL_STATE, aspect: arg.aspect };
  });
  return useMemo(() => ({ state, dispatch }), [state]);
}

export function canUndo(state: PhotoEditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: PhotoEditorState): boolean {
  return state.future.length > 0;
}

/** True when the editor state has any user-authored edit relative to INITIAL_STATE. */
export function hasEdits(state: PhotoEditorState): boolean {
  if (state.past.length > 0 || state.future.length > 0) return true;
  return !documentsEqual(extractDocument(state), extractDocument(INITIAL_STATE));
}

/** Resolves an AspectRatio preset into a pixel w/h ratio; `null` for 'free' and unresolvable cases. */
export function aspectRatioValue(
  aspect: AspectRatio,
  context?: { imageAspect?: number }
): number | null {
  switch (aspect) {
    case '1:1':
      return 1;
    case '4:3':
      return 4 / 3;
    case '16:9':
      return 16 / 9;
    case '9:16':
      return 9 / 16;
    case 'original': {
      const value = context?.imageAspect;
      return value != null && value > 0 ? value : null;
    }
    default:
      return null;
  }
}

export { LAYER_SCALE_MAX, LAYER_SCALE_MIN, TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../layers';
export type {
  PhotoLayer,
  PhotoLayerPatch,
  StickerContent,
  StickerLayer,
  TextLayer,
} from '../layers';
