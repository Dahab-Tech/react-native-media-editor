/** Consumer-injected background-removal engine contract. Structurally identical to `@dahab-tech/media-editor-ai`. */

export interface BackgroundRemovalOptions {
  /** 'none' preserves input dims (in-place override); 'subject' tightly crops to subject bbox. */
  crop?: 'none' | 'subject';
}

export interface BackgroundRemovalResult {
  /** `file://` URI to a PNG with alpha. */
  uri: string;
  width: number;
  height: number;
}

export interface BackgroundRemovalEngine {
  /** Must not throw; return `false` for unsupported devices. */
  isAvailable(): Promise<boolean>;

  /** Reject with `code === 'ERR_NO_SUBJECT'` for a specific inline hint; other errors show a generic message. */
  removeBackground(
    uri: string,
    options?: BackgroundRemovalOptions
  ): Promise<BackgroundRemovalResult>;
}
