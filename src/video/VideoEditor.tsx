import { Canvas, drawAsImage, ImageFormat, useImage } from '@shopify/react-native-skia';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaEditorProvider, type MediaEditorConfigProps } from '../core/MediaEditorProvider';
import { EditorHeader } from '../core/components/EditorHeader';
import { EditorShell } from '../core/components/EditorShell';
import { useEditorI18n } from '../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../core/icons/IconContext';
import { useEditorTheme } from '../core/theming/ThemeContext';
import MediaEditorModule from '../native/MediaEditorModule';
import {
  anyNonNeutral,
  composeAdjustmentMatrix,
  composeFilterMatrix,
  isIdentityMatrix,
  NEUTRAL_ADJUSTMENTS,
  ORIGINAL_FILTER_ID,
  resolveFilter,
  type PhotoAdjustmentKey,
  type PhotoFilterPack,
} from '../photo/color';
import { LayerOverlay } from '../photo/components/LayerOverlay';
import { CollapsedPanelStrip, ToolPanel } from '../photo/components/ToolPanel';
import { DrawOverlay, type DrawStroke } from '../photo/draw';
import {
  generateLayerId,
  type PhotoLayer,
  type PhotoStickerPack,
  type TextLayer,
} from '../photo/layers';
import { resolveOverlay, type PhotoOverlayPack } from '../photo/overlays';
import { ColorPreviewCanvas } from './components/ColorPreviewCanvas';
import {
  aspectRatioValue,
  ASPECT_RATIO_PRESETS,
  type AspectRatio,
} from '../photo/state/photoEditorState';
import { DEFAULT_FONT_ID, useCustomFontProvider, type PhotoCustomFont } from '../photo/text';
import type { DrawToolSettings } from '../photo/tools/DrawTool';
import { DEFAULT_TEXT_SPAWN_SCALE, spawnCenterFor } from '../photo/tools/StickerTool';
import {
  TextFocusEditor,
  type TextDraftFields,
  type TextFocusResult,
  type TextFocusSession,
} from '../photo/tools/TextFocusEditor';
import { TextTool } from '../photo/tools/TextTool';
import { useResolvedStickerImages } from '../photo/tools/useResolvedStickerImages';
import type { CropRect, ThumbnailResult, TrimResult, VideoInfo } from '../types';
import { getVideoInfo, getVideoThumbnail, trimVideo } from './api';
import { CoverPicker } from './components/CoverPicker';
import { CropAspectPicker } from './components/CropAspectPicker';
import { CropOverlay } from './components/CropOverlay';
import { TrimBar } from './components/TrimBar';
import { VideoOverlayRender } from './components/VideoOverlayRender';
import {
  canRedo,
  canUndo,
  useVideoEditorState,
  VIDEO_SPEED_DEFAULT,
  VIDEO_TOOL_IDS,
  type VideoToolId,
} from './state/videoEditorState';
import { SpeedTool } from './tools/SpeedTool';
import { VideoAdjustTool } from './tools/VideoAdjustTool';
import { createDefaultDrawSettings, VideoDrawTool } from './tools/VideoDrawTool';
import { VideoEffectsTool } from './tools/VideoEffectsTool';
import { VideoStickerTool } from './tools/VideoStickerTool';
import { VideoToolbar } from './tools/VideoToolbar';

/** Base on-canvas text size as a fraction of the shorter output dimension. Multiplied by layer.scale. */
const TEXT_BASE_RATIO = 0.06;
/** Base sticker size as a fraction of the shorter output dimension. */
const STICKER_BASE_RATIO = 0.2;

