import {
  FontSlant,
  FontWeight,
  Skia,
  TextAlign,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

import type { TextAlign as PhotoTextAlign } from '../layers';
import { resolveFontFamilies, type PhotoCustomFont } from './fonts';

export interface BreakLinesInput {
  text: string;
  fontId: string;
  bold: boolean;
  italic: boolean;
  align: PhotoTextAlign;
  /** In caller pixels; caller has already subtracted pill padding. */
  wrapWidthPx: number;
  fontSizePx: number;
  customFonts?: readonly PhotoCustomFont[];
  /** MUST be the same provider PhotoRender uses; different provider → different typeface → different breaks. */
  customFontTypefaces: SkTypefaceFontProvider | null;
}

// Reference size for the scale-invariant layout; the shaper sees the same em-space rectangle on both sides.
const REFERENCE_FONT_SIZE_PX = 100;

/** Pre-breaks text into hard lines so RN + Skia never disagree on wrap points.
 *  Lays out at REFERENCE_FONT_SIZE_PX scaled by wrapWidthPx/fontSizePx so preview and export shape identically. */
export function breakTextIntoLines(input: BreakLinesInput): string {
  const {
    text,
    fontId,
    bold,
    italic,
    align,
    wrapWidthPx,
    fontSizePx,
    customFonts,
    customFontTypefaces,
  } = input;

  if (text.length === 0) return text;
  if (fontSizePx <= 0 || wrapWidthPx <= 0) return text;

  const emWrapWidth = (wrapWidthPx * REFERENCE_FONT_SIZE_PX) / fontSizePx;

  const alignEnum =
    align === 'left' ? TextAlign.Left : align === 'right' ? TextAlign.Right : TextAlign.Center;

  const familyList = resolveFontFamilies(fontId, customFonts);
  const paragraphStyle = {
    textAlign: alignEnum,
    textStyle: {
      color: Skia.Color('white'),
      fontSize: REFERENCE_FONT_SIZE_PX,
      fontFamilies: familyList,
      fontStyle: {
        weight: bold ? FontWeight.Bold : FontWeight.Normal,
        slant: italic ? FontSlant.Italic : FontSlant.Upright,
      },
    },
  };

  // Undefined provider trips a native-bridge "expected an Object" error; omit the arg entirely instead.
  const builder = customFontTypefaces
    ? Skia.ParagraphBuilder.Make(paragraphStyle, customFontTypefaces)
    : Skia.ParagraphBuilder.Make(paragraphStyle);
  builder.addText(text);
  const paragraph = builder.build();
  paragraph.layout(emWrapWidth);

  const metrics = paragraph.getLineMetrics();
  if (metrics.length === 0) return text;
  if (metrics.length === 1) return text;

  // endExcludingWhitespaces drops trailing spaces on soft breaks and \n on hard breaks;
  // the join reintroduces exactly one \n per boundary.
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(text.slice(m.startIndex, m.endExcludingWhitespaces));
  }
  return lines.join('\n');
}
