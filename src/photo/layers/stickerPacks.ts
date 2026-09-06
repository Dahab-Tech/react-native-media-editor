import type { DataSourceParam } from '@shopify/react-native-skia';

import type { MediaEditorStrings } from '../../core/i18n/strings';

/** Sticker roster: built-in emoji packs (zero assets) + consumer image packs. */

export interface EmojiStickerDefinition {
  readonly emoji: string;
}

export interface BuiltInStickerPack {
  readonly id: string;
  readonly titleKey: keyof MediaEditorStrings;
  readonly stickers: readonly EmojiStickerDefinition[];
}

/** `source` follows Skia's `useImage` contract. */
export interface PhotoImageStickerDefinition {
  readonly id: string;
  readonly source: DataSourceParam;
}

/** Consumer pack; `title` is pre-localized. */
export interface PhotoStickerPack {
  readonly id: string;
  readonly title: string;
  readonly stickers: readonly PhotoImageStickerDefinition[];
}

const SMILEYS: EmojiStickerDefinition[] = [
  '😀',
  '😂',
  '🥰',
  '😍',
  '😎',
  '🤩',
  '😇',
  '😜',
  '😢',
  '😭',
  '😱',
  '🤯',
  '😴',
  '🤔',
  '😅',
  '🙃',
].map((emoji) => ({ emoji }));

const HEARTS: EmojiStickerDefinition[] = [
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '💖',
  '💕',
  '💗',
  '💘',
  '💝',
  '💞',
].map((emoji) => ({ emoji }));

const HANDS: EmojiStickerDefinition[] = [
  '👍',
  '👎',
  '👌',
  '✌️',
  '🤞',
  '🤟',
  '🤘',
  '👏',
  '🙌',
  '🙏',
  '💪',
  '👋',
  '🤝',
  '👊',
].map((emoji) => ({ emoji }));

const ANIMALS: EmojiStickerDefinition[] = [
  '🐶',
  '🐱',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🦁',
  '🐯',
  '🐸',
  '🐵',
  '🦄',
  '🐙',
  '🦋',
  '🐝',
  '🦖',
].map((emoji) => ({ emoji }));

const FOOD: EmojiStickerDefinition[] = [
  '🍕',
  '🍔',
  '🍟',
  '🌮',
  '🍣',
  '🍩',
  '🍦',
  '🍰',
  '🍎',
  '🍇',
  '🍓',
  '🍉',
  '☕',
  '🍺',
  '🥑',
  '🍫',
].map((emoji) => ({ emoji }));

const NATURE: EmojiStickerDefinition[] = [
  '🌸',
  '🌺',
  '🌻',
  '🌹',
  '🌷',
  '🌈',
  '☀️',
  '⛅',
  '🌙',
  '⭐',
  '🌊',
  '🔥',
  '❄️',
  '🌴',
].map((emoji) => ({ emoji }));

const CELEBRATION: EmojiStickerDefinition[] = [
  '🎉',
  '🎊',
  '🎂',
  '🎁',
  '🎈',
  '🎀',
  '🏆',
  '🥇',
  '🎇',
  '🎆',
  '✨',
  '🥳',
  '🎵',
  '🎶',
].map((emoji) => ({ emoji }));

const SYMBOLS: EmojiStickerDefinition[] = [
  '⭐',
  '✨',
  '💥',
  '💫',
  '💯',
  '❓',
  '❗',
  '💤',
  '💬',
  '🔔',
  '⚡',
  '☑️',
  '❌',
  '➕',
].map((emoji) => ({ emoji }));

export const BUILTIN_STICKER_PACKS: readonly BuiltInStickerPack[] = [
  { id: 'smileys', titleKey: 'stickerPackSmileys', stickers: SMILEYS },
  { id: 'hearts', titleKey: 'stickerPackHearts', stickers: HEARTS },
  { id: 'hands', titleKey: 'stickerPackHands', stickers: HANDS },
  { id: 'animals', titleKey: 'stickerPackAnimals', stickers: ANIMALS },
  { id: 'food', titleKey: 'stickerPackFood', stickers: FOOD },
  { id: 'nature', titleKey: 'stickerPackNature', stickers: NATURE },
  { id: 'celebration', titleKey: 'stickerPackCelebration', stickers: CELEBRATION },
  { id: 'symbols', titleKey: 'stickerPackSymbols', stickers: SYMBOLS },
];

/** Returns null on unknown ids; render path draws nothing. */
export function resolveImageSticker(
  packId: string,
  stickerId: string,
  extraPacks: readonly PhotoStickerPack[] = []
): PhotoImageStickerDefinition | null {
  for (const pack of extraPacks) {
    if (pack.id !== packId) continue;
    for (const sticker of pack.stickers) {
      if (sticker.id === stickerId) return sticker;
    }
  }
  return null;
}
