import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../i18n/I18nContext';
import { EditorIcon } from '../icons/IconContext';
import { useEditorTheme } from '../theming/ThemeContext';

export interface EditorHeaderProps {
  /** Title text. Empty string renders no title element, preserving cluster positions. */
  title: string;
  onCancel?: () => void;
  /** Defaults to the localized "Done" label. */
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  /** Optional undo/redo cluster rendered next to Cancel. */
  history?: EditorHeaderHistoryProps;
}

export interface EditorHeaderHistoryProps {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const HIT_TARGET = 44;
const BAR_MIN_HEIGHT = 44;

export function EditorHeader({
  title,
  onCancel,
  actionLabel,
  onAction,
  actionDisabled = false,
  history,
}: EditorHeaderProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const label = actionLabel ?? t('done');
  const cancelLabel = t('cancel');
  const actionEnabled = !actionDisabled && !!onAction;

  return (
    <View
      style={[
        styles.container,
        {
          flexDirection: isRTL ? 'row-reverse' : 'row',
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 0,
        },
      ]}>
      <View style={[styles.leadingCluster, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Pressable
          onPress={onCancel}
          disabled={!onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => [
            styles.iconButton,
            {
              opacity: onCancel ? (pressed ? 0.6 : 1) : 0.4,
            },
          ]}>
          <EditorIcon name="close" size={24} color={theme.colors.text} />
        </Pressable>
        {history ? (
          <HistoryCluster history={history} isRTL={isRTL} textColor={theme.colors.text} />
        ) : null}
      </View>
      {title === '' ? (
        <View style={styles.titleSpacer} />
      ) : (
        <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>
          {title}
        </Text>
      )}
      <Pressable
        onPress={onAction}
        disabled={!actionEnabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.actionPill,
          {
            backgroundColor: actionEnabled ? theme.colors.accent : theme.colors.border,
            borderRadius: 999,
            paddingHorizontal: theme.spacing.md,
            opacity: pressed && actionEnabled ? 0.85 : 1,
          },
        ]}>
        <Text
          style={[
            styles.actionLabel,
            { color: actionEnabled ? theme.colors.onAccent : theme.colors.textMuted },
          ]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

/** Undo/redo pair grouped with Cancel; glyphs mirror horizontally under RTL. */
function HistoryCluster({
  history,
  isRTL,
  textColor,
}: {
  history: EditorHeaderHistoryProps;
  isRTL: boolean;
  textColor: string;
}) {
  const { t } = useEditorI18n();
  const mirror = isRTL ? [{ scaleX: -1 as const }] : undefined;
  return (
    <>
      <Pressable
        onPress={history.onUndo}
        disabled={!history.canUndo}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('undo')}
        style={({ pressed }) => [
          styles.iconButton,
          { opacity: history.canUndo ? (pressed ? 0.6 : 1) : 0.4 },
        ]}>
        <View style={mirror ? { transform: mirror } : undefined}>
          <EditorIcon name="undo" size={22} color={textColor} />
        </View>
      </Pressable>
      <Pressable
        onPress={history.onRedo}
        disabled={!history.canRedo}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('redo')}
        style={({ pressed }) => [
          styles.iconButton,
          { opacity: history.canRedo ? (pressed ? 0.6 : 1) : 0.4 },
        ]}>
        <View style={mirror ? { transform: mirror } : undefined}>
          <EditorIcon name="redo" size={22} color={textColor} />
        </View>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: BAR_MIN_HEIGHT,
  },
  leadingCluster: {
    alignItems: 'center',
  },
  iconButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  titleSpacer: {
    flex: 1,
  },
  actionPill: {
    height: 34,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
