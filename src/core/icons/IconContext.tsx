import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import React, { createContext, useContext, type ReactNode } from 'react';

/** Every icon slot used by the editors. Consumers can override any of them. */
export type EditorIconName =
  | 'close'
  | 'check'
  | 'crop'
  | 'rotate'
  | 'flip'
  | 'adjust'
  | 'effects'
  | 'text'
  | 'stickers'
  | 'draw'
  | 'focus'
  | 'trash'
  | 'reset'
  | 'play'
  | 'pause'
  | 'trim'
  | 'cover'
  | 'add'
  | 'bold'
  | 'italic'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'bringForward'
  | 'sendBackward'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'backgroundFill'
  | 'font'
  | 'ai';

export interface EditorIconProps {
  size: number;
  color: string;
}

export type EditorIconRenderer = (props: EditorIconProps) => ReactNode;

export type EditorIconsOverride = Partial<Record<EditorIconName, EditorIconRenderer>>;

type Glyph =
  | { family: 'ionicons'; name: keyof typeof Ionicons.glyphMap }
  | { family: 'mci'; name: keyof typeof MaterialCommunityIcons.glyphMap };

const DEFAULT_GLYPHS: Record<EditorIconName, Glyph> = {
  close: { family: 'ionicons', name: 'close' },
  check: { family: 'ionicons', name: 'checkmark' },
  crop: { family: 'ionicons', name: 'crop' },
  rotate: { family: 'mci', name: 'rotate-right' },
  flip: { family: 'mci', name: 'flip-horizontal' },
  adjust: { family: 'ionicons', name: 'options' },
  effects: { family: 'mci', name: 'auto-fix' },
  text: { family: 'mci', name: 'format-text' },
  stickers: { family: 'mci', name: 'sticker-emoji' },
  draw: { family: 'ionicons', name: 'brush' },
  focus: { family: 'ionicons', name: 'aperture' },
  trash: { family: 'ionicons', name: 'trash-outline' },
  reset: { family: 'ionicons', name: 'refresh' },
  play: { family: 'ionicons', name: 'play' },
  pause: { family: 'ionicons', name: 'pause' },
  trim: { family: 'ionicons', name: 'cut' },
  cover: { family: 'ionicons', name: 'image-outline' },
  add: { family: 'ionicons', name: 'add' },
  bold: { family: 'mci', name: 'format-bold' },
  italic: { family: 'mci', name: 'format-italic' },
  undo: { family: 'mci', name: 'undo' },
  redo: { family: 'mci', name: 'redo' },
  duplicate: { family: 'mci', name: 'content-copy' },
  bringForward: { family: 'mci', name: 'flip-to-front' },
  sendBackward: { family: 'mci', name: 'flip-to-back' },
  alignLeft: { family: 'mci', name: 'format-align-left' },
  alignCenter: { family: 'mci', name: 'format-align-center' },
  alignRight: { family: 'mci', name: 'format-align-right' },
  backgroundFill: { family: 'mci', name: 'format-color-highlight' },
  font: { family: 'mci', name: 'format-font' },
  ai: { family: 'mci', name: 'creation' },
};

const IconContext = createContext<EditorIconsOverride>({});

/** Preloads Ionicons + MaterialCommunityIcons so toolbar/header glyphs render on the first painted frame. Load failure also reports ready (fallback boxes over hanging). */
export function useEditorIconFontsReady(): boolean {
  const [loaded, error] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });
  return loaded || error != null;
}

export function EditorIconProvider({
  icons,
  children,
}: {
  icons?: EditorIconsOverride;
  children: ReactNode;
}) {
  return <IconContext.Provider value={icons ?? {}}>{children}</IconContext.Provider>;
}

/** Renders a named editor icon, honoring any consumer-provided override. */
export function EditorIcon({ name, size, color }: EditorIconProps & { name: EditorIconName }) {
  const overrides = useContext(IconContext);
  const override = overrides[name];
  if (override) return <>{override({ size, color })}</>;
  const glyph = DEFAULT_GLYPHS[name];
  if (glyph.family === 'mci') {
    return <MaterialCommunityIcons name={glyph.name} size={size} color={color} />;
  }
  return <Ionicons name={glyph.name} size={size} color={color} />;
}
