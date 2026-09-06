import React, { type ReactNode } from 'react';

import { EditorI18nProvider, type EditorI18nProviderProps } from './i18n/I18nContext';
import { EditorIconProvider, type EditorIconsOverride } from './icons/IconContext';
import { EditorThemeProvider } from './theming/ThemeContext';
import { type MediaEditorColorScheme, type MediaEditorThemeOverride } from './theming/theme';

/** Shared configuration accepted by every editor screen. */
export interface MediaEditorConfigProps extends Omit<EditorI18nProviderProps, 'children'> {
  theme?: MediaEditorThemeOverride;
  /** Base palette selector. Defaults to `'dark'`; `'auto'` follows the device. */
  colorScheme?: MediaEditorColorScheme;
  /** Replace built-in icons with custom renderers. */
  icons?: EditorIconsOverride;
}

export interface MediaEditorProviderProps extends MediaEditorConfigProps {
  children: ReactNode;
}

export function MediaEditorProvider({
  theme,
  colorScheme,
  icons,
  locale,
  direction,
  strings,
  children,
}: MediaEditorProviderProps) {
  return (
    <EditorThemeProvider theme={theme} colorScheme={colorScheme}>
      <EditorIconProvider icons={icons}>
        <EditorI18nProvider locale={locale} direction={direction} strings={strings}>
          {children}
        </EditorI18nProvider>
      </EditorIconProvider>
    </EditorThemeProvider>
  );
}
