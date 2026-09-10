import React, { useMemo } from 'react';

import type { PhotoAdjustmentKey } from '../../photo/color';
import {
  INITIAL_STATE as PHOTO_INITIAL_STATE,
  type PhotoEditorAction,
  type PhotoEditorController,
  type PhotoEditorState,
} from '../../photo/state/photoEditorState';
import { AdjustTool } from '../../photo/tools/AdjustTool';
import type { VideoEditorController } from '../state/videoEditorState';

// Only matrix-expressible adjustments: the video export pipeline (CIColorMatrix / Media3 RgbMatrix)
// has no SkSL stage, so tone/vibrance/sharpness/vignette/grain would preview but never export.
const VIDEO_ADJUSTMENT_KEYS: readonly PhotoAdjustmentKey[] = [
  'exposure',
  'brightness',
  'contrast',
  'temperature',
  'tint',
  'saturation',
  'hue',
];

export interface VideoAdjustToolProps {
  controller: VideoEditorController;
}

/** Video-side wrapper around the photo `AdjustTool` — projects state and fans out the ~3 actions. */
export function VideoAdjustTool({ controller }: VideoAdjustToolProps) {
  const adjustments = controller.state.adjustments;
  const photoState = useMemo<PhotoEditorState>(
    () => ({ ...PHOTO_INITIAL_STATE, adjustments }),
    [adjustments]
  );
  const photoController = useMemo<PhotoEditorController>(
    () => ({
      state: photoState,
      dispatch: (action: PhotoEditorAction) => {
        switch (action.type) {
          case 'setAdjustment':
            controller.dispatch({ type: 'setAdjustment', key: action.key, value: action.value });
            break;
          case 'resetAdjustments':
            controller.dispatch({ type: 'resetAdjustments' });
            break;
          case 'checkpoint':
            controller.dispatch({ type: 'checkpoint' });
            break;
          default:
            break;
        }
      },
    }),
    [controller, photoState]
  );
  return <AdjustTool controller={photoController} keys={VIDEO_ADJUSTMENT_KEYS} />;
}
