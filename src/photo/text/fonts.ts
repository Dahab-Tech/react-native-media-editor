import type { DataSourceParam } from '@shopify/react-native-skia';
import { Platform } from 'react-native';

/** Font roster: built-in ids resolve to platform families; consumers extend via `customFonts`. */

export type BuiltInFontId = 'system' | 'serif' | 'mono' | 'condensed';

export interface PhotoFontDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Same family name for RN and Skia so preview and export shape identically. */
  readonly family: string;
}

/** Consumer must load `family` into RN separately (e.g. expo-font); editor loads Skia typeface from `source`. */
export interface PhotoCustomFont {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
  readonly source: DataSourceParam;
}

export const FALLBACK_FONT_FAMILY: string = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

export const BUILT_IN_FONTS: readonly PhotoFontDefinition[] = [
  {
    id: 'system',
    displayName: 'System',
    family: Platform.select({
      ios: 'System',
      android: 'sans-serif',
      default: 'System',
    }) as string,
  },
  {
    id: 'serif',
    displayName: 'Serif',
    family: Platform.select({
      ios: 'Georgia',
      android: 'serif',
      default: 'Georgia',
    }) as string,
  },
  {
    id: 'mono',
    displayName: 'Mono',
    family: Platform.select({
      ios: 'Courier New',
      android: 'monospace',
      default: 'Courier New',
    }) as string,
  },
  {
    id: 'condensed',
    displayName: 'Condensed',
    family: Platform.select({
      // Medium (not Bold) so bold/italic toggles compose cleanly.
      ios: 'AvenirNextCondensed-Medium',
      android: 'sans-serif-condensed',
      default: 'AvenirNextCondensed-Medium',
    }) as string,
  },
];

export const DEFAULT_FONT_ID: BuiltInFontId = 'system';

/** Consumer fonts shadow built-ins on id collision. Unknown ids fall back to the platform default. */
export function resolveFontFamily(
  fontId: string,
  customFonts?: readonly PhotoCustomFont[]
): string {
  if (customFonts) {
    for (const font of customFonts) {
      if (font.id === fontId) return font.family;
    }
  }
  for (const font of BUILT_IN_FONTS) {
    if (font.id === fontId) return font.family;
  }
  return FALLBACK_FONT_FAMILY;
}

/** Array form for Skia; appends the platform default so glyph misses still land on a real font. */
export function resolveFontFamilies(
  fontId: string,
  customFonts?: readonly PhotoCustomFont[]
): string[] {
  const primary = resolveFontFamily(fontId, customFonts);
  if (primary === FALLBACK_FONT_FAMILY) return [primary];
  return [primary, FALLBACK_FONT_FAMILY];
}
