import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette } from '../../core/theming/theme';
import {
  ADJUSTMENT_META,
  adjustmentMeta,
  isNeutral,
  NEUTRAL_ADJUSTMENTS,
  type PhotoAdjustmentKey,
} from '../color';
import { Slider } from '../components/Slider';
import { type PhotoEditorController } from '../state/photoEditorState';

export interface AdjustToolProps {
  controller: PhotoEditorController;
  /** Restrict which sliders show (chip order follows ADJUSTMENT_META); omitted = all. */
  keys?: readonly PhotoAdjustmentKey[];
}

// 30pt visible; 8pt hitSlop meets the 44pt touch minimum.
const CHIP_HEIGHT = 30;
const CHIP_MIN_WIDTH = 64;
const CHIP_HIT_SLOP = 8;

export function AdjustTool({ controller, keys }: AdjustToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setChipRowRef, onChipRowContentSizeChange] = useRtlHorizontalScrollLanding();
  const metas = keys ? ADJUSTMENT_META.filter((meta) => keys.includes(meta.key)) : ADJUSTMENT_META;

  // Default to first non-neutral key so returning to the tool jumps to the last-touched slider.
  const initialSelected = (): PhotoAdjustmentKey => {
    for (const meta of metas) {
      if (!isNeutral(meta.key, state.adjustments[meta.key])) return meta.key;
    }
    return metas[0]?.key ?? 'exposure';
  };
  const [selectedKey, setSelectedKey] = useState<PhotoAdjustmentKey>(initialSelected);
  const selectedMeta = adjustmentMeta(selectedKey);
  const selectedValue = state.adjustments[selectedKey];
  const selectedIsNeutral = isNeutral(selectedKey, selectedValue);

  const startCheckpoint = () => dispatch({ type: 'checkpoint' });

  const resetSelected = () => {
    dispatch({ type: 'checkpoint' });
    dispatch({
      type: 'setAdjustment',
      key: selectedKey,
      value: NEUTRAL_ADJUSTMENTS[selectedKey],
    });
  };

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
      <ScrollView
        ref={setChipRowRef}
        onContentSizeChange={onChipRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.xs,
        }}>
        {metas.map((meta) => {
          const active = meta.key === selectedKey;
          const value = state.adjustments[meta.key];
          const nonNeutral = !isNeutral(meta.key, value);
          return (
            <Pressable
              key={meta.key}
              onPress={() => {
                // Tapping the already-selected chip resets its value.
                if (active) {
                  resetSelected();
                  return;
                }
                setSelectedKey(meta.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={t(meta.labelKey)}
              accessibilityState={{ selected: active }}
              hitSlop={CHIP_HIT_SLOP}
              style={[
                styles.chip,
                {
                  minWidth: CHIP_MIN_WIDTH,
                  height: CHIP_HEIGHT,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 0,
                  backgroundColor: active ? panel.chipBgActive : panel.chipBg,
                  borderColor: active ? theme.colors.accent : 'transparent',
                },
              ]}>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? panel.text : panel.textMuted,
                  fontSize: 12,
                  fontWeight: active ? '700' : '500',
                }}>
                {t(meta.labelKey)}
              </Text>
              {nonNeutral && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.dot,
                    {
                      backgroundColor: active ? theme.colors.accent : panel.text,
                    },
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.md }}>
        <Slider
          label={t(selectedMeta.labelKey)}
          value={selectedValue}
          min={selectedMeta.min}
          max={selectedMeta.max}
          neutral={selectedMeta.neutral}
          onChange={(value) => dispatch({ type: 'setAdjustment', key: selectedKey, value })}
          onSlidingStart={startCheckpoint}
          onScrim
        />
      </View>

      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.md,
          marginTop: theme.spacing.xs,
        }}>
        <Pressable
          onPress={resetSelected}
          accessibilityRole="button"
          disabled={selectedIsNeutral}
          style={[
            styles.textAction,
            { paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.sm },
          ]}>
          <Text
            style={{
              color: selectedIsNeutral ? panel.textMuted : panel.text,
              fontSize: 13,
              fontWeight: '500',
            }}>
            {t('reset')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => dispatch({ type: 'resetAdjustments' })}
          accessibilityRole="button"
          style={[
            styles.resetAll,
            {
              borderColor: panel.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            },
          ]}>
          <Text style={{ color: panel.textMuted, fontSize: 12 }}>{t('resetAll')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    position: 'relative',
  },
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  textAction: {},
  resetAll: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
