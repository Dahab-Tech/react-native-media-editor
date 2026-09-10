import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette } from '../../core/theming/theme';
import { Slider } from '../components/Slider';
import type { FocusMode } from '../focus';
import { type PhotoEditorController } from '../state/photoEditorState';

const CHIP_HEIGHT = 30;
const CHIP_MIN_WIDTH = 64;
const CHIP_HIT_SLOP = 8;

const MODES: { id: FocusMode; labelKey: keyof MediaEditorStrings }[] = [
  { id: 'off', labelKey: 'focusOff' },
  { id: 'radial', labelKey: 'focusRadial' },
  { id: 'linear', labelKey: 'focusLinear' },
];

export interface FocusToolProps {
  controller: PhotoEditorController;
}

export function FocusTool({ controller }: FocusToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const focus = state.focus;
  const [setModeRowRef, onModeRowContentSizeChange] = useRtlHorizontalScrollLanding();

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
      <ScrollView
        ref={setModeRowRef}
        onContentSizeChange={onModeRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.xs,
          flexGrow: 1,
        }}>
        {MODES.map((mode) => {
          const active = mode.id === focus.mode;
          return (
            <Pressable
              key={mode.id}
              onPress={() => dispatch({ type: 'setFocusMode', mode: mode.id })}
              accessibilityRole="button"
              accessibilityLabel={t(mode.labelKey)}
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
                {t(mode.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {focus.mode !== 'off' ? (
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          <Slider
            label={t('focusIntensity')}
            value={focus.intensity}
            min={0}
            max={1}
            neutral={0}
            formatValue={(v) => `${Math.round(v * 100)}`}
            onSlidingStart={() => dispatch({ type: 'checkpoint' })}
            onChange={(value) =>
              dispatch({ type: 'setFocus', focus: { ...focus, intensity: value } })
            }
            onScrim
          />
        </View>
      ) : (
        <Text
          style={{
            color: panel.textMuted,
            fontSize: 12,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            textAlign: isRTL ? 'right' : 'left',
          }}>
          {t('focusHint')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
});
