import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import type { BackgroundRemovalEngine } from '../ai/types';

const SCRIM_TEXT = '#FFFFFF';
const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.75)';
const SCRIM_ROW_BG = 'rgba(255,255,255,0.06)';
const SCRIM_ROW_BG_DISABLED = 'rgba(255,255,255,0.03)';
const SCRIM_ERROR = '#FF6B6B';

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
          <Text style={{ color: SCRIM_TEXT_MUTED, fontSize: 12 }}>{t('aiProcessing')}</Text>
        </View>
      ) : errorKey ? (
        <Text
          style={{
            color: SCRIM_ERROR,
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
          backgroundColor: disabled ? SCRIM_ROW_BG_DISABLED : SCRIM_ROW_BG,
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <EditorIcon name={icon} size={20} color={SCRIM_TEXT} />
      <Text
        numberOfLines={1}
        style={{
          color: SCRIM_TEXT,
          fontSize: 14,
          fontWeight: '600',
        }}>
        {label}
      </Text>
    </Pressable>
  );
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
