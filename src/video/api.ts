import MediaEditorModule from '../native/MediaEditorModule';
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TrimOptions,
  TrimResult,
  VideoInfo,
} from '../types';

/** Reads duration, display dimensions, rotation and frame rate without decoding the video. */
export function getVideoInfo(uri: string): Promise<VideoInfo> {
  return MediaEditorModule.getVideoInfo(uri);
}

/** Trims the video to [startMs, endMs]. Providing `crop` (or any non-trim option) forces a re-encode; pure trims use lossless passthrough on iOS. */
export function trimVideo(uri: string, options: TrimOptions): Promise<TrimResult> {
  if (options.startMs < 0 || options.endMs <= options.startMs) {
    return Promise.reject(
      new Error(`Invalid trim range: startMs=${options.startMs}, endMs=${options.endMs}`)
    );
  }
  if (options.crop && (options.crop.width <= 0 || options.crop.height <= 0)) {
    return Promise.reject(
      new Error(`Invalid crop size: width=${options.crop.width}, height=${options.crop.height}`)
    );
  }
  return MediaEditorModule.trim(uri, options);
}

/** Extracts a single frame as a JPEG file in the app cache. */
export function getVideoThumbnail(
  uri: string,
  options: ThumbnailOptions = {}
): Promise<ThumbnailResult> {
  return MediaEditorModule.getThumbnail(uri, options);
}
