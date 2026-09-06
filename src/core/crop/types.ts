/** Axis-aligned rect in [0..1] × [0..1] over the displayed media rect. */
export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `'fit'` (photo): refit frame + scale photoRect. `'anchored'` (video): pin photoRect to the display rect so the frame never refits on lift. */
export type CropViewMode = 'fit' | 'anchored';
