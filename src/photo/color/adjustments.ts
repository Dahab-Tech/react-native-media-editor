import type { MediaEditorStrings } from '../../core/i18n/strings';

/** Order matches iOS Photos' Adjust chip row. */
export type PhotoAdjustmentKey =
  | 'exposure'
  | 'brightness'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'hue'
  | 'sharpness'
  | 'vignette'
  | 'grain';

export type PhotoAdjustments = Record<PhotoAdjustmentKey, number>;

type BipolarKey =
  | 'exposure'
  | 'brightness'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'hue';

type UnipolarKey = 'sharpness' | 'vignette' | 'grain';

export interface AdjustmentMeta {
  key: PhotoAdjustmentKey;
  labelKey: keyof MediaEditorStrings;
  min: number;
  max: number;
  neutral: number;
}

const BIPOLAR_META = (key: BipolarKey, labelKey: keyof MediaEditorStrings): AdjustmentMeta => ({
  key,
  labelKey,
  min: -1,
  max: 1,
  neutral: 0,
});

const UNIPOLAR_META = (key: UnipolarKey, labelKey: keyof MediaEditorStrings): AdjustmentMeta => ({
  key,
  labelKey,
  min: 0,
  max: 1,
  neutral: 0,
});

export const ADJUSTMENT_META: readonly AdjustmentMeta[] = [
  BIPOLAR_META('exposure', 'adjExposure'),
  BIPOLAR_META('brightness', 'brightness'),
  BIPOLAR_META('contrast', 'contrast'),
  BIPOLAR_META('highlights', 'adjHighlights'),
  BIPOLAR_META('shadows', 'adjShadows'),
  BIPOLAR_META('whites', 'adjWhites'),
  BIPOLAR_META('blacks', 'adjBlacks'),
  BIPOLAR_META('temperature', 'adjTemperature'),
  BIPOLAR_META('tint', 'adjTint'),
  BIPOLAR_META('saturation', 'saturation'),
  BIPOLAR_META('vibrance', 'adjVibrance'),
  BIPOLAR_META('hue', 'adjHue'),
  UNIPOLAR_META('sharpness', 'adjSharpness'),
  UNIPOLAR_META('vignette', 'adjVignette'),
  UNIPOLAR_META('grain', 'adjGrain'),
];

export const NEUTRAL_ADJUSTMENTS: PhotoAdjustments = ADJUSTMENT_META.reduce((acc, meta) => {
  acc[meta.key] = meta.neutral;
  return acc;
}, {} as PhotoAdjustments);

const META_BY_KEY: Record<PhotoAdjustmentKey, AdjustmentMeta> = ADJUSTMENT_META.reduce(
  (acc, meta) => {
    acc[meta.key] = meta;
    return acc;
  },
  {} as Record<PhotoAdjustmentKey, AdjustmentMeta>
);

export function adjustmentMeta(key: PhotoAdjustmentKey): AdjustmentMeta {
  return META_BY_KEY[key];
}

/** Enables the shader-stage skip-attach invariant. */
export function isNeutral(key: PhotoAdjustmentKey, value: number): boolean {
  return Math.abs(value - META_BY_KEY[key].neutral) < 1e-4;
}

export function anyNonNeutral(
  keys: readonly PhotoAdjustmentKey[],
  adjustments: PhotoAdjustments
): boolean {
  for (const key of keys) {
    if (!isNeutral(key, adjustments[key])) return true;
  }
  return false;
}
