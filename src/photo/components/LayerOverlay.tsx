/* eslint-disable react-hooks/immutability -- Reanimated shared values are hook-owned mutable containers. Worklets assign to `.value` on the UI thread; that is the intended API and not a component-prop mutation. */
import { Canvas, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import {
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EmojiStickerGlyph } from './PhotoRender';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import {
  LAYER_SCALE_MAX,
  LAYER_SCALE_MIN,
  resolveImageSticker,
  type PhotoLayer,
  type PhotoStickerPack,
  type StickerLayer,
  type TextLayer,
  type ReorderDirection,
} from '../layers';
import {
  breakTextIntoLines,
  PerLinePillBackground,
  resolveFontFamily,
  TEXT_MAX_WIDTH_FRACTION,
  TEXT_PILL_PADDING_RATIO,
  TEXT_PILL_RADIUS_RATIO,
  TEXT_PILL_VERTICAL_PADDING_RATIO,
  type PhotoCustomFont,
} from '../text';

export interface LayerOverlayProps {
  layers: PhotoLayer[];
  displayRect: { x: number; y: number; width: number; height: number };
  selectedId: string | null;
  baseFontSize: number;
  /** Base sticker size in view px; VISIBLE box is `baseStickerSize * scale`. */
  baseStickerSize: number;
  stickerPacks?: readonly PhotoStickerPack[];
  customFonts?: readonly PhotoCustomFont[];
  /** Skia typeface provider so the overlay-side line breaker shapes with the same typefaces as export. */
  customFontTypefaces: SkTypefaceFontProvider | null;
  onCommit: (
    id: string,
    transform: { x: number; y: number; scale: number; rotation: number }
  ) => void;
  onSelect: (id: string) => void;
  /** Fired on second tap of an already-selected layer (parent opens the focus editor for text). */
  onActivateLayer?: (layer: PhotoLayer) => void;
  onDeselect?: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, direction: ReorderDirection) => void;
}

// Position: 2% of image dim; rotation: ~3° in radians.
const POSITION_SNAP = 0.02;
const ROTATION_SNAP = (3 * Math.PI) / 180;
const ROTATION_ANCHORS = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI];

export function LayerOverlay({
  layers,
  displayRect,
  selectedId,
  baseFontSize,
  baseStickerSize,
  stickerPacks,
  customFonts,
  customFontTypefaces,
  onCommit,
  onSelect,
  onActivateLayer,
  onDeselect,
  onDelete,
  onDuplicate,
  onReorder,
}: LayerOverlayProps) {
  const theme = useEditorTheme();
  const showVerticalGuide = useSharedValue(0);
  const showHorizontalGuide = useSharedValue(0);

  const verticalStyle = useAnimatedStyle(() => ({ opacity: showVerticalGuide.value }));
  const horizontalStyle = useAnimatedStyle(() => ({ opacity: showHorizontalGuide.value }));

  const selectedLayer = selectedId ? (layers.find((l) => l.id === selectedId) ?? null) : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Background tap catcher: rendered first so per-layer GestureDetectors handle touches on layers before reaching this Pressable. */}
      {onDeselect ? (
        <Pressable
          onPress={onDeselect}
          accessibilityRole="button"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {layers.map((layer) => (
        <DraggableLayer
          key={layer.id}
          layer={layer}
          displayRect={displayRect}
          selected={selectedId === layer.id}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerPacks={stickerPacks}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
          onCommit={onCommit}
          onSelect={onSelect}
          onActivate={onActivateLayer}
          showVerticalGuide={showVerticalGuide}
          showHorizontalGuide={showHorizontalGuide}
        />
      ))}

      <Animated.View
        pointerEvents="none"
        style={[
          styles.guide,
          {
            left: displayRect.x + displayRect.width / 2 - 0.5,
            top: displayRect.y,
            width: 1,
            height: displayRect.height,
            backgroundColor: theme.colors.accent,
          },
          verticalStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.guide,
          {
            left: displayRect.x,
            top: displayRect.y + displayRect.height / 2 - 0.5,
            width: displayRect.width,
            height: 1,
            backgroundColor: theme.colors.accent,
          },
          horizontalStyle,
        ]}
      />

      {/* Rendered OUTSIDE per-layer GestureDetectors so button taps never race pan/pinch/tap. */}
      {selectedLayer && (
        <LayerActionBar
          displayRect={displayRect}
          layer={selectedLayer}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onReorder={onReorder}
        />
      )}
    </View>
  );
}

