import { I18nManager } from 'react-native';

export type EditorDirection = 'ltr' | 'rtl';
export type EditorDirectionProp = EditorDirection | 'auto';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv']);

export function isRtlLocale(locale: string): boolean {
  const language = locale.split('-')[0].toLowerCase();
  return RTL_LANGUAGES.has(language);
}

/** Resolves layout direction: explicit prop > locale script > device I18nManager. */
export function resolveDirection(
  direction: EditorDirectionProp | undefined,
  locale: string | undefined
): EditorDirection {
  if (direction && direction !== 'auto') {
    return direction;
  }
  if (locale) {
    return isRtlLocale(locale) ? 'rtl' : 'ltr';
  }
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}
