import MediaEditorModule from '../../native/MediaEditorModule';
import type { WireProject } from '../project/wire';

export interface ProjectExportResult {
  uri: string;
  durationMs: number;
}

export interface ProjectExportOptions {
  /** Export progress in [0, 1]; granularity is platform-dependent. */
  onProgress?: (progress: number) => void;
}

/** Renders a wire project to an mp4 in the app cache via the native exporter. */
export async function exportProject(
  project: WireProject,
  options: ProjectExportOptions = {}
): Promise<ProjectExportResult> {
  const { onProgress } = options;
  const subscription = onProgress
    ? MediaEditorModule.addListener('onExportProgress', (event) => onProgress(event.progress))
    : null;
  try {
    return await MediaEditorModule.exportProject(JSON.stringify(project));
  } finally {
    subscription?.remove();
  }
}
