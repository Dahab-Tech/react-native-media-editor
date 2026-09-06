import { IDENTITY_MATRIX, multiplyMatrix, type ColorMatrix4x5 } from './colorMatrix';

/** Composition: `final = filter · adjustments · source`. Matrix intensity is a lerp — exact for affine ops. */
export function composeFilterMatrix(
  filterMatrix: ColorMatrix4x5,
  adjustmentsMatrix: ColorMatrix4x5,
  intensity: number
): ColorMatrix4x5 {
  const t = Math.min(1, Math.max(0, intensity));
  if (t <= 0) return adjustmentsMatrix;
  const effective = t >= 1 ? filterMatrix : lerpMatrix(IDENTITY_MATRIX, filterMatrix, t);
  return multiplyMatrix(effective, adjustmentsMatrix);
}

export function lerpMatrix(a: ColorMatrix4x5, b: ColorMatrix4x5, t: number): ColorMatrix4x5 {
  const out = new Array<number>(20);
  const s = 1 - t;
  for (let i = 0; i < 20; i += 1) {
    out[i] = a[i] * s + b[i] * t;
  }
  return out;
}
