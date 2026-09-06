/** Draw strokes: serializable, undoable, normalized over the displayed photo rect. */

export type DrawBrush = 'pen' | 'marker' | 'neon' | 'eraser';

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawStroke {
  id: string;
  brush: DrawBrush;
  color: string;
  /** Fraction of the photo rect's min dimension. */
  size: number;
  points: DrawPoint[];
}

export const DRAW_SIZE_MIN = 0.005;
export const DRAW_SIZE_MAX = 0.09;

export const DRAW_DEFAULT_SIZES: Record<DrawBrush, number> = {
  pen: 0.014,
  marker: 0.04,
  neon: 0.018,
  eraser: 0.045,
};

export const DRAW_DEFAULT_COLOR = '#FFFFFF';

export function generateStrokeId(): string {
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}
