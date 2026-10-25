import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaEditorProvider, type MediaEditorConfigProps } from '../core/MediaEditorProvider';
import { ConfirmSheet } from '../core/components/ConfirmSheet';
import { EditorHeader } from '../core/components/EditorHeader';
import { EditorShell } from '../core/components/EditorShell';
import { useConsumeAndroidBack } from '../core/hooks/useConsumeAndroidBack';
import { useEditorI18n } from '../core/i18n/I18nContext';
import { useEditorTheme } from '../core/theming/ThemeContext';
import { type PhotoFilterPack } from '../photo/color';
import { LayerOverlay } from '../photo/components/LayerOverlay';
import { DrawOverlay, type DrawStroke } from '../photo/draw';
import {
  generateLayerId,
  type PhotoLayer,
  type PhotoStickerPack,
  type TextLayer,
} from '../photo/layers';
import { type PhotoOverlayPack } from '../photo/overlays';
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
import { useResolvedStickerImages } from '../photo/tools/useResolvedStickerImages';
import type {
  CropRect,
  ThumbnailResult,
  TrimResult,
  VideoCompressionOptions,
  VideoInfo,
} from '../types';
import { getVideoInfo, getVideoThumbnail } from './api';
import { CompactIconAction } from './components/CompactIconAction';
import { CropAspectPicker } from './components/CropAspectPicker';
import { CROP_EDIT_MARGIN, CropOverlay } from './components/CropOverlay';
import { GatedOverlayCanvas } from './components/GatedOverlayCanvas';
import { PipGhostOverlay } from './components/PipGhostOverlay';
import { ScrubEnginePreview } from './components/ScrubEnginePreview';
import { ScrubFrameOverlay } from './components/ScrubFrameOverlay';
import { VideoToolPanels } from './components/VideoToolPanels';
import { normalizeCropAspects, normalizeVideoTools, fitCropRectToAspect } from './editorOptions';
import { exportProject } from './export/exportProject';
import {
  STICKER_BASE_RATIO,
  TEXT_BASE_RATIO,
  useProjectRasterizer,
} from './export/useProjectRasterizer';
import { clamp } from './format';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import {
  TimelinePlayer,
  type PlaybackClock,
  type TimelinePlayerHandle,
} from './player/TimelinePlayer';
import {
  createClip,
  findClip,
  OVERLAY_END_UNBOUNDED,
  pipTracks,
  projectFromSources,
  videoTrack,
  type Clip,
  type PipTransform,
  type Project,
  type TimedOverlay,
} from './project/model';
import {
  canRedo,
  canUndo,
  drawOverlay,
  overlayForLayer,
  overlayLayers,
  overlayStrokes,
  selectedClip,
  useProjectEditorState,
  VIDEO_TOOL_IDS,
  type VideoToolId,
} from './project/reducer';
import { serializeProject, type ClipWashAsset } from './project/serialize';
import { clipDurationMs, TimelineIndex } from './project/timelineIndex';
import { type OverlayLaneModel } from './timeline/OverlayLane';
import { type PipLaneModel } from './timeline/PipLane';
import { SubToolbar, type SubToolbarAction } from './timeline/SubToolbar';
import { TimelineArea } from './timeline/TimelineArea';
import { TransportRow } from './timeline/TransportRow';
import { createDefaultDrawSettings } from './tools/VideoDrawTool';
import { VideoToolbar } from './tools/VideoToolbar';

/** Seek issue rate during scrub drags — native coalesces (iOS) / latest-wins (Android). */
const SCRUB_SEEK_INTERVAL_MS = 33;
/** Continuous edits settle this long before the native player recompiles the composition. */
const PREVIEW_REBUILD_DEBOUNCE_MS = 120;
const MIN_DURATION_DEFAULT_MS = 1000;

export type VideoSource = string | { uri: string };

export interface VideoEditorProps extends MediaEditorConfigProps {
  /** One source = classic reel flow (timeline hidden); an array opens the multi-clip timeline. */
  source: VideoSource | readonly VideoSource[];
  /** Header title override; `''` renders no title element. */
  title?: string;
  onCancel?: () => void;
  /** Called with the exported file once export succeeds. */
  onExport?: (result: TrimResult) => void;
  /** Fires when a cover frame is captured; if none picked before export, fires with the exported video's first frame. */
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
  /** Opt-in bitrate/dimension cap at export; presence forces re-encode even for pure trims. */
  compression?: VideoCompressionOptions;
  /** Host-side picker for the timeline's add-clip tile; resolve `null` to cancel. Presence shows the timeline even for a single source. */
  onAddClip?: () => Promise<VideoSource | readonly VideoSource[] | null>;
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
          <VideoEditorLoader {...rest} />
        </GestureHandlerRootView>
      </EditorShell>
    </MediaEditorProvider>
  );
}

type VideoEditorScreenProps = Omit<VideoEditorProps, keyof MediaEditorConfigProps>;

function sourceUri(source: VideoSource): string {
  return typeof source === 'string' ? source : source.uri;
}

