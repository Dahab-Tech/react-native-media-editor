import { NativeModule, registerWebModule } from 'expo';

const UNAVAILABLE = 'The MediaEditor native module is not available on web';

class MediaEditorWebModule extends NativeModule {
  getVideoInfo(): Promise<never> {
    return Promise.reject(new Error(UNAVAILABLE));
  }
  trim(): Promise<never> {
    return Promise.reject(new Error(UNAVAILABLE));
  }
  getThumbnail(): Promise<never> {
    return Promise.reject(new Error(UNAVAILABLE));
  }
  // No web filesystem — return a data URI so PhotoEditor's export API stays total (still usable as <img> src).
  writeCacheFile(base64: string, extension: string): Promise<string> {
    const mime = extension === 'png' ? 'image/png' : 'image/jpeg';
    return Promise.resolve(`data:${mime};base64,${base64}`);
  }
  // Symmetric with writeCacheFile: parse the data URI back to raw base64.
  readCacheFile(uri: string): Promise<string> {
    const match = /^data:[^;]+;base64,(.*)$/.exec(uri);
    if (!match) return Promise.reject(new Error(UNAVAILABLE));
    return Promise.resolve(match[1]);
  }
  createScrubSession(): Promise<never> {
    return Promise.reject(new Error(UNAVAILABLE));
  }
  scrubSessionTo(): Promise<void> {
    return Promise.resolve();
  }
  releaseScrubSession(): Promise<void> {
    return Promise.resolve();
  }
}

export default registerWebModule(MediaEditorWebModule, 'MediaEditor');
