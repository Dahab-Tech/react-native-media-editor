import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  absSinCosForAngle,
  maxCropScaleAnywhereForAngle,
  panLimitsForAngle,
} from './straightenMath';
import { type CropViewMode, type NormalizedCrop } from './types';
import { useEditorTheme } from '../theming/ThemeContext';

/** Shared crop overlay for photo and video editors. Operates in normalized [0..1] crop space over a view-px `region`. */

const DEG_TO_RAD = Math.PI / 180;

export interface CropOverlayProps {
  /** Canvas region the overlay lives inside (absoluteFill), in view px. */
  region: { width: number; height: number };
  /** Crop in post-rotation normalized space. */
  crop: NormalizedCrop;
  /** Aspect (w/h) of the displayed image / video, post-rotation. */
  imageAspect: number;
  /** Locked pixel aspect (w/h) — null for free-form. */
  aspectRatio: number | null;
  /** Fine-angle straighten in degrees (photo-only). Default 0 collapses to axis-aligned math. */
  straighten?: number;
  onChange: (crop: NormalizedCrop) => void;
  /** Fired during frame-resize with the live photoRect (photo pull-to-zoom-out). */
  onResizeChange?: (resizePhotoRect: CropView['photoRect']) => void;
  /** Fired at gesture end/cancel. */
  onResizeEnd?: () => void;
  /** Fired once at interaction start so the parent can checkpoint undo history. */
  onInteractionStart?: () => void;
  /** `'fit'` (default, photo) or `'anchored'` (video). See `CropViewMode`. */
  mode?: CropViewMode;
}

