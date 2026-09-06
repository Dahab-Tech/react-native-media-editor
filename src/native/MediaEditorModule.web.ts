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
  // Web has no filesystem to write to — return a data URI so the PhotoEditor
  // export API stays total (consumers can still use it as an <img>/Image src).
  writeCacheFile(base64: string, extension: string): Promise<string> {
    const mime = extension === 'png' ? 'image/png' : 'image/jpeg';
    return Promise.resolve(`data:${mime};base64,${base64}`);
  }
}

export default registerWebModule(MediaEditorWebModule, 'MediaEditor');
