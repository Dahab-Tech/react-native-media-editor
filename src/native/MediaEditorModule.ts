import { NativeModule, requireNativeModule } from 'expo';

import type {
  ThumbnailOptions,
  ThumbnailResult,
  TrimOptions,
  TrimResult,
  VideoInfo,
} from '../types';

export interface ScrubSessionInfo {
  sessionId: number;
  width: number;
  height: number;
  rotation: number;
  durationMs: number;
}

declare class MediaEditorNativeModule extends NativeModule {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  trim(uri: string, options: TrimOptions): Promise<TrimResult>;
  getThumbnail(uri: string, options: ThumbnailOptions): Promise<ThumbnailResult>;
  writeCacheFile(base64: string, extension: string): Promise<string>;
  readCacheFile(uri: string): Promise<string>;
  createScrubSession(uri: string): Promise<ScrubSessionInfo>;
  scrubSessionTo(sessionId: number, timeMs: number): Promise<void>;
  releaseScrubSession(sessionId: number): Promise<void>;
}

export default requireNativeModule<MediaEditorNativeModule>('MediaEditor');
