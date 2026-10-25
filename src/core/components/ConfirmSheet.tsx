import React from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { useEditorTheme } from '../theming/ThemeContext';

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirm button in the danger color (discard flows). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Themed confirmation dialog — replaces OS alerts so it follows the editor's theme and locale. */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const theme = useEditorTheme();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable
        style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.panelSurface,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.lg,
            },
          ]}
          onPress={() => {}}
          accessibilityViewIsModal>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
          <Text
            style={[
              styles.body,
              { color: theme.colors.textMuted, marginBottom: theme.spacing.lg },
            ]}>
            {body}
          </Text>
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.confirmButton,
              {
                backgroundColor: destructive ? theme.colors.danger : theme.colors.accent,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={[styles.confirmLabel, { color: theme.colors.onAccent }]}>
              {confirmLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancelButton, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.cancelLabel, { color: theme.colors.textMuted }]}>
              {cancelLabel}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    alignSelf: 'stretch',
    maxWidth: 420,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  confirmLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 4,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
