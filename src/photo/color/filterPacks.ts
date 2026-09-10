import { contrastMatrix, IDENTITY_MATRIX, type ColorMatrix4x5 } from './colorMatrix';
import type { PhotoFilterDefinition, PhotoFilterPack } from './filterTypes';
import { ORIGINAL_FILTER_ID, ORIGINAL_FILTER_NAME } from './filterTypes';
import {
  channelGainMatrix,
  channelMixMatrix,
  channelOffsetMatrix,
  compose,
  coolness,
  crushedShadowsMatrix,
  desat,
  green,
  liftedBlacksMatrix,
  magenta,
  monochromeMatrix,
  sat,
  splitToneOffsetMatrix,
  tonedMonochromeMatrix,
  warmth,
} from './matrixBuilders';

/** Built-in filter roster; every entry is a matrix filter folded into the ColorMatrix stage (zero shader cost). */

const matrix = (id: string, name: string, m: ColorMatrix4x5): PhotoFilterDefinition => ({
  id,
  name,
  kind: 'matrix',
  matrix: m,
});

const FILM: PhotoFilterDefinition[] = [
  matrix('film-portra', 'Portra', compose(warmth(0.16), sat(-0.1), liftedBlacksMatrix(0.03))),
  matrix('film-ektar', 'Ektar', compose(sat(0.25), contrastMatrix(0.1), warmth(0.08))),
  matrix('film-fuji', 'Fuji', compose(coolness(0.1), sat(0.12), green(0.12))),
  matrix('film-superia', 'Superia', compose(warmth(0.12), magenta(0.16), sat(0.08))),
  matrix(
    'film-cinestill',
    'CineStill',
    compose(warmth(0.24), liftedBlacksMatrix(0.05), sat(-0.05))
  ),
  matrix('film-gold', 'Gold', compose(warmth(0.3), sat(0.05), channelGainMatrix(1.05, 1.0, 0.92))),
  matrix('film-provia', 'Provia', compose(contrastMatrix(0.15), sat(0.1))),
  matrix('film-velvia', 'Velvia', compose(sat(0.4), contrastMatrix(0.18), warmth(0.06))),
];

const VINTAGE: PhotoFilterDefinition[] = [
  matrix(
    'vintage-sepia',
    'Sepia',
    compose(
      monochromeMatrix(),
      channelGainMatrix(1.07, 0.94, 0.72),
      channelOffsetMatrix(0.04, 0.02, -0.05)
    )
  ),
  matrix(
    'vintage-polaroid',
    'Polaroid',
    compose(warmth(0.2), sat(-0.15), liftedBlacksMatrix(0.08))
  ),
  matrix(
    'vintage-kodachrome',
    'Kodachrome',
    compose(sat(0.2), warmth(0.1), contrastMatrix(0.1), channelGainMatrix(1.05, 0.98, 0.9))
  ),
  matrix(
    'vintage-70s',
    '70s',
    compose(warmth(0.28), magenta(0.12), sat(-0.05), liftedBlacksMatrix(0.05))
  ),
  matrix(
    'vintage-nostalgia',
    'Nostalgia',
    compose(warmth(0.18), sat(-0.2), contrastMatrix(-0.1), liftedBlacksMatrix(0.06))
  ),
  matrix(
    'vintage-instant',
    'Instant',
    compose(sat(-0.1), warmth(0.12), splitToneOffsetMatrix(1.0, 0.4))
  ),
  matrix(
    'vintage-crossprocess',
    'X-Process',
    compose(sat(0.15), green(0.24), warmth(-0.1), contrastMatrix(0.12))
  ),
  matrix(
    'vintage-faded',
    'Faded',
    compose(sat(-0.25), contrastMatrix(-0.2), liftedBlacksMatrix(0.1))
  ),
];

const BW: PhotoFilterDefinition[] = [
  matrix('bw-classic', 'Classic B&W', monochromeMatrix()),
  matrix('bw-highcontrast', 'High Contrast', compose(monochromeMatrix(), contrastMatrix(0.4))),
  matrix(
    'bw-soft',
    'Soft B&W',
    compose(monochromeMatrix(), contrastMatrix(-0.15), liftedBlacksMatrix(0.05))
  ),
  matrix('bw-selenium', 'Selenium', tonedMonochromeMatrix(1.05, 1.0, 0.85)),
  matrix('bw-cyanotype', 'Cyanotype', tonedMonochromeMatrix(0.75, 0.95, 1.15)),
  matrix('bw-platinum', 'Platinum', tonedMonochromeMatrix(1.02, 1.0, 0.97)),
  matrix(
    'bw-ansel',
    'Ansel',
    compose(
      channelMixMatrix([0.45, 0.45, 0.1], [0.45, 0.45, 0.1], [0.45, 0.45, 0.1]),
      crushedShadowsMatrix(0.6)
    )
  ),
  matrix('bw-noir', 'Noir', compose(monochromeMatrix(), crushedShadowsMatrix(0.85))),
];

