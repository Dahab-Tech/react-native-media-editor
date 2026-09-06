import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import {
  darkTheme,
  lightTheme,
  mergeTheme,
  type MediaEditorColorScheme,
  type MediaEditorTheme,
  type MediaEditorThemeOverride,
} from './theme';

const ThemeContext = createContext<MediaEditorTheme>(darkTheme);

export interface EditorThemeProviderProps {
  /** Deep-partial override merged on top of the resolved base theme. */
  theme?: MediaEditorThemeOverride;
  /** Base palette selector. Defaults to `'dark'`; `'auto'` follows the device. */
  colorScheme?: MediaEditorColorScheme;
  children: ReactNode;
}

export function EditorThemeProvider({
  theme,
  colorScheme = 'dark',
  children,
}: EditorThemeProviderProps) {
  const systemScheme = useColorScheme();
  const value = useMemo(() => {
    const base =
      colorScheme === 'light'
        ? lightTheme
        : colorScheme === 'dark'
          ? darkTheme
          : systemScheme === 'light'
            ? lightTheme
            : darkTheme;
    return mergeTheme(base, theme);
  }, [colorScheme, systemScheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useEditorTheme(): MediaEditorTheme {
  return useContext(ThemeContext);
}
