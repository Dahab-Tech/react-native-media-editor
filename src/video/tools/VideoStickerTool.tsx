import React, { useMemo } from 'react';

import type { PhotoStickerPack } from '../../photo/layers';
import { INITIAL_STATE as PHOTO_INITIAL_STATE } from '../../photo/state/photoEditorState';
import type {
  PhotoEditorAction,
  PhotoEditorController,
  PhotoEditorState,
} from '../../photo/state/photoEditorState';
import { StickerTool } from '../../photo/tools/StickerTool';
import { overlayLayers, type ProjectEditorController } from '../project/reducer';

export interface VideoStickerToolProps {
  controller: ProjectEditorController;
  stickerPacks?: readonly PhotoStickerPack[];
}

/** Video-side wrapper around the photo `StickerTool`. Forwards only `addLayer`. */
export function VideoStickerTool({ controller, stickerPacks }: VideoStickerToolProps) {
  const layers = overlayLayers(controller.state.project);
  const photoState = useMemo<PhotoEditorState>(
    () => ({ ...PHOTO_INITIAL_STATE, layers }),
    [layers]
  );
  const photoController = useMemo<PhotoEditorController>(
    () => ({
      state: photoState,
      dispatch: (action: PhotoEditorAction) => {
        if (action.type === 'addLayer') {
          controller.dispatch({ type: 'addLayer', layer: action.layer });
        }
      },
    }),
    [controller, photoState]
  );
  return <StickerTool controller={photoController} stickerPacks={stickerPacks} />;
}
