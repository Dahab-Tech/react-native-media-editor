import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
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
}

const SCRIM_TEXT = '#FFFFFF';
const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.6)';
const SCRIM_CHIP_BG = 'rgba(255,255,255,0.08)';
const SCRIM_CHIP_BG_ACTIVE = 'rgba(255,255,255,0.16)';
const SCRIM_BORDER = 'rgba(255,255,255,0.35)';

// 30pt visible; 8pt hitSlop meets the 44pt touch minimum.
const CHIP_HEIGHT = 30;
const CHIP_MIN_WIDTH = 64;
const CHIP_HIT_SLOP = 8;

export function AdjustTool({ controller }: AdjustToolProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setChipRowRef, onChipRowContentSizeChange] = useRtlHorizontalScrollLanding();

  // Default to first non-neutral key so returning to the tool jumps to the last-touched slider.
  const initialSelected = (): PhotoAdjustmentKey => {
    for (const meta of ADJUSTMENT_META) {
      if (!isNeutral(meta.key, state.adjustments[meta.key])) return meta.key;
    }
    return 'exposure';
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
        {ADJUSTMENT_META.map((meta) => {
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
                {t(meta.labelKey)}
              </Text>
              {nonNeutral && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.dot,
                    {
                      backgroundColor: active ? theme.colors.accent : SCRIM_TEXT,
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
              color: selectedIsNeutral ? SCRIM_TEXT_MUTED : SCRIM_TEXT,
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
              borderColor: SCRIM_BORDER,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            },
          ]}>
          <Text style={{ color: SCRIM_TEXT_MUTED, fontSize: 12 }}>{t('resetAll')}</Text>
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