const WARM: PhotoFilterDefinition[] = [
  matrix('warm-glow', 'Glow', compose(warmth(0.3), liftedBlacksMatrix(0.03))),
  matrix(
    'warm-goldenhour',
    'Golden Hour',
    compose(warmth(0.4), channelGainMatrix(1.08, 1.02, 0.88), sat(0.05))
  ),
  matrix(
    'warm-desert',
    'Desert',
    compose(warmth(0.36), sat(-0.1), channelOffsetMatrix(0.02, 0.0, -0.03))
  ),
  matrix(
    'warm-honey',
    'Honey',
    compose(warmth(0.44), channelGainMatrix(1.1, 1.02, 0.85), liftedBlacksMatrix(0.04))
  ),
  matrix(
    'warm-amber',
    'Amber',
    compose(warmth(0.5), sat(0.08), channelGainMatrix(1.12, 0.98, 0.82))
  ),
  matrix(
    'warm-cairo',
    'Cairo',
    compose(warmth(0.32), magenta(0.1), sat(0.1), contrastMatrix(0.05))
  ),
  matrix(
    'warm-terracotta',
    'Terracotta',
    compose(
      warmth(0.2),
      sat(0.05),
      channelMixMatrix([1.0, 0.05, 0.02], [0.05, 0.95, 0.02], [0.02, 0.02, 0.9])
    )
  ),
  matrix('warm-sunset', 'Sunset', compose(warmth(0.4), magenta(0.2), sat(0.15))),
];

const COOL: PhotoFilterDefinition[] = [
  matrix('cool-mist', 'Mist', compose(coolness(0.24), sat(-0.15), liftedBlacksMatrix(0.06))),
  matrix(
    'cool-arctic',
    'Arctic',
    compose(coolness(0.4), sat(-0.1), channelGainMatrix(0.88, 1.0, 1.1))
  ),
  matrix('cool-teal', 'Teal', compose(coolness(0.2), green(0.16), sat(0.05))),
  matrix(
    'cool-moonlight',
    'Moonlight',
    compose(coolness(0.3), desat(0.2), liftedBlacksMatrix(0.05))
  ),
  matrix('cool-nordic', 'Nordic', compose(coolness(0.36), sat(-0.05), contrastMatrix(0.08))),
  matrix(
    'cool-cyan',
    'Cyan',
    compose(coolness(0.24), channelGainMatrix(0.85, 1.05, 1.12), sat(0.1))
  ),
  matrix(
    'cool-ice',
    'Ice',
    compose(coolness(0.44), sat(-0.15), channelOffsetMatrix(-0.02, 0.0, 0.04))
  ),
  matrix(
    'cool-midnight',
    'Midnight',
    compose(coolness(0.4), crushedShadowsMatrix(0.4), channelGainMatrix(0.9, 0.98, 1.15))
  ),
];

const CINEMATIC: PhotoFilterDefinition[] = [
  matrix(
    'cine-tealorange',
    'Teal & Orange',
    compose(splitToneOffsetMatrix(1.2, 0.8), sat(0.1), contrastMatrix(0.1))
  ),
  matrix(
    'cine-blockbuster',
    'Blockbuster',
    compose(warmth(0.16), coolness(0.1), contrastMatrix(0.2), sat(0.15))
  ),
  matrix('cine-noir', 'Cine Noir', compose(desat(0.7), crushedShadowsMatrix(0.6), coolness(0.1))),
  matrix(
    'cine-neonnight',
    'Neon Night',
    compose(coolness(0.3), magenta(0.3), sat(0.2), crushedShadowsMatrix(0.4))
  ),
  matrix(
    'cine-drama',
    'Drama',
    compose(contrastMatrix(0.3), sat(-0.05), crushedShadowsMatrix(0.3))
  ),
  matrix(
    'cine-thriller',
    'Thriller',
    compose(coolness(0.2), desat(0.15), crushedShadowsMatrix(0.5), green(0.1))
  ),
  matrix(
    'cine-western',
    'Western',
    compose(warmth(0.3), sat(0.05), contrastMatrix(0.15), channelGainMatrix(1.08, 1.0, 0.85))
  ),
  matrix(
    'cine-scifi',
    'Sci-Fi',
    compose(coolness(0.36), channelGainMatrix(0.85, 1.05, 1.2), contrastMatrix(0.15))
  ),
];

