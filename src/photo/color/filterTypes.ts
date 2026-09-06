import type { DataSourceParam } from '@shopify/react-native-skia';

import type { ColorMatrix4x5 } from './colorMatrix';
import type { MediaEditorStrings } from '../../core/i18n/strings';

/** `matrix` folds onto the ColorMatrix stage; `lut` uses the HALD shader. */
export type PhotoFilterDefinition =
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'matrix';
      readonly matrix: ColorMatrix4x5;
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'lut';
      readonly source: DataSourceParam;
    };

/** Built-ins use titleKey (typed i18n); consumer packs use `title` (pre-localized). */
export interface PhotoFilterPack {
  readonly id: string;
  readonly titleKey?: keyof MediaEditorStrings;
  readonly title?: string;
  readonly filters: readonly PhotoFilterDefinition[];
}

export const ORIGINAL_FILTER_ID = 'original';

export const ORIGINAL_FILTER_NAME = 'Original';
