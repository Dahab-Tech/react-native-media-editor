import React, { useMemo } from 'react';

import {
  INITIAL_STATE as PHOTO_INITIAL_STATE,
  type PhotoEditorAction,
  type PhotoEditorController,
} from '../../photo/state/photoEditorState';
import {
  createDefaultDrawSettings,
  DrawTool,
  type DrawToolSettings,
} from '../../photo/tools/DrawTool';
import type { VideoEditorController } from '../state/videoEditorState';

export interface VideoDrawToolProps {
  controller: VideoEditorController;
  settings: DrawToolSettings;
  onSettingsChange: (next: DrawToolSettings) => void;
}

/** Video-side wrapper around the photo `DrawTool`. Forwards only `clearStrokes`. */
export function VideoDrawTool({ controller, settings, onSettingsChange }: VideoDrawToolProps) {
  const photoController = useMemo<PhotoEditorController>(
    () => ({
      state: { ...PHOTO_INITIAL_STATE, strokes: controller.state.strokes },
      dispatch: (action: PhotoEditorAction) => {
        if (action.type === 'clearStrokes') {
          controller.dispatch({ type: 'clearStrokes' });
        }
      },
    }),
    [controller]
  );
  return (
    <DrawTool
      controller={photoController}
      settings={settings}
      onSettingsChange={onSettingsChange}
    />
  );
}

export { createDefaultDrawSettings };
export type { DrawToolSettings };
