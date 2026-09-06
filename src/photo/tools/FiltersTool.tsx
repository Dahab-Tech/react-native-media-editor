import {
  Canvas,
  ColorMatrix,
  Group,
  ImageFilter,
  Image as SkiaImage,
  Paint,
  useImage,
  type SkImage,
} from '@shopify/react-native-skia';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import {
  BUILTIN_FILTER_PACKS,
  buildLutImageFilter,
  IDENTITY_MATRIX,
  ORIGINAL_FILTER_DEFINITION,
  ORIGINAL_FILTER_ID,
  type PhotoFilterDefinition,
  type PhotoFilterPack,
} from '../color';
import { Slider } from '../components/Slider';
import { type PhotoEditorController } from '../state/photoEditorState';

export interface FiltersToolProps {
  image: SkImage;
  controller: PhotoEditorController;
  /** Optional consumer packs appended after built-ins. */
  filterPacks?: readonly PhotoFilterPack[];
}

const THUMB_SIZE = 64;

const SCRIM_TEXT = '#FFFFFF';
const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.75)';
const SCRIM_CHIP_BG = 'rgba(255,255,255,0.08)';
const SCRIM_CHIP_BG_ACTIVE = 'rgba(255,255,255,0.16)';
const SCRIM_THUMB_BG = 'rgba(0,0,0,0.35)';

const PACK_CHIP_HEIGHT = 32;
const PACK_CHIP_MIN_WIDTH = 64;

export function FiltersTool({ image, controller, filterPacks }: FiltersToolProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setPackRowRef, onPackRowContentSizeChange] = useRtlHorizontalScrollLanding();
  const [setThumbRowRef, onThumbRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const packs = useMemo<readonly PhotoFilterPack[]>(
    () => (filterPacks ? [...BUILTIN_FILTER_PACKS, ...filterPacks] : BUILTIN_FILTER_PACKS),
    [filterPacks]
  );

  const initialPackIndex = useMemo(() => {
    for (let i = 0; i < packs.length; i += 1) {
      if (packs[i].filters.some((f) => f.id === state.filterId)) return i;
    }
    return 0;
  }, [packs, state.filterId]);
  const [selectedPackIndex, setSelectedPackIndex] = useState(initialPackIndex);
  const activePack = packs[Math.min(selectedPackIndex, packs.length - 1)];

  // "Original" leads the strip so users can wipe the filter without a separate reset.
  const thumbnails = useMemo<readonly PhotoFilterDefinition[]>(
    () => [ORIGINAL_FILTER_DEFINITION, ...activePack.filters],
    [activePack]
  );

  const imageAspect = image.width() / image.height();
  const thumbWidth = imageAspect >= 1 ? THUMB_SIZE : THUMB_SIZE * imageAspect;
  const thumbHeight = imageAspect >= 1 ? THUMB_SIZE / imageAspect : THUMB_SIZE;

  const filterActive = state.filterId !== ORIGINAL_FILTER_ID;

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
                  backgroundColor: active ? SCRIM_CHIP_BG_ACTIVE : SCRIM_CHIP_BG,
                  borderColor: active ? theme.colors.accent : 'transparent',
                },
              ]}>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? SCRIM_TEXT : SCRIM_TEXT_MUTED,
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
        ref={setThumbRowRef}
        onContentSizeChange={onThumbRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.sm,
        }}>
        {thumbnails.map((definition) => {
          const active = state.filterId === definition.id;
          return (
            <Pressable
              key={definition.id}
              onPress={() => dispatch({ type: 'setFilter', id: definition.id })}
              accessibilityRole="button"
              accessibilityLabel={definition.name}
              accessibilityState={{ selected: active }}
              style={{ alignItems: 'center', gap: 4 }}>
              <View
                style={[
                  styles.thumbFrame,
                  {
                    width: THUMB_SIZE + 4,
                    height: THUMB_SIZE + 4,
                    borderColor: active ? theme.colors.accent : 'transparent',
                    borderRadius: theme.radius.sm + 2,
                    backgroundColor: SCRIM_THUMB_BG,
                  },
                ]}>
                <FilterThumbnail
                  image={image}
                  definition={definition}
                  width={thumbWidth}
                  height={thumbHeight}
                />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? theme.colors.accent : SCRIM_TEXT_MUTED,
                  fontSize: 11,
                  fontWeight: active ? '700' : '500',
                  maxWidth: THUMB_SIZE + 12,
                }}>
                {definition.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filterActive && (
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          <Slider
            label={t('filterIntensity')}
            value={state.filterIntensity}
            min={0}
            max={1}
            neutral={1}
            onChange={(value) => dispatch({ type: 'setFilterIntensity', value })}
            onSlidingStart={() => dispatch({ type: 'checkpoint' })}
            onScrim
          />
        </View>
      )}
    </View>
  );
}

function FilterThumbnail({
  image,
  definition,
  width,
  height,
}: {
  image: SkImage;
  definition: PhotoFilterDefinition;
  width: number;
  height: number;
}) {
  const lutSource = definition.kind === 'lut' ? definition.source : undefined;
  const lutImage = useImage(lutSource);
  // Full-strength preview so look differences are obvious.
  const lutImageFilter = useMemo(() => {
    if (definition.kind !== 'lut' || !lutImage) return null;
    return buildLutImageFilter(lutImage, 1);
  }, [definition, lutImage]);

  const matrix =
    definition.kind === 'matrix' ? (definition.matrix as number[]) : (IDENTITY_MATRIX as number[]);
  const isIdentity = definition.id === ORIGINAL_FILTER_ID;

  return (
    <Canvas style={{ width: THUMB_SIZE, height: THUMB_SIZE }}>
      <Group
        layer={
          <Paint>
            {!isIdentity && definition.kind === 'matrix' && <ColorMatrix matrix={matrix} />}
            {lutImageFilter && <ImageFilter filter={lutImageFilter} />}
          </Paint>
        }>
        <SkiaImage
          image={image}
          x={(THUMB_SIZE - width) / 2}
          y={(THUMB_SIZE - height) / 2}
          width={width}
          height={height}
          fit="cover"
        />
      </Group>
    </Canvas>
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
