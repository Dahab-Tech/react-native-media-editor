import { PROJECT_SCHEMA_VERSION } from './model';

/** Bridge wire format (schema v1) — pre-compiled edits only; natives parse this verbatim. */
export interface WireProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  /** tracks[0] is always the main video track; pip tracks follow in z-order. */
  tracks: WireTrack[];
  overlays?: WireOverlay[];
  output?: WireOutput;
}

export interface WireTrack {
  id: string;
  /** Absent = `video` (main). */
  kind?: 'video' | 'pip';
  clips: WireClip[];
}

/** Pip-clip canvas placement; natives clamp the window to the main-track duration. */
export interface WirePipPlacement {
  timelineStartMs: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface WireClip {
  id: string;
  source: string;
  sourceDurationMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  speed?: number;
  /** Display dimensions (rotation already applied) — drive the native render-size policy. */
  width: number;
  height: number;
  /** Integer display-space pixels. */
  crop?: { x: number; y: number; width: number; height: number };
  colorMatrix?: number[];
  lutUri?: string;
  lutIntensity?: number;
  washUri?: string;
  washBlendMode?: string;
  washIntensity?: number;
  /** Present on pip-track clips only. */
  placement?: WirePipPlacement;
}

/** Pre-rasterized full-canvas PNG shown during [timelineStartMs, timelineEndMs). */
export interface WireOverlay {
  id: string;
  pngUri: string;
  timelineStartMs: number;
  timelineEndMs: number;
}

export interface WireOutput {
  maxDimension?: number;
  compression?: {
    preset?: 'high' | 'medium' | 'low';
    maxDimension?: number;
    bitrateMbps?: number;
  };
}
