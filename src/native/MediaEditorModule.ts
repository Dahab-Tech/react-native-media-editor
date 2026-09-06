import { NativeModule, requireNativeModule } from 'expo';

import type {
  ThumbnailOptions,
  ThumbnailResult,
  TrimOptions,
  TrimResult,
  VideoInfo,
} from '../types';

declare class MediaEditorNativeModule extends NativeModule {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  trim(uri: string, options: TrimOptions): Promise<TrimResult>;
  getThumbnail(uri: string, options: ThumbnailOptions): Promise<ThumbnailResult>;
  writeCacheFile(base64: string, extension: string): Promise<string>;
}

export default requireNativeModule<MediaEditorNativeModule>('MediaEditor');
