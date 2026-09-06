import type { DataSourceParam } from '@shopify/react-native-skia';

import type { MediaEditorStrings } from '../../core/i18n/strings';

/** Closed union of the visually useful Skia blend modes. */
export type OverlayBlendMode =
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'screen'
  | 'multiply'
  | 'lighten'
  | 'darken'
  | 'colorDodge'
  | 'colorBurn';

/** Coordinates normalized [0..1] over the target rect; OverlayLayer denormalizes at draw time. */
export type OverlayProceduralShape =
  | {
      readonly kind: 'linear';
      readonly start: readonly [number, number];
      readonly end: readonly [number, number];
      readonly colors: readonly string[];
      readonly positions?: readonly number[];
    }
  | {
      readonly kind: 'radial';
      readonly center: readonly [number, number];
      /** Fraction of max(rect.width, rect.height). */
      readonly radius: number;
      readonly colors: readonly string[];
      readonly positions?: readonly number[];
    }
  | {
      readonly kind: 'fill';
      readonly color: string;
    };

export type PhotoOverlayDefinition =
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'procedural';
      readonly blendMode: OverlayBlendMode;
      /** Clamped 0..1. */
      readonly defaultIntensity?: number;
      readonly shape: OverlayProceduralShape;
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'image';
      readonly blendMode: OverlayBlendMode;
      readonly defaultIntensity?: number;
      readonly source: DataSourceParam;
    };

/** Built-in packs use titleKey (typed i18n); consumer packs use `title` (pre-localized). */
export interface PhotoOverlayPack {
  readonly id: string;
  readonly titleKey?: keyof MediaEditorStrings;
  readonly title?: string;
  readonly overlays: readonly PhotoOverlayDefinition[];
}

export const NO_OVERLAY_ID: null = null;

export type PhotoOverlayId = string | null;
