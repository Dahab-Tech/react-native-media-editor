/** Focus (selective blur): serializable, undoable, geometry normalized over the displayed photo rect. */

export type FocusMode = 'off' | 'radial' | 'linear';

export interface RadialFocus {
  mode: 'radial';
  centerX: number;
  centerY: number;
  /** Fraction of min(rect). */
  radius: number;
  feather: number;
  /** [0, 1] scales the max gaussian sigma. */
  intensity: number;
}

export interface LinearFocus {
  mode: 'linear';
  centerX: number;
  centerY: number;
  /** Fraction of min(rect). */
  halfWidth: number;
  /** Radians from horizontal, +clockwise (screen y-down). */
  angle: number;
  feather: number;
  intensity: number;
}

export type PhotoFocus = { mode: 'off' } | RadialFocus | LinearFocus;

export const FOCUS_OFF: PhotoFocus = { mode: 'off' };

export const FOCUS_RADIUS_MIN = 0.05;
export const FOCUS_RADIUS_MAX = 1.5;
export const FOCUS_HALF_WIDTH_MIN = 0.03;
export const FOCUS_HALF_WIDTH_MAX = 1.5;

export const FOCUS_DEFAULT_FEATHER = 0.25;
export const FOCUS_DEFAULT_INTENSITY = 0.6;

/** Shared fields carry over between radial↔linear; 'off' discards everything. */
export function focusForMode(mode: FocusMode, previous: PhotoFocus): PhotoFocus {
  if (mode === 'off') return FOCUS_OFF;
  const shared =
    previous.mode === 'off'
      ? { centerX: 0.5, centerY: 0.5, intensity: FOCUS_DEFAULT_INTENSITY }
      : { centerX: previous.centerX, centerY: previous.centerY, intensity: previous.intensity };
  if (mode === 'radial') {
    return {
      mode: 'radial',
      ...shared,
      radius: previous.mode === 'radial' ? previous.radius : 0.35,
      feather: previous.mode === 'off' ? FOCUS_DEFAULT_FEATHER : previous.feather,
    };
  }
  return {
    mode: 'linear',
    ...shared,
    halfWidth: previous.mode === 'linear' ? previous.halfWidth : 0.2,
    angle: previous.mode === 'linear' ? previous.angle : 0,
    feather: previous.mode === 'off' ? FOCUS_DEFAULT_FEATHER : previous.feather,
  };
}
