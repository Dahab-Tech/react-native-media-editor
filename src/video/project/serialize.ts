import type { Clip, ClipEdits, Project } from './model';
import { clipDurationMs } from './timelineIndex';
import type { WireClip, WireOverlay, WireProject } from './wire';
import {
  composeAdjustmentMatrix,
  composeFilterMatrix,
  isIdentityMatrix,
  ORIGINAL_FILTER_ID,
  resolveFilter,
  type PhotoFilterPack,
} from '../../photo/color';

export interface ClipGradeParams {
  colorMatrix?: number[];
  lutUri?: string;
  lutIntensity?: number;
}

/** Full-strength wash PNG rasterized at the clip's output size; native blends per frame. */
export interface ClipWashAsset {
  uri: string;
  blendMode?: string;
}

export interface SerializeOptions {
  filterPacks?: readonly PhotoFilterPack[];
  /** Keyed by clip id; clips without an entry ship no wash. */
  clipWashes?: ReadonlyMap<string, ClipWashAsset>;
  /** Keyed by overlay id; overlays without an entry are dropped (preview draws them in JS). */
  overlayPngs?: ReadonlyMap<string, string>;
}

/** Composes the 4×5 grade matrix + LUT params for one clip; identity collapses to `undefined`. */
export function clipGradeParams(
  edits: ClipEdits,
  filterPacks?: readonly PhotoFilterPack[]
): ClipGradeParams {
  const filter = resolveFilter(edits.filterId, filterPacks);
  const adjustmentsMatrix = composeAdjustmentMatrix(edits.adjustments);
  const composed =
    filter.kind === 'matrix' && filter.id !== ORIGINAL_FILTER_ID
      ? composeFilterMatrix(filter.matrix, adjustmentsMatrix, edits.filterIntensity)
      : adjustmentsMatrix;
  const params: ClipGradeParams = {};
  if (!isIdentityMatrix(composed)) params.colorMatrix = composed as number[];
  // Only string-URI LUT sources round-trip across the bridge; numeric handles / remote records are deferred.
  if (filter.kind === 'lut' && typeof filter.source === 'string') {
    params.lutUri = filter.source;
    params.lutIntensity = edits.filterIntensity;
  }
  return params;
}

/** Project → bridge wire format; rasterized assets are supplied by the caller. */
export function serializeProject(project: Project, options: SerializeOptions = {}): WireProject {
  const serializeClip = (clip: Clip): WireClip => {
    const { edits } = clip;
    const grade = clipGradeParams(edits, options.filterPacks);
    const wash = edits.overlayIntensity > 0 ? options.clipWashes?.get(clip.id) : undefined;
    // Wire ms/pixel fields are integers — iOS decodes them as Int64/Int and rejects fractions.
    return {
      id: clip.id,
      source: clip.source,
      sourceDurationMs: Math.round(clip.sourceDurationMs),
      sourceStartMs: Math.round(clip.sourceStartMs),
      sourceEndMs: Math.round(clip.sourceEndMs),
      speed: edits.speed !== 1 ? edits.speed : undefined,
      width: Math.round(clip.info.width),
      height: Math.round(clip.info.height),
      crop: edits.crop
        ? {
            x: Math.round(edits.crop.x),
            y: Math.round(edits.crop.y),
            width: Math.round(edits.crop.width),
            height: Math.round(edits.crop.height),
          }
        : undefined,
      colorMatrix: grade.colorMatrix,
      lutUri: grade.lutUri,
      lutIntensity: grade.lutIntensity,
      washUri: wash?.uri,
      washBlendMode: wash ? wash.blendMode : undefined,
      washIntensity: wash ? edits.overlayIntensity : undefined,
      placement: clip.placement
        ? {
            timelineStartMs: Math.round(clip.placement.timelineStartMs),
            x: clip.placement.transform.x,
            y: clip.placement.transform.y,
            scale: clip.placement.transform.scale,
            rotation: clip.placement.transform.rotation,
            opacity: clip.placement.transform.opacity,
          }
        : undefined,
    };
  };

  const track = project.tracks[0];
  const totalMs = track.clips.reduce((sum, clip) => sum + clipDurationMs(clip), 0);
  const overlays = project.overlays
    .map((overlay): WireOverlay | null => {
      const pngUri = options.overlayPngs?.get(overlay.id);
      if (!pngUri) return null;
      const startMs = Math.max(0, overlay.timelineStartMs);
      const endMs = Math.min(overlay.timelineEndMs, totalMs);
      if (endMs <= startMs) return null;
      return {
        id: overlay.id,
        pngUri,
        timelineStartMs: Math.round(startMs),
        timelineEndMs: Math.round(endMs),
      };
    })
    .filter((overlay): overlay is WireOverlay => overlay != null);

  return {
    schemaVersion: project.schemaVersion,
    tracks: project.tracks.map((t) => ({
      id: t.id,
      kind: t.kind === 'pip' ? ('pip' as const) : undefined,
      clips: t.clips.map(serializeClip),
    })),
    overlays: overlays.length > 0 ? overlays : undefined,
    output: project.output,
  };
}
