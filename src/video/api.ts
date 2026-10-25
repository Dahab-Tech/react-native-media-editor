import MediaEditorModule from '../native/MediaEditorModule';
import type {
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailStripOptions,
  TrimOptions,
  TrimResult,
  VideoInfo,
} from '../types';
import { exportProject } from './export/exportProject';
import { PROJECT_SCHEMA_VERSION } from './project/model';
import type { WireClip, WireOverlay, WireProject } from './project/wire';

/** Reads duration, display dimensions, rotation and frame rate without decoding the video. */
export function getVideoInfo(uri: string): Promise<VideoInfo> {
  return MediaEditorModule.getVideoInfo(uri);
}

/** Trims to [startMs, endMs]; crop/compression/any non-trim option forces re-encode; pure trims use lossless passthrough on iOS. */
export async function trimVideo(uri: string, options: TrimOptions): Promise<TrimResult> {
  if (options.startMs < 0 || options.endMs <= options.startMs) {
    throw new Error(`Invalid trim range: startMs=${options.startMs}, endMs=${options.endMs}`);
  }
  if (options.crop && (options.crop.width <= 0 || options.crop.height <= 0)) {
    throw new Error(
      `Invalid crop size: width=${options.crop.width}, height=${options.crop.height}`
    );
  }

  const info = await getVideoInfo(uri);
  const sourceEndMs = Math.min(options.endMs, info.durationMs);
  const speed = options.speedFactor && options.speedFactor > 0 ? options.speedFactor : 1;
  // Wire ms/pixel fields are integers — iOS decodes them as Int64/Int and rejects fractions.
  const clip: WireClip = {
    id: 'trim',
    source: uri,
    sourceDurationMs: Math.round(info.durationMs),
    sourceStartMs: Math.round(options.startMs),
    sourceEndMs: Math.round(sourceEndMs),
    speed,
    width: Math.round(info.width),
    height: Math.round(info.height),
    crop: options.crop
      ? {
          x: Math.round(options.crop.x),
          y: Math.round(options.crop.y),
          width: Math.round(options.crop.width),
          height: Math.round(options.crop.height),
        }
      : undefined,
    colorMatrix: options.colorMatrix ? [...options.colorMatrix] : undefined,
    lutUri: options.lutImageUri,
    lutIntensity: options.lutIntensity,
    washUri: options.washImageUri,
    washBlendMode: options.washBlendMode,
    washIntensity: options.washIntensity,
  };
  const overlays: WireOverlay[] | undefined = options.overlayImageUri
    ? [
        {
          id: 'trim-overlay',
          pngUri: options.overlayImageUri,
          timelineStartMs: 0,
          timelineEndMs: Math.round((sourceEndMs - options.startMs) / speed),
        },
      ]
    : undefined;
  const project: WireProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks: [{ id: 'trim-track', clips: [clip] }],
    overlays,
    output: options.compression ? { compression: options.compression } : undefined,
  };
  return exportProject(project);
}

/** Extracts a single frame as a JPEG file in the app cache. */
export function getVideoThumbnail(
  uri: string,
  options: ThumbnailOptions = {}
): Promise<ThumbnailResult> {
  return MediaEditorModule.getThumbnail(uri, options);
}

/** Batch frame extraction in one decoder pass, nearest-keyframe accuracy. Failed frames come back as null. */
export function getVideoThumbnailStrip(
  uri: string,
  options: ThumbnailStripOptions
): Promise<readonly (string | null)[]> {
  return MediaEditorModule.getThumbnailStrip(uri, options);
}