export interface VideoEditorProps extends MediaEditorConfigProps {
  /** Local or remote video URI. */
  source: string;
  /** Header title override; `''` renders no title element. */
  title?: string;
  onCancel?: () => void;
  /** Called with the trimmed file once export succeeds. */
  onExport?: (result: TrimResult) => void;
  /** Called after a cover frame is captured at the current playback position. */
  onCoverSelected?: (result: ThumbnailResult) => void;
  onError?: (error: Error) => void;
  /** Smallest selectable trim range. Defaults to 1000 ms. */
  minDurationMs?: number;
  /** Toolbar tab allowlist in order. `undefined` = defaults, `[]` = no tabs. */
  videoTools?: readonly VideoToolId[];
  /** Sticker packs appended after built-ins. */
  stickerPacks?: readonly PhotoStickerPack[];
  /** Aspect chip allowlist in order. `undefined` = defaults, `[]` = no picker. */
  cropAspectRatios?: readonly AspectRatio[];
  /** Custom fonts appended after the built-in font roster. */
  customFonts?: readonly PhotoCustomFont[];
  /** Overrides the built-in text color palette. */
  textColors?: readonly string[];
  /** Filter packs appended after built-ins. */
  filterPacks?: readonly PhotoFilterPack[];
  /** Overlay packs appended after built-ins. */
  overlayPacks?: readonly PhotoOverlayPack[];
}

export function VideoEditor({
  theme,
  colorScheme,
  locale,
  direction,
  strings,
  icons,
  ...rest
}: VideoEditorProps) {
  return (
    <MediaEditorProvider
      theme={theme}
      colorScheme={colorScheme}
      icons={icons}
      locale={locale}
      direction={direction}
      strings={strings}>
      <EditorShell>
        <GestureHandlerRootView style={styles.container}>
          <VideoEditorScreen {...rest} />
        </GestureHandlerRootView>
      </EditorShell>
    </MediaEditorProvider>
  );
}

type VideoEditorScreenProps = Omit<VideoEditorProps, keyof MediaEditorConfigProps>;

