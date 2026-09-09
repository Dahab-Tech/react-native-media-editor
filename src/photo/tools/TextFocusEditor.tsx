import React, { useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextColorPicker } from './TextColorPicker';
import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { type TextAlign, type TextLayer } from '../layers';
import {
  BUILT_IN_FONTS,
  contrastTextColor,
  PerLinePillBackground,
  resolveFontFamily,
  TEXT_PILL_PADDING_RATIO,
  TEXT_PILL_RADIUS_RATIO,
  TEXT_PILL_VERTICAL_PADDING_RATIO,
  type PhotoCustomFont,
  type PhotoFontDefinition,
} from '../text';

const SCRIM_BG = 'rgba(0,0,0,0.65)';
const SCRIM_TEXT = '#FFFFFF';
const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.75)';
const SCRIM_BORDER = 'rgba(255,255,255,0.35)';
const SCRIM_CHIP_BG = 'rgba(255,255,255,0.10)';
const SCRIM_CHIP_BG_ACTIVE = 'rgba(255,255,255,0.16)';

const PILL_HEIGHT = 36;
const PILL_RADIUS = 999;
const PILL_PADDING_H = 18;

/** HIG minimum 44pt hit target. */
const CONTROL_TARGET_SIZE = 44;

const ALIGN_CYCLE: readonly TextAlign[] = ['left', 'center', 'right'];

const ALIGN_ICON: Record<TextAlign, EditorIconName> = {
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
};

const ALIGN_LABEL_KEY = {
  left: 'textAlignLeft',
  center: 'textAlignCenter',
  right: 'textAlignRight',
} as const;

const DEFAULT_BACKGROUND_COLOR = '#000000';

/** Built-in swatch palette; shared with the Draw tool for a single editor palette. */
export const DEFAULT_TEXT_COLORS: readonly string[] = [
  '#FFFFFF',
  '#000000',
  '#8E8E93',
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#00C7BE',
  '#4F8EF7',
  '#AF52DE',
  '#FF2D55',
  '#A2845E',
];

type PaintTarget = 'text' | 'background';

export interface TextFocusEditorProps {
  session: TextFocusSession;
  customFonts?: readonly PhotoCustomFont[];
  /** Optional palette override. */
  textColors?: readonly string[];
  /** Commit draft; parent owns the reducer dispatch policy (add/update/remove). */
  onDone: (result: TextFocusResult) => void;
  onCancel: () => void;
}

/** Existing session carries the source layer; new carries only initial style. */
export type TextFocusSession =
  { kind: 'new'; initial: TextDraftFields } | { kind: 'existing'; layer: TextLayer };

/** Editable subset of a TextLayer (excludes transform + id). */
export interface TextDraftFields {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  background: string | null;
  fontId: string;
}

export interface TextFocusResult {
  session: TextFocusSession;
  draft: TextDraftFields;
}

function sessionToDraft(session: TextFocusSession): TextDraftFields {
  if (session.kind === 'new') return session.initial;
  const { text, color, bold, italic, align, background, fontId } = session.layer;
  return { text, color, bold, italic, align, background, fontId };
}

