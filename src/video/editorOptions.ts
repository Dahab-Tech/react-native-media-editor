import { ASPECT_RATIO_PRESETS, type AspectRatio } from '../photo/state/photoEditorState';
import type { CropRect } from '../types';
import { VIDEO_TOOL_IDS, type VideoToolId } from './project/reducer';

export function normalizeVideoTools(
  list: readonly VideoToolId[] | undefined
): readonly VideoToolId[] | null {
  if (list == null) return null;
  if (list.length === 0) return list;
  const known = new Set<VideoToolId>(VIDEO_TOOL_IDS);
  const seen = new Set<VideoToolId>();
  const out: VideoToolId[] = [];
  for (const id of list) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeCropAspects(
  list: readonly AspectRatio[] | undefined
): readonly AspectRatio[] | null {
  if (list == null) return null;
  if (list.length === 0) return list;
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const aspect of list) {
    if (!ASPECT_RATIO_PRESETS.includes(aspect) || seen.has(aspect)) continue;
    seen.add(aspect);
    out.push(aspect);
  }
  return out;
}

/** Largest rect of `pixelAspect` centered inside `frameWidth × frameHeight`. */
export function fitCropRectToAspect(
  frameWidth: number,
  frameHeight: number,
  pixelAspect: number
): CropRect {
  let width = frameWidth;
  let height = width / pixelAspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * pixelAspect;
  }
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  };
}
