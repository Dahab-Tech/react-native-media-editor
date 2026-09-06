/** Text layout constants; expressed as size-relative fractions so preview and export match at any scale. */

/** Wrap width as a fraction of the display / output rect. Both sides feed this to `breakTextIntoLines`. */
export const TEXT_MAX_WIDTH_FRACTION = 0.8;

/** Pill horizontal padding as a fraction of font size. */
export const TEXT_PILL_PADDING_RATIO = 0.35;

/** Pill corner radius as a fraction of font size. */
export const TEXT_PILL_RADIUS_RATIO = 0.25;

/** Pill vertical padding. Invariant: >= TEXT_PILL_RADIUS_RATIO so line-seam corner arcs are hidden inside the overlap. */
export const TEXT_PILL_VERTICAL_PADDING_RATIO = 0.25;

/** Rec. 601 luma-based auto-contrast; returns white for non-hex input. */
export function contrastTextColor(background: string): '#000000' | '#FFFFFF' {
  const rgb = parseHex(background);
  if (!rgb) return '#FFFFFF';
  const [r, g, b] = rgb;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#000000' : '#FFFFFF';
}

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  if (value.length === 3) {
    const r = parseInt(value[0] + value[0], 16);
    const g = parseInt(value[1] + value[1], 16);
    const b = parseInt(value[2] + value[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  if (value.length === 6) {
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}