/** Full-screen Instagram Stories-style text editor: draft-local edits commit as one reducer action on Done. */
export function TextFocusEditor({
  session,
  customFonts,
  textColors,
  onDone,
  onCancel,
}: TextFocusEditorProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const insets = useSafeAreaInsets();
  const [setFontRowRef, onFontRowContentSizeChange] = useRtlHorizontalScrollLanding();
  const [setColorRowRef, onColorRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const textInputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState<TextDraftFields>(() => sessionToDraft(session));

  const [paintTarget, setPaintTarget] = useState<PaintTarget>('text');
  const [customPickerOpen, setCustomPickerOpen] = useState(false);

  const palette = textColors && textColors.length > 0 ? textColors : DEFAULT_TEXT_COLORS;
  const fontRoster: readonly PhotoFontDefinition[] = useMemo(
    () => (customFonts ? [...BUILT_IN_FONTS, ...customFonts] : BUILT_IN_FONTS),
    [customFonts]
  );

  const hasBackground = draft.background != null;
  const backgroundActive = hasBackground && paintTarget === 'background';

  const paletteRefColor = backgroundActive
    ? ((draft.background ?? DEFAULT_BACKGROUND_COLOR) as string)
    : draft.color;

  const previewFontFamily = resolveFontFamily(draft.fontId, customFonts);

  // Reclaims TextInput focus in the same commit if a Pressable blurred it (keyboard never dips).
  const refocusInput = () => {
    if (textInputRef.current && !textInputRef.current.isFocused()) {
      textInputRef.current.focus();
    }
  };

  const patch = (fields: Partial<TextDraftFields>) => {
    setDraft((prev) => ({ ...prev, ...fields }));
    refocusInput();
  };

  const handleSwatch = (color: string) => {
    setCustomPickerOpen(false);
    if (backgroundActive) {
      patch({ background: color });
    } else {
      patch({ color });
    }
  };

  const handleToggleBackground = () => {
    if (hasBackground) {
      setPaintTarget('text');
      patch({ background: null });
    } else {
      patch({
        background: DEFAULT_BACKGROUND_COLOR,
        color: contrastTextColor(DEFAULT_BACKGROUND_COLOR),
      });
      setPaintTarget('background');
    }
  };

  const handleAlignCycle = () => {
    const idx = ALIGN_CYCLE.indexOf(draft.align);
    patch({ align: ALIGN_CYCLE[(idx + 1) % ALIGN_CYCLE.length] });
  };

  const handleCycleFont = () => {
    const idx = fontRoster.findIndex((f) => f.id === draft.fontId);
    const next = fontRoster[(idx + 1) % Math.max(1, fontRoster.length)];
    if (next) patch({ fontId: next.id });
  };

  const handleDone = () => {
    Keyboard.dismiss();
    onDone({ session, draft });
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    onCancel();
  };

  const customActive = !palette.some((c) => equalsHex(c, paletteRefColor));

  const commitLabel = t(session.kind === 'new' ? 'add' : 'update');

  const currentFont = fontRoster.find((f) => f.id === draft.fontId) ?? fontRoster[0];
  const currentFontFamily = currentFont
    ? resolveFontFamily(currentFont.id, customFonts)
    : undefined;

  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: SCRIM_BG }]}>
      <View
        style={[
          styles.topBar,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            paddingTop: insets.top + theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
          },
        ]}>
        <Pressable
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
          hitSlop={12}
          style={({ pressed }) => [styles.headerIconButton, { opacity: pressed ? 0.6 : 1 }]}>
          <EditorIcon name="close" size={26} color={SCRIM_TEXT} />
        </Pressable>
        <View style={styles.headerSpacer} />
        <Pressable
          onPress={handleDone}
          accessibilityRole="button"
          accessibilityLabel={commitLabel}
          hitSlop={8}
          style={({ pressed }) => [
            styles.pillPrimary,
            {
              backgroundColor: theme.colors.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.pillLabel, { color: theme.colors.onAccent }]}>{commitLabel}</Text>
        </Pressable>
      </View>

      {/* 'padding' on Android too: edge-to-edge (Expo 53+) stops the window from resizing
          for the keyboard, which left the dock buried under it. KAV pads only by the
          keyboard/frame OVERLAP, so legacy adjustResize apps don't double-shift. */}
      <KeyboardAvoidingView style={styles.body} behavior="padding">
        <View style={styles.inputCenter} pointerEvents="box-none">
          <View style={styles.inputBubble}>
            <FocusTextInputWithPill
              draft={draft}
              previewFontFamily={previewFontFamily}
              placeholder={t('typeHere')}
              placeholderTextColor={hasBackground ? 'rgba(255,255,255,0.55)' : SCRIM_TEXT_MUTED}
              onChangeText={(text) => setDraft((prev) => ({ ...prev, text }))}
              textInputRef={textInputRef}
            />
          </View>
        </View>

        <View
          style={[
            styles.dock,
            {
              paddingBottom: insets.bottom + theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ]}>
          {/* keyboardShouldPersistTaps='always' glues focus to the TextInput across swatch taps. */}
          <ScrollView
            ref={setColorRowRef}
            onContentSizeChange={onColorRowContentSizeChange}
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: isRTL ? 'row-reverse' : 'row',
              gap: theme.spacing.sm,
              alignItems: 'center',
              paddingHorizontal: theme.spacing.xs,
            }}>
            {palette.map((color) => {
              const active = !customActive && equalsHex(paletteRefColor, color);
              return (
                <Pressable
                  key={color}
                  onPress={() => handleSwatch(color)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  hitSlop={8}
                  style={[
                    styles.swatchRing,
                    {
                      borderWidth: active ? 2 : 0,
                      borderColor: active ? theme.colors.accent : 'transparent',
                    },
                  ]}>
                  <View
                    style={[styles.swatch, { backgroundColor: color, borderColor: SCRIM_BORDER }]}
                  />
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                setCustomPickerOpen((cur) => !cur);
                refocusInput();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('customColor')}
              accessibilityState={{ selected: customActive, expanded: customPickerOpen }}
              hitSlop={8}
              style={[
                styles.swatchRing,
                {
                  borderWidth: customActive ? 2 : 0,
                  borderColor: customActive ? theme.colors.accent : 'transparent',
                },
              ]}>
              <View
                style={[
                  styles.swatch,
                  styles.customSwatch,
                  {
                    backgroundColor: customActive ? paletteRefColor : 'transparent',
                    borderColor: SCRIM_BORDER,
                  },
                ]}>
                {!customActive && <EditorIcon name="add" size={16} color={SCRIM_TEXT} />}
              </View>
            </Pressable>
          </ScrollView>

          {customPickerOpen && <TextColorPicker value={paletteRefColor} onChange={handleSwatch} />}

          {hasBackground && (
            <View
              style={[
                styles.segmentGroup,
                {
                  flexDirection: isRTL ? 'row-reverse' : 'row',
                  borderRadius: theme.radius.md,
                },
              ]}>
              <PaintTargetSegment
                label={t('paintTargetText')}
                active={paintTarget === 'text'}
                onPress={() => {
                  setPaintTarget('text');
                  refocusInput();
                }}
              />
              <PaintTargetSegment
                label={t('paintTargetBackground')}
                active={paintTarget === 'background'}
                onPress={() => {
                  setPaintTarget('background');
                  refocusInput();
                }}
              />
            </View>
          )}

          <View
            style={{
              flexDirection: isRTL ? 'row-reverse' : 'row',
              gap: theme.spacing.sm,
              alignItems: 'center',
            }}>
            <FontChip
              label={currentFont?.displayName ?? 'Aa'}
              fontFamily={currentFontFamily}
              onPress={handleCycleFont}
              a11yLabel={`${t('textFont')} — ${currentFont?.displayName ?? ''}`}
            />
            <StyleToggle
              icon="bold"
              label={t('bold')}
              active={draft.bold}
              onPress={() => patch({ bold: !draft.bold })}
            />
            <StyleToggle
              icon="italic"
              label={t('italic')}
              active={draft.italic}
              onPress={() => patch({ italic: !draft.italic })}
            />
            <StyleToggle
              icon={ALIGN_ICON[draft.align]}
              label={t(ALIGN_LABEL_KEY[draft.align])}
              active={draft.align !== 'center'}
              onPress={handleAlignCycle}
            />
            <View style={styles.toolbarSpacer} />
            <BackgroundToggle
              active={hasBackground}
              label={t(hasBackground ? 'textBackgroundOff' : 'textBackgroundOn')}
              onPress={handleToggleBackground}
            />
          </View>

          <ScrollView
            ref={setFontRowRef}
            onContentSizeChange={onFontRowContentSizeChange}
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: isRTL ? 'row-reverse' : 'row',
              gap: theme.spacing.xs,
              alignItems: 'center',
              paddingHorizontal: theme.spacing.xs,
            }}>
            {fontRoster.map((font) => {
              const active = draft.fontId === font.id;
              const family = resolveFontFamily(font.id, customFonts);
              return (
                <Pressable
                  key={font.id}
                  onPress={() => patch({ fontId: font.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('textFont')} — ${font.displayName}`}
                  accessibilityState={{ selected: active }}
                  hitSlop={6}
                  style={[
                    styles.fontChip,
                    {
                      backgroundColor: active ? theme.colors.accent : SCRIM_CHIP_BG,
                      borderColor: active ? theme.colors.accent : SCRIM_BORDER,
                      borderRadius: theme.radius.md,
                      paddingHorizontal: theme.spacing.sm,
                    },
                  ]}>
                  <Text
                    style={{
                      color: active ? theme.colors.onAccent : SCRIM_TEXT,
                      fontFamily: family,
                      fontSize: 15,
                    }}>
                    {font.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

interface StyleToggleProps {
  icon: EditorIconName;
  label: string;
  active: boolean;
  onPress: () => void;
}

function StyleToggle({ icon, label, active, onPress }: StyleToggleProps) {
  const theme = useEditorTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.styleToggle,
        {
          borderColor: active ? theme.colors.accent : 'transparent',
          backgroundColor: active ? theme.colors.accent : SCRIM_CHIP_BG,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <EditorIcon name={icon} size={22} color={active ? theme.colors.onAccent : SCRIM_TEXT} />
    </Pressable>
  );
}

interface FontChipProps {
  label: string;
  fontFamily?: string;
  onPress: () => void;
  a11yLabel: string;
}

function FontChip({ label, fontFamily, onPress, a11yLabel }: FontChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.fontAaChip,
        {
          backgroundColor: SCRIM_CHIP_BG,
          borderColor: 'transparent',
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        style={{
          color: SCRIM_TEXT,
          fontFamily,
          fontSize: 18,
          fontWeight: '700',
        }}
        numberOfLines={1}>
        {label.length > 3 ? 'Aa' : label}
      </Text>
    </Pressable>
  );
}

interface BackgroundToggleProps {
  active: boolean;
  label: string;
  onPress: () => void;
}

function BackgroundToggle({ active, label, onPress }: BackgroundToggleProps) {
  const theme = useEditorTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={10}
      style={({ pressed }) => [
        styles.bgToggle,
        {
          backgroundColor: active ? theme.colors.accent : SCRIM_CHIP_BG,
          borderColor: active ? theme.colors.accent : SCRIM_BORDER,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <EditorIcon
        name="backgroundFill"
        size={20}
        color={active ? theme.colors.onAccent : SCRIM_TEXT}
      />
    </Pressable>
  );
}

interface PaintTargetSegmentProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function PaintTargetSegment({ label, active, onPress }: PaintTargetSegmentProps) {
  const theme = useEditorTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: active ? theme.colors.accent : SCRIM_CHIP_BG_ACTIVE,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        style={{
          color: active ? theme.colors.onAccent : SCRIM_TEXT,
          fontWeight: active ? '700' : '500',
          fontSize: 13,
          letterSpacing: 0.2,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

// Wraps in PerLinePillBackground when the pill is on so preview matches LayerOverlay/Skia.
function FocusTextInputWithPill({
  draft,
  previewFontFamily,
  placeholder,
  placeholderTextColor,
  onChangeText,
  textInputRef,
}: {
  draft: TextDraftFields;
  previewFontFamily?: string;
  placeholder: string;
  placeholderTextColor: string;
  onChangeText: (text: string) => void;
  textInputRef: React.RefObject<TextInput | null>;
}) {
  const hasBackground = draft.background != null;
  const editorFontSize = 36;
  const padH = editorFontSize * TEXT_PILL_PADDING_RATIO;
  // padV >= pillRadius so per-line pills overlap and hide corner arcs.
  const padV = editorFontSize * TEXT_PILL_VERTICAL_PADDING_RATIO;
  const pillRadius = editorFontSize * TEXT_PILL_RADIUS_RATIO;

  // Shared with the pill's measurement mirror (identical widths); alignSelf:stretch locks the input's width — Android reflows one char/frame otherwise.
  const textStyle = {
    color: draft.color,
    fontFamily: previewFontFamily,
    fontWeight: draft.bold ? ('700' as const) : ('400' as const),
    fontStyle: draft.italic ? ('italic' as const) : ('normal' as const),
    fontSize: editorFontSize,
    lineHeight: 44,
    padding: 0,
    includeFontPadding: false,
    textAlign: draft.align,
    alignSelf: 'stretch' as const,
    textShadowColor: hasBackground ? 'transparent' : 'rgba(0,0,0,0.5)',
    textShadowRadius: hasBackground ? 0 : 3,
  };

  const input = (
    <TextInput
      ref={textInputRef}
      autoFocus
      multiline
      showSoftInputOnFocus
      submitBehavior="newline"
      allowFontScaling={false}
      textBreakStrategy="highQuality"
      value={draft.text}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      style={textStyle}
    />
  );

  if (!hasBackground) return input;

  return (
    <PerLinePillBackground
      text={draft.text.length > 0 ? draft.text : placeholder}
      textStyle={textStyle}
      background={draft.background as string}
      borderRadius={pillRadius}
      paddingHorizontal={padH}
      paddingVertical={padV}
      align={draft.align}>
      {input}
    </PerLinePillBackground>
  );
}

function equalsHex(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const styles = StyleSheet.create({
  scrim: {
    zIndex: 100,
  },
  topBar: {
    alignItems: 'center',
    minHeight: CONTROL_TARGET_SIZE,
  },
  headerSpacer: {
    flex: 1,
  },
  headerIconButton: {
    width: CONTROL_TARGET_SIZE,
    height: CONTROL_TARGET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPrimary: {
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    paddingHorizontal: PILL_PADDING_H,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  body: {
    flex: 1,
  },
  inputCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBubble: {
    width: '85%',
  },
  dock: {},
  toolbarSpacer: {
    flex: 1,
  },
  swatchRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customSwatch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fontChip: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontAaChip: {
    width: CONTROL_TARGET_SIZE,
    height: CONTROL_TARGET_SIZE,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleToggle: {
    borderWidth: StyleSheet.hairlineWidth,
    width: CONTROL_TARGET_SIZE,
    height: CONTROL_TARGET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgToggle: {
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: CONTROL_TARGET_SIZE,
    height: CONTROL_TARGET_SIZE,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentGroup: {
    borderColor: SCRIM_BORDER,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