const VIVID: PhotoFilterDefinition[] = [
  matrix('vivid-pop', 'Pop', compose(sat(0.35), contrastMatrix(0.1))),
  matrix('vivid-punch', 'Punch', compose(sat(0.5), contrastMatrix(0.2))),
  matrix(
    'vivid-hdr',
    'HDR',
    compose(sat(0.25), contrastMatrix(0.25), channelOffsetMatrix(0.02, 0.02, 0.02))
  ),
  matrix('vivid-crush', 'Crush', compose(sat(0.4), crushedShadowsMatrix(0.4), warmth(0.06))),
  matrix(
    'vivid-tropic',
    'Tropic',
    compose(sat(0.3), warmth(0.16), green(0.12), contrastMatrix(0.08))
  ),
  matrix('vivid-neon', 'Neon', compose(sat(0.6), contrastMatrix(0.15), magenta(0.1))),
  matrix(
    'vivid-electric',
    'Electric',
    compose(sat(0.45), coolness(0.1), channelGainMatrix(1.0, 1.05, 1.1))
  ),
  matrix('vivid-fuchsia', 'Fuchsia', compose(sat(0.4), magenta(0.3), warmth(0.06))),
];

const PASTEL: PhotoFilterDefinition[] = [
  matrix(
    'pastel-soft',
    'Soft',
    compose(sat(-0.15), contrastMatrix(-0.15), liftedBlacksMatrix(0.08))
  ),
  matrix(
    'pastel-dreamy',
    'Dreamy',
    compose(sat(-0.2), contrastMatrix(-0.25), warmth(0.1), liftedBlacksMatrix(0.1))
  ),
  matrix(
    'pastel-bloom',
    'Bloom',
    compose(warmth(0.1), sat(-0.1), contrastMatrix(-0.15), channelGainMatrix(1.02, 1.02, 1.05))
  ),
  matrix(
    'pastel-matte',
    'Matte',
    compose(contrastMatrix(-0.3), sat(-0.1), liftedBlacksMatrix(0.12))
  ),
  matrix(
    'pastel-pinktone',
    'Pink Tone',
    compose(magenta(0.2), sat(-0.15), warmth(0.1), liftedBlacksMatrix(0.08))
  ),
  matrix(
    'pastel-airy',
    'Airy',
    compose(
      contrastMatrix(-0.2),
      liftedBlacksMatrix(0.1),
      sat(-0.05),
      channelOffsetMatrix(0.02, 0.03, 0.04)
    )
  ),
  matrix(
    'pastel-mint',
    'Mint',
    compose(coolness(0.12), green(0.16), sat(-0.1), liftedBlacksMatrix(0.08))
  ),
  matrix(
    'pastel-cream',
    'Cream',
    compose(warmth(0.2), sat(-0.2), contrastMatrix(-0.2), liftedBlacksMatrix(0.12))
  ),
];

export const BUILTIN_FILTER_PACKS: readonly PhotoFilterPack[] = [
  { id: 'film', titleKey: 'filterPackFilm', filters: FILM },
  { id: 'vintage', titleKey: 'filterPackVintage', filters: VINTAGE },
  { id: 'bw', titleKey: 'filterPackBW', filters: BW },
  { id: 'warm', titleKey: 'filterPackWarm', filters: WARM },
  { id: 'cool', titleKey: 'filterPackCool', filters: COOL },
  { id: 'cinematic', titleKey: 'filterPackCinematic', filters: CINEMATIC },
  { id: 'vivid', titleKey: 'filterPackVivid', filters: VIVID },
  { id: 'pastel', titleKey: 'filterPackPastel', filters: PASTEL },
];

export const ORIGINAL_FILTER_DEFINITION: PhotoFilterDefinition = {
  id: ORIGINAL_FILTER_ID,
  name: ORIGINAL_FILTER_NAME,
  kind: 'matrix',
  matrix: IDENTITY_MATRIX,
};

/** Built-ins first, then consumer packs. Unknown id → identity filter. */
export function resolveFilter(
  id: string,
  extraPacks: readonly PhotoFilterPack[] = []
): PhotoFilterDefinition {
  if (id === ORIGINAL_FILTER_ID) return ORIGINAL_FILTER_DEFINITION;
  for (const pack of BUILTIN_FILTER_PACKS) {
    for (const filter of pack.filters) {
      if (filter.id === id) return filter;
    }
  }
  for (const pack of extraPacks) {
    for (const filter of pack.filters) {
      if (filter.id === id) return filter;
    }
  }
  return ORIGINAL_FILTER_DEFINITION;
}
