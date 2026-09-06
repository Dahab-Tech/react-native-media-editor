/** Focus-tool pure math: clamping, gesture deltas → state, mask params → shader uniforms. */

import {
  FOCUS_HALF_WIDTH_MAX,
  FOCUS_HALF_WIDTH_MIN,
  FOCUS_RADIUS_MAX,
  FOCUS_RADIUS_MIN,
  type PhotoFocus,
} from './types';

export interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampFocus(focus: PhotoFocus): PhotoFocus {
  if (focus.mode === 'off') return focus;
  const base = {
    centerX: clamp(focus.centerX, 0, 1),
    centerY: clamp(focus.centerY, 0, 1),
    feather: clamp(focus.feather, 0.01, 1),
    intensity: clamp(focus.intensity, 0, 1),
  };
  if (focus.mode === 'radial') {
    return {
      mode: 'radial',
      ...base,
      radius: clamp(focus.radius, FOCUS_RADIUS_MIN, FOCUS_RADIUS_MAX),
    };
  }
  return {
    mode: 'linear',
    ...base,
    halfWidth: clamp(focus.halfWidth, FOCUS_HALF_WIDTH_MIN, FOCUS_HALF_WIDTH_MAX),
    angle: normalizeAngle(focus.angle),
  };
}

/** Wraps to (-π, π]. */
export function normalizeAngle(angle: number): number {
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function moveFocusCenter(
  start: PhotoFocus,
  translationX: number,
  translationY: number,
  rect: FocusRect
): PhotoFocus {
  if (start.mode === 'off' || rect.width <= 0 || rect.height <= 0) return start;
  return {
    ...start,
    centerX: start.centerX + translationX / rect.width,
    centerY: start.centerY + translationY / rect.height,
  };
}

export function scaleFocusRegion(start: PhotoFocus, scale: number): PhotoFocus {
  if (start.mode === 'off' || scale <= 0) return start;
  if (start.mode === 'radial') {
    return { ...start, radius: start.radius * scale };
  }
  return { ...start, halfWidth: start.halfWidth * scale };
}

/** Radial focus is rotation-invariant — returned unchanged. */
export function rotateFocusBand(start: PhotoFocus, rotation: number): PhotoFocus {
  if (start.mode !== 'linear') return start;
  return { ...start, angle: start.angle + rotation };
}

export interface FocusMaskParams {
  /** Sharp-zone center in canvas px. */
  centerX: number;
  centerY: number;
  /** Distance (px) from center at which the blur ramp starts. */
  innerEdge: number;
  /** Ramp width in px. */
  feather: number;
  /** Band direction unit vector (linear); (1, 0) for radial. */
  dirX: number;
  dirY: number;
}

export function focusMaskParams(
  focus: Exclude<PhotoFocus, { mode: 'off' }>,
  rect: FocusRect
): FocusMaskParams {
  const minDim = Math.min(rect.width, rect.height);
  return {
    centerX: rect.x + focus.centerX * rect.width,
    centerY: rect.y + focus.centerY * rect.height,
    innerEdge: (focus.mode === 'radial' ? focus.radius : focus.halfWidth) * minDim,
    // Min 1px so smoothstep never degenerates to a step at the edge.
    feather: Math.max(1, focus.feather * minDim),
    dirX: focus.mode === 'linear' ? Math.cos(focus.angle) : 1,
    dirY: focus.mode === 'linear' ? Math.sin(focus.angle) : 0,
  };
}

/** Max gaussian sigma as a fraction of min(rect) so preview/export blur by the same relative amount. */
export const FOCUS_MAX_SIGMA_FRACTION = 0.03;

export function focusBlurSigma(intensity: number, rect: FocusRect): number {
  return intensity * FOCUS_MAX_SIGMA_FRACTION * Math.min(rect.width, rect.height);
}
