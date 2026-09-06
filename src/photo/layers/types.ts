/** Discriminated union of overlay layers. Array order in `layers` = z-order (last = topmost). */
export interface LayerBase {
  id: string;
  /** Center in normalized [0..1] over the cropped-rotated display rect. */
  x: number;
  y: number;
  /** Multiplier applied to the kind-specific base size. */
  scale: number;
  /** Rotation in radians around the layer center. */
  rotation: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  /** Physical semantics (`left` = left edge on screen); not flipped per app RTL. */
  align: TextAlign;
  /** IG-style pill; `null` = transparent. */
  background: string | null;
  fontId: string;
}

export type TextAlign = 'left' | 'center' | 'right';

/** Layer stores IDs (or a stable URI); resolution happens at render time so removed packs don't brick layers. */
export type StickerContent =
  | { variant: 'emoji'; emoji: string }
  | { variant: 'image'; packId: string; stickerId: string }
  | {
      variant: 'uri';
      uri: string;
      /** width / height; must be > 0. */
      aspectRatio: number;
    };

export interface StickerLayer extends LayerBase {
  kind: 'sticker';
  content: StickerContent;
}

export type PhotoLayer = TextLayer | StickerLayer;

export type PhotoLayerKind = PhotoLayer['kind'];

// Non-distributive Omit collapses to shared fields; distributing preserves per-kind shape.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Any subset of a layer's fields except `id` and `kind`. */
export type PhotoLayerPatch<L extends PhotoLayer = PhotoLayer> = Partial<
  DistributiveOmit<L, 'id' | 'kind'>
>;

export const LAYER_SCALE_MIN = 0.3;
export const LAYER_SCALE_MAX = 6;

export const TEXT_SCALE_MIN = LAYER_SCALE_MIN;
export const TEXT_SCALE_MAX = LAYER_SCALE_MAX;

export const DUPLICATE_OFFSET = 0.03;
