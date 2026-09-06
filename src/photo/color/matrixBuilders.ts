import {
  contrastMatrix,
  IDENTITY_MATRIX,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  multiplyMatrix,
  saturationMatrix,
  temperatureMatrix,
  tintMatrix,
  type ColorMatrix4x5,
} from './colorMatrix';

/** Composable 4x5 matrix primitives for filter recipes; last applied is outermost in the composition. */

/** Per-channel gain around 0. */
export function channelGainMatrix(r: number, g: number, b: number): ColorMatrix4x5 {
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/** Per-channel offset in Skia's normalized color space. */
export function channelOffsetMatrix(r: number, g: number, b: number): ColorMatrix4x5 {
  return [1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];
}

/** IG-style faded look; typical amount 0.02..0.12. */
export function liftedBlacksMatrix(amount: number): ColorMatrix4x5 {
  return channelOffsetMatrix(amount, amount, amount);
}

/** Split-tone approximation via a fixed offset — reads as a tonal split at a glance. */
export function splitToneOffsetMatrix(warm: number, cool: number): ColorMatrix4x5 {
  return channelOffsetMatrix(warm * 0.06 - cool * 0.02, 0, -warm * 0.02 + cool * 0.06);
}

/** Rec.709 luma-weighted grayscale. */
export function monochromeMatrix(): ColorMatrix4x5 {
  return [
    LUMA_R,
    LUMA_G,
    LUMA_B,
    0,
    0,
    LUMA_R,
    LUMA_G,
    LUMA_B,
    0,
    0,
    LUMA_R,
    LUMA_G,
    LUMA_B,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Grayscale × per-channel gain; equivalent to `channelGainMatrix(...) * monochromeMatrix()` folded. */
export function tonedMonochromeMatrix(tintR: number, tintG: number, tintB: number): ColorMatrix4x5 {
  return [
    LUMA_R * tintR,
    LUMA_G * tintR,
    LUMA_B * tintR,
    0,
    0,
    LUMA_R * tintG,
    LUMA_G * tintG,
    LUMA_B * tintG,
    0,
    0,
    LUMA_R * tintB,
    LUMA_G * tintB,
    LUMA_B * tintB,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Contrast bump + black-crush; approximates a cinematic S-curve in the matrix stage. */
export function crushedShadowsMatrix(amount: number): ColorMatrix4x5 {
  const bump = contrastMatrix(amount * 0.35);
  const crush = channelOffsetMatrix(-amount * 0.06, -amount * 0.06, -amount * 0.06);
  return multiplyMatrix(crush, bump);
}

/** Per-output row of (fromR, fromG, fromB) weights; alpha is identity. */
export function channelMixMatrix(
  rRow: readonly [number, number, number],
  gRow: readonly [number, number, number],
  bRow: readonly [number, number, number]
): ColorMatrix4x5 {
  return [
    rRow[0],
    rRow[1],
    rRow[2],
    0,
    0,
    gRow[0],
    gRow[1],
    gRow[2],
    0,
    0,
    bRow[0],
    bRow[1],
    bRow[2],
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Composes in READING order — first entry is innermost, so `compose(base, warm, fade)` = base → warm → fade. */
export function compose(...matrices: readonly ColorMatrix4x5[]): ColorMatrix4x5 {
  if (matrices.length === 0) return IDENTITY_MATRIX;
  let out: ColorMatrix4x5 = matrices[0];
  for (let i = 1; i < matrices.length; i += 1) {
    out = multiplyMatrix(matrices[i], out);
  }
  return out;
}

export const warmth = temperatureMatrix;
export const coolness = (value: number): ColorMatrix4x5 => temperatureMatrix(-value);
export const sat = saturationMatrix;
export const desat = (value: number): ColorMatrix4x5 => saturationMatrix(-value);
export const magenta = tintMatrix;
export const green = (value: number): ColorMatrix4x5 => tintMatrix(-value);
