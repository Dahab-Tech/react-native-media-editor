import { type NormalizedCrop } from './types';

/** Straighten geometry (fine-angle rotation about the crop center). Works in a normalized-pixel space (width=aspect, height=1) so angles stay exact. θ is in degrees. */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEG_TO_RAD = Math.PI / 180;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Normalized [0..1] crop → normalized-pixel space (width=aspect, height=1). */
function cropToPixelSpace(crop: NormalizedCrop, aspect: number): Rect {
  return {
    x: crop.x * aspect,
    y: crop.y,
    width: crop.width * aspect,
    height: crop.height,
  };
}

function pixelSpaceToCrop(rect: Rect, aspect: number): NormalizedCrop {
  const safe = aspect > 0 ? aspect : 1;
  return {
    x: rect.x / safe,
    y: rect.y,
    width: rect.width / safe,
    height: rect.height,
  };
}

function rotatedBboxHalfExtents(hw: number, hh: number, thetaDeg: number) {
  const rad = thetaDeg * DEG_TO_RAD;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { hw: hw * c + hh * s, hh: hw * s + hh * c };
}

/** Largest uniform scale of `crop` (about its center, aspect preserved) satisfying coverage at angle θ. */
export function maxCropScaleForAngle(
  crop: NormalizedCrop,
  aspect: number,
  thetaDeg: number
): number {
  if (aspect <= 0 || crop.width <= 0 || crop.height <= 0) return 1;
  const px = cropToPixelSpace(crop, aspect);
  const hw = px.width / 2;
  const hh = px.height / 2;
  const cx = px.x + hw;
  const cy = px.y + hh;
  const { hw: hwR, hh: hhR } = rotatedBboxHalfExtents(hw, hh, thetaDeg);
  const roomX = Math.min(cx, aspect - cx);
  const roomY = Math.min(cy, 1 - cy);
  if (hwR <= 0 || hhR <= 0) return 1;
  const kX = roomX / hwR;
  const kY = roomY / hhR;
  return Math.max(0, Math.min(1, kX, kY));
}

/** Largest uniform scale of `crop` (aspect preserved) whose rotated bbox fits the image at SOME position — translation is the caller's job. Unlike `maxCropScaleForAngle` this is not anchored to the crop center, so it can exceed 1 (pinch-to-zoom-out). */
export function maxCropScaleAnywhereForAngle(
  crop: NormalizedCrop,
  aspect: number,
  thetaDeg: number
): number {
  if (aspect <= 0 || crop.width <= 0 || crop.height <= 0) return 1;
  const px = cropToPixelSpace(crop, aspect);
  const { hw: hwR, hh: hhR } = rotatedBboxHalfExtents(px.width / 2, px.height / 2, thetaDeg);
  if (hwR <= 0 || hhR <= 0) return 1;
  return Math.max(1, Math.min(aspect / (2 * hwR), 1 / (2 * hhR)));
}

/** Shrink-then-translate clamp — the "photo auto-zooms as you rotate" behavior for the straighten dial. */
export function clampCropForAngle(
  crop: NormalizedCrop,
  aspect: number,
  thetaDeg: number
): NormalizedCrop {
  if (aspect <= 0 || crop.width <= 0 || crop.height <= 0) return crop;

  const k = maxCropScaleForAngle(crop, aspect, thetaDeg);
  const scale = Math.min(1, Math.max(0, k));

  const px = cropToPixelSpace(crop, aspect);
  const cx = px.x + px.width / 2;
  const cy = px.y + px.height / 2;
  const newW = px.width * scale;
  const newH = px.height * scale;
  const newHw = newW / 2;
  const newHh = newH / 2;
  const { hw: hwR, hh: hhR } = rotatedBboxHalfExtents(newHw, newHh, thetaDeg);

  const newCx = clamp(cx, hwR, aspect - hwR);
  const newCy = clamp(cy, hhR, 1 - hhR);

  const shrunk: Rect = {
    x: newCx - newHw,
    y: newCy - newHh,
    width: newW,
    height: newH,
  };
  return pixelSpaceToCrop(shrunk, aspect);
}

/** Translate-first fit — apply after a resize commit so the reducer doesn't silently shrink a user-chosen size when translation alone restores coverage. */
export function fitCropForAngle(
  crop: NormalizedCrop,
  aspect: number,
  thetaDeg: number
): NormalizedCrop {
  if (aspect <= 0 || crop.width <= 0 || crop.height <= 0) return crop;

  const px = cropToPixelSpace(crop, aspect);
  const hw = px.width / 2;
  const hh = px.height / 2;
  const cx = px.x + hw;
  const cy = px.y + hh;
  const { hw: hwR, hh: hhR } = rotatedBboxHalfExtents(hw, hh, thetaDeg);

  const fitsX = 2 * hwR <= aspect;
  const fitsY = 2 * hhR <= 1;

  if (fitsX && fitsY) {
    // Bbox fits somewhere; translate only.
    const newCx = clamp(cx, hwR, aspect - hwR);
    const newCy = clamp(cy, hhR, 1 - hhR);
    const shifted: Rect = {
      x: newCx - hw,
      y: newCy - hh,
      width: px.width,
      height: px.height,
    };
    return pixelSpaceToCrop(shifted, aspect);
  }

  // Bbox too large for any position → uniform shrink to the largest that fits.
  const kX = hwR > 0 ? aspect / (2 * hwR) : Number.POSITIVE_INFINITY;
  const kY = hhR > 0 ? 1 / (2 * hhR) : Number.POSITIVE_INFINITY;
  const k = Math.min(1, kX, kY);
  const newW = px.width * k;
  const newH = px.height * k;
  const newHw = newW / 2;
  const newHh = newH / 2;
  const { hw: newHwR, hh: newHhR } = rotatedBboxHalfExtents(newHw, newHh, thetaDeg);
  const newCx = clamp(cx, newHwR, aspect - newHwR);
  const newCy = clamp(cy, newHhR, 1 - newHhR);
  const shrunk: Rect = {
    x: newCx - newHw,
    y: newCy - newHh,
    width: newW,
    height: newH,
  };
  return pixelSpaceToCrop(shrunk, aspect);
}

/** Per-axis pan limits for the crop's top-left at angle θ, in normalized [0..1] image space. */
export function panLimitsForAngle(
  crop: NormalizedCrop,
  aspect: number,
  thetaDeg: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (aspect <= 0)
    return {
      minX: 0,
      maxX: Math.max(0, 1 - crop.width),
      minY: 0,
      maxY: Math.max(0, 1 - crop.height),
    };
  const hwPx = (crop.width * aspect) / 2;
  const hhPx = crop.height / 2;
  const { hw: hwR, hh: hhR } = rotatedBboxHalfExtents(hwPx, hhPx, thetaDeg);
  const padXPx = hwR - hwPx;
  const padYPx = hhR - hhPx;
  const padX = padXPx / aspect;
  const padY = padYPx;
  const minX = padX;
  const maxX = Math.max(minX, 1 - crop.width - padX);
  const minY = padY;
  const maxY = Math.max(minY, 1 - crop.height - padY);
  return { minX, maxX, minY, maxY };
}

/** Absolute sin/cos of θ (degrees). */
export function absSinCosForAngle(thetaDeg: number): { absCos: number; absSin: number } {
  const rad = thetaDeg * DEG_TO_RAD;
  return { absCos: Math.abs(Math.cos(rad)), absSin: Math.abs(Math.sin(rad)) };
}
