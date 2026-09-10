import React, { useMemo, useState } from 'react';
import { Image as RNImage, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette, isPanelDark } from '../../core/theming/theme';
import {
  BUILTIN_STICKER_PACKS,
  generateLayerId,
  type PhotoStickerPack,
  type StickerLayer,
} from '../layers';
import { type PhotoEditorController } from '../state/photoEditorState';

export interface StickerToolProps {
  controller: PhotoEditorController;
  /** Consumer packs appended after built-ins. */
  stickerPacks?: readonly PhotoStickerPack[];
}

const PACK_CHIP_HEIGHT = 32;
const PACK_CHIP_MIN_WIDTH = 64;

/** Default spawn scale for stickers; shared with the video wrapper and AI cutout spawn. */
export const DEFAULT_STICKER_SPAWN_SCALE = 1.6;

/** Default spawn scale for text (spawn-side only; existing layers keep their committed scale). */
export const DEFAULT_TEXT_SPAWN_SCALE = 1.2;

/** Deterministic stagger so consecutive spawns don't stack at dead-center. */
export const SPAWN_OFFSET_STEP = 0.04;
export const SPAWN_OFFSET_WRAP = 8;
export function spawnCenterFor(layerCount: number): { x: number; y: number } {
  const step = (layerCount % SPAWN_OFFSET_WRAP) * SPAWN_OFFSET_STEP;
  return { x: 0.5 + step, y: 0.5 + step };
}
const GRID_ITEM_SIZE = 80;
const GRID_VERTICAL_PADDING = 6;
const GRID_MAX_HEIGHT = 2 * GRID_ITEM_SIZE + 8 + 2 * GRID_VERTICAL_PADDING;

/** Pack chips + wrapping grid; tap-to-add spawns a StickerLayer at a staggered center. */
export function StickerTool({ controller, stickerPacks }: StickerToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const panelDark = isPanelDark(theme);
  const itemBg = panelDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const textMuted = panelDark ? 'rgba(255,255,255,0.75)' : theme.colors.textMuted;
  const { t, isRTL } = useEditorI18n();
  const { dispatch } = controller;
  const [setPackRowRef, onPackRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const entries = useMemo(() => {
    const built = BUILTIN_STICKER_PACKS.map((pack) => ({ kind: 'builtin' as const, pack }));
    const consumer = (stickerPacks ?? []).map((pack) => ({ kind: 'consumer' as const, pack }));
    return [...built, ...consumer];
  }, [stickerPacks]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeEntry = entries[Math.min(selectedIndex, entries.length - 1)];

  const handleAddEmoji = (emoji: string) => {
    const center = spawnCenterFor(controller.state.layers.length);
    const layer: StickerLayer = {
      id: generateLayerId(),
      kind: 'sticker',
      content: { variant: 'emoji', emoji },
      x: center.x,
      y: center.y,
      scale: DEFAULT_STICKER_SPAWN_SCALE,
      rotation: 0,
    };
    dispatch({ type: 'addLayer', layer });
  };

  const handleAddImage = (packId: string, stickerId: string) => {
    const center = spawnCenterFor(controller.state.layers.length);
    const layer: StickerLayer = {
      id: generateLayerId(),
      kind: 'sticker',
      content: { variant: 'image', packId, stickerId },
      x: center.x,
      y: center.y,
      scale: DEFAULT_STICKER_SPAWN_SCALE,
      rotation: 0,
    };
    dispatch({ type: 'addLayer', layer });
  };

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
      <ScrollView
        ref={setPackRowRef}
        onContentSizeChange={onPackRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.xs,
        }}>
        {entries.map((entry, index) => {
          const active = index === selectedIndex;
          const label =
            entry.kind === 'builtin'
              ? t(entry.pack.titleKey as keyof MediaEditorStrings)
              : entry.pack.title;
          return (
            <Pressable
              key={`${entry.kind}:${entry.pack.id}`}
              onPress={() => setSelectedIndex(index)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              style={[
                styles.packChip,
                {
                  minWidth: PACK_CHIP_MIN_WIDTH,
                  height: PACK_CHIP_HEIGHT,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.sm,
                  backgroundColor: active ? panel.chipBgActive : panel.chipBg,
                  borderColor: active ? theme.colors.accent : 'transparent',
                },
              ]}>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? panel.text : textMuted,
                  fontSize: 12,
                  fontWeight: active ? '700' : '500',
                }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: GRID_MAX_HEIGHT }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: GRID_VERTICAL_PADDING,
        }}>
        <View
          style={{
            flexDirection: isRTL ? 'row-reverse' : 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
          }}>
          {activeEntry.kind === 'builtin'
            ? activeEntry.pack.stickers.map((sticker, i) => (
                <Pressable
                  key={`${activeEntry.pack.id}-${i}`}
                  onPress={() => handleAddEmoji(sticker.emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={sticker.emoji}
                  hitSlop={4}
                  style={[
                    styles.gridItem,
                    {
                      width: GRID_ITEM_SIZE,
                      height: GRID_ITEM_SIZE,
                      borderRadius: theme.radius.md,
                      backgroundColor: itemBg,
                    },
                  ]}>
                  <Text
                    allowFontScaling={false}
                    style={{
                      fontSize: 44,
                      lineHeight: 52,
                      textAlign: 'center',
                    }}>
                    {sticker.emoji}
                  </Text>
                </Pressable>
              ))
            : activeEntry.pack.stickers.map((sticker) => (
                <Pressable
                  key={sticker.id}
                  onPress={() => handleAddImage(activeEntry.pack.id, sticker.id)}
                  accessibilityRole="button"
                  accessibilityLabel={sticker.id}
                  hitSlop={4}
                  style={[
                    styles.gridItem,
                    {
                      width: GRID_ITEM_SIZE,
                      height: GRID_ITEM_SIZE,
                      borderRadius: theme.radius.md,
                      backgroundColor: itemBg,
                    },
                  ]}>
                  {(() => {
                    const src = toRNImageSource(sticker.source);
                    return src ? (
                      <RNImage
                        source={src}
                        style={{ width: GRID_ITEM_SIZE - 12, height: GRID_ITEM_SIZE - 12 }}
                        resizeMode="contain"
                      />
                    ) : null;
                  })()}
                </Pressable>
              ))}
        </View>
      </ScrollView>
    </View>
  );
}

function toRNImageSource(source: unknown): { uri: string } | number | null {
  if (typeof source === 'string') return { uri: source };
  if (typeof source === 'number') return source;
  return null;
}

const styles = StyleSheet.create({
  packChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  gridItem: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