/** Reads metadata for every source, then mounts the editor with a ready project. */
function VideoEditorLoader(props: VideoEditorScreenProps) {
  const theme = useEditorTheme();
  const [loaded, setLoaded] = useState<{ key: string; project: Project } | null>(null);
  const onErrorRef = useRef(props.onError);
  useEffect(() => {
    onErrorRef.current = props.onError;
  });

  const { source } = props;
  const sourceKey = (Array.isArray(source) ? source : [source]).map(sourceUri).join('\n');
  const project = loaded?.key === sourceKey ? loaded.project : null;
  useEffect(() => {
    let cancelled = false;
    const uris = sourceKey.split('\n');
    Promise.all(uris.map((uri) => getVideoInfo(uri)))
      .then((infos: VideoInfo[]) => {
        if (cancelled) return;
        const sources = uris.map((uri, i) => ({ uri, info: infos[i] }));
        setLoaded({ key: sourceKey, project: projectFromSources(sources) });
      })
      .catch((error) => {
        if (!cancelled) {
          onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  if (!project) {
    return (
      <View
        style={[styles.container, styles.loading, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  return <VideoEditorScreen key={sourceKey} {...props} initialProject={project} />;
}

function VideoEditorScreen({
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
  compression,
  onAddClip,
  initialProject,
}: VideoEditorScreenProps & { initialProject: Project }) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const insets = useSafeAreaInsets();
  useConsumeAndroidBack();

  const controller = useProjectEditorState(initialProject);
  const { state, dispatch } = controller;
  const clip = selectedClip(state);
  const edits = clip.edits;
  const info = clip.info;
  const layers = overlayLayers(state.project);
  const strokes = overlayStrokes(state.project);
  const minMs = minDurationMs ?? MIN_DURATION_DEFAULT_MS;

  const [busy, setBusy] = useState(false);
  // Preview player unloads during export so its decoders don't compete with the export session.
  const [exporting, setExporting] = useState(false);
  // Editors open paused on the first frame (CapCut et al.); play is a user action.
  const [paused, setPaused] = useState(true);
  // Ephemeral crop-mode UI kept out of the reducer so undo/redo never reopens crop.
  const [cropActive, setCropActive] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<CropRect | null>(null);
  const [videoContainer, setVideoContainer] = useState({ width: 0, height: 0 });
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [clipFocused, setClipFocused] = useState(false);
  const [drawLaneSelected, setDrawLaneSelected] = useState(false);

  // Sync pending crop from reducer while crop UI is closed (adjust-state-during-render pattern).
  const [lastSyncedCrop, setLastSyncedCrop] = useState(edits.crop);
  if (!cropActive && lastSyncedCrop !== edits.crop) {
    setLastSyncedCrop(edits.crop);
    setPendingCrop(edits.crop);
  }

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  const reportError = useCallback((error: unknown) => {
    onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
  }, []);

  const customFontTypefaces = useCustomFontProvider(customFonts);
  const stickerImages = useResolvedStickerImages(layers, stickerPacks);
  const rasterizer = useProjectRasterizer({
    stickerImages,
    customFonts,
    customFontTypefaces,
    stickerPacks,
    overlayPacks,
  });

  const visibleTools = useMemo<readonly VideoToolId[]>(
    () => normalizeVideoTools(videoTools) ?? VIDEO_TOOL_IDS,
    [videoTools]
  );
  const aspectOptions = useMemo<readonly AspectRatio[]>(
    () => normalizeCropAspects(cropAspectRatios) ?? ASPECT_RATIO_PRESETS,
    [cropAspectRatios]
  );

  // ---- Preview project: committed state, minus crop while the crop UI edits it. ----
  const previewProject = useMemo<Project>(() => {
    if (!cropActive) return state.project;
    return mapClip(state.project, clip.id, (c) => ({ ...c, edits: { ...c.edits, crop: null } }));
  }, [state.project, cropActive, clip.id]);

  // Full-strength wash rasters per clip; intensity rides the wire so slider drags never re-rasterize.
  const [clipWashes, setClipWashes] = useState<ReadonlyMap<string, ClipWashAsset>>(new Map());
  const clips = videoTrack(state.project).clips;
  // Washes rasterize for every track's clips — pip clips take effects too.
  const allClips = useMemo(
    () => state.project.tracks.flatMap((track) => track.clips),
    [state.project.tracks]
  );
  const washKey = allClips
    .map((c) => `${c.id}:${String(c.edits.overlayId)}:${outputSizeKey(c)}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, ClipWashAsset>();
      for (const c of allClips) {
        if (c.edits.overlayId == null) continue;
        const { width, height } = clipOutputSize(c);
        const asset = await rasterizer.rasterizeWashPng(c.edits.overlayId, width, height);
        if (asset) next.set(c.id, asset);
      }
      if (!cancelled) setClipWashes(next);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [washKey, rasterizer]);

  const previewWire = useMemo(
    () => serializeProject(previewProject, { filterPacks, clipWashes }),
    [previewProject, filterPacks, clipWashes]
  );
  const debouncedWire = useDebouncedValue(previewWire, PREVIEW_REBUILD_DEBOUNCE_MS);

  // ---- Player + playback clock ----
  const playerRef = useRef<TimelinePlayerHandle>(null);
  const clock = useSharedValue<PlaybackClock | null>(null);
  // Playhead in the selected clip's source-time domain (used by scrub previews).
  const playheadMs = useSharedValue(clip.sourceStartMs);

  const previewClips = videoTrack(previewProject).clips;
  const projectDurationMs = previewClips.reduce((sum, c) => sum + clipDurationMs(c), 0);
  const timelineFromSource = useCallback(
    (sourceMs: number): number => {
      let start = 0;
      for (const c of videoTrack(previewProject).clips) {
        if (c.id === clip.id) {
          const clamped = clamp(sourceMs, c.sourceStartMs, c.sourceEndMs);
          return start + (clamped - c.sourceStartMs) / c.edits.speed;
        }
        start += clipDurationMs(c);
      }
      return 0;
    },
    [previewProject, clip.id]
  );

  const activeTool = state.activeTool;

  const isPipSelected = clip.placement != null;
  const pipEntry = isPipSelected ? findClip(state.project, clip.id) : null;
  // A selected pip keeps the player canvas-shaped — the view shows the composed main track, not the pip source.
  const displayClip = isPipSelected && !cropActive ? clips[0] : clip;

  // ---- Display rect: letterbox rect during crop-edit; cropped viewport rect otherwise. ----
  const videoDisplayRect = useMemo(() => {
    if (videoContainer.width === 0 || videoContainer.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const crop = !cropActive ? displayClip.edits.crop : null;
    const contentW = crop ? crop.width : displayClip.info.width;
    const contentH = crop ? crop.height : displayClip.info.height;
    // Crop-editing insets the video by CROP_EDIT_MARGIN so corner handles stay grabbable at screen edges.
    const inset = cropActive ? CROP_EDIT_MARGIN : 0;
    const scale = Math.min(
      Math.max(1, videoContainer.width - inset * 2) / contentW,
      Math.max(1, videoContainer.height - inset * 2) / contentH
    );
    const width = contentW * scale;
    const height = contentH * scale;
    return {
      x: (videoContainer.width - width) / 2,
      y: (videoContainer.height - height) / 2,
      width,
      height,
    };
  }, [displayClip.info, displayClip.edits.crop, videoContainer, cropActive]);

  const cropOverlayAspect = useMemo<number | null>(() => {
    if (edits.aspect === 'free') return null;
    return aspectRatioValue(edits.aspect, { imageAspect: info.width / info.height });
  }, [edits.aspect, info]);

  const previewBaseFontSize =
    Math.min(videoDisplayRect.width, videoDisplayRect.height) * TEXT_BASE_RATIO;
  const previewBaseStickerSize =
    Math.min(videoDisplayRect.width, videoDisplayRect.height) * STICKER_BASE_RATIO;

  // ---- Draw tool ----
  const [drawSettings, setDrawSettings] = useState<DrawToolSettings>(createDefaultDrawSettings);
  // Live stroke persists until the reducer echoes it back.
  const [liveStroke, setLiveStroke] = useState<DrawStroke | null>(null);
  const liveStrokeCommitted = liveStroke != null && strokes.some((s) => s.id === liveStroke.id);
  if (liveStrokeCommitted) {
    setLiveStroke(null);
  }
  const pendingLiveStroke = liveStrokeCommitted ? null : liveStroke;
  const handleStrokeEnd = useCallback(
    (stroke: DrawStroke) => dispatch({ type: 'addStroke', stroke }),
    [dispatch]
  );

  // ---- Text focus: one reducer commit at Done. ----
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
        if (trimmed.length > 0) {
          const center = spawnCenterFor(layers.length);
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
        }
      } else if (trimmed.length === 0) {
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
      setTextFocus(null);
    },
    [dispatch, layers.length]
  );

  // ---- Scrubbing: playhead + Android frame overlay every tick; native seeks at a throttled cadence. ----
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubActiveRef = useRef(false);
  // Post-trim settle position, pre-computed at commit: the source→timeline mapping in
  // `timelineFromSource` still reads pre-commit state during the same tick (React batching).
  const trimSettleMsRef = useRef<number | null>(null);
  const scrubLastSeekAtRef = useRef(0);
  const scrubFrameListenerRef = useRef<((timeMs: number) => void) | null>(null);
  const registerScrubFrameListener = useCallback((cb: ((timeMs: number) => void) | null) => {
    scrubFrameListenerRef.current = cb;
  }, []);
  // Keyed by source so a new video retries the fast path; on decoder-alloc/fatal we fall back to the pre-extracted overlay for the session.
  const [scrubEngineFailure, setScrubEngineFailure] = useState<{ source: string } | null>(null);
  const scrubEngineFailed = scrubEngineFailure?.source === clip.source;
  const handleScrubEngineFallback = useCallback(() => {
    setScrubEngineFailure({ source: clip.source });
  }, [clip.source]);

  const handleScrub = useCallback(
    (timeMs: number) => {
      // eslint-disable-next-line react-hooks/immutability -- shared-value write is the reanimated JS→UI API; keeps the playhead on the dragged handle.
      playheadMs.value = timeMs;
      scrubFrameListenerRef.current?.(timeMs);
      if (!scrubActiveRef.current) {
        scrubActiveRef.current = true;
        // Touching the timeline pauses and STAYS paused (CapCut contract); play is a user action.
        setPaused(true);
        playerRef.current?.setScrubbing(true).catch(() => {});
        setIsScrubbing(true);
      }
      const now = Date.now();
      if (now - scrubLastSeekAtRef.current >= SCRUB_SEEK_INTERVAL_MS) {
        scrubLastSeekAtRef.current = now;
        playerRef.current?.seekTo(timelineFromSource(timeMs)).catch(() => {});
      }
    },
    [playheadMs, timelineFromSource, setPaused]
  );

  const handleScrubEnd = useCallback(() => {
    if (!scrubActiveRef.current) return;
    scrubActiveRef.current = false;
    setIsScrubbing(false);
    // Drop scrub mode first so the settle seek is frame-exact (in-scrub seeks are approximate).
    playerRef.current?.setScrubbing(false).catch(() => {});
    const settleMs = trimSettleMsRef.current ?? timelineFromSource(playheadMs.value);
    trimSettleMsRef.current = null;
    playerRef.current?.seekTo(settleMs).catch(() => {});
  }, [playheadMs, timelineFromSource]);

  // ---- Timeline scrub: positions flow UI-thread → native via `scrubMsSv` (see TimelinePlayer
  // scrubMs); JS only handles the gesture edges — pause/scrub-mode on touch, exact settle seek. ----
  const scrubMsSv = useSharedValue(-1);
  const handleTimelineScrubBegin = useCallback(() => {
    if (scrubActiveRef.current) return;
    scrubActiveRef.current = true;
    // Touching the timeline pauses and STAYS paused (CapCut contract); play is a user action.
    setPaused(true);
    playerRef.current?.setScrubbing(true).catch(() => {});
  }, [setPaused]);

  const handleTimelineScrub = (timelineMs: number) => {
    if (!scrubActiveRef.current) {
      scrubActiveRef.current = true;
      // Touching the timeline pauses and STAYS paused (CapCut contract); play is a user action.
      setPaused(true);
      playerRef.current?.setScrubbing(true).catch(() => {});
    }
    const now = Date.now();
    if (now - scrubLastSeekAtRef.current >= SCRUB_SEEK_INTERVAL_MS) {
      scrubLastSeekAtRef.current = now;
      playerRef.current?.seekTo(timelineMs).catch(() => {});
    }
  };
  const handleTimelineScrubEnd = (timelineMs: number) => {
    if (!scrubActiveRef.current) return;
    scrubActiveRef.current = false;
    // -1 disarms the native scrub channel so the next gesture's first write always differs.
    scrubMsSv.value = -1;
    playerRef.current?.setScrubbing(false).catch(() => {});
    playerRef.current?.seekTo(timelineMs).catch(() => {});
  };

  // ---- Timed overlays: each element keeps its own window; lane selection binds the range control. ----
  const layerEditingActive =
    activeTool === 'text' || activeTool === 'stickers' || state.selectedLayerId != null;
  const selectedOverlay: TimedOverlay | null =
    drawLaneSelected || activeTool === 'draw'
      ? drawOverlay(state.project)
      : state.selectedLayerId != null
        ? overlayForLayer(state.project, state.selectedLayerId)
        : null;

  const overlayLanes = useMemo<OverlayLaneModel[]>(
    () =>
      state.project.overlays
        .filter((o) => o.layers.length > 0 || o.strokes.length > 0)
        .map((o) => {
          const first = o.layers[0];
          const kind = first == null ? 'draw' : first.kind === 'text' ? 'text' : 'sticker';
          return {
            id: o.id,
            kind,
            label: first?.kind === 'text' ? first.text : '',
            startMs: o.timelineStartMs,
            endMs: Math.min(o.timelineEndMs, projectDurationMs),
          };
        }),
    [state.project.overlays, projectDurationMs]
  );

  // Displayed top-to-bottom = topmost-z first, so the lanes read like layers (track order is bottom-up).
  const pipLanes = useMemo<PipLaneModel[]>(
    () =>
      pipTracks(state.project)
        .map((track) => ({ trackId: track.id, clip: track.clips[0] }))
        .reverse(),
    [state.project]
  );

  // Overlay tools show their content unconditionally; everywhere else each window gates visibility.
  const overlayGatesEnabled = !layerEditingActive && activeTool !== 'draw' && textFocus == null;
  const overlayEntries = useMemo(() => {
    const draw = drawOverlay(state.project);
    const entries = state.project.overlays
      .map((o) => {
        const endMs = Math.min(o.timelineEndMs, projectDurationMs);
        return {
          key: o.id,
          layers: layerEditingActive ? [] : o.layers,
          strokes:
            o === draw && pendingLiveStroke != null ? [...o.strokes, pendingLiveStroke] : o.strokes,
          startMs: o.timelineStartMs,
          endMs,
          gated: overlayGatesEnabled && (o.timelineStartMs > 0 || endMs < projectDurationMs),
        };
      })
      .filter((e) => e.layers.length > 0 || e.strokes.length > 0);
    if (pendingLiveStroke != null && draw == null) {
      entries.push({
        key: 'live-stroke',
        layers: [],
        strokes: [pendingLiveStroke],
        startMs: 0,
        endMs: projectDurationMs,
        gated: false,
      });
    }
    return entries;
  }, [
    state.project,
    layerEditingActive,
    overlayGatesEnabled,
    pendingLiveStroke,
    projectDurationMs,
  ]);

  const anyOverlayGated = overlayEntries.some((e) => e.gated);
  // Timeline-position clock the gates compare against, extrapolated per frame from the playback snapshot.
  const timelinePlayheadMs = useSharedValue(0);
  const overlayGateDrive = useFrameCallback((frame) => {
    'worklet';
    const snap = clock.value;
    if (snap == null) return;
    timelinePlayheadMs.value = snap.positionMs + (frame.timestamp - snap.epochMs) * snap.rate;
  }, false);
  useEffect(() => {
    overlayGateDrive.setActive(anyOverlayGated);
  }, [anyOverlayGated, overlayGateDrive]);

  const handleAddClip = async () => {
    if (!onAddClip || busy) return;
    try {
      const picked = await onAddClip();
      if (picked == null) return;
      const uris = (Array.isArray(picked) ? picked : [picked]).map(sourceUri);
      if (uris.length === 0) return;
      const infos = await Promise.all(uris.map((uri) => getVideoInfo(uri)));
      dispatch({
        type: 'addClips',
        clips: uris.map((uri, i) => createClip(uri, infos[i])),
        afterId: clip.id,
      });
    } catch (error) {
      reportError(error);
    }
  };

  const handleAddPip = async () => {
    if (!onAddClip || busy) return;
    try {
      const picked = await onAddClip();
      if (picked == null) return;
      const uri = (Array.isArray(picked) ? picked : [picked]).map(sourceUri)[0];
      if (uri == null) return;
      const pipInfo = await getVideoInfo(uri);
      const snap = clock.value;
      const positionMs =
        snap == null ? 0 : snap.positionMs + (performance.now() - snap.epochMs) * snap.rate;
      dispatch({
        type: 'addPip',
        source: uri,
        info: pipInfo,
        timelineStartMs: clamp(
          Math.round(positionMs),
          0,
          Math.max(0, Math.round(projectDurationMs - minMs))
        ),
      });
      setClipFocused(true);
      setDrawLaneSelected(false);
      if (state.selectedLayerId != null) dispatch({ type: 'selectLayer', id: null });
    } catch (error) {
      reportError(error);
    }
  };

  const handlePipWindowCommit = (trackId: string, timelineStartMs: number, laneDelta: number) => {
    const pips = pipTracks(state.project);
    const fromIndex = pips.findIndex((tk) => tk.id === trackId);
    if (fromIndex < 0) return;
    // Displayed lanes are reversed (top = topmost z): +1 display row down = −1 pip index.
    const toIndex = clamp(fromIndex - laneDelta, 0, pips.length - 1);
    const windowChanged = pips[fromIndex].clips[0].placement?.timelineStartMs !== timelineStartMs;
    if (!windowChanged && toIndex === fromIndex) return;
    dispatch({ type: 'setPipWindow', trackId, timelineStartMs, toIndex });
  };

  const handlePipTrimCommit = (
    trackId: string,
    clipId: string,
    sourceStartMs: number,
    sourceEndMs: number,
    timelineStartMs: number
  ) => {
    const track = pipTracks(state.project).find((tk) => tk.id === trackId);
    const target = track?.clips[0];
    if (!target || target.id !== clipId) return;
    const windowChanged = target.placement?.timelineStartMs !== timelineStartMs;
    const trimChanged =
      target.sourceStartMs !== sourceStartMs || target.sourceEndMs !== sourceEndMs;
    if (!windowChanged && !trimChanged) return;
    // One drag = one undo step: setPipWindow auto-checkpoints, otherwise checkpoint explicitly.
    if (windowChanged) {
      dispatch({ type: 'setPipWindow', trackId, timelineStartMs });
    } else {
      dispatch({ type: 'checkpoint' });
    }
    if (trimChanged) {
      dispatch({ type: 'trimClip', id: clipId, sourceStartMs, sourceEndMs });
    }
  };

  const handlePipTransformCommit = (trackId: string, transform: PipTransform) => {
    dispatch({ type: 'setPipTransform', trackId, transform });
  };

  // ---- Trim / crop commit flows (plain functions — the compiler memoizes) ----
  const handleTrimCommit = (id: string, sourceStartMs: number, sourceEndMs: number) => {
    const target = clips.find((c) => c.id === id);
    if (!target || (target.sourceStartMs === sourceStartMs && target.sourceEndMs === sourceEndMs)) {
      return;
    }
    // One committed trim = one undo step.
    dispatch({ type: 'checkpoint' });
    dispatch({ type: 'trimClip', id, sourceStartMs, sourceEndMs });
    // CapCut contract: the trimmed edge sits under the playhead after release. Preceding
    // clips are untouched by a trim, so their pre-commit durations give the post-commit prefix.
    let start = 0;
    for (const c of previewClips) {
      if (c.id === id) break;
      start += clipDurationMs(c);
    }
    trimSettleMsRef.current =
      target.sourceStartMs !== sourceStartMs
        ? start
        : start + (sourceEndMs - sourceStartMs) / target.edits.speed;
  };

  const handleSelectClip = (id: string) => {
    dispatch({ type: 'selectClip', id });
    setClipFocused(true);
    setDrawLaneSelected(false);
    if (state.selectedLayerId != null) dispatch({ type: 'selectLayer', id: null });
  };

  const handleSelectOverlay = (overlayId: string) => {
    const overlay = state.project.overlays.find((o) => o.id === overlayId);
    if (!overlay) return;
    setClipFocused(false);
    if (overlay.layers.length > 0) {
      setDrawLaneSelected(false);
      dispatch({ type: 'selectLayer', id: overlay.layers[0].id });
    } else {
      dispatch({ type: 'selectLayer', id: null });
      setDrawLaneSelected(true);
    }
  };

  const handleOverlayWindowCommit = (overlayId: string, startMs: number, endMs: number) => {
    dispatch({
      type: 'setOverlayTiming',
      overlayId,
      timelineStartMs: startMs,
      // Windows released at the tail keep tracking the project end as clips change.
      timelineEndMs: endMs >= projectDurationMs - 50 ? OVERLAY_END_UNBOUNDED : endMs,
    });
  };

  const handleSplit = () => {
    const snap = clock.value;
    const positionMs =
      snap == null ? 0 : snap.positionMs + (performance.now() - snap.epochMs) * snap.rate;
    const at = new TimelineIndex(clips).positionToClip(positionMs);
    const target = clips[at.clipIndex];
    if (target == null || target.id !== clip.id) return;
    dispatch({
      type: 'splitClip',
      id: target.id,
      sourceMs: Math.round(at.sourceMs),
      minDurationMs: minMs,
    });
  };

  const enterCrop = () => {
    setPendingCrop(edits.crop);
    setCropActive(true);
  };
  const applyCrop = () => {
    // One committed crop = one undo step.
    dispatch({ type: 'checkpoint' });
    dispatch({ type: 'setCrop', crop: pendingCrop });
    setCropActive(false);
  };
  const resetCrop = () => {
    setPendingCrop(null);
    if (edits.aspect !== 'free') {
      dispatch({ type: 'setAspect', aspect: 'free' });
    }
  };

  const handleAspectChange = (aspect: AspectRatio) => {
    dispatch({ type: 'setAspect', aspect });
    if (aspect === 'free') return;
    const ratio = aspectRatioValue(aspect, { imageAspect: info.width / info.height });
    if (ratio == null || ratio <= 0) return;
    setPendingCrop(fitCropRectToAspect(info.width, info.height, ratio));
  };

  // ---- Toolbar / panels ----
  const handleToolSelect = (tool: VideoToolId) => {
    if (busy) return;
    // Pip is an action, not a panel: it runs the add flow and never becomes the active tool.
    if (tool === 'pip') {
      handleAddPip().catch(() => {});
      return;
    }
    if (tool === activeTool) {
      dispatch({ type: 'setTool', tool: null });
      return;
    }
    dispatch({ type: 'setTool', tool });
  };
  const closeCoverPicker = useCallback(() => dispatch({ type: 'setTool', tool: null }), [dispatch]);

  // ---- Cover ----
  const coverPickedRef = useRef(false);
  const handleSaveCover = async (timeMs: number) => {
    setBusy(true);
    try {
      const result = await getVideoThumbnail(clip.source, { timeMs });
      coverPickedRef.current = true;
      onCoverSelected?.(result);
      dispatch({ type: 'setTool', tool: null });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  // Prefetch at mount so the effects panel renders in one phase; swapping content mid-animation offsets its hit-test region.
  const [effectsPosterUri, setEffectsPosterUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getVideoThumbnail(clip.source, { timeMs: 0, maxWidth: 512, quality: 0.85 })
      .then((r) => {
        if (!cancelled) setEffectsPosterUri(r.uri);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clip.source]);

  // ---- Export ----
  const handleExport = async () => {
    setBusy(true);
    setExporting(true);
    setPaused(true);
    try {
      const project = state.project;
      const renderSize = clipOutputSize(videoTrack(project).clips[0]);
      const overlayPngs = new Map<string, string>();
      for (const overlay of project.overlays) {
        const png = await rasterizer.rasterizeOverlayPng(
          overlay,
          renderSize.width,
          renderSize.height
        );
        if (png) overlayPngs.set(overlay.id, png);
      }
      const washes = new Map<string, ClipWashAsset>();
      for (const c of project.tracks.flatMap((track) => track.clips)) {
        if (c.edits.overlayId == null || c.edits.overlayIntensity <= 0) continue;
        const { width, height } = clipOutputSize(c);
        const asset = await rasterizer.rasterizeWashPng(c.edits.overlayId, width, height);
        if (asset) washes.set(c.id, asset);
      }
      const wire = serializeProject(
        compression ? { ...project, output: { ...project.output, compression } } : project,
        { filterPacks, clipWashes: washes, overlayPngs }
      );
      const result = await exportProject(wire);
      if (onCoverSelected && !coverPickedRef.current) {
        // Default cover: first frame of the exported file, so it reflects trim/crop/color edits.
        try {
          onCoverSelected(await getVideoThumbnail(result.uri, { timeMs: 0 }));
        } catch {
          // Best-effort — a missing default cover must not fail the export.
        }
      }
      onExport?.(result);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
      setExporting(false);
    }
  };

  // Done first settles the canvas like tapping outside (deselect), then asks before exporting.
  const [confirmingDone, setConfirmingDone] = useState(false);
  const handleDonePress = () => {
    Keyboard.dismiss();
    dispatch({ type: 'selectLayer', id: null });
    setClipFocused(false);
    setDrawLaneSelected(false);
    setConfirmingDone(true);
  };

  const togglePlayback = () => setPaused((p) => !p);

  const panelBottom = toolbarHeight + insets.bottom;
  const panelVisible = activeTool != null && !cropActive && textFocus == null;
  const highlightedTool: VideoToolId | null = activeTool;

  const rootTools = useMemo(
    () =>
      visibleTools.filter(
        (id) => id !== 'crop' && id !== 'speed' && (id !== 'pip' || onAddClip != null)
      ),
    [visibleTools, onAddClip]
  );

  const overlayFocused = activeTool == null && selectedOverlay != null;
  const clipMenuVisible = activeTool == null && !overlayFocused && clipFocused;

  const handleSubToolbarBack = () => {
    setClipFocused(false);
    setDrawLaneSelected(false);
    if (state.selectedLayerId != null) dispatch({ type: 'selectLayer', id: null });
  };

  const clipActions: SubToolbarAction[] = [
    { key: 'split', icon: 'trim', label: t('split'), onPress: handleSplit },
    ...(visibleTools.includes('speed')
      ? [
          {
            key: 'speed',
            icon: 'trim' as const,
            label: t('speed'),
            onPress: () => dispatch({ type: 'setTool', tool: 'speed' as const }),
          },
        ]
      : []),
    ...(visibleTools.includes('crop')
      ? [{ key: 'crop', icon: 'crop' as const, label: t('crop'), onPress: enterCrop }]
      : []),
    {
      key: 'delete',
      icon: 'trash',
      label: t('removeClip'),
      destructive: true,
      disabled: clips.length <= 1,
      onPress: () => dispatch({ type: 'removeClip', id: clip.id }),
    },
  ];

  const pipActions: SubToolbarAction[] = [
    ...(visibleTools.includes('speed')
      ? [
          {
            key: 'speed',
            icon: 'trim' as const,
            label: t('speed'),
            onPress: () => dispatch({ type: 'setTool', tool: 'speed' as const }),
          },
        ]
      : []),
    ...(visibleTools.includes('effects')
      ? [
          {
            key: 'effects',
            icon: 'effects' as const,
            label: t('effects'),
            onPress: () => dispatch({ type: 'setTool', tool: 'effects' as const }),
          },
        ]
      : []),
    ...(visibleTools.includes('adjust')
      ? [
          {
            key: 'adjust',
            icon: 'adjust' as const,
            label: t('adjust'),
            onPress: () => dispatch({ type: 'setTool', tool: 'adjust' as const }),
          },
        ]
      : []),
    {
      key: 'delete',
      icon: 'trash',
      label: t('remove'),
      destructive: true,
      onPress: () => {
        if (pipEntry != null) dispatch({ type: 'removePip', trackId: pipEntry.track.id });
        setClipFocused(false);
      },
    },
  ];

  const overlayActions: SubToolbarAction[] = [
    ...(selectedOverlay != null && selectedOverlay.layers.length > 0
      ? [
          {
            key: 'duplicate',
            icon: 'duplicate' as const,
            label: t('duplicate'),
            onPress: () => dispatch({ type: 'duplicateLayer', id: selectedOverlay.layers[0].id }),
          },
        ]
      : []),
    {
      key: 'delete',
      icon: 'trash',
      label: t('remove'),
      destructive: true,
      onPress: () => {
        if (selectedOverlay != null && selectedOverlay.layers.length > 0) {
          dispatch({ type: 'removeLayer', id: selectedOverlay.layers[0].id });
        } else {
          dispatch({ type: 'clearStrokes' });
        }
        setDrawLaneSelected(false);
      },
    },
  ];

  return (
    // useSafeAreaInsets() applies on first frame — native SafeAreaView re-measures after first paint on Android, causing a jump.
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}>
      <View
        style={textFocus != null ? styles.chromeHidden : null}
        pointerEvents={textFocus != null ? 'none' : 'auto'}>
        <EditorHeader
          title={title ?? t('editVideo')}
          onCancel={onCancel}
          actionLabel={t('done')}
          onAction={handleDonePress}
          actionDisabled={busy || cropActive}
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
        {videoDisplayRect.width > 0 && (
          <TimelinePlayer
            ref={playerRef}
            project={exporting ? null : debouncedWire}
            paused={paused}
            loop
            clock={clock}
            scrubMs={scrubMsSv}
            onError={(message) => reportError(new Error(message))}
            style={{
              position: 'absolute',
              left: videoDisplayRect.x,
              top: videoDisplayRect.y,
              width: videoDisplayRect.width,
              height: videoDisplayRect.height,
            }}
          />
        )}
        {Platform.OS === 'android' && !scrubEngineFailed && (
          <ScrubEnginePreview
            source={clip.source}
            durationMs={clip.sourceDurationMs}
            info={info}
            crop={cropActive ? null : edits.crop}
            displayRect={videoDisplayRect}
            visible={isScrubbing}
            registerListener={registerScrubFrameListener}
            onFallback={handleScrubEngineFallback}
          />
        )}
        {Platform.OS === 'android' && scrubEngineFailed && (
          <ScrubFrameOverlay
            source={clip.source}
            durationMs={clip.sourceDurationMs}
            info={info}
            crop={cropActive ? null : edits.crop}
            displayRect={videoDisplayRect}
            visible={isScrubbing}
            registerListener={registerScrubFrameListener}
          />
        )}
        {videoDisplayRect.width > 0 &&
          overlayEntries.map((entry) => (
            <GatedOverlayCanvas
              key={entry.key}
              gated={entry.gated}
              startMs={entry.startMs}
              endMs={entry.endMs}
              playheadMs={timelinePlayheadMs}
              displayRect={videoDisplayRect}
              layers={entry.layers}
              strokes={entry.strokes}
              baseFontSize={previewBaseFontSize}
              baseStickerSize={previewBaseStickerSize}
              stickerImages={stickerImages}
              customFonts={customFonts}
              customFontTypefaces={customFontTypefaces}
              stickerPacks={stickerPacks}
            />
          ))}
        {cropActive && (
          <CropOverlay
            videoWidth={info.width}
            videoHeight={info.height}
            value={pendingCrop}
            onChange={setPendingCrop}
            aspectRatio={cropOverlayAspect}
          />
        )}
        {!cropActive && videoDisplayRect.width > 0 && layerEditingActive && (
          <LayerOverlay
            layers={layers}
            displayRect={videoDisplayRect}
            selectedId={state.selectedLayerId}
            baseFontSize={previewBaseFontSize}
            baseStickerSize={previewBaseStickerSize}
            stickerPacks={stickerPacks}
            customFonts={customFonts}
            customFontTypefaces={customFontTypefaces}
            onCommit={(id, transform) => dispatch({ type: 'setLayerTransform', id, ...transform })}
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
        {!cropActive &&
          videoDisplayRect.width > 0 &&
          clipMenuVisible &&
          isPipSelected &&
          pipEntry != null && (
            <PipGhostOverlay
              clip={pipEntry.clip}
              displayRect={videoDisplayRect}
              onCommit={(transform) => handlePipTransformCommit(pipEntry.track.id, transform)}
            />
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
                value={edits.aspect}
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
      ) : (
        <>
          <TransportRow
            paused={paused}
            onTogglePlay={togglePlayback}
            clock={clock}
            durationMs={projectDurationMs}
            canUndo={canUndo(state)}
            canRedo={canRedo(state)}
            onUndo={() => dispatch({ type: 'undo' })}
            onRedo={() => dispatch({ type: 'redo' })}
          />
          <TimelineArea
            clips={previewClips}
            selectedClipId={clip.id}
            clipFocused={clipMenuVisible}
            clock={clock}
            scrubMs={scrubMsSv}
            onScrubBegin={handleTimelineScrubBegin}
            overlays={overlayLanes}
            selectedOverlayId={selectedOverlay?.id ?? null}
            minDurationMs={minMs}
            onSelectClip={handleSelectClip}
            onMoveClip={(id, toIndex) => dispatch({ type: 'moveClip', id, toIndex })}
            onAddPress={onAddClip ? handleAddClip : undefined}
            onScrub={handleTimelineScrub}
            onScrubEnd={handleTimelineScrubEnd}
            onTrimCommit={handleTrimCommit}
            onTrimScrub={handleScrub}
            onTrimScrubEnd={handleScrubEnd}
            onSelectOverlay={handleSelectOverlay}
            onOverlayWindowCommit={handleOverlayWindowCommit}
            pips={pipLanes}
            onPipWindowCommit={handlePipWindowCommit}
            onPipTrimCommit={handlePipTrimCommit}
          />
        </>
      )}
      <View
        style={textFocus != null ? styles.chromeHidden : null}
        pointerEvents={textFocus != null ? 'none' : 'auto'}
        onLayout={(e: LayoutChangeEvent) => setToolbarHeight(e.nativeEvent.layout.height)}>
        {overlayFocused ? (
          <SubToolbar actions={overlayActions} onBack={handleSubToolbarBack} />
        ) : clipMenuVisible ? (
          <SubToolbar
            actions={isPipSelected ? pipActions : clipActions}
            onBack={handleSubToolbarBack}
          />
        ) : (
          <VideoToolbar active={highlightedTool} onSelect={handleToolSelect} tools={rootTools} />
        )}
      </View>

      {panelVisible && activeTool != null && (
        <VideoToolPanels
          controller={controller}
          activeTool={activeTool}
          bottom={panelBottom}
          onDismiss={closeCoverPicker}
          posterUri={effectsPosterUri}
          filterPacks={filterPacks}
          overlayPacks={overlayPacks}
          stickerPacks={stickerPacks}
          drawSettings={drawSettings}
          onDrawSettingsChange={setDrawSettings}
          onAddText={handleOpenTextFocus}
          cover={{
            source: clip.source,
            durationMs: clip.sourceDurationMs,
            onScrub: handleScrub,
            onScrubEnd: handleScrubEnd,
            onSave: handleSaveCover,
            onCancel: closeCoverPicker,
            busy,
          }}
        />
      )}

      {textFocus && (
        <TextFocusEditor
          session={textFocus}
          customFonts={customFonts}
          textColors={textColors}
          onDone={handleTextFocusDone}
          onCancel={() => setTextFocus(null)}
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

      <ConfirmSheet
        visible={confirmingDone}
        title={t('finishConfirmTitle')}
        body={t('finishConfirmBody')}
        confirmLabel={t('export')}
        cancelLabel={t('discardConfirmKeep')}
        onConfirm={() => {
          setConfirmingDone(false);
          handleExport();
        }}
        onCancel={() => setConfirmingDone(false)}
      />
    </View>
  );
}

function mapClip(project: Project, clipId: string, update: (clip: Clip) => Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? update(c) : c)),
    })),
  };
}

/** Post-crop output size in display px — the size wash/overlay rasters must match. */
function clipOutputSize(clip: Clip): { width: number; height: number } {
  const crop = clip.edits.crop;
  return {
    width: Math.round(crop ? crop.width : clip.info.width),
    height: Math.round(crop ? crop.height : clip.info.height),
  };
}

function outputSizeKey(clip: Clip): string {
  const { width, height } = clipOutputSize(clip);
  return `${width}x${height}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  video: { flex: 1, overflow: 'hidden' },
  loading: { alignItems: 'center', justifyContent: 'center' },
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
  busyOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyLabel: { marginTop: 12 },
  chromeHidden: { opacity: 0 },
});
