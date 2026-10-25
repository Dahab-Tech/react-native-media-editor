export { VideoEditor, type VideoEditorProps, type VideoSource } from './VideoEditor';
export { CropOverlay, type CropOverlayProps } from './components/CropOverlay';
export { CropAspectPicker, type CropAspectPickerProps } from './components/CropAspectPicker';
export { getVideoInfo, getVideoThumbnail, getVideoThumbnailStrip, trimVideo } from './api';
export {
  exportProject,
  type ProjectExportOptions,
  type ProjectExportResult,
} from './export/exportProject';
export type { WireClip, WireOutput, WireOverlay, WireProject } from './project/wire';
export { VIDEO_TOOL_IDS, type ProjectEditorController, type VideoToolId } from './project/reducer';
export type { Clip, ClipEdits, Project, TimedOverlay, Track } from './project/model';
export { projectFromSources } from './project/model';
export { serializeProject } from './project/serialize';
export {
  TimelinePlayer,
  type TimelinePlayerHandle,
  type TimelinePlayerProps,
} from './player/TimelinePlayer';
export { ASPECT_RATIO_PRESETS, type AspectRatio } from '../photo/state/photoEditorState';
export type {
  CropRect,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailStripOptions,
  TrimOptions,
  TrimResult,
  VideoCompressionOptions,
  VideoInfo,
} from '../types';
