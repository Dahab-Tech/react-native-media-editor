import React, { useContext, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from 'react-native-safe-area-context';

import { useEditorI18n } from '../i18n/I18nContext';
import { useEditorIconFontsReady } from '../icons/IconContext';
import { useEditorTheme } from '../theming/ThemeContext';

/** Shared mount shell owning first-frame polish: no white flash (sync insets + themed bg) and no icon pop-in (font preload gate). */
export function EditorShell({ children }: { children: ReactNode }) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const iconFontsReady = useEditorIconFontsReady();
  // Reuse the outer provider when present: a nested one re-measures async (initialWindowMetrics null on Fabric) and reports zero insets on first frame.
  const hasOuterProvider = useContext(SafeAreaInsetsContext) != null;
  const content = iconFontsReady ? (
    children
  ) : (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing.sm }}>
        {t('loading')}
      </Text>
    </View>
  );
  const fillStyle = [styles.fill, { backgroundColor: theme.colors.background }];
  if (hasOuterProvider) {
    return <View style={fillStyle}>{content}</View>;
  }
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={fillStyle}>
      {content}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
