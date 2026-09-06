export interface MediaEditorColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  border: string;
  /** Scrim color used behind floating bars and busy overlays that sit over image/video content. */
  overlay: string;
  /** Near-opaque background (~0.96 alpha) for sliding tool drawers over the canvas. */
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
    // Drawers stay dark in both schemes (always over media).
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
    overlay: 'rgba(0, 0, 0, 0.55)',
    panelSurface: 'rgba(14, 14, 17, 0.96)',
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