function VideoEditorScreen({
  source,
  title,
  onCancel,
  onExport,
  onCoverSelected,
  onError,
  minDurationMs,
  videoTools,
  stickerPacks,
  customFonts,
  textColors,
  cropAspectRatios,
  filterPacks,
  overlayPacks,
}: VideoEditorScreenProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const insets = useSafeAreaInsets();

  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // Ephemeral crop-mode UI kept out of the reducer so undo/redo never reopens crop.
  const [cropActive, setCropActive] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<CropRect | null>(null);

  const [videoContainer, setVideoContainer] = useState({ width: 0, height: 0 });
  const [toolbarHeight, setToolbarHeight] = useState(0);

  const controller = useVideoEditorState();
  const { state, dispatch } = controller;

  // Sync pending crop from reducer while crop UI is closed (adjust-state-during-render pattern).
  const [lastSyncedCrop, setLastSyncedCrop] = useState(state.crop);
  if (!cropActive && lastSyncedCrop !== state.crop) {
    setLastSyncedCrop(state.crop);
    setPendingCrop(state.crop);
  }

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
    instance.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  // Mirror `speed` onto player.playbackRate so live preview matches export.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- expo-video's player exposes playbackRate as a mutable property; assignment is the intended API.
    player.playbackRate = state.speed;
  }, [player, state.speed]);

  const reportError = useCallback(
    (error: unknown) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;
    getVideoInfo(source)
      .then((videoInfo) => {
        if (cancelled) return;
        setInfo(videoInfo);
        dispatch({ type: 'setRange', startMs: 0, endMs: videoInfo.durationMs });
      })
      .catch((error) => {
        if (!cancelled) reportError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [source, reportError, dispatch]);

  const customFontTypefaces = useCustomFontProvider(customFonts);
  const stickerImages = useResolvedStickerImages(state.layers, stickerPacks);

  const visibleTools = useMemo<readonly VideoToolId[]>(() => {
    return normalizeVideoTools(videoTools) ?? VIDEO_TOOL_IDS;
  }, [videoTools]);

  const aspectOptions = useMemo<readonly AspectRatio[]>(() => {
    return normalizeCropAspects(cropAspectRatios) ?? ASPECT_RATIO_PRESETS;
  }, [cropAspectRatios]);

  const [drawSettings, setDrawSettings] = useState<DrawToolSettings>(createDefaultDrawSettings);
  // Live stroke persists until the reducer echoes it back.
  const [liveStroke, setLiveStroke] = useState<DrawStroke | null>(null);
  const liveStrokeCommitted =
    liveStroke != null && state.strokes.some((s) => s.id === liveStroke.id);
  if (liveStrokeCommitted) {
    setLiveStroke(null);
  }
  const pendingLiveStroke = liveStrokeCommitted ? null : liveStroke;

  const handleStrokeEnd = useCallback(
    (stroke: DrawStroke) => {
      dispatch({ type: 'addStroke', stroke });
    },
    [dispatch]
  );

  // Text-focus session: one reducer commit at Done.
  const [textFocus, setTextFocus] = useState<TextFocusSession | null>(null);
  const handleOpenTextFocus = useCallback(() => {
    const initial: TextDraftFields = {
      text: '',
      color: '#FFFFFF',
      bold: true,
      italic: false,
      align: 'center',
      background: null,
      fontId: DEFAULT_FONT_ID,
    };
    setTextFocus({ kind: 'new', initial });
  }, []);
  const handleActivateLayer = useCallback((layer: PhotoLayer) => {
    if (layer.kind !== 'text') return;
    setTextFocus({ kind: 'existing', layer });
  }, []);
  const handleTextFocusDone = useCallback(
    ({ session, draft }: TextFocusResult) => {
      const trimmed = draft.text.trim();
      if (session.kind === 'new') {
        if (trimmed.length === 0) {
          setTextFocus(null);
          return;
        }
        const center = spawnCenterFor(state.layers.length);
        const layer: TextLayer = {
          id: generateLayerId(),
          kind: 'text',
          x: center.x,
          y: center.y,
          scale: DEFAULT_TEXT_SPAWN_SCALE,
          rotation: 0,
          ...draft,
        };
        dispatch({ type: 'addLayer', layer });
      } else {
        if (trimmed.length === 0) {
          dispatch({ type: 'removeLayer', id: session.layer.id });
        } else {
          dispatch({ type: 'checkpoint' });
          dispatch({
            type: 'updateLayer',
            id: session.layer.id,
            patch: {
              text: draft.text,
              color: draft.color,
              bold: draft.bold,
              italic: draft.italic,
              align: draft.align,
              background: draft.background,
              fontId: draft.fontId,
            },
          });
        }
      }
      setTextFocus(null);
    },
    [dispatch, state.layers.length]
  );
  const handleTextFocusCancel = useCallback(() => setTextFocus(null), []);

  // Letterbox rect during crop-edit; clipped viewport rect otherwise (so annotations land inside the cropped view).
  const videoDisplayRect = useMemo(() => {
    if (!info || videoContainer.width === 0 || videoContainer.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const showCropped = state.crop != null && !cropActive;
    if (!showCropped) {
      const scale = Math.min(
        videoContainer.width / info.width,
        videoContainer.height / info.height
      );
      const width = info.width * scale;
      const height = info.height * scale;
      return {
        x: (videoContainer.width - width) / 2,
        y: (videoContainer.height - height) / 2,
        width,
        height,
      };
    }
    const crop = state.crop as CropRect;
    const scale = Math.min(videoContainer.width / crop.width, videoContainer.height / crop.height);
    const width = crop.width * scale;
    const height = crop.height * scale;
    return {
      x: (videoContainer.width - width) / 2,
      y: (videoContainer.height - height) / 2,
      width,
      height,
    };
  }, [info, videoContainer, state.crop, cropActive]);

  const cropOverlayAspect = useMemo<number | null>(() => {
    if (!info || state.aspect === 'free') return null;
    return aspectRatioValue(state.aspect, {
      imageAspect: info.width / info.height,
    });
  }, [state.aspect, info]);

  const previewBaseFontSize =
    Math.min(videoDisplayRect.width, videoDisplayRect.height) * TEXT_BASE_RATIO;
  const previewBaseStickerSize =
    Math.min(videoDisplayRect.width, videoDisplayRect.height) * STICKER_BASE_RATIO;

  const renderStrokes = useMemo(
    () => (pendingLiveStroke ? [...state.strokes, pendingLiveStroke] : state.strokes),
    [state.strokes, pendingLiveStroke]
  );

  const [panelHidden, setPanelHidden] = useState(false);
  const activeTool = state.activeTool;
  const [prevTool, setPrevTool] = useState(activeTool);
  if (prevTool !== activeTool) {
    setPrevTool(activeTool);
    setPanelHidden(false);
  }

  const handleSaveCover = useCallback(
    async (timeMs: number) => {
      setBusy(true);
      try {
        const result = await getVideoThumbnail(source, { timeMs });
        onCoverSelected?.(result);
        dispatch({ type: 'setTool', tool: null });
      } catch (error) {
        reportError(error);
      } finally {
        setBusy(false);
      }
    },
    [source, onCoverSelected, reportError, dispatch]
  );

  // Scrub target in SECONDS; the Skia ColorPreviewCanvas seeks its decoder to this value in lockstep.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);

  const handleScrub = useCallback(
    (timeMs: number) => {
      if (player.playing) player.pause();
      const seconds = timeMs / 1000;
      // eslint-disable-next-line react-hooks/immutability -- expo-video's player exposes currentTime as its documented seek API; assignment is the intended usage.
      player.currentTime = seconds;
      setScrubSeconds(seconds);
    },
    [player]
  );

  const handleScrubEnd = useCallback(() => {
    setScrubSeconds(null);
  }, []);

  const closeCoverPicker = useCallback(() => {
    dispatch({ type: 'setTool', tool: null });
  }, [dispatch]);

  const enterCrop = useCallback(() => {
    setPendingCrop(state.crop);
    setCropActive(true);
  }, [state.crop]);

  const applyCrop = useCallback(() => {
    // One committed crop = one undo step.
    dispatch({ type: 'checkpoint' });
    dispatch({ type: 'setCrop', crop: pendingCrop });
    setCropActive(false);
  }, [dispatch, pendingCrop]);

  const resetCrop = useCallback(() => {
    setPendingCrop(null);
    if (state.aspect !== 'free') {
      dispatch({ type: 'setAspect', aspect: 'free' });
    }
  }, [dispatch, state.aspect]);
  const cancelCrop = useCallback(() => {
    setPendingCrop(state.crop);
    setCropActive(false);
  }, [state.crop]);

  const handleAspectChange = useCallback(
    (aspect: AspectRatio) => {
      dispatch({ type: 'setAspect', aspect });
      if (aspect === 'free') return;
      if (!info) return;
      const ratio = aspectRatioValue(aspect, {
        imageAspect: info.width / info.height,
      });
      if (ratio == null || ratio <= 0) return;
      setPendingCrop(fitCropRectToAspect(info.width, info.height, ratio));
    },
    [dispatch, info]
  );

  const handleToolSelect = useCallback(
    (tool: VideoToolId) => {
      if (busy || !info) return;
      if (tool === 'crop') {
        if (cropActive) {
          cancelCrop();
        } else {
          enterCrop();
        }
        dispatch({ type: 'setTool', tool: 'crop' });
        return;
      }
      if (tool === activeTool) {
        setPanelHidden((v) => !v);
        return;
      }
      dispatch({ type: 'setTool', tool });
    },
    [busy, info, activeTool, cropActive, cancelCrop, enterCrop, dispatch]
  );

  const exportOverlayDefinition = useMemo(
    () => resolveOverlay(state.overlayId, overlayPacks),
    [state.overlayId, overlayPacks]
  );
  const exportOverlayImage = useImage(
    exportOverlayDefinition?.kind === 'image' ? exportOverlayDefinition.source : undefined
  );

  // Rasterize overlay (color wash + layers + strokes) to a cache PNG the native trimmer composites over frames.
  const rasterizeOverlay = useCallback(async (): Promise<string | null> => {
    if (!info) return null;
    const hasAnnotations = state.layers.length > 0 || state.strokes.length > 0;
    const hasOverlayWash = exportOverlayDefinition != null && state.overlayIntensity > 0;
    if (!hasAnnotations && !hasOverlayWash) return null;

    const crop = state.crop;
    const outW = Math.round(crop ? crop.width : info.width);
    const outH = Math.round(crop ? crop.height : info.height);
    if (outW <= 0 || outH <= 0) return null;

    const baseFontSize = Math.min(outW, outH) * TEXT_BASE_RATIO;
    const baseStickerSize = Math.min(outW, outH) * STICKER_BASE_RATIO;

    const snapshot = await drawAsImage(
      <VideoOverlayRender
        outputWidth={outW}
        outputHeight={outH}
        layers={state.layers}
        strokes={state.strokes}
        baseFontSize={baseFontSize}
        baseStickerSize={baseStickerSize}
        stickerImages={stickerImages}
        customFonts={customFonts}
        customFontTypefaces={customFontTypefaces}
        stickerPacks={stickerPacks}
        overlayDefinition={hasOverlayWash ? exportOverlayDefinition : null}
        overlayIntensity={state.overlayIntensity}
        overlayImage={exportOverlayImage}
      />,
      { width: outW, height: outH }
    );
    if (!snapshot) return null;
    // PNG so the overlay's alpha travels through the file.
    const encoded = snapshot.encodeToBase64(ImageFormat.PNG, 100);
    if (!encoded) return null;
    return await MediaEditorModule.writeCacheFile(encoded, 'png');
  }, [
    info,
    state.crop,
    state.layers,
    state.strokes,
    state.overlayIntensity,
    stickerImages,
    customFonts,
    customFontTypefaces,
    stickerPacks,
    exportOverlayDefinition,
    exportOverlayImage,
  ]);

  const handleTrim = useCallback(async () => {
    if (!info) return;
    setBusy(true);
    try {
      const overlayImageUri = (await rasterizeOverlay()) ?? undefined;
      // Compose the 4×5 matrix JS-side; native applies one stage per frame or short-circuits when identity.
      const filterDefinition = resolveFilter(state.filterId, filterPacks);
      const adjustmentsMatrix = composeAdjustmentMatrix(state.adjustments);
      const composedMatrix =
        filterDefinition.kind === 'matrix' && filterDefinition.id !== ORIGINAL_FILTER_ID
          ? composeFilterMatrix(filterDefinition.matrix, adjustmentsMatrix, state.filterIntensity)
          : adjustmentsMatrix;
      const matrixNumbers = composedMatrix as number[];
      const includeMatrix = !isIdentityMatrix(composedMatrix);

      // Only string-URI LUT sources round-trip across the bridge; numeric handles / remote records are deferred.
      let lutImageUri: string | undefined;
      let lutIntensity: number | undefined;
      if (filterDefinition.kind === 'lut' && typeof filterDefinition.source === 'string') {
        lutImageUri = filterDefinition.source;
        lutIntensity = state.filterIntensity;
      }

      const speedFactor = state.speed !== VIDEO_SPEED_DEFAULT ? state.speed : undefined;

      const result = await trimVideo(source, {
        startMs: state.range.startMs,
        endMs: state.range.endMs,
        crop: state.crop ?? undefined,
        overlayImageUri,
        colorMatrix: includeMatrix ? matrixNumbers : undefined,
        lutImageUri,
        lutIntensity,
        speedFactor,
      });
      onExport?.(result);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [
    info,
    source,
    state.range.startMs,
    state.range.endMs,
    state.crop,
    state.filterId,
    state.filterIntensity,
    state.adjustments,
    state.speed,
    filterPacks,
    onExport,
    reportError,
    rasterizeOverlay,
  ]);

  const togglePlayback = useCallback(() => {
    if (player.playing) player.pause();
    else player.play();
  }, [player]);

  const toolsDisabled = busy || !info;

  const panelBottom = toolbarHeight + insets.bottom;
  const panelVisible = activeTool != null && !panelHidden && !cropActive && textFocus == null;
  const highlightedTool: VideoToolId | null = cropActive ? 'crop' : activeTool;

  const colorPipelineActive =
    state.filterId !== ORIGINAL_FILTER_ID ||
    anyNonNeutral(Object.keys(NEUTRAL_ADJUSTMENTS) as PhotoAdjustmentKey[], state.adjustments) ||
    state.overlayId != null;
  const colorPreviewMounted = info != null && videoDisplayRect.width > 0;
  const nativeVideoHidden = false;
  // Two-surface design: native VideoView is the always-visible base; Skia fades in on top only when the color pipeline is active and not scrubbing, because the Skia decoder can't reliably re-seek.
  const skiaOpacityTarget = colorPipelineActive && scrubSeconds == null ? 1 : 0;
  const skiaOpacity = useSharedValue(skiaOpacityTarget);
  useEffect(() => {
    skiaOpacity.value = withTiming(skiaOpacityTarget, { duration: 250 });
  }, [skiaOpacityTarget, skiaOpacity]);
  const skiaAnimatedStyle = useAnimatedStyle(() => ({ opacity: skiaOpacity.value }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={textFocus != null ? styles.chromeHidden : null}
        pointerEvents={textFocus != null ? 'none' : 'auto'}>
        <EditorHeader
          title={title ?? t('editVideo')}
          onCancel={onCancel}
          actionLabel={t('done')}
          onAction={handleTrim}
          actionDisabled={toolsDisabled || cropActive}
          history={{
            onUndo: () => dispatch({ type: 'undo' }),
            onRedo: () => dispatch({ type: 'redo' }),
            canUndo: canUndo(state),
            canRedo: canRedo(state),
          }}
        />
      </View>
      <View
        style={styles.video}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setVideoContainer({ width, height });
          }
        }}>
        <CropAwareVideo
          player={player}
          info={info}
          container={videoContainer}
          crop={cropActive ? null : state.crop}
          displayRect={videoDisplayRect}
          hidden={nativeVideoHidden}
        />
        {colorPreviewMounted && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, skiaAnimatedStyle]}>
            <ColorPreviewCanvas
              source={source}
              rect={videoDisplayRect}
              paused={!isPlaying}
              seekSeconds={scrubSeconds}
              // Raw source dims; crop clipping handled internally via the `crop` prop.
              videoWidth={info.width}
              videoHeight={info.height}
              crop={cropActive ? null : state.crop}
              adjustments={state.adjustments}
              filterId={state.filterId}
              filterIntensity={state.filterIntensity}
              overlayId={state.overlayId}
              overlayIntensity={state.overlayIntensity}
              filterPacks={filterPacks}
              overlayPacks={overlayPacks}
              speed={state.speed}
            />
          </Animated.View>
        )}
        {videoDisplayRect.width > 0 && (
          <Canvas
            style={[
              styles.overlayCanvas,
              {
                left: videoDisplayRect.x,
                top: videoDisplayRect.y,
                width: videoDisplayRect.width,
                height: videoDisplayRect.height,
              },
            ]}
            pointerEvents="none">
            <VideoOverlayRender
              outputWidth={videoDisplayRect.width}
              outputHeight={videoDisplayRect.height}
              layers={activeTool === 'text' || activeTool === 'stickers' ? [] : state.layers}
              strokes={renderStrokes}
              baseFontSize={previewBaseFontSize}
              baseStickerSize={previewBaseStickerSize}
              stickerImages={stickerImages}
              customFonts={customFonts}
              customFontTypefaces={customFontTypefaces}
              stickerPacks={stickerPacks}
            />
          </Canvas>
        )}
        {cropActive && info && (
          <CropOverlay
            videoWidth={info.width}
            videoHeight={info.height}
            value={pendingCrop}
            onChange={setPendingCrop}
            aspectRatio={cropOverlayAspect}
          />
        )}
        {!cropActive &&
          videoDisplayRect.width > 0 &&
          (activeTool === 'text' || activeTool === 'stickers') && (
            <LayerOverlay
              layers={state.layers}
              displayRect={videoDisplayRect}
              selectedId={state.selectedLayerId}
              baseFontSize={previewBaseFontSize}
              baseStickerSize={previewBaseStickerSize}
              stickerPacks={stickerPacks}
              customFonts={customFonts}
              customFontTypefaces={customFontTypefaces}
              onCommit={(id, transform) =>
                dispatch({ type: 'setLayerTransform', id, ...transform })
              }
              onSelect={(id) => dispatch({ type: 'selectLayer', id })}
              onActivateLayer={handleActivateLayer}
              onDeselect={() => {
                Keyboard.dismiss();
                dispatch({ type: 'selectLayer', id: null });
              }}
              onDelete={(id) => dispatch({ type: 'removeLayer', id })}
              onDuplicate={(id) => dispatch({ type: 'duplicateLayer', id })}
              onReorder={(id, direction) => dispatch({ type: 'reorderLayer', id, direction })}
            />
          )}
        {!cropActive && videoDisplayRect.width > 0 && activeTool === 'draw' && (
          <DrawOverlay
            displayRect={videoDisplayRect}
            brush={drawSettings.brush}
            color={drawSettings.color}
            size={drawSettings.sizes[drawSettings.brush]}
            onStrokeUpdate={setLiveStroke}
            onStrokeEnd={handleStrokeEnd}
          />
        )}
        {!cropActive && activeTool !== 'draw' && (
          <View pointerEvents="box-none" style={styles.playbackOverlay}>
            <Pressable
              onPress={togglePlayback}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('pause') : t('play')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.playButton,
                {
                  backgroundColor: theme.colors.overlay,
                  borderRadius: theme.radius.lg * 2,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}>
              {/* On dark scrim, pin to white. */}
              <EditorIcon name={isPlaying ? 'pause' : 'play'} size={26} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>
      {cropActive ? (
        <View
          style={[
            styles.cropChromeRow,
            {
              flexDirection: isRTL ? 'row-reverse' : 'row',
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
              gap: theme.spacing.sm,
            },
          ]}>
          {aspectOptions.length > 0 ? (
            <View style={styles.cropAspectFlex}>
              <CropAspectPicker
                options={aspectOptions}
                value={state.aspect}
                onChange={handleAspectChange}
              />
            </View>
          ) : (
            <View style={styles.cropAspectFlex} />
          )}
          <View
            style={[
              styles.cropInlineActions,
              { flexDirection: isRTL ? 'row-reverse' : 'row', gap: theme.spacing.xs },
            ]}>
            <CompactIconAction
              iconName="reset"
              label={t('reset')}
              onPress={resetCrop}
              disabled={busy}
            />
            <CompactIconAction
              iconName="check"
              label={t('apply')}
              onPress={applyCrop}
              emphasized
              disabled={busy}
            />
          </View>
        </View>
      ) : info ? (
        <TrimBar
          source={source}
          durationMs={info.durationMs}
          startMs={state.range.startMs}
          endMs={state.range.endMs}
          minDurationMs={minDurationMs}
          onChange={(startMs, endMs) => {
            dispatch({ type: 'setRange', startMs, endMs });
          }}
          onScrub={handleScrub}
          onScrubEnd={handleScrubEnd}
        />
      ) : (
        <View style={[styles.loading, { padding: theme.spacing.md }]}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      )}
      <View
        style={textFocus != null ? styles.chromeHidden : null}
        pointerEvents={textFocus != null ? 'none' : 'auto'}
        onLayout={(e: LayoutChangeEvent) => setToolbarHeight(e.nativeEvent.layout.height)}>
        <VideoToolbar active={highlightedTool} onSelect={handleToolSelect} tools={visibleTools} />
      </View>

      {info && panelVisible && activeTool === 'adjust' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <VideoAdjustTool controller={controller} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'effects' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <VideoEffectsTool
              controller={controller}
              source={source}
              filterPacks={filterPacks}
              overlayPacks={overlayPacks}
            />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'speed' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <SpeedTool controller={controller} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'text' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <TextTool onAddText={handleOpenTextFocus} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'stickers' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <VideoStickerTool controller={controller} stickerPacks={stickerPacks} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'draw' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)}>
            <VideoDrawTool
              controller={controller}
              settings={drawSettings}
              onSettingsChange={setDrawSettings}
            />
          </ToolPanel>
        </FloatingPanel>
      )}
      {info && panelVisible && activeTool === 'cover' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={closeCoverPicker}>
            <CoverPicker
              source={source}
              durationMs={info.durationMs}
              onScrub={handleScrub}
              onScrubEnd={handleScrubEnd}
              onSave={handleSaveCover}
              onCancel={closeCoverPicker}
              busy={busy}
            />
          </ToolPanel>
        </FloatingPanel>
      )}

      {info && activeTool != null && panelHidden && !cropActive && textFocus == null && (
        <View
          pointerEvents="box-none"
          style={[styles.floatingStripWrapper, { bottom: panelBottom }]}>
          <CollapsedPanelStrip onReveal={() => setPanelHidden(false)} />
        </View>
      )}

      {textFocus && (
        <TextFocusEditor
          session={textFocus}
          customFonts={customFonts}
          textColors={textColors}
          onDone={handleTextFocusDone}
          onCancel={handleTextFocusCancel}
        />
      )}

      {busy && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.busyOverlay,
            { backgroundColor: theme.colors.overlay },
          ]}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={[styles.busyLabel, { color: '#FFFFFF' }]}>{t('processing')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const PANEL_ENTER_MS = 220;
const PANEL_EXIT_MS = 180;

function FloatingPanel({ children, bottom }: { children: React.ReactNode; bottom: number }) {
  return (
    <View pointerEvents="box-none" style={[styles.floatingPanelWrapper, { bottom }]}>
      <Animated.View
        entering={SlideInDown.duration(PANEL_ENTER_MS)}
        exiting={SlideOutDown.duration(PANEL_EXIT_MS)}>
        {children}
      </Animated.View>
    </View>
  );
}

function normalizeVideoTools(
  list: readonly VideoToolId[] | undefined
): readonly VideoToolId[] | null {
  if (list == null) return null;
  if (list.length === 0) return list;
  const known = new Set<VideoToolId>(VIDEO_TOOL_IDS);
  const seen = new Set<VideoToolId>();
  const out: VideoToolId[] = [];
  for (const id of list) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeCropAspects(
  list: readonly AspectRatio[] | undefined
): readonly AspectRatio[] | null {
  if (list == null) return null;
  if (list.length === 0) return list;
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const aspect of list) {
    if (!ASPECT_RATIO_PRESETS.includes(aspect) || seen.has(aspect)) continue;
    seen.add(aspect);
    out.push(aspect);
  }
  return out;
}

/** Largest rect of `pixelAspect` centered inside `frameWidth × frameHeight`. */
function fitCropRectToAspect(
  frameWidth: number,
  frameHeight: number,
  pixelAspect: number
): CropRect {
  let width = frameWidth;
  let height = width / pixelAspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * pixelAspect;
  }
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  };
}

