import type { PhotoOverlayDefinition, PhotoOverlayPack } from './types';

/** Built-in overlay roster — procedural gradient recipes, zero image assets. */

const proc = (
  id: string,
  name: string,
  blendMode: PhotoOverlayDefinition['blendMode'],
  defaultIntensity: number,
  shape: Extract<PhotoOverlayDefinition, { kind: 'procedural' }>['shape']
): PhotoOverlayDefinition => ({
  id,
  name,
  kind: 'procedural',
  blendMode,
  defaultIntensity,
  shape,
});

const LIGHT: PhotoOverlayDefinition[] = [
  proc('light-goldenHour', 'Golden Hour', 'softLight', 0.75, {
    kind: 'linear',
    start: [0, 0],
    end: [1, 1],
    colors: ['rgba(255, 200, 120, 0.85)', 'rgba(255, 140, 60, 0.55)', 'rgba(255, 90, 30, 0.15)'],
    positions: [0, 0.5, 1],
  }),
  proc('light-coolDusk', 'Cool Dusk', 'softLight', 0.7, {
    kind: 'linear',
    start: [0, 1],
    end: [1, 0],
    colors: ['rgba(60, 90, 180, 0.7)', 'rgba(180, 120, 200, 0.35)', 'rgba(255, 180, 140, 0.15)'],
    positions: [0, 0.55, 1],
  }),
  proc('light-warmLeak', 'Warm Leak', 'screen', 0.65, {
    kind: 'linear',
    start: [0, 0],
    end: [1, 0.5],
    colors: ['rgba(255, 90, 30, 0.75)', 'rgba(255, 160, 60, 0.35)', 'rgba(0, 0, 0, 0)'],
    positions: [0, 0.35, 1],
  }),
  proc('light-sunFlare', 'Sun Flare', 'screen', 0.6, {
    kind: 'radial',
    center: [0.8, 0.2],
    radius: 0.65,
    colors: ['rgba(255, 230, 170, 0.85)', 'rgba(255, 180, 90, 0.25)', 'rgba(0, 0, 0, 0)'],
    positions: [0, 0.5, 1],
  }),
  proc('light-softGlow', 'Soft Glow', 'softLight', 0.8, {
    kind: 'radial',
    center: [0.5, 0.5],
    radius: 0.85,
    colors: ['rgba(255, 240, 220, 0.6)', 'rgba(255, 220, 180, 0.25)', 'rgba(0, 0, 0, 0)'],
  }),
  proc('light-magenta', 'Magenta', 'screen', 0.55, {
    kind: 'linear',
    start: [1, 0],
    end: [0, 1],
    colors: ['rgba(255, 60, 180, 0.7)', 'rgba(180, 60, 200, 0.35)', 'rgba(0, 0, 0, 0)'],
    positions: [0, 0.5, 1],
  }),
  proc('light-mintHaze', 'Mint Haze', 'softLight', 0.7, {
    kind: 'linear',
    start: [0.5, 0],
    end: [0.5, 1],
    colors: ['rgba(200, 255, 220, 0.55)', 'rgba(120, 220, 200, 0.3)', 'rgba(0, 0, 0, 0)'],
    positions: [0, 0.55, 1],
  }),
];

const MOOD: PhotoOverlayDefinition[] = [
  proc('mood-classicVignette', 'Vignette', 'multiply', 0.75, {
    kind: 'radial',
    center: [0.5, 0.5],
    radius: 0.9,
    colors: ['rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 0.85)'],
    positions: [0, 0.55, 1],
  }),
  proc('mood-warmVignette', 'Warm Vignette', 'multiply', 0.7, {
    kind: 'radial',
    center: [0.5, 0.5],
    radius: 0.9,
    colors: ['rgba(255, 255, 255, 1)', 'rgba(255, 230, 200, 1)', 'rgba(120, 40, 20, 0.85)'],
    positions: [0, 0.55, 1],
  }),
  proc('mood-coolVignette', 'Cool Vignette', 'multiply', 0.7, {
    kind: 'radial',
    center: [0.5, 0.5],
    radius: 0.9,
    colors: ['rgba(255, 255, 255, 1)', 'rgba(210, 220, 240, 1)', 'rgba(20, 30, 60, 0.85)'],
    positions: [0, 0.55, 1],
  }),
  proc('mood-fadedFilm', 'Faded Film', 'screen', 0.4, {
    kind: 'fill',
    color: 'rgba(180, 160, 140, 0.5)',
  }),
  proc('mood-noirWash', 'Noir', 'softLight', 0.85, {
    kind: 'linear',
    start: [0, 0],
    end: [0, 1],
    colors: ['rgba(40, 45, 60, 0.75)', 'rgba(20, 20, 30, 0.9)'],
  }),
  proc('mood-sepiaTone', 'Sepia', 'overlay', 0.55, {
    kind: 'fill',
    color: 'rgba(180, 130, 70, 0.5)',
  }),
  proc('mood-teal', 'Teal', 'softLight', 0.75, {
    kind: 'fill',
    color: 'rgba(40, 150, 160, 0.6)',
  }),
  proc('mood-plum', 'Plum', 'overlay', 0.55, {
    kind: 'linear',
    start: [0, 0],
    end: [1, 1],
    colors: ['rgba(120, 60, 140, 0.7)', 'rgba(40, 20, 80, 0.4)'],
  }),
];

export const BUILTIN_OVERLAY_PACKS: readonly PhotoOverlayPack[] = [
  { id: 'light', titleKey: 'overlayPackLight', overlays: LIGHT },
  { id: 'mood', titleKey: 'overlayPackMood', overlays: MOOD },
];

/** Built-ins first, then consumer packs. Null id / unknown id → null (render attaches nothing). */
export function resolveOverlay(
  id: string | null,
  extraPacks: readonly PhotoOverlayPack[] = []
): PhotoOverlayDefinition | null {
  if (id == null) return null;
  for (const pack of BUILTIN_OVERLAY_PACKS) {
    for (const overlay of pack.overlays) {
      if (overlay.id === id) return overlay;
    }
  }
  for (const pack of extraPacks) {
    for (const overlay of pack.overlays) {
      if (overlay.id === id) return overlay;
    }
  }
  return null;
}
