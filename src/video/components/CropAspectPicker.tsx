import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { type AspectRatio } from '../../photo/state/photoEditorState';

export interface CropAspectPickerProps {
  /** Ordered, deduped list of presets. Empty array renders nothing. */
  options: readonly AspectRatio[];
  /** Currently-selected preset. */
  value: AspectRatio;
  onChange: (aspect: AspectRatio) => void;
}

// On-scrim palette (dark video canvas).
const SCRIM_TEXT = '#FFFFFF';
const SCRIM_BORDER = 'rgba(255,255,255,0.35)';

const RATIO_LABELS: Partial<Record<AspectRatio, string>> = {
  '1:1': '1:1',
  '4:3': '4:3',
  '16:9': '16:9',
  '9:16': '9:16',
};

/** Horizontal pill row of crop aspect presets. */
export function CropAspectPicker({ options, value, onChange }: CropAspectPickerProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const [setScrollRef, onContentSizeChange] = useRtlHorizontalScrollLanding();

  if (options.length === 0) return null;

  const labelFor = (aspect: AspectRatio): string => {
    if (aspect === 'free') return t('free');
    if (aspect === 'original') return t('original');
    return RATIO_LABELS[aspect] ?? aspect;
  };

  return (
    <ScrollView
      ref={setScrollRef}
      onContentSizeChange={onContentSizeChange}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        flexDirection: isRTL ? 'row-reverse' : 'row',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        gap: theme.spacing.xs,
      }}>
      {options.map((aspect) => {
        const active = value === aspect;
        return (
          <Pressable
            key={aspect}
            onPress={() => onChange(aspect)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={6}
            style={[
              styles.chip,
              {
                borderColor: active ? theme.colors.accent : SCRIM_BORDER,
                backgroundColor: active ? theme.colors.accent : 'transparent',
                borderRadius: 999,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
              },
            ]}>
            <Text
              style={{
                color: active ? theme.colors.onAccent : SCRIM_TEXT,
                fontWeight: '600',
                fontSize: 13,
                fontVariant: ['tabular-nums'],
              }}>
              {labelFor(aspect)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
