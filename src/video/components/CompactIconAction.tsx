import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette } from '../../core/theming/theme';

export interface CompactIconActionProps {
  iconName: EditorIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  emphasized?: boolean;
  /** Chip sits on the dark `overlay` scrim (dark in both schemes) — pin white. Otherwise the scheme-aware panel palette applies. */
  onScrim?: boolean;
}

/** Compact icon-only action chip; hitSlop keeps the ≥44pt touch target. */
export function CompactIconAction({
  iconName,
  label,
  onPress,
  disabled,
  emphasized,
  onScrim,
}: CompactIconActionProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const bg = emphasized
    ? theme.colors.accent
    : onScrim
      ? 'rgba(255,255,255,0.16)'
      : panel.chipBgActive;
  const fg = emphasized ? theme.colors.onAccent : onScrim ? '#FFFFFF' : panel.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: bg,
          borderRadius: 999,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      <EditorIcon name={iconName} size={18} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