export interface CropView {
  /** The visible crop frame, in view px. */
  frame: { x: number; y: number; width: number; height: number };
  /** The rect the FULL rotated image occupies behind the frame, in view px. */
  photoRect: { x: number; y: number; width: number; height: number };
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Edge = 'top' | 'bottom' | 'left' | 'right';

// Invisible touch targets kept large; visual L-bracket is thinner. Do not shrink to match the visual.
// Targets are biased INWARD: a full-screen crop leaves corners only CROP_FRAME_MARGIN (16px) from the
// display edge — Android eats outward touches there (parent-bounds clipping + back-gesture strip).
const CORNER_TOUCH_SIZE = 56;
const CORNER_TOUCH_OUTSET = 12;
/** Inward reach of a corner target; edge strips inset by this so corners win at intersections. */
const CORNER_TOUCH_INSET = CORNER_TOUCH_SIZE - CORNER_TOUCH_OUTSET;
const EDGE_STRIP_THICKNESS = 28;
const EDGE_STRIP_OUTSET = 8;
const BRACKET_ARM_LENGTH = 20;
const BRACKET_THICKNESS = 3;
const EDGE_HOLDER_LENGTH = 20;
const EDGE_HOLDER_THICKNESS = 3;
/** Breathing room around the fitted frame so corner handles keep full hit area. */
export const CROP_FRAME_MARGIN = 16;
// 44pt = platform touch-target minimum.
const MIN_FRAME_PX = 44;
// Matches reducer's clampCrop floor so pinch/pan never propose a rect the reducer would silently shrink.
const MIN_NORMALIZED = 0.05;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Derive the crop frame and photo placement rect from the current crop + region. Shared source of truth for overlay and Skia canvas. */
export function computeCropView(
  region: { width: number; height: number },
  postCrop: NormalizedCrop,
  imageAspect: number,
  margin: number = CROP_FRAME_MARGIN,
  mode: CropViewMode = 'fit'
): CropView {
  if (
    region.width <= 0 ||
    region.height <= 0 ||
    postCrop.width <= 0 ||
    postCrop.height <= 0 ||
    imageAspect <= 0
  ) {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    return { frame: empty, photoRect: empty };
  }
  const fitW = Math.max(1, region.width - 2 * margin);
  const fitH = Math.max(1, region.height - 2 * margin);

  if (mode === 'anchored') {
    // Anchored: photoRect stays fixed at full image aspect (no refit on lift, for video).
    let photoW = fitW;
    let photoH = photoW / imageAspect;
    if (photoH > fitH) {
      photoH = fitH;
      photoW = photoH * imageAspect;
    }
    const photoX = (region.width - photoW) / 2;
    const photoY = (region.height - photoH) / 2;
    return {
      photoRect: { x: photoX, y: photoY, width: photoW, height: photoH },
      frame: {
        x: photoX + postCrop.x * photoW,
        y: photoY + postCrop.y * photoH,
        width: postCrop.width * photoW,
        height: postCrop.height * photoH,
      },
    };
  }

  // Fit: frame refits to crop's aspect; photoRect scales to match ("zoom to crop area").
  const frameAspect = (postCrop.width * imageAspect) / postCrop.height;
  let frameW = fitW;
  let frameH = frameW / frameAspect;
  if (frameH > fitH) {
    frameH = fitH;
    frameW = frameH * frameAspect;
  }
  const frameX = (region.width - frameW) / 2;
  const frameY = (region.height - frameH) / 2;

  const dispW = frameW / postCrop.width;
  const dispH = frameH / postCrop.height;
  const photoX = frameX - postCrop.x * dispW;
  const photoY = frameY - postCrop.y * dispH;

  return {
    frame: { x: frameX, y: frameY, width: frameW, height: frameH },
    photoRect: { x: photoX, y: photoY, width: dispW, height: dispH },
  };
}

export function CropOverlay({
  region,
  crop,
  imageAspect,
  aspectRatio,
  straighten = 0,
  onChange,
  onResizeChange,
  onResizeEnd,
  onInteractionStart,
  mode = 'fit',
}: CropOverlayProps) {
  const theme = useEditorTheme();

  const view = computeCropView(region, crop, imageAspect, CROP_FRAME_MARGIN, mode);

  // State (not ref) so render tracks the frame under the finger; without this a mid-drag refit would visually jump.
  const [liveFrame, setLiveFrame] = useState<CropView['frame'] | null>(null);
  const displayFrame = liveFrame ?? view.frame;

  // Refs read only inside gesture callbacks, never during render.
  const latest = useRef({
    region,
    crop,
    imageAspect,
    aspectRatio,
    straighten,
    onChange,
    onResizeChange,
    onResizeEnd,
    onInteractionStart,
    frame: view.frame,
    photoRect: view.photoRect,
  });
  useEffect(() => {
    latest.current = {
      region,
      crop,
      imageAspect,
      aspectRatio,
      straighten,
      onChange,
      onResizeChange,
      onResizeEnd,
      onInteractionStart,
      frame: view.frame,
      photoRect: view.photoRect,
    };
  });

  // Per-gesture origins captured on grant so a stolen responder can't read another gesture's baseline.
  const panOrigin = useRef<{ crop: NormalizedCrop; dispW: number; dispH: number } | null>(null);
  const pinchOrigin = useRef<{
    crop: NormalizedCrop;
    frame: CropView['frame'];
    // Focal in normalized full-image coords (invariant under the transform).
    focalImgX: number;
    focalImgY: number;
  } | null>(null);
  const cornerOrigin = useRef<{
    frame: CropView['frame'];
    photoRect: CropView['photoRect'];
    aspect: number | null;
  } | null>(null);
  const edgeOrigin = useRef<{
    frame: CropView['frame'];
    photoRect: CropView['photoRect'];
    aspect: number | null;
  } | null>(null);

  // Anchored (video) mode defers the crop commit to gesture end: per-move onChange re-renders the
  // whole VideoEditor per touch sample, which made crop drags visibly choppy on Android. During the
  // drag only liveFrame (local state) animates; the pending value commits once on release/terminate.
  const pendingResize = useRef<ResizeResult | null>(null);
  const pendingPanCrop = useRef<NormalizedCrop | null>(null);

  // Commit uses the LIVE photoRect so the crop doesn't drift under the finger during pull-to-zoom-out.
  const commitFrame = (frame: CropView['frame'], photo: CropView['photoRect']) => {
    const s = latest.current;
    if (photo.width <= 0 || photo.height <= 0) return;
    const cropX = clamp((frame.x - photo.x) / photo.width, 0, 1);
    const cropY = clamp((frame.y - photo.y) / photo.height, 0, 1);
    const cropW = clamp(frame.width / photo.width, MIN_NORMALIZED, 1 - cropX);
    const cropH = clamp(frame.height / photo.height, MIN_NORMALIZED, 1 - cropY);
    s.onChange({ x: cropX, y: cropY, width: cropW, height: cropH });
  };

  // Fit mode: photo follows finger (frame fixed, crop origin moves opposite). Anchored mode: the frame itself moves, so crop origin follows the finger.
  const panDirection = mode === 'anchored' ? 1 : -1;
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Never steal from a handle/edge strip already tracking a finger.
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: () => {
        const s = latest.current;
        s.onInteractionStart?.();
        panOrigin.current = {
          crop: s.crop,
          dispW: s.photoRect.width,
          dispH: s.photoRect.height,
        };
      },
      onPanResponderMove: (_e, g) => {
        const o = panOrigin.current;
        if (!o || o.dispW <= 0 || o.dispH <= 0) return;
        const s = latest.current;
        // Un-rotate finger delta by −θ so pan lives in the un-rotated canvas space (identity at θ=0).
        const rad = s.straighten * DEG_TO_RAD;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dxP = cos * g.dx + sin * g.dy;
        const dyP = -sin * g.dx + cos * g.dy;
        const limits = panLimitsForAngle(o.crop, s.imageAspect, s.straighten);
        const nextX = clamp(o.crop.x + (panDirection * dxP) / o.dispW, limits.minX, limits.maxX);
        const nextY = clamp(o.crop.y + (panDirection * dyP) / o.dispH, limits.minY, limits.maxY);
        const nextCrop = { x: nextX, y: nextY, width: o.crop.width, height: o.crop.height };
        if (mode === 'anchored') {
          // Frame follows the finger locally; photoRect is fixed in anchored mode.
          const photo = s.photoRect;
          pendingPanCrop.current = nextCrop;
          setLiveFrame({
            x: photo.x + nextX * photo.width,
            y: photo.y + nextY * photo.height,
            width: o.crop.width * photo.width,
            height: o.crop.height * photo.height,
          });
        } else {
          s.onChange(nextCrop);
        }
      },
      onPanResponderRelease: () => {
        panOrigin.current = null;
        const pending = pendingPanCrop.current;
        pendingPanCrop.current = null;
        if (pending) latest.current.onChange(pending);
        setLiveFrame(null);
      },
      onPanResponderTerminate: () => {
        panOrigin.current = null;
        const pending = pendingPanCrop.current;
        pendingPanCrop.current = null;
        if (pending) latest.current.onChange(pending);
        setLiveFrame(null);
      },
    })
  );

  // Two-finger pinch zooms about the focal point; disabled in anchored mode (video crop is resize-only).
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [pinch] = useState(() =>
    Gesture.Pinch()
      .runOnJS(true)
      .enabled(mode !== 'anchored')
      .onStart((e) => {
        const s = latest.current;
        if (s.photoRect.width <= 0 || s.photoRect.height <= 0) {
          pinchOrigin.current = null;
          return;
        }
        s.onInteractionStart?.();
        // Un-rotate focal by −θ about the frame center into un-rotated canvas space.
        const cx = s.frame.x + s.frame.width / 2;
        const cy = s.frame.y + s.frame.height / 2;
        const rad = s.straighten * DEG_TO_RAD;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const fx = e.focalX - cx;
        const fy = e.focalY - cy;
        const focalX = cx + cos * fx + sin * fy;
        const focalY = cy + -sin * fx + cos * fy;
        const focalImgX = clamp((focalX - s.photoRect.x) / s.photoRect.width, 0, 1);
        const focalImgY = clamp((focalY - s.photoRect.y) / s.photoRect.height, 0, 1);
        pinchOrigin.current = {
          crop: s.crop,
          frame: s.frame,
          focalImgX,
          focalImgY,
        };
      })
      .onChange((e) => {
        const o = pinchOrigin.current;
        if (!o) return;
        const s = latest.current;
        // Photo grows by scale → crop shrinks by 1/scale; clamp folds MIN_NORMALIZED, cover, and rotated-bbox caps.
        const safeScale = e.scale > 0 ? e.scale : 1;
        const invScale = 1 / safeScale;
        const minFactor = Math.max(MIN_NORMALIZED / o.crop.width, MIN_NORMALIZED / o.crop.height);
        // Fits-anywhere cap (not center-anchored): growth is legal until the bbox can't fit at any position; pinchLimits below re-clamps x/y for the new size.
        const maxFactor = Math.min(
          1 / o.crop.width,
          1 / o.crop.height,
          maxCropScaleAnywhereForAngle(o.crop, s.imageAspect, s.straighten)
        );
        const factor = clamp(invScale, minFactor, maxFactor);
        const width = o.crop.width * factor;
        const height = o.crop.height * factor;
        // Keep focal point fixed in image coords.
        const fracX = o.crop.width > 0 ? (o.focalImgX - o.crop.x) / o.crop.width : 0.5;
        const fracY = o.crop.height > 0 ? (o.focalImgY - o.crop.y) / o.crop.height : 0.5;
        const rawX = o.focalImgX - fracX * width;
        const rawY = o.focalImgY - fracY * height;
        const pinchLimits = panLimitsForAngle(
          { x: rawX, y: rawY, width, height },
          s.imageAspect,
          s.straighten
        );
        latest.current.onChange({
          x: clamp(rawX, pinchLimits.minX, pinchLimits.maxX),
          y: clamp(rawY, pinchLimits.minY, pinchLimits.maxY),
          width,
          height,
        });
      })
      .onFinalize(() => {
        pinchOrigin.current = null;
      })
  );

  // Corner resize with iOS Photos pull-to-zoom-out (frame pins, photo shrinks about anchor).
  const makeCorner = (corner: Corner) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const s = latest.current;
        s.onInteractionStart?.();
        cornerOrigin.current = {
          frame: s.frame,
          photoRect: s.photoRect,
          aspect: s.aspectRatio,
        };
        setLiveFrame(s.frame);
        s.onResizeChange?.(s.photoRect);
      },
      onPanResponderMove: (_e, g) => {
        const o = cornerOrigin.current;
        if (!o) return;
        const s = latest.current;
        const next =
          mode === 'anchored'
            ? resizeFrameCornerAnchored(o.frame, corner, g.dx, g.dy, o.aspect, o.photoRect)
            : resizeFrameCorner(
                o.frame,
                corner,
                g.dx,
                g.dy,
                o.aspect,
                o.photoRect,
                s.region,
                s.straighten
              );
        setLiveFrame(next.frame);
        if (mode === 'anchored') {
          pendingResize.current = next;
        } else {
          commitFrame(next.frame, next.photoRect);
          // Anchored mode has no pull-to-zoom-out; photoRect never shrinks.
          s.onResizeChange?.(next.photoRect);
        }
      },
      onPanResponderRelease: () => {
        cornerOrigin.current = null;
        const pending = pendingResize.current;
        pendingResize.current = null;
        if (pending) commitFrame(pending.frame, pending.photoRect);
        setLiveFrame(null);
        if (mode !== 'anchored') latest.current.onResizeEnd?.();
      },
      onPanResponderTerminate: () => {
        cornerOrigin.current = null;
        const pending = pendingResize.current;
        pendingResize.current = null;
        if (pending) commitFrame(pending.frame, pending.photoRect);
        setLiveFrame(null);
        if (mode !== 'anchored') latest.current.onResizeEnd?.();
      },
    });

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [tl] = useState(() => makeCorner('tl'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [tr] = useState(() => makeCorner('tr'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [bl] = useState(() => makeCorner('bl'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [br] = useState(() => makeCorner('br'));

  const makeEdge = (edge: Edge) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const s = latest.current;
        s.onInteractionStart?.();
        edgeOrigin.current = {
          frame: s.frame,
          photoRect: s.photoRect,
          aspect: s.aspectRatio,
        };
        setLiveFrame(s.frame);
        s.onResizeChange?.(s.photoRect);
      },
      onPanResponderMove: (_e, g) => {
        const o = edgeOrigin.current;
        if (!o) return;
        const s = latest.current;
        const next =
          mode === 'anchored'
            ? resizeFrameEdgeAnchored(o.frame, edge, g.dx, g.dy, o.aspect, o.photoRect)
            : resizeFrameEdge(
                o.frame,
                edge,
                g.dx,
                g.dy,
                o.aspect,
                o.photoRect,
                s.region,
                s.straighten
              );
        setLiveFrame(next.frame);
        if (mode === 'anchored') {
          pendingResize.current = next;
        } else {
          commitFrame(next.frame, next.photoRect);
          s.onResizeChange?.(next.photoRect);
        }
      },
      onPanResponderRelease: () => {
        edgeOrigin.current = null;
        const pending = pendingResize.current;
        pendingResize.current = null;
        if (pending) commitFrame(pending.frame, pending.photoRect);
        setLiveFrame(null);
        if (mode !== 'anchored') latest.current.onResizeEnd?.();
      },
      onPanResponderTerminate: () => {
        edgeOrigin.current = null;
        const pending = pendingResize.current;
        pendingResize.current = null;
        if (pending) commitFrame(pending.frame, pending.photoRect);
        setLiveFrame(null);
        if (mode !== 'anchored') latest.current.onResizeEnd?.();
      },
    });

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [topEdge] = useState(() => makeEdge('top'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [bottomEdge] = useState(() => makeEdge('bottom'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [leftEdge] = useState(() => makeEdge('left'));
  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [rightEdge] = useState(() => makeEdge('right'));

  const frameX = displayFrame.x;
  const frameY = displayFrame.y;
  const frameW = displayFrame.width;
  const frameH = displayFrame.height;

  const dimColor = theme.colors.overlay;
  // Scrim-white in both schemes (not onAccent — that flips to near-black on yellow accent).
  const borderColor = '#FFFFFF';

  return (
    <GestureDetector gesture={pinch}>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* Pan surface rendered FIRST so later siblings (edges, handles) win touch priority. */}
        <View {...panResponder.panHandlers} pointerEvents="auto" style={StyleSheet.absoluteFill} />

        <Dim color={dimColor} style={{ left: 0, top: 0, right: 0, height: frameY }} />
        <Dim color={dimColor} style={{ left: 0, top: frameY + frameH, right: 0, bottom: 0 }} />
        <Dim color={dimColor} style={{ left: 0, top: frameY, width: frameX, height: frameH }} />
        <Dim
          color={dimColor}
          style={{ left: frameX + frameW, top: frameY, right: 0, height: frameH }}
        />

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: frameX,
            top: frameY,
            width: frameW,
            height: frameH,
            borderWidth: 2,
            borderColor,
          }}>
          <GridLine
            style={{ top: '33.33%', height: StyleSheet.hairlineWidth, left: 0, right: 0 }}
          />
          <GridLine
            style={{ top: '66.66%', height: StyleSheet.hairlineWidth, left: 0, right: 0 }}
          />
          <GridLine
            style={{ left: '33.33%', width: StyleSheet.hairlineWidth, top: 0, bottom: 0 }}
          />
          <GridLine
            style={{ left: '66.66%', width: StyleSheet.hairlineWidth, top: 0, bottom: 0 }}
          />
        </View>

        {/* Edge strips inset by the corners' inward reach so corner handles win at intersections;
            biased inward (EDGE_STRIP_OUTSET outside the line, rest inside) like the corners. */}
        <EdgeStrip
          responder={topEdge}
          orientation="horizontal"
          color={borderColor}
          lineOffset={EDGE_STRIP_OUTSET}
          style={{
            left: frameX + CORNER_TOUCH_INSET,
            top: frameY - EDGE_STRIP_OUTSET,
            width: Math.max(0, frameW - 2 * CORNER_TOUCH_INSET),
            height: EDGE_STRIP_THICKNESS,
          }}
        />
        <EdgeStrip
          responder={bottomEdge}
          orientation="horizontal"
          color={borderColor}
          lineOffset={EDGE_STRIP_THICKNESS - EDGE_STRIP_OUTSET}
          style={{
            left: frameX + CORNER_TOUCH_INSET,
            top: frameY + frameH - (EDGE_STRIP_THICKNESS - EDGE_STRIP_OUTSET),
            width: Math.max(0, frameW - 2 * CORNER_TOUCH_INSET),
            height: EDGE_STRIP_THICKNESS,
          }}
        />
        <EdgeStrip
          responder={leftEdge}
          orientation="vertical"
          color={borderColor}
          lineOffset={EDGE_STRIP_OUTSET}
          style={{
            left: frameX - EDGE_STRIP_OUTSET,
            top: frameY + CORNER_TOUCH_INSET,
            width: EDGE_STRIP_THICKNESS,
            height: Math.max(0, frameH - 2 * CORNER_TOUCH_INSET),
          }}
        />
        <EdgeStrip
          responder={rightEdge}
          orientation="vertical"
          color={borderColor}
          lineOffset={EDGE_STRIP_THICKNESS - EDGE_STRIP_OUTSET}
          style={{
            left: frameX + frameW - (EDGE_STRIP_THICKNESS - EDGE_STRIP_OUTSET),
            top: frameY + CORNER_TOUCH_INSET,
            width: EDGE_STRIP_THICKNESS,
            height: Math.max(0, frameH - 2 * CORNER_TOUCH_INSET),
          }}
        />

        <CornerHandle x={frameX} y={frameY} corner="tl" responder={tl} color={borderColor} />
        <CornerHandle
          x={frameX + frameW}
          y={frameY}
          corner="tr"
          responder={tr}
          color={borderColor}
        />
        <CornerHandle
          x={frameX}
          y={frameY + frameH}
          corner="bl"
          responder={bl}
          color={borderColor}
        />
        <CornerHandle
          x={frameX + frameW}
          y={frameY + frameH}
          corner="br"
          responder={br}
          color={borderColor}
        />
      </View>
    </GestureDetector>
  );
}

function Dim({ color, style }: { color: string; style: object }) {
  return <View pointerEvents="none" style={[styles.dim, { backgroundColor: color }, style]} />;
}

function GridLine({ style }: { style: object }) {
  return <View pointerEvents="none" style={[styles.gridLine, style]} />;
}

/** iOS Photos-style L-bracket corner handle with a large invisible touch target. */
function CornerHandle({
  x,
  y,
  corner,
  responder,
  color,
}: {
  x: number;
  y: number;
  corner: Corner;
  responder: ReturnType<typeof PanResponder.create>;
  color: string;
}) {
  const sx = corner === 'tl' || corner === 'bl' ? -1 : 1;
  const sy = corner === 'tl' || corner === 'tr' ? -1 : 1;
  // Corner point sits CORNER_TOUCH_OUTSET from the view's outward side (sx/sy point outward).
  const anchorX = sx > 0 ? CORNER_TOUCH_INSET : CORNER_TOUCH_OUTSET;
  const anchorY = sy > 0 ? CORNER_TOUCH_INSET : CORNER_TOUCH_OUTSET;
  const horizArm = {
    left: sx > 0 ? 0 : -BRACKET_ARM_LENGTH,
    top: sy > 0 ? -BRACKET_THICKNESS : 0,
    width: BRACKET_ARM_LENGTH,
    height: BRACKET_THICKNESS,
    backgroundColor: color,
  } as const;
  const vertArm = {
    left: sx > 0 ? -BRACKET_THICKNESS : 0,
    top: sy > 0 ? 0 : -BRACKET_ARM_LENGTH,
    width: BRACKET_THICKNESS,
    height: BRACKET_ARM_LENGTH,
    backgroundColor: color,
  } as const;

  return (
    <View
      {...responder.panHandlers}
      style={{
        position: 'absolute',
        left: x - anchorX,
        top: y - anchorY,
        width: CORNER_TOUCH_SIZE,
        height: CORNER_TOUCH_SIZE,
      }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: anchorX, top: anchorY }}>
        <View pointerEvents="none" style={{ position: 'absolute', ...horizArm }} />
        <View pointerEvents="none" style={{ position: 'absolute', ...vertArm }} />
      </View>
    </View>
  );
}

/** Edge drag strip with a thin white "holder" bar on the frame line (`lineOffset` px across the strip). */
function EdgeStrip({
  responder,
  orientation,
  color,
  lineOffset,
  style,
}: {
  responder: ReturnType<typeof PanResponder.create>;
  orientation: 'horizontal' | 'vertical';
  color: string;
  lineOffset: number;
  style: { left: number; top: number; width: number; height: number };
}) {
  if (style.width <= 0 || style.height <= 0) return null;
  const holderStyle =
    orientation === 'horizontal'
      ? {
          left: style.width / 2 - EDGE_HOLDER_LENGTH / 2,
          top: lineOffset - EDGE_HOLDER_THICKNESS / 2,
          width: EDGE_HOLDER_LENGTH,
          height: EDGE_HOLDER_THICKNESS,
        }
      : {
          left: lineOffset - EDGE_HOLDER_THICKNESS / 2,
          top: style.height / 2 - EDGE_HOLDER_LENGTH / 2,
          width: EDGE_HOLDER_THICKNESS,
          height: EDGE_HOLDER_LENGTH,
        };
  return (
    <View {...responder.panHandlers} style={[styles.edgeStrip, style]}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', backgroundColor: color, ...holderStyle }}
      />
    </View>
  );
}

/** Region-margin box the frame must stay within on-screen. */
function regionBox(region: { width: number; height: number }, margin: number = CROP_FRAME_MARGIN) {
  return {
    minX: margin,
    maxX: region.width - margin,
    minY: margin,
    maxY: region.height - margin,
  };
}

interface ResizeResult {
  frame: CropView['frame'];
  photoRect: CropView['photoRect'];
}

/** Uniformly shrink `photo` by factor `k >= 1` about `anchor`. */
function shrinkPhotoAboutAnchor(
  photo: CropView['photoRect'],
  anchor: { x: number; y: number },
  k: number
): CropView['photoRect'] {
  if (k <= 1) return photo;
  return {
    x: anchor.x + (photo.x - anchor.x) / k,
    y: anchor.y + (photo.y - anchor.y) / k,
    width: photo.width / k,
    height: photo.height / k,
  };
}

/** Anchor point for a corner drag = opposite corner of the origin frame. */
function cornerAnchor(origin: CropView['frame'], corner: Corner): { x: number; y: number } {
  return {
    x: corner === 'tl' || corner === 'bl' ? origin.x + origin.width : origin.x,
    y: corner === 'tl' || corner === 'tr' ? origin.y + origin.height : origin.y,
  };
}

/** Anchor point for an edge drag — opposite edge on the anchor axis, cross center on the other. */
function edgeAnchor(origin: CropView['frame'], edge: Edge): { x: number; y: number } {
  const centerX = origin.x + origin.width / 2;
  const centerY = origin.y + origin.height / 2;
  if (edge === 'right') return { x: origin.x, y: centerY };
  if (edge === 'left') return { x: origin.x + origin.width, y: centerY };
  if (edge === 'bottom') return { x: centerX, y: origin.y };
  return { x: centerX, y: origin.y + origin.height }; // top
}

/** Per-side distances from the anchor point to the origin photo's edges. */
function photoSpansFromAnchor(photo: CropView['photoRect'], anchor: { x: number; y: number }) {
  return {
    left: Math.max(0, anchor.x - photo.x),
    right: Math.max(0, photo.x + photo.width - anchor.x),
    top: Math.max(0, anchor.y - photo.y),
    bottom: Math.max(0, photo.y + photo.height - anchor.y),
  };
}

/** Rotated-bbox coverage-constraint solver. See `core/crop/straightenMath.ts`. At θ=0 collapses to axis-aligned math. */

interface AngleTrig {
  absCos: number;
  absSin: number;
}

function rotatedHalfExtents(w: number, h: number, t: AngleTrig) {
  return {
    hwR: (w / 2) * t.absCos + (h / 2) * t.absSin,
    hhR: (w / 2) * t.absSin + (h / 2) * t.absCos,
  };
}

function requiredSpans(w: number, h: number, offsetX: number, offsetY: number, t: AngleTrig) {
  const { hwR, hhR } = rotatedHalfExtents(w, h, t);
  return {
    left: Math.max(0, hwR - offsetX),
    right: Math.max(0, hwR + offsetX),
    top: Math.max(0, hhR - offsetY),
    bottom: Math.max(0, hhR + offsetY),
  };
}

function minRatio(available: Spans, required: Spans): number {
  let m = Number.POSITIVE_INFINITY;
  (['left', 'right', 'top', 'bottom'] as const).forEach((side) => {
    const r = required[side];
    if (r > 0) m = Math.min(m, available[side] / r);
  });
  return m;
}

interface Spans {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function fitDisplayAndShrink(params: {
  desiredW: number;
  desiredH: number;
  regionSpanW: number;
  regionSpanH: number;
  offsetXPerW: number;
  offsetYPerH: number;
  photoSpans: Spans;
  aspect: number | null;
  trig: AngleTrig;
}): { displayW: number; displayH: number; k: number } {
  const {
    desiredW,
    desiredH,
    regionSpanW,
    regionSpanH,
    offsetXPerW,
    offsetYPerH,
    photoSpans,
    aspect,
    trig,
  } = params;

  // 1. Region cap.
  let displayW = Math.min(desiredW, Math.max(MIN_FRAME_PX, regionSpanW));
  let displayH = Math.min(desiredH, Math.max(MIN_FRAME_PX, regionSpanH));

  // 2. Aspect preservation.
  if (aspect != null) {
    const r = Math.min(displayW / desiredW, displayH / desiredH);
    displayW = desiredW * r;
    displayH = desiredH * r;
  }

  displayW = Math.max(displayW, MIN_FRAME_PX);
  displayH = Math.max(displayH, MIN_FRAME_PX);

  // 3. Photo cap at k=1 (frame-side shrink).
  const req1 = requiredSpans(
    displayW,
    displayH,
    offsetXPerW * displayW,
    offsetYPerH * displayH,
    trig
  );
  const rFit = minRatio(photoSpans, req1);
  if (rFit < 1) {
    const r = Math.max(rFit, MIN_FRAME_PX / Math.max(displayW, displayH));
    displayW = Math.max(MIN_FRAME_PX, displayW * r);
    displayH = Math.max(MIN_FRAME_PX, displayH * r);
  }

  // 4. k solve.
  const req = requiredSpans(
    displayW,
    displayH,
    offsetXPerW * displayW,
    offsetYPerH * displayH,
    trig
  );
  const kMax = Math.max(1, minRatio(photoSpans, req));
  const kW = displayW > 0 ? desiredW / displayW : 1;
  const kH = displayH > 0 ? desiredH / displayH : 1;
  const kWant = Math.max(1, kW, kH);
  const k = Math.min(kWant, kMax);

  return { displayW, displayH, k };
}

/** Resize the frame by dragging one corner (pull-to-zoom-out at θ=0, rotated-bbox coverage otherwise). */
function resizeFrameCorner(
  origin: CropView['frame'],
  corner: Corner,
  dx: number,
  dy: number,
  aspect: number | null,
  photo: CropView['photoRect'],
  region: { width: number; height: number },
  straighten: number
): ResizeResult {
  const box = regionBox(region);
  const anchor = cornerAnchor(origin, corner);
  const signX = corner === 'tl' || corner === 'bl' ? -1 : 1;
  const signY = corner === 'tl' || corner === 'tr' ? -1 : 1;

  let desiredW = Math.max(MIN_FRAME_PX, origin.width + signX * dx);
  let desiredH = Math.max(MIN_FRAME_PX, origin.height + signY * dy);

  if (aspect != null) {
    if (desiredW / desiredH > aspect) {
      desiredH = desiredW / aspect;
    } else {
      desiredW = desiredH * aspect;
    }
  }

  const regionSpanW = signX > 0 ? box.maxX - anchor.x : anchor.x - box.minX;
  const regionSpanH = signY > 0 ? box.maxY - anchor.y : anchor.y - box.minY;

  const trig = absSinCosForAngle(straighten);
  const result = fitDisplayAndShrink({
    desiredW,
    desiredH,
    regionSpanW,
    regionSpanH,
    // Corner: frame center = anchor + (signX·w/2, signY·h/2).
    offsetXPerW: signX / 2,
    offsetYPerH: signY / 2,
    photoSpans: photoSpansFromAnchor(photo, anchor),
    aspect,
    trig,
  });

  const displayFrame: CropView['frame'] = {
    x: signX > 0 ? anchor.x : anchor.x - result.displayW,
    y: signY > 0 ? anchor.y : anchor.y - result.displayH,
    width: result.displayW,
    height: result.displayH,
  };
  return {
    frame: displayFrame,
    photoRect: shrinkPhotoAboutAnchor(photo, anchor, result.k),
  };
}

/** Resize the frame by dragging one edge. */
function resizeFrameEdge(
  origin: CropView['frame'],
  edge: Edge,
  dx: number,
  dy: number,
  aspect: number | null,
  photo: CropView['photoRect'],
  region: { width: number; height: number },
  straighten: number
): ResizeResult {
  const box = regionBox(region);
  const anchor = edgeAnchor(origin, edge);
  const horizontal = edge === 'left' || edge === 'right';
  const signDrag = edge === 'right' || edge === 'bottom' ? 1 : -1;

  let desiredW: number;
  let desiredH: number;
  if (horizontal) {
    desiredW = Math.max(MIN_FRAME_PX, origin.width + signDrag * dx);
    desiredH = aspect != null ? desiredW / aspect : origin.height;
  } else {
    desiredH = Math.max(MIN_FRAME_PX, origin.height + signDrag * dy);
    desiredW = aspect != null ? desiredH * aspect : origin.width;
  }

  const regionSpanDrag = horizontal
    ? edge === 'right'
      ? box.maxX - anchor.x
      : anchor.x - box.minX
    : edge === 'bottom'
      ? box.maxY - anchor.y
      : anchor.y - box.minY;
  const regionSpanCrossX = 2 * Math.min(anchor.x - box.minX, box.maxX - anchor.x);
  const regionSpanCrossY = 2 * Math.min(anchor.y - box.minY, box.maxY - anchor.y);
  const regionSpanW = horizontal ? regionSpanDrag : regionSpanCrossX;
  const regionSpanH = horizontal ? regionSpanCrossY : regionSpanDrag;

  const offsetXPerW = horizontal ? signDrag / 2 : 0;
  const offsetYPerH = horizontal ? 0 : signDrag / 2;

  const trig = absSinCosForAngle(straighten);
  const result = fitDisplayAndShrink({
    desiredW,
    desiredH,
    regionSpanW,
    regionSpanH,
    offsetXPerW,
    offsetYPerH,
    photoSpans: photoSpansFromAnchor(photo, anchor),
    aspect,
    trig,
  });

  let x: number;
  let y: number;
  if (horizontal) {
    x = edge === 'right' ? origin.x : origin.x + origin.width - result.displayW;
    y = origin.y + origin.height / 2 - result.displayH / 2;
  } else {
    y = edge === 'bottom' ? origin.y : origin.y + origin.height - result.displayH;
    x = origin.x + origin.width / 2 - result.displayW / 2;
  }
  const displayFrame: CropView['frame'] = {
    x,
    y,
    width: result.displayW,
    height: result.displayH,
  };
  return {
    frame: displayFrame,
    photoRect: shrinkPhotoAboutAnchor(photo, anchor, result.k),
  };
}

/** Anchored corner resize — photoRect fixed, no pull-to-zoom-out, no θ math (video path). */
function resizeFrameCornerAnchored(
  origin: CropView['frame'],
  corner: Corner,
  dx: number,
  dy: number,
  aspect: number | null,
  photo: CropView['photoRect']
): ResizeResult {
  const anchor = cornerAnchor(origin, corner);
  const signX = corner === 'tl' || corner === 'bl' ? -1 : 1;
  const signY = corner === 'tl' || corner === 'tr' ? -1 : 1;

  let desiredW = Math.max(MIN_FRAME_PX, origin.width + signX * dx);
  let desiredH = Math.max(MIN_FRAME_PX, origin.height + signY * dy);

  if (aspect != null) {
    if (desiredW / desiredH > aspect) {
      desiredH = desiredW / aspect;
    } else {
      desiredW = desiredH * aspect;
    }
  }

  const spans = photoSpansFromAnchor(photo, anchor);
  const availW = signX > 0 ? spans.right : spans.left;
  const availH = signY > 0 ? spans.bottom : spans.top;

  let displayW = Math.min(desiredW, Math.max(MIN_FRAME_PX, availW));
  let displayH = Math.min(desiredH, Math.max(MIN_FRAME_PX, availH));

  if (aspect != null) {
    const r = Math.min(displayW / desiredW, displayH / desiredH);
    displayW = Math.max(MIN_FRAME_PX, desiredW * r);
    displayH = Math.max(MIN_FRAME_PX, desiredH * r);
  }

  const displayFrame: CropView['frame'] = {
    x: signX > 0 ? anchor.x : anchor.x - displayW,
    y: signY > 0 ? anchor.y : anchor.y - displayH,
    width: displayW,
    height: displayH,
  };
  return { frame: displayFrame, photoRect: photo };
}

/** Anchored edge resize — photoRect fixed, no pull-to-zoom (video path). */
function resizeFrameEdgeAnchored(
  origin: CropView['frame'],
  edge: Edge,
  dx: number,
  dy: number,
  aspect: number | null,
  photo: CropView['photoRect']
): ResizeResult {
  const anchor = edgeAnchor(origin, edge);
  const horizontal = edge === 'left' || edge === 'right';
  const signDrag = edge === 'right' || edge === 'bottom' ? 1 : -1;

  let desiredW: number;
  let desiredH: number;
  if (horizontal) {
    desiredW = Math.max(MIN_FRAME_PX, origin.width + signDrag * dx);
    desiredH = aspect != null ? desiredW / aspect : origin.height;
  } else {
    desiredH = Math.max(MIN_FRAME_PX, origin.height + signDrag * dy);
    desiredW = aspect != null ? desiredH * aspect : origin.width;
  }

  const spans = photoSpansFromAnchor(photo, anchor);
  const availDrag = horizontal
    ? edge === 'right'
      ? spans.right
      : spans.left
    : edge === 'bottom'
      ? spans.bottom
      : spans.top;
  // Locked-aspect grows symmetrically about the cross center → cross cap is 2 * min(sides).
  const availCrossX = 2 * Math.min(spans.left, spans.right);
  const availCrossY = 2 * Math.min(spans.top, spans.bottom);
  const availW = horizontal ? availDrag : availCrossX;
  const availH = horizontal ? availCrossY : availDrag;

  let displayW = Math.min(desiredW, Math.max(MIN_FRAME_PX, availW));
  let displayH = Math.min(desiredH, Math.max(MIN_FRAME_PX, availH));

  if (aspect != null) {
    const r = Math.min(displayW / desiredW, displayH / desiredH);
    displayW = Math.max(MIN_FRAME_PX, desiredW * r);
    displayH = Math.max(MIN_FRAME_PX, desiredH * r);
  }

  let x: number;
  let y: number;
  if (horizontal) {
    x = edge === 'right' ? origin.x : origin.x + origin.width - displayW;
    y = origin.y + origin.height / 2 - displayH / 2;
  } else {
    y = edge === 'bottom' ? origin.y : origin.y + origin.height - displayH;
    x = origin.x + origin.width / 2 - displayW / 2;
  }
  const displayFrame: CropView['frame'] = { x, y, width: displayW, height: displayH };
  return { frame: displayFrame, photoRect: photo };
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  edgeStrip: { position: 'absolute', backgroundColor: 'transparent' },
});
