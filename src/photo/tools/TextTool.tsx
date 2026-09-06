import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';

export interface TextToolProps {
  /** Opens the full-screen TextFocusEditor with a new draft. */
  onAddText: () => void;
}

const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.65)';

const PILL_HEIGHT = 34;
const PILL_RADIUS = 999;
const PILL_PADDING_H = 16;

const ACCENT_TINT_ALPHA = 0.18;

/** Slim drawer: one "+ Add text" pill + hint. All editing lives in TextFocusEditor. */
export function TextTool({ onAddText }: TextToolProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();

  return (
    <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          alignItems: 'center',
        }}>
        <Pressable
          onPress={onAddText}
          accessibilityRole="button"
          accessibilityLabel={t('addText')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.pill,
            styles.pillSecondary,
            {
              flexDirection: isRTL ? 'row-reverse' : 'row',
              backgroundColor: withAlpha(theme.colors.accent, ACCENT_TINT_ALPHA),
              borderColor: theme.colors.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <EditorIcon name="add" size={16} color={theme.colors.accent} />
          <Text style={[styles.pillLabel, { color: theme.colors.accent }]}>{t('addText')}</Text>
        </Pressable>
      </View>
      <Text
        style={{
          color: SCRIM_TEXT_MUTED,
          fontSize: 12,
          textAlign: isRTL ? 'right' : 'left',
        }}>
        {t('textFocusHint')}
      </Text>
    </View>
  );
}

// Alpha-tints an opaque hex; falls through untouched for rgba/named colors.
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
    const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  pill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    paddingHorizontal: PILL_PADDING_H,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  pillSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
