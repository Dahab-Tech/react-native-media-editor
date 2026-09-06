import { Skia, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'react-native';

import type { PhotoCustomFont } from './fonts';

/** Skia typeface provider for consumer custom fonts. Returns null while loading; render falls back to system fonts. */
export function useCustomFontProvider(
  customFonts?: readonly PhotoCustomFont[]
): SkTypefaceFontProvider | null {
  const [provider, setProvider] = useState<SkTypefaceFontProvider | null>(null);

  // Fingerprint so the loader only re-runs when the font list actually changes.
  const fingerprint = useMemo(() => {
    if (!customFonts || customFonts.length === 0) return '';
    return customFonts.map((f) => `${f.id}|${f.family}`).join('||');
  }, [customFonts]);

  // Provider swap is async; old provider stays live until the new one loads (fallback path still renders).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!customFonts || fingerprint === '') {
        if (!cancelled) setProvider(null);
        return;
      }
      const entries: { family: string; data: Awaited<ReturnType<typeof Skia.Data.fromURI>> }[] = [];
      for (const font of customFonts) {
        const source = font.source;
        if (source == null) continue;
        try {
          const data = await loadFontData(source);
          if (data) entries.push({ family: font.family, data });
        } catch {
          // Per-font failure falls back to the system family.
        }
      }
      if (cancelled) return;
      const nextProvider = Skia.TypefaceFontProvider.Make();
      for (const { family, data } of entries) {
        const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data);
        if (tf) nextProvider.registerFont(tf, family);
      }
      setProvider(nextProvider);
    };
    load().catch(() => {
      // Non-fatal; per-font errors are already caught above.
    });
    return () => {
      cancelled = true;
    };
  }, [customFonts, fingerprint]);

  return provider;
}

/** Normalizes every DataSourceParam variant (URI, asset id, ESModule default, bytes) to SkData. */
async function loadFontData(source: NonNullable<PhotoCustomFont['source']>) {
  if (source instanceof Uint8Array) {
    return Skia.Data.fromBytes(source);
  }
  if (typeof source === 'string') {
    return Skia.Data.fromURI(source);
  }
  if (typeof source === 'number') {
    const resolved = Image.resolveAssetSource(source);
    if (!resolved?.uri) return null;
    return Skia.Data.fromURI(resolved.uri);
  }
  if (typeof source === 'object' && source != null) {
    if ('uri' in source && typeof source.uri === 'string') {
      return Skia.Data.fromURI(source.uri);
    }
    if ('__esModule' in source && typeof source.default === 'string') {
      return Skia.Data.fromURI(source.default);
    }
  }
  return null;
}
