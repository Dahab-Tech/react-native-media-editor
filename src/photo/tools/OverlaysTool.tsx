import {
  Canvas,
  Group,
  LinearGradient,
  RadialGradient,
  Rect,
  Image as SkiaImage,
  useImage,
  vec,
  type DataSourceParam,
} from '@shopify/react-native-skia';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette, isPanelDark } from '../../core/theming/theme';
import { Slider } from '../components/Slider';
import {
  BUILTIN_OVERLAY_PACKS,
  type PhotoOverlayDefinition,
  type PhotoOverlayPack,
} from '../overlays';
import { type PhotoEditorController } from '../state/photoEditorState';

export interface OverlaysToolProps {
  controller: PhotoEditorController;
  /** Optional consumer packs appended after built-ins. */
  overlayPacks?: readonly PhotoOverlayPack[];
}

// Opaque so Skia blend modes have something to composite against; kept dark in both schemes.
const SWATCH_COMPOSITE_BG = 'rgba(60, 60, 70, 1)';

const PACK_CHIP_HEIGHT = 32;
const PACK_CHIP_MIN_WIDTH = 64;
const SWATCH_SIZE = 56;
const NONE_SWATCH_ID = '__overlays_none__';

/** Pack chips + swatch strip + intensity slider. Structure mirrors FiltersTool. */
export function OverlaysTool({ controller, overlayPacks }: OverlaysToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const textMuted = isPanelDark(theme) ? 'rgba(255,255,255,0.75)' : theme.colors.textMuted;
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setPackRowRef, onPackRowContentSizeChange] = useRtlHorizontalScrollLanding();
  const [setSwatchRowRef, onSwatchRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const packs = useMemo<readonly PhotoOverlayPack[]>(
    () => (overlayPacks ? [...BUILTIN_OVERLAY_PACKS, ...overlayPacks] : BUILTIN_OVERLAY_PACKS),
    [overlayPacks]
  );

  // Defaults to the pack containing the current overlay so re-entering opens on its home pack.
  const initialPackIndex = useMemo(() => {
    if (state.overlayId == null) return 0;
    for (let i = 0; i < packs.length; i += 1) {
      if (packs[i].overlays.some((o) => o.id === state.overlayId)) return i;
    }
    return 0;
  }, [packs, state.overlayId]);
  const [selectedPackIndex, setSelectedPackIndex] = useState(initialPackIndex);
  const activePack = packs[Math.min(selectedPackIndex, packs.length - 1)];

  const overlayActive = state.overlayId != null;

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
        {packs.map((pack, index) => {
          const active = index === selectedPackIndex;
          const label = pack.titleKey
            ? t(pack.titleKey as keyof MediaEditorStrings)
            : (pack.title ?? pack.id);
          return (
            <Pressable
              key={pack.id}
              onPress={() => setSelectedPackIndex(index)}
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
        ref={setSwatchRowRef}
        onContentSizeChange={onSwatchRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.sm,
        }}>
        <Pressable
          key={NONE_SWATCH_ID}
          onPress={() => dispatch({ type: 'setOverlay', id: null })}
          accessibilityRole="button"
          accessibilityLabel={t('original')}
          accessibilityState={{ selected: !overlayActive }}
          style={{ alignItems: 'center', gap: 4 }}>
          <View
            style={[
              styles.thumbFrame,
              {
                width: SWATCH_SIZE + 4,
                height: SWATCH_SIZE + 4,
                borderColor: !overlayActive ? theme.colors.accent : 'transparent',
                borderRadius: theme.radius.sm + 2,
                backgroundColor: SWATCH_COMPOSITE_BG,
              },
            ]}>
            <View style={{ width: SWATCH_SIZE, height: SWATCH_SIZE }} />
          </View>
          <Text
            numberOfLines={1}
            style={{
              color: !overlayActive ? theme.colors.accent : textMuted,
              fontSize: 11,
              fontWeight: !overlayActive ? '700' : '500',
              maxWidth: SWATCH_SIZE + 12,
            }}>
            {t('original')}
          </Text>
        </Pressable>

        {activePack.overlays.map((definition) => {
          const active = state.overlayId === definition.id;
          return (
            <Pressable
              key={definition.id}
              onPress={() =>
                dispatch({
                  type: 'setOverlay',
                  id: definition.id,
                  defaultIntensity: definition.defaultIntensity,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={definition.name}
              accessibilityState={{ selected: active }}
              style={{ alignItems: 'center', gap: 4 }}>
              <View
                style={[
                  styles.thumbFrame,
                  {
                    width: SWATCH_SIZE + 4,
                    height: SWATCH_SIZE + 4,
                    borderColor: active ? theme.colors.accent : 'transparent',
                    borderRadius: theme.radius.sm + 2,
                    backgroundColor: SWATCH_COMPOSITE_BG,
                  },
                ]}>
                <OverlaySwatch definition={definition} size={SWATCH_SIZE} />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? theme.colors.accent : textMuted,
                  fontSize: 11,
                  fontWeight: active ? '700' : '500',
                  maxWidth: SWATCH_SIZE + 12,
                }}>
                {definition.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {overlayActive && (
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          <Slider
            label={t('overlayIntensity')}
            value={state.overlayIntensity}
            min={0}
            max={1}
            neutral={1}
            onChange={(value) => dispatch({ type: 'setOverlayIntensity', value })}
            onSlidingStart={() => dispatch({ type: 'checkpoint' })}
            onScrim
          />
        </View>
      )}
    </View>
  );
}

function OverlaySwatch({ definition, size }: { definition: PhotoOverlayDefinition; size: number }) {
  return (
    <Canvas style={{ width: size, height: size }}>
      {/* In-canvas dark base so Skia blend modes have something to composite against. */}
      <Rect x={0} y={0} width={size} height={size} color={SWATCH_COMPOSITE_BG} />
      {definition.kind === 'procedural' ? (
        <ProceduralSwatchBody definition={definition} size={size} />
      ) : (
        <ImageSwatchBody source={definition.source} size={size} definition={definition} />
      )}
    </Canvas>
  );
}

function ProceduralSwatchBody({
  definition,
  size,
}: {
  definition: Extract<PhotoOverlayDefinition, { kind: 'procedural' }>;
  size: number;
}) {
  const rect = { x: 0, y: 0, width: size, height: size };
  return (
    <Rect
      x={0}
      y={0}
      width={size}
      height={size}
      opacity={definition.defaultIntensity ?? 1}
      blendMode={definition.blendMode}>
      {definition.shape.kind === 'linear' ? (
        <LinearGradient
          start={vec(
            rect.x + definition.shape.start[0] * rect.width,
            rect.y + definition.shape.start[1] * rect.height
          )}
          end={vec(
            rect.x + definition.shape.end[0] * rect.width,
            rect.y + definition.shape.end[1] * rect.height
          )}
          colors={definition.shape.colors as string[]}
          positions={
            definition.shape.positions ? (definition.shape.positions as number[]) : undefined
          }
        />
      ) : definition.shape.kind === 'radial' ? (
        <RadialGradient
          c={vec(
            rect.x + definition.shape.center[0] * rect.width,
            rect.y + definition.shape.center[1] * rect.height
          )}
          r={definition.shape.radius * Math.max(rect.width, rect.height)}
          colors={definition.shape.colors as string[]}
          positions={
            definition.shape.positions ? (definition.shape.positions as number[]) : undefined
          }
        />
      ) : (
        <LinearGradient
          start={vec(0, 0)}
          end={vec(size, size)}
          colors={[definition.shape.color, definition.shape.color]}
        />
      )}
    </Rect>
  );
}

function ImageSwatchBody({
  source,
  size,
  definition,
}: {
  source: DataSourceParam;
  size: number;
  definition: Extract<PhotoOverlayDefinition, { kind: 'image' }>;
}) {
  const image = useImage(source);
  if (!image) return null;
  return (
    <Group clip={{ x: 0, y: 0, width: size, height: size }}>
      <SkiaImage
        image={image}
        x={0}
        y={0}
        width={size}
        height={size}
        fit="cover"
        opacity={definition.defaultIntensity ?? 1}
        blendMode={definition.blendMode}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  packChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  thumbFrame: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
