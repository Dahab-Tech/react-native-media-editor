import React, { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { useEditorI18n } from '../i18n/I18nContext';
import { useEditorIconFontsReady } from '../icons/IconContext';
import { useEditorTheme } from '../theming/ThemeContext';

/** Shared mount shell owning first-frame polish: no white flash (sync insets + themed bg) and no icon pop-in (font preload gate). */
export function EditorShell({ children }: { children: ReactNode }) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const iconFontsReady = useEditorIconFontsReady();
  return (
    <SafeAreaProvider
      initialMetrics={initialWindowMetrics}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {iconFontsReady ? (
        children
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing.sm }}>
            {t('loading')}
          </Text>
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
