import { useImage, type SkImage, type DataSourceParam } from '@shopify/react-native-skia';
import { useMemo } from 'react';

import { resolveImageSticker, type PhotoLayer, type PhotoStickerPack } from '../layers';

/** Resolves image/uri stickers into a `${packId}::${stickerId}` → SkImage map; rules-of-hooks force MAX_UNIQUE fixed useImage slots. */

const MAX_UNIQUE = 32;

interface StickerRef {
  key: string;
  source: DataSourceParam;
}

export function useResolvedStickerImages(
  layers: readonly PhotoLayer[],
  stickerPacks?: readonly PhotoStickerPack[]
): Readonly<Record<string, SkImage>> {
  // Emoji stickers render through Skia Paragraph and don't participate here.
  const refs = useMemo<StickerRef[]>(() => {
    const seen = new Set<string>();
    const out: StickerRef[] = [];
    for (const layer of layers) {
      if (layer.kind !== 'sticker') continue;
      if (layer.content.variant === 'image') {
        const key = `image::${layer.content.packId}::${layer.content.stickerId}`;
        if (seen.has(key)) continue;
        const resolved = resolveImageSticker(
          layer.content.packId,
          layer.content.stickerId,
          stickerPacks
        );
        if (!resolved) continue;
        seen.add(key);
        out.push({ key, source: resolved.source });
      } else if (layer.content.variant === 'uri') {
        const key = `uri::${layer.content.uri}`;
        if (seen.has(key)) continue;
        if (!layer.content.uri) continue;
        seen.add(key);
        out.push({ key, source: layer.content.uri });
      } else {
        continue;
      }
      if (out.length >= MAX_UNIQUE) break;
    }
    return out;
  }, [layers, stickerPacks]);

  // Fixed slot count; `undefined` source is a no-op useImage call.
  const slot0 = useImage(refs[0]?.source);
  const slot1 = useImage(refs[1]?.source);
  const slot2 = useImage(refs[2]?.source);
  const slot3 = useImage(refs[3]?.source);
  const slot4 = useImage(refs[4]?.source);
  const slot5 = useImage(refs[5]?.source);
  const slot6 = useImage(refs[6]?.source);
  const slot7 = useImage(refs[7]?.source);
  const slot8 = useImage(refs[8]?.source);
  const slot9 = useImage(refs[9]?.source);
  const slot10 = useImage(refs[10]?.source);
  const slot11 = useImage(refs[11]?.source);
  const slot12 = useImage(refs[12]?.source);
  const slot13 = useImage(refs[13]?.source);
  const slot14 = useImage(refs[14]?.source);
  const slot15 = useImage(refs[15]?.source);
  const slot16 = useImage(refs[16]?.source);
  const slot17 = useImage(refs[17]?.source);
  const slot18 = useImage(refs[18]?.source);
  const slot19 = useImage(refs[19]?.source);
  const slot20 = useImage(refs[20]?.source);
  const slot21 = useImage(refs[21]?.source);
  const slot22 = useImage(refs[22]?.source);
  const slot23 = useImage(refs[23]?.source);
  const slot24 = useImage(refs[24]?.source);
  const slot25 = useImage(refs[25]?.source);
  const slot26 = useImage(refs[26]?.source);
  const slot27 = useImage(refs[27]?.source);
  const slot28 = useImage(refs[28]?.source);
  const slot29 = useImage(refs[29]?.source);
  const slot30 = useImage(refs[30]?.source);
  const slot31 = useImage(refs[31]?.source);

  const slots = [
    slot0,
    slot1,
    slot2,
    slot3,
    slot4,
    slot5,
    slot6,
    slot7,
    slot8,
    slot9,
    slot10,
    slot11,
    slot12,
    slot13,
    slot14,
    slot15,
    slot16,
    slot17,
    slot18,
    slot19,
    slot20,
    slot21,
    slot22,
    slot23,
    slot24,
    slot25,
    slot26,
    slot27,
    slot28,
    slot29,
    slot30,
    slot31,
  ];

  return useMemo(() => {
    const out: Record<string, SkImage> = {};
    for (let i = 0; i < refs.length; i += 1) {
      const image = slots[i];
      if (image) out[refs[i].key] = image;
    }
    return out;
  }, [
    refs,
    slot0,
    slot1,
    slot2,
    slot3,
    slot4,
    slot5,
    slot6,
    slot7,
    slot8,
    slot9,
    slot10,
    slot11,
    slot12,
    slot13,
    slot14,
    slot15,
    slot16,
    slot17,
    slot18,
    slot19,
    slot20,
    slot21,
    slot22,
    slot23,
    slot24,
    slot25,
    slot26,
    slot27,
    slot28,
    slot29,
    slot30,
    slot31,
  ]);
}