interface DraggableLayerProps {
  layer: PhotoLayer;
  displayRect: LayerOverlayProps['displayRect'];
  selected: boolean;
  baseFontSize: number;
  baseStickerSize: number;
  stickerPacks?: readonly PhotoStickerPack[];
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
  onCommit: LayerOverlayProps['onCommit'];
  onSelect: LayerOverlayProps['onSelect'];
  onActivate?: LayerOverlayProps['onActivateLayer'];
  showVerticalGuide: ReturnType<typeof useSharedValue<number>>;
  showHorizontalGuide: ReturnType<typeof useSharedValue<number>>;
}

function DraggableLayer({
  layer,
  displayRect,
  selected,
  baseFontSize,
  baseStickerSize,
  stickerPacks,
  customFonts,
  customFontTypefaces,
  onCommit,
  onSelect,
  onActivate,
  showVerticalGuide,
  showHorizontalGuide,
}: DraggableLayerProps) {
  const theme = useEditorTheme();

  // Live center in view px — UI-thread single source of truth. Gestures write it directly; on release
  // we commit the normalized value without any reset, so there's no reducer-round-trip flicker.
  const centerXPx = useSharedValue(displayRect.x + layer.x * displayRect.width);
  const centerYPx = useSharedValue(displayRect.y + layer.y * displayRect.height);

  // Last-committed normalized values + cached rect: lets the sync effect distinguish
  // "reducer echoed our commit" (skip) from "container resized" (re-project).
  const lastCommittedX = useSharedValue(layer.x);
  const lastCommittedY = useSharedValue(layer.y);
  const lastRectX = useSharedValue(displayRect.x);
  const lastRectY = useSharedValue(displayRect.y);
  const lastRectW = useSharedValue(displayRect.width);
  const lastRectH = useSharedValue(displayRect.height);

  const scale = useSharedValue(layer.scale);
  const rotation = useSharedValue(layer.rotation);
  const scaleStart = useSharedValue(layer.scale);
  const rotationStart = useSharedValue(layer.rotation);

  // Raw finger travel + pan start so snap can override applied position without eating subsequent movement.
  const rawTranslateX = useSharedValue(0);
  const rawTranslateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  const measuredW = useSharedValue(0);
  const measuredH = useSharedValue(0);

  // Re-project position only on external updates or rect resize — never on our own reducer echo (release flicker).
  useEffect(() => {
    const rectChanged =
      lastRectX.value !== displayRect.x ||
      lastRectY.value !== displayRect.y ||
      lastRectW.value !== displayRect.width ||
      lastRectH.value !== displayRect.height;
    if (layer.x !== lastCommittedX.value || rectChanged) {
      centerXPx.value = displayRect.x + layer.x * displayRect.width;
      lastCommittedX.value = layer.x;
    }
    if (layer.y !== lastCommittedY.value || rectChanged) {
      centerYPx.value = displayRect.y + layer.y * displayRect.height;
      lastCommittedY.value = layer.y;
    }
    lastRectX.value = displayRect.x;
    lastRectY.value = displayRect.y;
    lastRectW.value = displayRect.width;
    lastRectH.value = displayRect.height;
    scale.value = layer.scale;
    rotation.value = layer.rotation;
  }, [
    layer.x,
    layer.y,
    layer.scale,
    layer.rotation,
    displayRect.x,
    displayRect.y,
    displayRect.width,
    displayRect.height,
    centerXPx,
    centerYPx,
    scale,
    rotation,
    lastCommittedX,
    lastCommittedY,
    lastRectX,
    lastRectY,
    lastRectW,
    lastRectH,
  ]);

  const rectX = displayRect.x;
  const rectY = displayRect.y;
  const rectW = displayRect.width;
  const rectH = displayRect.height;

  const gestures = useMemo(() => {
    const commit = (cxPx: number, cyPx: number, s: number, r: number) => {
      const nx = clamp01((cxPx - rectX) / rectW);
      const ny = clamp01((cyPx - rectY) / rectH);
      onCommit(layer.id, { x: nx, y: ny, scale: s, rotation: r });
    };

    // First tap selects, second tap on already-selected activates (opens focus editor for text).
    const wasSelected = selected;
    const tap = Gesture.Tap()
      .maxDistance(8)
      .onEnd(() => {
        if (wasSelected && onActivate) {
          runOnJS(onActivate)(layer);
        } else {
          runOnJS(onSelect)(layer.id);
        }
      });

    const pan = Gesture.Pan()
      .minDistance(2)
      .onStart(() => {
        panStartX.value = centerXPx.value;
        panStartY.value = centerYPx.value;
        rawTranslateX.value = 0;
        rawTranslateY.value = 0;
        runOnJS(onSelect)(layer.id);
      })
      .onChange((e) => {
        rawTranslateX.value += e.changeX;
        rawTranslateY.value += e.changeY;

        const proposedX = panStartX.value + rawTranslateX.value;
        const proposedY = panStartY.value + rawTranslateY.value;

        const rectCenterX = rectX + rectW / 2;
        const rectCenterY = rectY + rectH / 2;
        const snapPxX = POSITION_SNAP * rectW;
        const snapPxY = POSITION_SNAP * rectH;

        if (Math.abs(proposedX - rectCenterX) < snapPxX) {
          centerXPx.value = rectCenterX;
          showVerticalGuide.value = withTiming(1, { duration: 90 });
        } else {
          centerXPx.value = proposedX;
          showVerticalGuide.value = withTiming(0, { duration: 140 });
        }
        if (Math.abs(proposedY - rectCenterY) < snapPxY) {
          centerYPx.value = rectCenterY;
          showHorizontalGuide.value = withTiming(1, { duration: 90 });
        } else {
          centerYPx.value = proposedY;
          showHorizontalGuide.value = withTiming(0, { duration: 140 });
        }
      })
      .onFinalize(() => {
        showVerticalGuide.value = withTiming(0, { duration: 160 });
        showHorizontalGuide.value = withTiming(0, { duration: 160 });
        // Pre-write the committed normalized values so the sync effect no-ops on the reducer round-trip.
        const nx = clamp01((centerXPx.value - rectX) / rectW);
        const ny = clamp01((centerYPx.value - rectY) / rectH);
        lastCommittedX.value = nx;
        lastCommittedY.value = ny;
        runOnJS(commit)(centerXPx.value, centerYPx.value, scale.value, rotation.value);
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        scaleStart.value = scale.value;
      })
      .onChange((e) => {
        const next = scaleStart.value * e.scale;
        scale.value = Math.min(LAYER_SCALE_MAX, Math.max(LAYER_SCALE_MIN, next));
      })
      .onFinalize(() => {
        const nx = clamp01((centerXPx.value - rectX) / rectW);
        const ny = clamp01((centerYPx.value - rectY) / rectH);
        lastCommittedX.value = nx;
        lastCommittedY.value = ny;
        runOnJS(commit)(centerXPx.value, centerYPx.value, scale.value, rotation.value);
      });

    const rotate = Gesture.Rotation()
      .onStart(() => {
        rotationStart.value = rotation.value;
      })
      .onChange((e) => {
        let next = rotationStart.value + e.rotation;
        for (const anchor of ROTATION_ANCHORS) {
          if (Math.abs(next - anchor) < ROTATION_SNAP) {
            next = anchor;
            break;
          }
        }
        rotation.value = next;
      })
      .onFinalize(() => {
        const nx = clamp01((centerXPx.value - rectX) / rectW);
        const ny = clamp01((centerYPx.value - rectY) / rectH);
        lastCommittedX.value = nx;
        lastCommittedY.value = ny;
        runOnJS(commit)(centerXPx.value, centerYPx.value, scale.value, rotation.value);
      });

    return Gesture.Simultaneous(tap, pan, pinch, rotate);
  }, [
    layer,
    rectX,
    rectY,
    rectW,
    rectH,
    onCommit,
    onSelect,
    onActivate,
    selected,
    centerXPx,
    centerYPx,
    rawTranslateX,
    rawTranslateY,
    panStartX,
    panStartY,
    scale,
    rotation,
    scaleStart,
    rotationStart,
    lastCommittedX,
    lastCommittedY,
    showVerticalGuide,
    showHorizontalGuide,
  ]);

  // Shell owns absolute scale; content lays out at constant size. Sizing via Fabric commits
  // instead would race the worklet transform and flash one frame double-scaled.
  const animatedStyle = useAnimatedStyle(() => ({
    left: centerXPx.value - measuredW.value / 2,
    top: centerYPx.value - measuredH.value / 2,
    transform: [{ rotate: `${rotation.value}rad` }, { scale: scale.value }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    measuredW.value = event.nativeEvent.layout.width;
    measuredH.value = event.nativeEvent.layout.height;
  };

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View
        onLayout={handleLayout}
        style={[
          {
            position: 'absolute',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: selected ? 1 : 0,
            borderColor: theme.colors.accent,
            borderStyle: 'dashed',
            padding: SELECTION_INSET,
          },
          animatedStyle,
        ]}>
        <LayerContent
          layer={layer}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerPacks={stickerPacks}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
          displayRectWidth={displayRect.width}
        />
        {selected ? <SelectionHandles /> : null}
      </Animated.View>
    </GestureDetector>
  );
}

const SELECTION_INSET = 6;
const HANDLE_SIZE = 12;

/** Four accent discs at the corners of the selected layer box. */
function SelectionHandles() {
  const theme = useEditorTheme();
  const dotStyle = {
    position: 'absolute' as const,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: theme.colors.accent,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  };
  const offset = -HANDLE_SIZE / 2;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[dotStyle, { top: offset, left: offset }]} />
      <View style={[dotStyle, { top: offset, right: offset }]} />
      <View style={[dotStyle, { bottom: offset, left: offset }]} />
      <View style={[dotStyle, { bottom: offset, right: offset }]} />
    </View>
  );
}

