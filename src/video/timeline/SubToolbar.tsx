import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';

export interface SubToolbarAction {
  key: string;
  icon: EditorIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface SubToolbarProps {
  actions: readonly SubToolbarAction[];
  onBack: () => void;
}

/** Context toolbar for the selected clip/overlay: back chevron + action chips, CapCut-style. */
export function SubToolbar({ actions, onBack }: SubToolbarProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();

  return (
    <View
      style={[
        styles.row,
        {
          flexDirection: isRTL ? 'row-reverse' : 'row',
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      ]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t('back')}
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}>
        {/* Chevron points back — mirrored container flips it for RTL. */}
        <View style={{ transform: [{ scaleX: isRTL ? 1 : -1 }] }}>
          <EditorIcon name="chevronForward" size={22} color={theme.colors.text} />
        </View>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.actions,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            paddingHorizontal: theme.spacing.sm,
          },
        ]}>
        {actions.map((action) => {
          const tint = action.destructive ? theme.colors.danger : theme.colors.textMuted;
          return (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={8}
              style={({ pressed }) => [
                styles.action,
                {
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1,
                },
              ]}>
              <EditorIcon name={action.icon} size={20} color={tint} />
              <Text numberOfLines={1} style={[styles.actionLabel, { color: tint }]}>
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
  },
  actions: {
    alignItems: 'center',
    justifyContent: 'space-around',
    flexGrow: 1,
  },
  action: {
    minHeight: 44,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
