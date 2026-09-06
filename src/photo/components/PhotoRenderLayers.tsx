import {
  FontSlant,
  FontWeight,
  Group,
  RoundedRect,
  Paragraph as SkiaParagraph,
  Image as SkiaImage,
  Skia,
  TextAlign,
  type SkImage,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import React, { useMemo } from 'react';

import type { PhotoLayer, PhotoStickerPack, StickerLayer, TextLayer } from '../layers';
import {
  breakTextIntoLines,
  resolveFontFamilies,
  TEXT_MAX_WIDTH_FRACTION,
  TEXT_PILL_PADDING_RATIO,
  TEXT_PILL_RADIUS_RATIO,
  TEXT_PILL_VERTICAL_PADDING_RATIO,
  type PhotoCustomFont,
} from '../text';

/** Skia renderers for overlay layers (text + stickers), shared by photo + video pipelines. */
export function LayerGlyph({
  layer,
  drawRect,
  baseFontSize,
  baseStickerSize,
  stickerImages,
  customFonts,
  customFontTypefaces,
  stickerPacks: _stickerPacks,
}: {
  layer: PhotoLayer;
  drawRect: { x: number; y: number; width: number; height: number };
  baseFontSize: number;
  baseStickerSize: number;
  stickerImages: Readonly<Record<string, SkImage>>;
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
  stickerPacks?: readonly PhotoStickerPack[];
}) {
  switch (layer.kind) {
    case 'text':
      return (
        <TextGlyph
          item={layer}
          drawRect={drawRect}
          baseFontSize={baseFontSize}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
        />
      );
    case 'sticker':
      return (
        <StickerGlyph
          item={layer}
          drawRect={drawRect}
          baseStickerSize={baseStickerSize}
          stickerImages={stickerImages}
        />
      );
  }
}

function StickerGlyph({
  item,
  drawRect,
  baseStickerSize,
  stickerImages,
}: {
  item: StickerLayer;
  drawRect: { x: number; y: number; width: number; height: number };
  baseStickerSize: number;
  stickerImages: Readonly<Record<string, SkImage>>;
}) {
  const size = baseStickerSize * item.scale;
  const centerX = drawRect.x + item.x * drawRect.width;
  const centerY = drawRect.y + item.y * drawRect.height;

  if (item.content.variant === 'emoji') {
    return (
      <EmojiStickerGlyph
        emoji={item.content.emoji}
        size={size}
        centerX={centerX}
        centerY={centerY}
        rotation={item.rotation}
      />
    );
  }
  const key =
    item.content.variant === 'image'
      ? `image::${item.content.packId}::${item.content.stickerId}`
      : `uri::${item.content.uri}`;
  const skImage = stickerImages[key];
  if (!skImage) return null;
  const imgW = skImage.width();
  const imgH = skImage.height();
  const boxScale = Math.min(size / imgW, size / imgH);
  const drawW = imgW * boxScale;
  const drawH = imgH * boxScale;
  return (
    <Group origin={{ x: centerX, y: centerY }} transform={[{ rotate: item.rotation }]}>
      <SkiaImage
        image={skImage}
        x={centerX - drawW / 2}
        y={centerY - drawH / 2}
        width={drawW}
        height={drawH}
        fit="contain"
      />
    </Group>
  );
}

/** Emoji sticker glyph. Exported for the RN overlay's per-layer <Canvas>. */
export function EmojiStickerGlyph({
  emoji,
  size,
  centerX,
  centerY,
  rotation,
}: {
  emoji: string;
  size: number;
  centerX: number;
  centerY: number;
  rotation: number;
}) {
  const paragraph = useMemo(() => {
    const fontSize = size * 0.85;
    const b = Skia.ParagraphBuilder.Make({
      textAlign: TextAlign.Center,
      textStyle: { color: Skia.Color('white'), fontSize },
    });
    b.addText(emoji);
    const p = b.build();
    p.layout(size);
    return p;
  }, [emoji, size]);

  const paragraphHeight = paragraph.getHeight();
  const topLeftX = centerX - size / 2;
  const topLeftY = centerY - paragraphHeight / 2;

  return (
    <Group origin={{ x: centerX, y: centerY }} transform={[{ rotate: rotation }]}>
      <SkiaParagraph paragraph={paragraph} x={topLeftX} y={topLeftY} width={size} />
    </Group>
  );
}

function TextGlyph({
  item,
  drawRect,
  baseFontSize,
  customFonts,
  customFontTypefaces,
}: {
  item: TextLayer;
  drawRect: { x: number; y: number; width: number; height: number };
  baseFontSize: number;
  customFonts?: readonly PhotoCustomFont[];
  customFontTypefaces: SkTypefaceFontProvider | null;
}) {
  const fontSize = baseFontSize * item.scale;
  const padH = fontSize * TEXT_PILL_PADDING_RATIO;
  // padV >= pillRadius so per-line pills overlap and hide corner arcs.
  const padV = fontSize * TEXT_PILL_VERTICAL_PADDING_RATIO;
  const pillRadius = fontSize * TEXT_PILL_RADIUS_RATIO;
  const wrapWidth =
    drawRect.width * TEXT_MAX_WIDTH_FRACTION - (item.background != null ? padH * 2 : 0);
  const familyList = useMemo(
    () => resolveFontFamilies(item.fontId, customFonts),
    [item.fontId, customFonts]
  );

  const brokenText = useMemo(
    () =>
      breakTextIntoLines({
        text: item.text,
        fontId: item.fontId,
        bold: item.bold,
        italic: item.italic,
        align: item.align,
        wrapWidthPx: wrapWidth,
        fontSizePx: fontSize,
        customFonts,
        customFontTypefaces,
      }),
    [
      item.text,
      item.fontId,
      item.bold,
      item.italic,
      item.align,
      wrapWidth,
      fontSize,
      customFonts,
      customFontTypefaces,
    ]
  );

  const paragraph = useMemo(() => {
    const alignEnum =
      item.align === 'left'
        ? TextAlign.Left
        : item.align === 'right'
          ? TextAlign.Right
          : TextAlign.Center;
    const paragraphStyle = {
      textAlign: alignEnum,
      textStyle: {
        color: Skia.Color(item.color),
        fontSize,
        fontFamilies: familyList,
        fontStyle: {
          weight: item.bold ? FontWeight.Bold : FontWeight.Normal,
          slant: item.italic ? FontSlant.Italic : FontSlant.Upright,
        },
      },
    };
    const builder = customFontTypefaces
      ? Skia.ParagraphBuilder.Make(paragraphStyle, customFontTypefaces)
      : Skia.ParagraphBuilder.Make(paragraphStyle);
    builder.addText(brokenText);
    const p = builder.build();
    p.layout(1e6);
    return p;
  }, [
    brokenText,
    item.color,
    item.align,
    item.bold,
    item.italic,
    fontSize,
    familyList,
    customFontTypefaces,
  ]);

  const paragraphHeight = paragraph.getHeight();
  const longestLine = paragraph.getLongestLine();
  const centerX = drawRect.x + item.x * drawRect.width;
  const centerY = drawRect.y + item.y * drawRect.height;

  const RENDER_BOX_WIDTH = 1e6;
  const topLeftY = centerY - paragraphHeight / 2;
  const paintX =
    item.align === 'left'
      ? centerX - longestLine / 2
      : item.align === 'right'
        ? centerX + longestLine / 2 - RENDER_BOX_WIDTH
        : centerX - RENDER_BOX_WIDTH / 2;

  // IG-style per-line pills: adjacent pills overlap by 2*padV so uniformly-rounded corners hide inside
  // the overlap and the chain reads as one merged shape. Cumulative line heights avoid ascent-sign drift.
  const backgroundRects = useMemo(() => {
    if (item.background == null) return null;
    const metrics = paragraph.getLineMetrics();
    if (metrics.length === 0) return null;
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    let cursorY = topLeftY;
    for (let i = 0; i < metrics.length; i++) {
      const line = metrics[i]!;
      const lineTop = cursorY;
      cursorY += line.height;
      rects.push({
        x: paintX + line.left - padH,
        y: lineTop - padV,
        width: line.width + padH * 2,
        height: line.height + padV * 2,
      });
    }
    return rects;
  }, [paragraph, item.background, paintX, topLeftY, padH, padV]);

  // Local const so the map callback below narrows cleanly.
  const backgroundColor = item.background;

  return (
    <Group origin={{ x: centerX, y: centerY }} transform={[{ rotate: item.rotation }]}>
      {backgroundRects != null &&
        backgroundColor != null &&
        backgroundRects.map((rect, i) => (
          <RoundedRect
            key={i}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            r={pillRadius}
            color={backgroundColor}
          />
        ))}
      <SkiaParagraph paragraph={paragraph} x={paintX} y={topLeftY} width={RENDER_BOX_WIDTH} />
    </Group>
  );
}
