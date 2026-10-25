import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { CoverPicker } from './CoverPicker';
import type { PhotoFilterPack } from '../../photo/color';
import { ToolPanel } from '../../photo/components/ToolPanel';
import type { PhotoStickerPack } from '../../photo/layers';
import type { PhotoOverlayPack } from '../../photo/overlays';
import type { DrawToolSettings } from '../../photo/tools/DrawTool';
import { TextTool } from '../../photo/tools/TextTool';
import type { ProjectEditorController, VideoToolId } from '../project/reducer';
import { SpeedTool } from '../tools/SpeedTool';
import { VideoAdjustTool } from '../tools/VideoAdjustTool';
import { VideoDrawTool } from '../tools/VideoDrawTool';
import { VideoEffectsTool } from '../tools/VideoEffectsTool';
import { VideoStickerTool } from '../tools/VideoStickerTool';

const PANEL_ENTER_MS = 220;

export interface VideoToolPanelsProps {
  controller: ProjectEditorController;
  activeTool: VideoToolId;
  bottom: number;
  onDismiss: () => void;
  posterUri: string | null;
  filterPacks?: readonly PhotoFilterPack[];
  overlayPacks?: readonly PhotoOverlayPack[];
  stickerPacks?: readonly PhotoStickerPack[];
  drawSettings: DrawToolSettings;
  onDrawSettingsChange: (next: DrawToolSettings) => void;
  onAddText: () => void;
  cover: {
    source: string;
    durationMs: number;
    onScrub: (timeMs: number) => void;
    onScrubEnd: () => void;
    onSave: (timeMs: number) => void;
    onCancel: () => void;
    busy: boolean;
  };
}

/** Floating panel for the active tool tab; trim/crop bring their own chrome and never render here. */
export function VideoToolPanels({
  controller,
  activeTool,
  bottom,
  onDismiss,
  posterUri,
  filterPacks,
  overlayPacks,
  stickerPacks,
  drawSettings,
  onDrawSettingsChange,
  onAddText,
  cover,
}: VideoToolPanelsProps) {
  const content = (() => {
    switch (activeTool) {
      case 'adjust':
        return <VideoAdjustTool controller={controller} />;
      case 'effects':
        return (
          <VideoEffectsTool
            controller={controller}
            posterUri={posterUri}
            filterPacks={filterPacks}
            overlayPacks={overlayPacks}
          />
        );
      case 'speed':
        return <SpeedTool controller={controller} />;
      case 'text':
        return <TextTool onAddText={onAddText} />;
      case 'stickers':
        return <VideoStickerTool controller={controller} stickerPacks={stickerPacks} />;
      case 'draw':
        return (
          <VideoDrawTool
            controller={controller}
            settings={drawSettings}
            onSettingsChange={onDrawSettingsChange}
          />
        );
      case 'cover':
        return (
          <CoverPicker
            source={cover.source}
            durationMs={cover.durationMs}
            onScrub={cover.onScrub}
            onScrubEnd={cover.onScrubEnd}
            onSave={cover.onSave}
            onCancel={cover.onCancel}
            busy={cover.busy}
          />
        );
      default:
        return null;
    }
  })();
  if (content == null) return null;
  return (
    <FloatingPanel bottom={bottom}>
      <ToolPanel onDismiss={onDismiss}>{content}</ToolPanel>
    </FloatingPanel>
  );
}

// Fade only — transform slides diverged hit-testing from visuals on resize, and exit ghosts swallowed taps on the replacing panel.
function FloatingPanel({ children, bottom }: { children: React.ReactNode; bottom: number }) {
  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom }]}>
      <Animated.View entering={FadeIn.duration(PANEL_ENTER_MS)}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});
