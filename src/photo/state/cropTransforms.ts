import { type NormalizedCrop } from './photoEditorState';

/** Maps normalized crops between pre-rotation image space and post-rotation display space.
 *  Forward is `p_display = R_θ(F(p_pre))`; 90°-step rotations keep axis-alignment. */

export type Rotation = 0 | 90 | 180 | 270;

interface Point {
  x: number;
  y: number;
}

function flipPoint(p: Point, flipHorizontal: boolean): Point {
  return flipHorizontal ? { x: 1 - p.x, y: p.y } : p;
}

function rotatePoint(p: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return p;
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return p;
  }
}

function inverseRotatePoint(p: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return p;
    case 90:
      return { x: p.y, y: 1 - p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: 1 - p.y, y: p.x };
    default:
      return p;
  }
}

function boundingBox(points: Point[]): NormalizedCrop {
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectCorners(rect: NormalizedCrop): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

/** Pre-rotation crop → post-rotation display rect. */
export function toPostRotation(
  crop: NormalizedCrop,
  rotation: Rotation,
  flipHorizontal: boolean
): NormalizedCrop {
  const corners = rectCorners(crop).map((p) => rotatePoint(flipPoint(p, flipHorizontal), rotation));
  return boundingBox(corners);
}

/** Post-rotation display rect → pre-rotation crop (used at dispatch). */
export function toPreRotation(
  crop: NormalizedCrop,
  rotation: Rotation,
  flipHorizontal: boolean
): NormalizedCrop {
  // Inverse is F ∘ R⁻¹ (flip is self-inverse).
  const corners = rectCorners(crop).map((p) =>
    flipPoint(inverseRotatePoint(p, rotation), flipHorizontal)
  );
  return boundingBox(corners);
}