/** `VideoView` in a crop viewport — scales + translates the video so the crop rect lands at wrapper origin. */
function CropAwareVideo({
  player,
  info,
  container,
  crop,
  displayRect,
  hidden,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  info: VideoInfo | null;
  container: { width: number; height: number };
  crop: CropRect | null;
  displayRect: { x: number; y: number; width: number; height: number };
  /** Sets opacity:0 while keeping the player mounted so audio continues. */
  hidden?: boolean;
}) {
  const opacityStyle = hidden ? styles.videoHidden : null;
  if (!crop || !info || container.width === 0 || container.height === 0) {
    return (
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, opacityStyle]}
        contentFit="contain"
        nativeControls={false}
      />
    );
  }
  const scale = displayRect.width / crop.width;
  const innerWidth = info.width * scale;
  const innerHeight = info.height * scale;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: displayRect.x,
          top: displayRect.y,
          width: displayRect.width,
          height: displayRect.height,
          overflow: 'hidden',
        },
        opacityStyle,
      ]}>
      <VideoView
        player={player}
        style={{
          position: 'absolute',
          left: -crop.x * scale,
          top: -crop.y * scale,
          width: innerWidth,
          height: innerHeight,
        }}
        contentFit="fill"
        nativeControls={false}
      />
    </View>
  );
}

interface CompactIconActionProps {
  iconName: EditorIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  emphasized?: boolean;
}

/** Compact icon-only crop-action chip; hitSlop keeps the ≥44pt touch target. */
function CompactIconAction({
  iconName,
  label,
  onPress,
  disabled,
  emphasized,
}: CompactIconActionProps) {
  const theme = useEditorTheme();
  const bg = emphasized ? theme.colors.accent : 'rgba(255,255,255,0.16)';
  const fg = emphasized ? theme.colors.onAccent : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={({ pressed }) => [
        styles.compactIconAction,
        {
          backgroundColor: bg,
          borderRadius: 999,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      <EditorIcon name={iconName} size={18} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  video: { flex: 1, overflow: 'hidden' },
  overlayCanvas: { position: 'absolute' },
  videoHidden: { opacity: 0 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  playbackOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropChromeRow: {
    alignItems: 'center',
  },
  cropAspectFlex: {
    flex: 1,
    minWidth: 0, // let the scroll view clip inside its flex bounds
  },
  cropInlineActions: {
    alignItems: 'center',
  },
  compactIconAction: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyLabel: { marginTop: 12 },
  chromeHidden: { opacity: 0 },
  floatingPanelWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  floatingStripWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
