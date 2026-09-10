import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette } from '../../core/theming/theme';
import { Slider } from '../../photo/components/Slider';
import {
  VIDEO_SPEED_DEFAULT,
  VIDEO_SPEED_MAX,
  VIDEO_SPEED_MIN,
  VIDEO_SPEED_PRESETS,
  type VideoEditorController,
} from '../state/videoEditorState';

export interface SpeedToolProps {
  controller: VideoEditorController;
}

const CHIP_HEIGHT = 32;
const CHIP_MIN_WIDTH = 56;
const CHIP_HIT_SLOP = 8;

/** Playback-speed panel — preset chip row above a fine-grain slider. */
export function SpeedTool({ controller }: SpeedToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setChipRowRef, onChipRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const speed = state.speed;

  const isDefault = Math.abs(speed - VIDEO_SPEED_DEFAULT) < 1e-4;

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
        {VIDEO_SPEED_PRESETS.map((preset) => {
          // Float compare — strict === would flicker the highlight during fine slider drags.
          const active = Math.abs(preset - speed) < 1e-4;
          return (
            <Pressable
              key={preset}
              onPress={() => dispatch({ type: 'setSpeed', value: preset })}
              accessibilityRole="button"
              accessibilityLabel={formatSpeedLabel(preset)}
              accessibilityState={{ selected: active }}
              hitSlop={CHIP_HIT_SLOP}
              style={[
                styles.chip,
                {
                  minWidth: CHIP_MIN_WIDTH,
                  height: CHIP_HEIGHT,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.sm,
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
                {formatSpeedLabel(preset)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.md }}>
        <Slider
          label={t('speedFine')}
          value={speed}
          min={VIDEO_SPEED_MIN}
          max={VIDEO_SPEED_MAX}
          neutral={VIDEO_SPEED_DEFAULT}
          onChange={(value) => dispatch({ type: 'setSpeed', value })}
          onSlidingStart={() => dispatch({ type: 'checkpoint' })}
          formatValue={formatSpeedLabel}
          onScrim
        />
      </View>

      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: theme.spacing.md,
          marginTop: theme.spacing.xs,
        }}>
        <Pressable
          onPress={() => dispatch({ type: 'setSpeed', value: VIDEO_SPEED_DEFAULT })}
          accessibilityRole="button"
          disabled={isDefault}
          style={[
            styles.resetAll,
            {
              borderColor: panel.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
              opacity: isDefault ? 0.5 : 1,
            },
          ]}>
          <Text style={{ color: panel.textMuted, fontSize: 12 }}>{t('reset')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Format a speed multiplier ("1×", "1.5×"). U+00D7 avoids BIDI issues in Arabic. */
function formatSpeedLabel(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-4) {
    return `${Math.round(value)}×`;
  }
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded)}×`;
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  resetAll: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
