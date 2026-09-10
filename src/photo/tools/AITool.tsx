import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette, isPanelDark, type MediaEditorTheme } from '../../core/theming/theme';
import type { BackgroundRemovalEngine } from '../ai/types';

export interface AIToolProps {
  engine: BackgroundRemovalEngine;
  /** Original source URI; both ops always call the engine with this (never the override). */
  sourceUri: string;
  hasBackgroundRemoved: boolean;
  onSetBackgroundRemoved: (uri: string | null) => void;
  onAddCutoutSticker: (uri: string, aspectRatio: number) => void;
}

/** AI action rows with a shared in-flight flag so ops serialize. */
export function AITool({
  engine,
  sourceUri,
  hasBackgroundRemoved,
  onSetBackgroundRemoved,
  onAddCutoutSticker,
}: AIToolProps) {
  const theme = useEditorTheme();
  const panelDark = isPanelDark(theme);
  const textMuted = panelDark ? 'rgba(255,255,255,0.75)' : theme.colors.textMuted;
  // Fixed bright red on dark panels so errors read over the scrim; light panels use the theme's danger color.
  const errorColor = panelDark ? '#FF6B6B' : theme.colors.danger;
  const { t, isRTL } = useEditorI18n();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<'aiNoSubject' | 'aiError' | null>(null);

  const handleRemoveBackground = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await engine.removeBackground(sourceUri, { crop: 'none' });
      onSetBackgroundRemoved(result.uri);
    } catch (error) {
      setErrorKey(mapErrorToKey(error));
    } finally {
      setBusy(false);
    }
  }, [busy, engine, sourceUri, onSetBackgroundRemoved]);

  const handleCutout = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await engine.removeBackground(sourceUri, { crop: 'subject' });
      // Guard against 0-dim results so the layer path doesn't hit NaN aspect.
      if (result.width <= 0 || result.height <= 0) {
        setErrorKey('aiError');
        return;
      }
      onAddCutoutSticker(result.uri, result.width / result.height);
    } catch (error) {
      setErrorKey(mapErrorToKey(error));
    } finally {
      setBusy(false);
    }
  }, [busy, engine, sourceUri, onAddCutoutSticker]);

  const handleRestore = useCallback(() => {
    if (busy) return;
    setErrorKey(null);
    onSetBackgroundRemoved(null);
  }, [busy, onSetBackgroundRemoved]);

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
      <ActionRow
        icon="ai"
        label={t('removeBackground')}
        onPress={handleRemoveBackground}
        disabled={busy}
        isRTL={isRTL}
      />
      <ActionRow
        icon="stickers"
        label={t('cutoutSubject')}
        onPress={handleCutout}
        disabled={busy}
        isRTL={isRTL}
      />
      {hasBackgroundRemoved ? (
        <ActionRow
          icon="reset"
          label={t('restoreBackground')}
          onPress={handleRestore}
          disabled={busy}
          isRTL={isRTL}
        />
      ) : null}

      {busy ? (
        <View
          style={[
            styles.statusRow,
            {
              flexDirection: isRTL ? 'row-reverse' : 'row',
              paddingHorizontal: theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ]}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={{ color: textMuted, fontSize: 12 }}>{t('aiProcessing')}</Text>
        </View>
      ) : errorKey ? (
        <Text
          style={{
            color: errorColor,
            fontSize: 12,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            textAlign: isRTL ? 'right' : 'left',
          }}>
          {t(errorKey)}
        </Text>
      ) : null}
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  disabled,
  isRTL,
}: {
  icon: EditorIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  isRTL: boolean;
}) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const { rowBg, rowBgDisabled } = rowBackgrounds(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled ?? false }}
      disabled={disabled}
      style={[
        styles.row,
        {
          marginHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          flexDirection: isRTL ? 'row-reverse' : 'row',
          gap: theme.spacing.sm,
          backgroundColor: disabled ? rowBgDisabled : rowBg,
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <EditorIcon name={icon} size={20} color={panel.text} />
      <Text
        numberOfLines={1}
        style={{
          color: panel.text,
          fontSize: 14,
          fontWeight: '600',
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

// AI rows use lighter fills than the standard chip tokens (0.06/0.03 vs 0.08/0.16).
function rowBackgrounds(theme: MediaEditorTheme): { rowBg: string; rowBgDisabled: string } {
  if (isPanelDark(theme)) {
    return { rowBg: 'rgba(255,255,255,0.06)', rowBgDisabled: 'rgba(255,255,255,0.03)' };
  }
  return { rowBg: 'rgba(0,0,0,0.04)', rowBgDisabled: 'rgba(0,0,0,0.02)' };
}

function mapErrorToKey(error: unknown): 'aiNoSubject' | 'aiError' {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ERR_NO_SUBJECT') return 'aiNoSubject';
  }
  return 'aiError';
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: 44,
  },
  statusRow: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 6,
  },
});
