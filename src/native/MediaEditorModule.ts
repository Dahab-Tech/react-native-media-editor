import { NativeModule, requireNativeModule } from 'expo';

import type { ThumbnailOptions, ThumbnailResult, ThumbnailStripOptions, VideoInfo } from '../types';

export interface ScrubSessionInfo {
  sessionId: number;
  width: number;
  height: number;
  rotation: number;
  durationMs: number;
}

export interface MediaEditorModuleEvents extends Record<string, (...args: any[]) => void> {
  onExportProgress: (event: { progress: number }) => void;
}

declare class MediaEditorNativeModule extends NativeModule<MediaEditorModuleEvents> {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  exportProject(projectJson: string): Promise<{ uri: string; durationMs: number }>;
  getThumbnail(uri: string, options: ThumbnailOptions): Promise<ThumbnailResult>;
  getThumbnailStrip(
    uri: string,
    options: ThumbnailStripOptions
  ): Promise<readonly (string | null)[]>;
  writeCacheFile(base64: string, extension: string): Promise<string>;
  readCacheFile(uri: string): Promise<string>;
  createScrubSession(uri: string): Promise<ScrubSessionInfo>;
  scrubSessionTo(sessionId: number, timeMs: number): Promise<void>;
  releaseScrubSession(sessionId: number): Promise<void>;
}

export default requireNativeModule<MediaEditorNativeModule>('MediaEditor');
