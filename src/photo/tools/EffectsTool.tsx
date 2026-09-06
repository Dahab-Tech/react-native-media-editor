import { type SkImage } from '@shopify/react-native-skia';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { type PhotoFilterPack } from '../color';
import { type PhotoOverlayPack } from '../overlays';
import { FiltersTool } from './FiltersTool';
import { OverlaysTool } from './OverlaysTool';
import { type PhotoEditorController } from '../state/photoEditorState';

export interface EffectsToolProps {
  image: SkImage;
  controller: PhotoEditorController;
  filterPacks?: readonly PhotoFilterPack[];
  overlayPacks?: readonly PhotoOverlayPack[];
}

type EffectsSegment = 'filters' | 'overlays';

const DEFAULT_SEGMENT: EffectsSegment = 'filters';

const SCRIM_TEXT = '#FFFFFF';
const SCRIM_BORDER = 'rgba(255,255,255,0.35)';
const SCRIM_SEGMENT_BG = 'rgba(255,255,255,0.16)';

/** Segmented control over FiltersTool + OverlaysTool. Purely a UI grouping; reducer state is untouched. */
export function EffectsTool({ image, controller, filterPacks, overlayPacks }: EffectsToolProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const [segment, setSegment] = useState<EffectsSegment>(DEFAULT_SEGMENT);

  return (
    <View onLayout={_noopLayout}>
      <View
        style={[
          styles.segmentRow,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            marginHorizontal: theme.spacing.md,
            marginTop: theme.spacing.sm,
            borderColor: SCRIM_BORDER,
            borderRadius: theme.radius.md,
          },
        ]}>
        <Segment
          label={t('filters')}
          active={segment === 'filters'}
          onPress={() => setSegment('filters')}
        />
        <Segment
          label={t('overlays')}
          active={segment === 'overlays'}
          onPress={() => setSegment('overlays')}
        />
      </View>

      {/* Fixed height so the segmented control's Y doesn't shift on toggle. */}
      <View style={styles.contentWell}>
        {segment === 'filters' ? (
          <FiltersTool image={image} controller={controller} filterPacks={filterPacks} />
        ) : (
          <OverlaysTool controller={controller} overlayPacks={overlayPacks} />
        )}
      </View>
    </View>
  );
}

interface SegmentProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function Segment({ label, active, onPress }: SegmentProps) {
  const theme = useEditorTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: active ? theme.colors.accent : SCRIM_SEGMENT_BG,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        style={{
          color: active ? theme.colors.onAccent : SCRIM_TEXT,
          fontWeight: active ? '700' : '500',
          fontSize: 13,
          letterSpacing: 0.2,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

// Named no-op so React Compiler treats it as stable across renders.
function _noopLayout(_e: LayoutChangeEvent) {}

// Pinned to the taller filters-with-slider layout so the segmented control's Y is invariant.
const EFFECTS_CONTENT_HEIGHT = 220;

const styles = StyleSheet.create({
  segmentRow: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWell: {
    height: EFFECTS_CONTENT_HEIGHT,
  },
});
