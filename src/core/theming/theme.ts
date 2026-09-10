export interface MediaEditorColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  border: string;
  /** Scrim color used behind floating bars and busy overlays that sit over image/video content. Dark in both schemes so it always reads over arbitrary media. */
  overlay: string;
  /** Near-opaque background (~0.96 alpha) for sliding tool drawers over the canvas. Follows the color scheme. */
  panelSurface: string;
}

export interface MediaEditorSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
}

export interface MediaEditorRadius {
  sm: number;
  md: number;
  lg: number;
}

export interface MediaEditorTheme {
  colors: MediaEditorColors;
  spacing: MediaEditorSpacing;
  radius: MediaEditorRadius;
}

export interface MediaEditorThemeOverride {
  colors?: Partial<MediaEditorColors>;
  spacing?: Partial<MediaEditorSpacing>;
  radius?: Partial<MediaEditorRadius>;
}

/** Follows platform / device appearance. `'auto'` resolves via `useColorScheme()`. */
export type MediaEditorColorScheme = 'light' | 'dark' | 'auto';

export const darkTheme: MediaEditorTheme = {
  colors: {
    background: '#0E0E11',
    surface: '#1B1B20',
    text: '#FFFFFF',
    textMuted: '#9B9BA4',
    // DahabTech brand yellow. `onAccent` MUST be near-black — white on yellow is unreadable.
    accent: '#FFCE0A',
    onAccent: '#17171C',
    danger: '#F45B5B',
    border: '#2A2A31',
    // Scrims stay dark in both schemes (always over media).
    overlay: 'rgba(0, 0, 0, 0.55)',
    // Constructed from `background` at ~0.96 alpha so drawers read as tinted-dark glass.
    panelSurface: 'rgba(14, 14, 17, 0.96)',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  radius: { sm: 6, md: 10, lg: 16 },
};

export const lightTheme: MediaEditorTheme = {
  colors: {
    background: '#F7F7F9',
    surface: '#FFFFFF',
    text: '#17171C',
    textMuted: '#6E6E78',
    // DahabTech brand blue — deep enough that white-on-accent stays legible.
    accent: '#1C5E83',
    onAccent: '#FFFFFF',
    danger: '#E0484F',
    border: '#E2E2E8',
    // Scrims stay dark in both schemes (always over media).
    overlay: 'rgba(0, 0, 0, 0.55)',
    // Mirrors the dark construction: `background` at ~0.96 alpha for tinted-light glass.
    panelSurface: 'rgba(247, 247, 249, 0.96)',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  radius: { sm: 6, md: 10, lg: 16 },
};

/** Alias — dark is the default look. */
export const defaultTheme: MediaEditorTheme = darkTheme;

export function mergeTheme(
  base: MediaEditorTheme,
  override?: MediaEditorThemeOverride
): MediaEditorTheme {
  if (!override) {
    return base;
  }
  return {
    colors: { ...base.colors, ...override.colors },
    spacing: { ...base.spacing, ...override.spacing },
    radius: { ...base.radius, ...override.radius },
  };
}

/** On-panel palette for controls rendered on top of `panelSurface`. Alpha ramps are kept identical between schemes; only the tint flips (white on dark, black on light). */
export interface PanelPalette {
  text: string;
  textMuted: string;
  border: string;
  chipBg: string;
  chipBgActive: string;
}

/** Perceived luminance in [0..1]; `#000` → 0, `#FFF` → 1. Rec. 601 weights. */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0.5;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** True when the drawer surface is dark and needs light-on-dark controls. */
export function isPanelDark(theme: MediaEditorTheme): boolean {
  return hexLuminance(theme.colors.background) < 0.5;
}

/** Derives the on-panel control palette from a resolved theme. Dark panels use fixed white ramps (the same scrim values used over media). */
export function getPanelPalette(theme: MediaEditorTheme): PanelPalette {
  if (isPanelDark(theme)) {
    return {
      text: '#FFFFFF',
      textMuted: 'rgba(255,255,255,0.6)',
      border: 'rgba(255,255,255,0.35)',
      chipBg: 'rgba(255,255,255,0.08)',
      chipBgActive: 'rgba(255,255,255,0.16)',
    };
  }
  return {
    text: theme.colors.text,
    textMuted: theme.colors.textMuted,
    border: theme.colors.border,
    chipBg: 'rgba(0,0,0,0.05)',
    chipBgActive: 'rgba(0,0,0,0.10)',
  };
}
