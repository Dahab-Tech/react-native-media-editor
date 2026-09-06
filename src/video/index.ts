export { VideoEditor, type VideoEditorProps } from './VideoEditor';
export { TrimBar, type TrimBarProps } from './components/TrimBar';
export { CropOverlay, type CropOverlayProps } from './components/CropOverlay';
export { CropAspectPicker, type CropAspectPickerProps } from './components/CropAspectPicker';
export { getVideoInfo, getVideoThumbnail, trimVideo } from './api';
export {
  VIDEO_TOOL_IDS,
  type VideoEditorController,
  type VideoToolId,
} from './state/videoEditorState';
export { ASPECT_RATIO_PRESETS, type AspectRatio } from '../photo/state/photoEditorState';
export type {
  CropRect,
  ThumbnailOptions,
  ThumbnailResult,
  TrimOptions,
  TrimResult,
  VideoCompressionOptions,
  VideoInfo,
} from '../types';
