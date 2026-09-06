import { useImage, type SkImage } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useEditorTheme } from '../../core/theming/ThemeContext';
import { type PhotoFilterPack } from '../../photo/color';
import { type PhotoOverlayPack } from '../../photo/overlays';
import {
  INITIAL_STATE as PHOTO_INITIAL_STATE,
  type PhotoEditorAction,
  type PhotoEditorController,
  type PhotoEditorState,
} from '../../photo/state/photoEditorState';
import { EffectsTool } from '../../photo/tools/EffectsTool';
import type { VideoEditorController } from '../state/videoEditorState';

export interface VideoEffectsToolProps {
  controller: VideoEditorController;
  /** Poster frame URI, prefetched by the editor; `null` while still loading. */
  posterUri: string | null;
  filterPacks?: readonly PhotoFilterPack[];
  overlayPacks?: readonly PhotoOverlayPack[];
}

/** Video-side wrapper around the photo `EffectsTool`, fed a prefetched poster SkImage for the filter thumbnail strip. */
export function VideoEffectsTool({
  controller,
  posterUri,
  filterPacks,
  overlayPacks,
}: VideoEffectsToolProps) {
  const theme = useEditorTheme();
  const posterImage = useImage(posterUri ?? undefined);

  const { filterId, filterIntensity, overlayId, overlayIntensity } = controller.state;
  const photoState = useMemo<PhotoEditorState>(
    () => ({
      ...PHOTO_INITIAL_STATE,
      filterId,
      filterIntensity,
      overlayId,
      overlayIntensity,
    }),
    [filterId, filterIntensity, overlayId, overlayIntensity]
  );
  const photoController = useMemo<PhotoEditorController>(
    () => ({
      state: photoState,
      dispatch: (action: PhotoEditorAction) => {
        switch (action.type) {
          case 'setFilter':
            controller.dispatch({ type: 'setFilter', id: action.id });
            break;
          case 'setFilterIntensity':
            controller.dispatch({ type: 'setFilterIntensity', value: action.value });
            break;
          case 'setOverlay':
            controller.dispatch({
              type: 'setOverlay',
              id: action.id,
              defaultIntensity: action.defaultIntensity,
            });
            break;
          case 'setOverlayIntensity':
            controller.dispatch({ type: 'setOverlayIntensity', value: action.value });
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

  if (!posterImage) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  return (
    <EffectsTool
      image={posterImage}
      controller={photoController}
      filterPacks={filterPacks}
      overlayPacks={overlayPacks}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export type { SkImage };
