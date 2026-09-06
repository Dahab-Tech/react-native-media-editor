import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

import { resolveDirection, type EditorDirection, type EditorDirectionProp } from './direction';
import { builtInStrings, en, type MediaEditorStrings } from './strings';

export interface EditorI18n {
  t: (key: keyof MediaEditorStrings) => string;
  locale: string;
  direction: EditorDirection;
  isRTL: boolean;
}

export interface EditorI18nProviderProps {
  /** BCP-47 language tag, e.g. "en", "ar" or "ar-EG". Defaults to "en". */
  locale?: string;
  /** Layout direction. "auto" resolves from locale, falling back to the device setting. */
  direction?: EditorDirectionProp;
  /** Per-key overrides, or full custom translations for unsupported locales. */
  strings?: Partial<MediaEditorStrings>;
  children: ReactNode;
}

const defaultI18n: EditorI18n = {
  t: (key) => en[key],
  locale: 'en',
  direction: 'ltr',
  isRTL: false,
};

const I18nContext = createContext<EditorI18n>(defaultI18n);

export function EditorI18nProvider({
  locale,
  direction = 'auto',
  strings,
  children,
}: EditorI18nProviderProps) {
  const value = useMemo<EditorI18n>(() => {
    const language = (locale ?? 'en').split('-')[0].toLowerCase();
    const table: MediaEditorStrings = { ...(builtInStrings[language] ?? en), ...strings };
    const resolved = resolveDirection(direction, locale);
    return {
      t: (key) => table[key],
      locale: locale ?? 'en',
      direction: resolved,
      isRTL: resolved === 'rtl',
    };
  }, [locale, direction, strings]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useEditorI18n(): EditorI18n {
  return useContext(I18nContext);
}
