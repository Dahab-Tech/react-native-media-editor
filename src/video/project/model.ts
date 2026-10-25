import {
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  type PhotoAdjustments,
  type PhotoFilterId,
} from '../../photo/color';
import type { DrawStroke } from '../../photo/draw/types';
import type { PhotoLayer } from '../../photo/layers';
import type { PhotoOverlayId } from '../../photo/overlays';
import type { AspectRatio } from '../../photo/state/photoEditorState';
import type { CropRect, VideoCompressionOptions, VideoInfo } from '../../types';

export const PROJECT_SCHEMA_VERSION = 1;

/** Overlay `timelineEndMs` sentinel: tracks the project end; serialization clamps it to the real duration. */
export const OVERLAY_END_UNBOUNDED = Number.POSITIVE_INFINITY;

/** Per-clip visual edits — the old single-source document state minus range/layers/strokes. */
export interface ClipEdits {
  /** Committed crop in display-space pixels, or null for the full frame. */
  crop: CropRect | null;
  /** Selected crop aspect preset; `'free'` drops the constraint. */
  aspect: AspectRatio;
  adjustments: PhotoAdjustments;
  filterId: PhotoFilterId;
  /** Filter strength in [0, 1]. */
  filterIntensity: number;
  /** Color-wash overlay id; `null` = none. */
  overlayId: PhotoOverlayId;
  /** Wash strength in [0, 1]. */
  overlayIntensity: number;
  /** Playback speed multiplier; 1.0 = real-time. */
  speed: number;
}

export interface Clip {
  id: string;
  source: string;
  /** Untrimmed source duration — natives need it for preview timeline layout. */
  sourceDurationMs: number;
  /** Source metadata captured at add time (dimensions, rotation, fps). */
  info: VideoInfo;
  sourceStartMs: number;
  sourceEndMs: number;
  edits: ClipEdits;
  /** Present on pip-track clips only — timeline position + canvas transform. */
  placement?: PipPlacement;
}

/** Normalized-canvas placement transform for a pip clip (static in v1; keyframes swap values later). */
export interface PipTransform {
  /** Center X in [0, 1] of the canvas width. */
  x: number;
  /** Center Y in [0, 1] of the canvas height, top-left origin. */
  y: number;
  /** Fraction of the canvas after aspect-fit; 1 = full canvas. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
}

export interface PipPlacement {
  timelineStartMs: number;
  transform: PipTransform;
}

export interface Track {
  id: string;
  /** `video` = the main sequential track (tracks[0]); `pip` tracks composite over it in array order. */
  kind: 'video' | 'pip';
  clips: Clip[];
}

/** Project-level overlay with timeline (not clip-local) timing; rich layer data stays in JS. */
export interface TimedOverlay {
  id: string;
  timelineStartMs: number;
  timelineEndMs: number;
  layers: PhotoLayer[];
  strokes: DrawStroke[];
}

export interface ProjectOutput {
  /** Cap on the render long edge in display px; never upscales. */
  maxDimension?: number;
  compression?: VideoCompressionOptions;
}

export interface Project {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  /** Exactly one video track in schema v1; array reserves room for audio/overlay tracks. */
  tracks: Track[];
  overlays: TimedOverlay[];
  output?: ProjectOutput;
}

export const NEUTRAL_CLIP_EDITS: ClipEdits = {
  crop: null,
  aspect: 'free',
  adjustments: NEUTRAL_ADJUSTMENTS,
  filterId: ORIGINAL_FILTER_ID,
  filterIntensity: 1,
  overlayId: null,
  overlayIntensity: 1,
  speed: 1,
};

export function generateProjectId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

export function createClip(source: string, info: VideoInfo): Clip {
  return {
    id: generateProjectId('c'),
    source,
    sourceDurationMs: info.durationMs,
    info,
    sourceStartMs: 0,
    sourceEndMs: info.durationMs,
    edits: NEUTRAL_CLIP_EDITS,
  };
}

export function projectFromSources(sources: readonly { uri: string; info: VideoInfo }[]): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks: [
      {
        id: generateProjectId('t'),
        kind: 'video',
        clips: sources.map((s) => createClip(s.uri, s.info)),
      },
    ],
    overlays: [],
  };
}

export function videoTrack(project: Project): Track {
  return project.tracks[0];
}

export function pipTracks(project: Project): Track[] {
  return project.tracks.filter((track) => track.kind === 'pip');
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export const DEFAULT_PIP_TRANSFORM: PipTransform = {
  x: 0.5,
  y: 0.5,
  scale: 0.4,
  rotation: 0,
  opacity: 1,
};

/** One pip = one track; z-order is the tracks array order. */
export function createPipTrack(source: string, info: VideoInfo, timelineStartMs: number): Track {
  const clip = createClip(source, info);
  return {
    id: generateProjectId('t'),
    kind: 'pip',
    clips: [{ ...clip, placement: { timelineStartMs, transform: DEFAULT_PIP_TRANSFORM } }],
  };
}
