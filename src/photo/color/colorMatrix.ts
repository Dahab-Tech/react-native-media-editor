import type { PhotoAdjustments } from './adjustments';

/** Skia 4x5 row-major color matrix; rows are [R, G, B, A, translation]. */
export type ColorMatrix4x5 = readonly number[];

// Rec.709 luma weights.
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

export const IDENTITY_MATRIX: ColorMatrix4x5 = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

/** Slider [-1, 1] maps to ±1 EV. */
export function exposureMatrix(value: number): ColorMatrix4x5 {
  const s = Math.pow(2, value);
  return [s, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 1, 0];
}

export function brightnessMatrix(value: number): ColorMatrix4x5 {
  const t = value;
  return [1, 0, 0, 0, t, 0, 1, 0, 0, t, 0, 0, 1, 0, t, 0, 0, 0, 1, 0];
}

/** Slope range [0, 2] around 0.5 gray. */
export function contrastMatrix(value: number): ColorMatrix4x5 {
  const c = value + 1;
  const t = (1 - c) * 0.5;
  return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0];
}

/** Lerp between luma grayscale (-1) and 2× saturation (+1). */
export function saturationMatrix(value: number): ColorMatrix4x5 {
  const s = value + 1;
  const invS = 1 - s;
  const r = LUMA_R * invS;
  const g = LUMA_G * invS;
  const b = LUMA_B * invS;
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
}

export function temperatureMatrix(value: number): ColorMatrix4x5 {
  const rGain = 1 + value * 0.2;
  const bGain = 1 - value * 0.2;
  return [rGain, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, bGain, 0, 0, 0, 0, 0, 1, 0];
}

/** Magenta/green axis; balanced so mid-gray stays gray. */
export function tintMatrix(value: number): ColorMatrix4x5 {
  const gGain = 1 - value * 0.15;
  const rbGain = 1 + value * 0.075;
  return [rbGain, 0, 0, 0, 0, 0, gGain, 0, 0, 0, 0, 0, rbGain, 0, 0, 0, 0, 0, 1, 0];
}

/** Full ±180° at slider extremes. */
export function hueMatrix(value: number): ColorMatrix4x5 {
  const angle = value * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lr = LUMA_R;
  const lg = LUMA_G;
  const lb = LUMA_B;
  return [
    lr + cos * (1 - lr) + sin * -lr,
    lg + cos * -lg + sin * -lg,
    lb + cos * -lb + sin * (1 - lb),
    0,
    0,
    lr + cos * -lr + sin * 0.143,
    lg + cos * (1 - lg) + sin * 0.14,
    lb + cos * -lb + sin * -0.283,
    0,
    0,
    lr + cos * -lr + sin * -(1 - lr),
    lg + cos * -lg + sin * lg,
    lb + cos * (1 - lb) + sin * lb,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Order per-point (right-to-left): exposure → brightness → contrast → temperature → tint → saturation → hue. */
export function composeAdjustmentMatrix(a: PhotoAdjustments): ColorMatrix4x5 {
  let out: ColorMatrix4x5 = exposureMatrix(a.exposure);
  out = multiplyMatrix(brightnessMatrix(a.brightness), out);
  out = multiplyMatrix(contrastMatrix(a.contrast), out);
  out = multiplyMatrix(temperatureMatrix(a.temperature), out);
  out = multiplyMatrix(tintMatrix(a.tint), out);
  out = multiplyMatrix(saturationMatrix(a.saturation), out);
  out = multiplyMatrix(hueMatrix(a.hue), out);
  return out;
}

/** result = a * b (a applied AFTER b). */
export function multiplyMatrix(a: ColorMatrix4x5, b: ColorMatrix4x5): number[] {
  const out = new Array<number>(20).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[row * 5 + k] * b[k * 5 + col];
      }
      if (col === 4) {
        sum += a[row * 5 + 4];
      }
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

/** Skip-attach discriminator for the ColorMatrix node. */
export function isIdentityMatrix(m: ColorMatrix4x5): boolean {
  for (let i = 0; i < 20; i += 1) {
    if (Math.abs(m[i] - IDENTITY_MATRIX[i]) > 1e-4) return false;
  }
  return true;
}