function LayerContent({
  layer,
  baseFontSize,
  baseStickerSize,
  stickerPacks,
  customFonts,
  customFontTypefaces,
  displayRectWidth,
}: {
  layer: PhotoLayer;
  baseFontSize: number;
  baseStickerSize: number;
  stickerPacks?: readonly PhotoStickerPack[];
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
  displayRectWidth: number;
}) {
  switch (layer.kind) {
    case 'text':
      return (
        <TextLayerContent
          layer={layer}
          baseFontSize={baseFontSize}
          displayRectWidth={displayRectWidth}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
        />
      );
    case 'sticker':
      return (
        <StickerLayerContent
          layer={layer}
          baseStickerSize={baseStickerSize}
          stickerPacks={stickerPacks}
        />
      );
  }
}

// Cap on the emoji raster canvas — beyond this the View transform upscales the fixed raster;
// Apple Color Emoji is a bitmap strike anyway so re-rasterizing larger adds no detail.
const EMOJI_CANVAS_MAX_SIZE = 320;

function StickerLayerContent({
  layer,
  baseStickerSize,
  stickerPacks,
}: {
  layer: StickerLayer;
  baseStickerSize: number;
  stickerPacks?: readonly PhotoStickerPack[];
}) {
  // Constant box; shell's animated transform is the sole scale authority (race-free invariant).
  const size = baseStickerSize;
  if (layer.content.variant === 'emoji') {
    // Same EmojiStickerGlyph as export — RN <Text> clips/shifts Apple Color Emoji.
    // Rasterized at LAYER_SCALE_MAX so the shell's transform can upscale losslessly.
    const canvasSize = Math.min(baseStickerSize * LAYER_SCALE_MAX, EMOJI_CANVAS_MAX_SIZE);
    const inset = (size - canvasSize) / 2;
    return (
      <View pointerEvents="none" style={{ width: size, height: size }}>
        <Canvas
          style={{
            position: 'absolute',
            left: inset,
            top: inset,
            width: canvasSize,
            height: canvasSize,
            transform: [{ scale: size / canvasSize }],
          }}>
          <EmojiStickerGlyph
            emoji={layer.content.emoji}
            size={canvasSize}
            centerX={canvasSize / 2}
            centerY={canvasSize / 2}
            rotation={0}
          />
        </Canvas>
      </View>
    );
  }
  if (layer.content.variant === 'uri') {
    if (!layer.content.uri || layer.content.aspectRatio <= 0) {
      return <View style={{ width: size, height: size }} />;
    }
    return (
      <RNImage
        source={{ uri: layer.content.uri }}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }
  const resolved = resolveImageSticker(layer.content.packId, layer.content.stickerId, stickerPacks);
  if (!resolved) {
    return <View style={{ width: size, height: size }} />;
  }
  const rnSource = toRNImageSource(resolved.source);
  if (!rnSource) return <View style={{ width: size, height: size }} />;
  return <RNImage source={rnSource} style={{ width: size, height: size }} resizeMode="contain" />;
}

/** Narrow a Skia DataSourceParam to what RN <Image> accepts; buffers fall through as null. */
function toRNImageSource(source: unknown): { uri: string } | number | null {
  if (typeof source === 'string') return { uri: source };
  if (typeof source === 'number') return source;
  return null;
}

// Screen-overflow guard only; normal content is already pre-broken.
const TEXT_OVERFLOW_SAFETY_FRACTION = 0.95;

// Renders at scale-1 reference size (shell transform applies layer.scale) — pre-broken via
// breakTextIntoLines so RN Text and Skia agree on line breaks. textShadow dropped when a pill is present.
function TextLayerContent({
  layer,
  baseFontSize,
  displayRectWidth,
  customFonts,
  customFontTypefaces,
}: {
  layer: TextLayer;
  baseFontSize: number;
  displayRectWidth: number;
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
}) {
  const fontSize = baseFontSize;
  const padH = fontSize * TEXT_PILL_PADDING_RATIO;
  // padV >= pillRadius so adjacent per-line pills overlap and hide corner radii (merged-silhouette invariant).
  const padV = fontSize * TEXT_PILL_VERTICAL_PADDING_RATIO;
  const pillRadius = fontSize * TEXT_PILL_RADIUS_RATIO;
  const fontFamily = resolveFontFamily(layer.fontId, customFonts);
  const hasBackground = layer.background != null;

  const scale = layer.scale > 0 ? layer.scale : 1;

  // Pre-transform wrap width; after the shell's `scale`, matches the Skia export formula.
  const wrapWidth =
    (displayRectWidth * TEXT_MAX_WIDTH_FRACTION) / scale - (hasBackground ? padH * 2 : 0);
  const brokenText = useMemo(
    () =>
      breakTextIntoLines({
        text: layer.text,
        fontId: layer.fontId,
        bold: layer.bold,
        italic: layer.italic,
        align: layer.align,
        wrapWidthPx: wrapWidth,
        fontSizePx: fontSize,
        customFonts,
        customFontTypefaces,
      }),
    [
      layer.text,
      layer.fontId,
      layer.bold,
      layer.italic,
      layer.align,
      wrapWidth,
      fontSize,
      customFonts,
      customFontTypefaces,
    ]
  );

  // Shared between visible <Text> and PerLinePillBackground's measurement mirror so pills hug identically.
  const textStyle = {
    color: layer.color,
    fontSize,
    // lineHeight = fontSize matches Skia's em-box so multi-line heights align preview↔export.
    lineHeight: fontSize,
    fontFamily,
    fontWeight: layer.bold ? ('700' as const) : ('400' as const),
    fontStyle: layer.italic ? ('italic' as const) : ('normal' as const),
    textAlign: layer.align,
    textShadowColor: hasBackground ? 'transparent' : 'rgba(0,0,0,0.5)',
    textShadowRadius: hasBackground ? 0 : 3,
  };

  const safetyMaxWidth = (displayRectWidth * TEXT_OVERFLOW_SAFETY_FRACTION) / scale;

  if (hasBackground) {
    return (
      <PerLinePillBackground
        text={brokenText}
        textStyle={textStyle}
        background={layer.background as string}
        borderRadius={pillRadius}
        paddingHorizontal={padH}
        paddingVertical={padV}
        align={layer.align}
        maxWidth={safetyMaxWidth}>
        <Text allowFontScaling={false} style={textStyle}>
          {brokenText}
        </Text>
      </PerLinePillBackground>
    );
  }

  return (
    <View style={{ maxWidth: safetyMaxWidth }}>
      <Text allowFontScaling={false} style={textStyle}>
        {brokenText}
      </Text>
    </View>
  );
}

const ACTION_BAR_TOP_OFFSET = 12;

interface LayerActionBarProps {
  displayRect: LayerOverlayProps['displayRect'];
  layer: PhotoLayer;
  onDelete: LayerOverlayProps['onDelete'];
  onDuplicate: LayerOverlayProps['onDuplicate'];
  onReorder: LayerOverlayProps['onReorder'];
}

/** Floating icon bar for the selected layer, anchored to the display rect's top edge. */
function LayerActionBar({
  displayRect,
  layer,
  onDelete,
  onDuplicate,
  onReorder,
}: LayerActionBarProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.actionBarWrapper,
        {
          top: displayRect.y + ACTION_BAR_TOP_OFFSET,
          left: displayRect.x,
          width: displayRect.width,
          alignItems: isRTL ? 'flex-start' : 'flex-end',
        },
      ]}>
      <View
        style={[
          styles.actionBar,
          {
            flexDirection: isRTL ? 'row-reverse' : 'row',
            backgroundColor: theme.colors.overlay,
            borderRadius: theme.radius.md,
            padding: theme.spacing.xs,
            gap: theme.spacing.xs,
          },
        ]}>
        <ActionButton
          icon="sendBackward"
          label={t('sendBackward')}
          onPress={() => onReorder(layer.id, 'sendBackward')}
        />
        <ActionButton
          icon="bringForward"
          label={t('bringForward')}
          onPress={() => onReorder(layer.id, 'bringForward')}
        />
        <ActionButton
          icon="duplicate"
          label={t('duplicate')}
          onPress={() => onDuplicate(layer.id)}
        />
        <ActionButton
          icon="trash"
          label={t('remove')}
          onPress={() => onDelete(layer.id)}
          tint="danger"
        />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: EditorIconName;
  label: string;
  onPress: () => void;
  tint?: 'default' | 'danger';
}) {
  const theme = useEditorTheme();
  const color = tint === 'danger' ? theme.colors.danger : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={styles.actionButton}>
      <EditorIcon name={icon} size={20} color={color} />
    </Pressable>
  );
}

function clamp01(v: number): number {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

const styles = StyleSheet.create({
  guide: {
    position: 'absolute',
  },
  actionBarWrapper: {
    position: 'absolute',
  },
  actionBar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
