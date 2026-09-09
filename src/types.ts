export interface VideoInfo {
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Display width in pixels (rotation already applied). */
  width: number;
  /** Display height in pixels (rotation already applied). */
  height: number;
  /** Source rotation metadata in degrees (0, 90, 180 or 270). */
  rotation: number;
  /** Frames per second, 0 when unknown. */
  fps: number;
}

/** Axis-aligned crop region in display-space pixels (rotation already applied). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opt-in re-encode target for `trimVideo`; presence forces re-encode even for pure trims. */
export interface VideoCompressionOptions {
  /** Quality tier driving bpp-per-frame on output dims and source fps: high=0.15, medium=0.08, low=0.04. Ignored when bitrateMbps is set. */
  preset?: 'high' | 'medium' | 'low';
  /** Cap the output's long edge in display px (post-crop/rotation), preserving aspect; never upscales, rounded to even for H.264. */
  maxDimension?: number;
  /** Explicit average video bitrate override in Mbps; takes precedence over `preset`. */
  bitrateMbps?: number;
}

export interface TrimOptions {
  startMs: number;
  endMs: number;
  /** Crops the output to this region. Forces re-encoding (passthrough applies to pure trims only). */
  crop?: CropRect;
  /** Optional PNG overlay composited over every exported frame. Dimensions must match the post-crop render size. */
  overlayImageUri?: string;
  /** Optional 4×5 color matrix (row-major, 20 floats) applied per frame before the overlay. */
  colorMatrix?: readonly number[];
  /** Optional HALD LUT PNG URI. Applied after `colorMatrix` when both are set. */
  lutImageUri?: string;
  /** LUT mix strength in [0, 1]. */
  lutIntensity?: number;
  /** Playback speed multiplier in [0.5..2.0]. `1.0` = real-time. */
  speedFactor?: number;
  /** Opt-in bitrate/dimension compression; presence forces re-encode even for pure trims. Omit for byte-for-byte passthrough. */
  compression?: VideoCompressionOptions;
}

export interface TrimResult {
  uri: string;
  durationMs: number;
}

export interface ThumbnailOptions {
  /** Frame position in milliseconds. Defaults to 0. */
  timeMs?: number;
  /** JPEG quality between 0 and 1. Defaults to 0.9. */
  quality?: number;
  /** Downscale so width does not exceed this value. 0 keeps the original size. */
  maxWidth?: number;
}

export interface ThumbnailResult {
  uri: string;
  width: number;
  height: number;
}

export interface PhotoExportOptions {
  /** Output encoding. Default 'jpeg'. */
  format?: 'jpeg' | 'png';
  /** JPEG quality 0-100. Ignored for png. Default 90. */
  quality?: number;
  /** Cap the LONGEST side of the output in pixels, preserving aspect. Omit for full resolution. */
  maxDimension?: number;
  /** Also return the encoded bytes as base64. Default false — the file URI is the primary output. */
  includeBase64?: boolean;
}

export interface PhotoExportResult {
  /** file:// URI in the app cache directory. */
  uri: string;
  width: number;
  height: number;
  format: 'jpeg' | 'png';
  /** Present only when `PhotoExportOptions.includeBase64` is true. */
  base64?: string;
}
