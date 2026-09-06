import {
  Canvas,
  drawAsImage,
  ImageFormat,
  Skia,
  useImage,
  type SkImage,
} from '@shopify/react-native-skia';
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaEditorProvider, type MediaEditorConfigProps } from '../core/MediaEditorProvider';
import { EditorHeader } from '../core/components/EditorHeader';
import { EditorShell } from '../core/components/EditorShell';
import { useEditorI18n, type EditorI18n } from '../core/i18n/I18nContext';
import { EditorIcon } from '../core/icons/IconContext';
import { useEditorTheme } from '../core/theming/ThemeContext';
import MediaEditorModule from '../native/MediaEditorModule';
import type { PhotoExportOptions, PhotoExportResult } from '../types';
import type { BackgroundRemovalEngine } from './ai/types';
import type { PhotoFilterPack } from './color';
import { computeCropView, CropOverlay } from './components/CropOverlay';
import { LayerOverlay } from './components/LayerOverlay';
import { PhotoRender } from './components/PhotoRender';
import { PhotoToolbar } from './components/PhotoToolbar';
import { CollapsedPanelStrip, ToolPanel } from './components/ToolPanel';
import { DrawOverlay, type DrawStroke } from './draw';
import { FOCUS_OFF, FocusOverlay, type PhotoFocus } from './focus';
import {
  generateLayerId,
  type PhotoLayer,
  type PhotoStickerPack,
  type StickerLayer,
  type TextLayer,
} from './layers';
import type { PhotoOverlayPack } from './overlays';
import { toPostRotation, toPreRotation } from './state/cropTransforms';
import {
  ASPECT_RATIO_PRESETS,
  aspectRatioValue,
  canRedo,
  canUndo,
  FULL_CROP,
  hasEdits,
  PHOTO_TOOL_IDS,
  INITIAL_STATE,
  usePhotoEditorState,
  type AspectRatio,
  type NormalizedCrop,
  type PhotoEditorState,
  type PhotoToolId,
} from './state/photoEditorState';
import { DEFAULT_FONT_ID, useCustomFontProvider, type PhotoCustomFont } from './text';
import { AITool } from './tools/AITool';
import { AdjustTool } from './tools/AdjustTool';
import { CropTool } from './tools/CropTool';
import { createDefaultDrawSettings, DrawTool } from './tools/DrawTool';
import { EffectsTool } from './tools/EffectsTool';
import { FocusTool } from './tools/FocusTool';
import {
  DEFAULT_STICKER_SPAWN_SCALE,
  DEFAULT_TEXT_SPAWN_SCALE,
  spawnCenterFor,
  StickerTool,
} from './tools/StickerTool';
import {
  TextFocusEditor,
  type TextDraftFields,
  type TextFocusResult,
  type TextFocusSession,
} from './tools/TextFocusEditor';
import { TextTool } from './tools/TextTool';
import { useResolvedStickerImages } from './tools/useResolvedStickerImages';

/** URI string or any object with a `.uri` string field (e.g. Expo `ImagePicker` assets). */
export type PhotoSource = string | { readonly uri: string };

function normalizeSource(source: PhotoSource): string {
  return typeof source === 'string' ? source : source.uri;
}

interface PhotoEditorBaseProps extends MediaEditorConfigProps {
  /** Header title override. `''` renders no title element; ignored in multi-source mode. */
  title?: string;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  /** Output format, quality, size cap and base64 opt-in. */
  exportOptions?: PhotoExportOptions;
  /** Overrides the built-in text color palette used by the text tool. */
  textColors?: string[];
  /** Consumer filter packs appended after built-ins. Built-in ids win resolution. */
  filterPacks?: PhotoFilterPack[];
  /** Consumer overlay packs appended after built-ins. Built-in ids win resolution. */
  overlayPacks?: PhotoOverlayPack[];
  /** Consumer sticker packs appended after built-ins. Built-in ids win resolution. */
  stickerPacks?: PhotoStickerPack[];
  /** Custom fonts appended to the text tool's font picker. Consumer must load into RN under the same `family`; editor loads Skia typeface from `source`. */
  customFonts?: PhotoCustomFont[];
  /** Crop aspect-ratio allowlist. When 'free' is excluded, editor locks to the first entry (no undo entry for the lock). */
  cropAspectRatios?: readonly AspectRatio[];
  /** Toolbar tab allowlist. 'ai' additionally requires `backgroundRemoval` + `isAvailable()` to render. `[]` renders no tabs. */
  tools?: readonly PhotoToolId[];
  /** Optional on-device background-removal engine (e.g. from `@dahab-tech/media-editor-ai`). Engine is called with the ORIGINAL source URI; the `{crop:'none'}` pixel-dimension contract keeps normalized geometry valid across swaps. */
  backgroundRemoval?: BackgroundRemovalEngine;
}

/** Single-source PhotoEditor props. */
export interface PhotoSingleSourceProps extends PhotoEditorBaseProps {
  source: PhotoSource;
  /** Fired once when the user hits Done. */
  onExport?: (result: PhotoExportResult) => void;
}

/** Multi-source PhotoEditor props. Any per-photo failure suppresses `onExport` and routes to `onError`. */
export interface PhotoMultiSourceProps extends PhotoEditorBaseProps {
  source: readonly PhotoSource[];
  /** Fired ONCE at end of batch with results in input order; suppressed on any failure. */
  onExport?: (results: readonly PhotoExportResult[]) => void;
}

export type PhotoEditorProps = PhotoSingleSourceProps | PhotoMultiSourceProps;

function isMultiSource(source: PhotoEditorProps['source']): source is readonly PhotoSource[] {
  return Array.isArray(source);
}

/** Photo editor. Overloads (not a union) drive `onExport` narrowing at JSX call sites (TS#7294). */
export function PhotoEditor(props: PhotoSingleSourceProps): React.ReactElement;
export function PhotoEditor(props: PhotoMultiSourceProps): React.ReactElement;
export function PhotoEditor(props: PhotoEditorProps): React.ReactElement;
export function PhotoEditor(props: PhotoEditorProps): React.ReactElement {
  const { theme, colorScheme, locale, direction, strings, icons, ...rest } = props;
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
          {isMultiSource(rest.source) ? (
            <PhotoBatchShell
              {...(rest as Omit<PhotoMultiSourceProps, keyof MediaEditorConfigProps>)}
            />
          ) : (
            <PhotoEditorScreen {...(rest as PhotoEditorScreenProps)} />
          )}
        </GestureHandlerRootView>
      </EditorShell>
    </MediaEditorProvider>
  );
}

type PhotoEditorScreenProps = Omit<PhotoSingleSourceProps, keyof MediaEditorConfigProps> & {
  /** Reducer snapshot to hydrate from (batch mode restores per-photo history). */
  initialState?: PhotoEditorState;
  /** Streams live state (batch shell writes to a ref for pre-nav snapshotting). */
  onStateChange?: (state: PhotoEditorState) => void;
  /** Replaces the built-in EditorHeader (used by the batch shell). */
  headerSlot?: ReactNode;
  /** Imperative export handle for a parent (batch shell). */
  screenRef?: MutableRefObject<PhotoScreenHandle | null>;
};

/** Imperative surface the screen exposes to a parent. */
export interface PhotoScreenHandle {
  /** Runs the export pipeline; returns null when the image hasn't loaded. Throws on encode/write failure. */
  exportAsync: () => Promise<PhotoExportResult | null>;
}

type PhotoBatchShellProps = Omit<PhotoMultiSourceProps, keyof MediaEditorConfigProps>;

function PhotoBatchShell({
  source,
  onCancel,
  onExport,
  onError,
  ...perPhotoProps
}: PhotoBatchShellProps) {
  const { t, isRTL, locale } = useEditorI18n();
  const theme = useEditorTheme();

  const count = source.length;
  const [currentIndex, setCurrentIndex] = useState(0);

  const [snapshots, setSnapshots] = useState<PhotoEditorState[]>(() =>
    Array.from({ length: count }, () => INITIAL_STATE)
  );

  const [exportCache, setExportCache] = useState<(PhotoExportResult | null)[]>(() =>
    Array.from({ length: count }, () => null)
  );

  const liveStateRef = useRef<PhotoEditorState>(snapshots[currentIndex] ?? INITIAL_STATE);
  const handleStateChange = useCallback((state: PhotoEditorState) => {
    liveStateRef.current = state;
  }, []);

  const screenRef = useRef<PhotoScreenHandle | null>(null);

  /** Freeze live state into `snapshots[currentIndex]`; invalidate cache slot when reference-different. */
  const captureCurrent = useCallback(() => {
    const captured = liveStateRef.current;
    let becameStale = false;
    setSnapshots((prev) => {
      if (prev[currentIndex] === captured) {
        becameStale = false;
        return prev;
      }
      becameStale = true;
      const next = prev.slice();
      next[currentIndex] = captured;
      return next;
    });
    if (becameStale) {
      setExportCache((prev) => {
        if (prev[currentIndex] == null) return prev;
        const next = prev.slice();
        next[currentIndex] = null;
        return next;
      });
    }
  }, [currentIndex]);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= count || target === currentIndex) return;
      captureCurrent();
      setCurrentIndex(target);
    },
    [count, currentIndex, captureCurrent]
  );

  const [batchExporting, setBatchExporting] = useState(false);

  const handleAdvance = useCallback(async () => {
    if (batchExporting) return;
    captureCurrent();
    setBatchExporting(true);
    try {
      const captured = liveStateRef.current;
      const prevSnap = snapshots[currentIndex];
      const cached = exportCache[currentIndex];
      // Cache trusted only when captured state is reference-equal to the snapshot
      // it was written against (captureCurrent's setState clear is async).
      let result: PhotoExportResult | null = null;
      if (cached != null && prevSnap === captured) {
        result = cached;
      } else {
        const handle = screenRef.current;
        if (!handle) {
          throw new Error('Photo editor screen is not mounted');
        }
        result = await handle.exportAsync();
        if (result == null) {
          return;
        }
        const fresh = result;
        setExportCache((prev) => {
          const next = prev.slice();
          next[currentIndex] = fresh;
          return next;
        });
      }

      if (currentIndex === count - 1) {
        const orderedCache = exportCache.slice();
        orderedCache[currentIndex] = result;
        const missing = orderedCache.some((r) => r == null);
        if (missing) {
          throw new Error('Batch export incomplete — retry required');
        }
        onExport?.(orderedCache as readonly PhotoExportResult[]);
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBatchExporting(false);
    }
  }, [
    batchExporting,
    captureCurrent,
    currentIndex,
    count,
    exportCache,
    snapshots,
    onError,
    onExport,
  ]);

  const handleCancel = useCallback(() => {
    const merged = snapshots.slice();
    merged[currentIndex] = liveStateRef.current;
    const dirty = merged.some((snap) => hasEdits(snap));

    if (!dirty) {
      onCancel?.();
      return;
    }
    Alert.alert(
      t('discardConfirmTitle'),
      t('discardConfirmBody'),
      [
        { text: t('discardConfirmKeep'), style: 'cancel' },
        { text: t('discardConfirmDiscard'), style: 'destructive', onPress: () => onCancel?.() },
      ],
      { cancelable: true }
    );
  }, [snapshots, currentIndex, onCancel, t]);

  const isLast = currentIndex === count - 1;
  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < count - 1;

  const header = (
    <BatchHeader
      current={currentIndex}
      total={count}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={() => goTo(currentIndex - 1)}
      onForward={() => goTo(currentIndex + 1)}
      onCancel={handleCancel}
      onAdvance={handleAdvance}
      advanceLabel={isLast ? t('done') : t('next')}
      advanceDisabled={batchExporting}
      i18n={{ t, isRTL, locale }}
      theme={theme}
    />
  );

  return (
    <PhotoEditorScreen
      key={currentIndex}
      {...perPhotoProps}
      source={source[currentIndex]}
      initialState={snapshots[currentIndex] ?? INITIAL_STATE}
      onStateChange={handleStateChange}
      screenRef={screenRef}
      headerSlot={header}
      // Batch shell owns cancel + export; do not forward consumer callbacks.
      onCancel={undefined}
      onExport={undefined}
      onError={onError}
    />
  );
}

function BatchHeader({
  current,
  total,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onCancel,
  onAdvance,
  advanceLabel,
  advanceDisabled,
  i18n,
  theme,
}: {
  current: number;
  total: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onCancel: () => void;
  onAdvance: () => void;
  advanceLabel: string;
  advanceDisabled: boolean;
  i18n: Pick<EditorI18n, 't' | 'isRTL' | 'locale'>;
  theme: ReturnType<typeof useEditorTheme>;
}) {
  const { t, isRTL, locale } = i18n;
  const counter = formatCounter(t('photoCounter'), current + 1, total, locale);

  return (
    <View
      style={[
        batchHeaderStyles.container,
        {
          flexDirection: isRTL ? 'row-reverse' : 'row',
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
          paddingHorizontal: theme.spacing.sm,
        },
      ]}>
      <View
        style={[
          batchHeaderStyles.leadingCluster,
          { flexDirection: isRTL ? 'row-reverse' : 'row' },
        ]}>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
          style={({ pressed }) => [batchHeaderStyles.iconButton, { opacity: pressed ? 0.6 : 1 }]}>
          <EditorIcon name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Pressable
          onPress={onBack}
          disabled={!canGoBack}
          hitSlop={8}
          accessibilityRole="button"
          // Counter serves as arrow context ("3 / 5") without adding i18n strings.
          accessibilityLabel={counter}
          style={({ pressed }) => [
            batchHeaderStyles.iconButton,
            { opacity: canGoBack ? (pressed ? 0.6 : 1) : 0.35 },
          ]}>
          {/* Un-mirror the glyph under RTL so the chevron head points the same semantic direction in both writing modes. */}
          <View
            style={[
              batchHeaderStyles.chevron,
              { transform: [{ rotate: isRTL ? '0deg' : '180deg' }] },
            ]}>
            <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '500' }}>›</Text>
          </View>
        </Pressable>
        <Text
          style={[batchHeaderStyles.counter, { color: theme.colors.text }]}
          accessibilityLabel={counter}>
          {counter}
        </Text>
        <Pressable
          onPress={onForward}
          disabled={!canGoForward}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={counter}
          style={({ pressed }) => [
            batchHeaderStyles.iconButton,
            { opacity: canGoForward ? (pressed ? 0.6 : 1) : 0.35 },
          ]}>
          <View
            style={[
              batchHeaderStyles.chevron,
              { transform: [{ rotate: isRTL ? '180deg' : '0deg' }] },
            ]}>
            <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '500' }}>›</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        onPress={onAdvance}
        disabled={advanceDisabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={advanceLabel}
        style={({ pressed }) => [
          batchHeaderStyles.actionPill,
          {
            backgroundColor: advanceDisabled ? theme.colors.border : theme.colors.accent,
            paddingHorizontal: theme.spacing.md,
            opacity: pressed && !advanceDisabled ? 0.85 : 1,
          },
        ]}>
        <Text
          style={[
            batchHeaderStyles.actionLabel,
            { color: advanceDisabled ? theme.colors.textMuted : theme.colors.onAccent },
          ]}>
          {advanceLabel}
        </Text>
      </Pressable>
    </View>
  );
}

/** Locale-aware counter formatter — some Hermes builds ignore numberingSystem, hence the digit-map fallback. */
function formatCounter(template: string, current: number, total: number, locale: string): string {
  let formatCurrent: string;
  let formatTotal: string;
  try {
    const localeWithExt = tagLocaleWithNumberingSystem(locale);
    const fmt = new Intl.NumberFormat(localeWithExt, numberingOptionsForLocale(locale));
    formatCurrent = mapToLocaleDigits(fmt.format(current), locale);
    formatTotal = mapToLocaleDigits(fmt.format(total), locale);
  } catch {
    formatCurrent = mapToLocaleDigits(String(current), locale);
    formatTotal = mapToLocaleDigits(String(total), locale);
  }
  return template.replace('{current}', formatCurrent).replace('{total}', formatTotal);
}

function tagLocaleWithNumberingSystem(locale: string): string {
  const options = numberingOptionsForLocale(locale);
  if (options?.numberingSystem == null) return locale;
  if (/-u-.*nu-/i.test(locale)) return locale;
  const separator = locale.includes('-u-') ? '-nu-' : '-u-nu-';
  return `${locale}${separator}${options.numberingSystem}`;
}

function mapToLocaleDigits(value: string, locale: string): string {
  const options = numberingOptionsForLocale(locale);
  const system = options?.numberingSystem;
  if (system == null) return value;
  const table = DIGIT_TABLES[system];
  if (table == null) return value;
  return value.replace(/[0-9]/g, (d) => table[d.charCodeAt(0) - 48]);
}

const DIGIT_TABLES: Record<string, readonly string[]> = {
  arab: ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'],
  arabext: ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'],
};

function numberingOptionsForLocale(locale: string): Intl.NumberFormatOptions | undefined {
  const language = locale.split('-')[0].toLowerCase();
  switch (language) {
    case 'ar':
      return { numberingSystem: 'arab' };
    case 'fa':
    case 'ur':
      return { numberingSystem: 'arabext' };
    default:
      return undefined;
  }
}

const batchHeaderStyles = StyleSheet.create({
  container: {
    // Defensive base flexDirection so a dropped inline override never collapses the header vertically.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    paddingVertical: 0,
  },
  leadingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 44,
    textAlign: 'center',
    paddingHorizontal: 4,
    // Counter is a numeric composite; keep LTR digit order even under RTL (mirrors iOS Photos).
    writingDirection: 'ltr',
  },
  actionPill: {
    height: 34,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

// Text/sticker base sizes as a share of the shorter output dimension so preview and export match.
const TEXT_BASE_RATIO = 0.06;
const STICKER_BASE_RATIO = 0.2;

function PhotoEditorScreen({
  source,
  title,
  onCancel,
  onExport,
  onError,
  exportOptions,
  textColors,
  filterPacks,
  overlayPacks,
  stickerPacks,
  customFonts,
  cropAspectRatios,
  tools,
  backgroundRemoval,
  initialState,
  onStateChange,
  headerSlot,
  screenRef,
}: PhotoEditorScreenProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();
  const sourceUri = useMemo(() => normalizeSource(source), [source]);
  // Skia's useImage silently returns null on decode failure (e.g. HEIC on iOS); the error callback
  // is the only way to distinguish "still loading" from "failed to load".
  const [loadError, setLoadError] = useState<Error | null>(null);
  const handleImageError = useCallback(
    (err: Error) => {
      setLoadError(err);
      onError?.(err);
    },
    [onError]
  );
  const image = useImage(sourceUri, handleImageError);
  const allowedAspects = useMemo(() => normalizeCropAspects(cropAspectRatios), [cropAspectRatios]);
  const allowedTools = useMemo(() => normalizeTools(tools), [tools]);
  const [aiAvailable, setAiAvailable] = useState(false);
  useEffect(() => {
    if (!backgroundRemoval) return;
    let cancelled = false;
    backgroundRemoval
      .isAvailable()
      .then((ok) => {
        if (!cancelled) setAiAvailable(ok === true);
      })
      .catch(() => {
        if (!cancelled) setAiAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backgroundRemoval]);
  const lockedAspect =
    allowedAspects != null && !allowedAspects.includes('free') ? allowedAspects[0] : undefined;
  const controller = usePhotoEditorState(
    initialState != null
      ? { state: initialState }
      : lockedAspect != null
        ? { aspect: lockedAspect }
        : undefined
  );
  const dispatch = controller.dispatch;

  const aiTabAllowed = backgroundRemoval != null && aiAvailable;
  const visibleTools = useMemo<readonly PhotoToolId[]>(() => {
    const base = allowedTools ?? PHOTO_TOOL_IDS;
    return base.filter((id) => (id === 'ai' ? aiTabAllowed : true));
  }, [allowedTools, aiTabAllowed]);
  // Second unconditional useImage for the AI background-removal override. Load errors
  // swallowed on purpose — the AITool panel owns AI failure UX.
  const backgroundOverrideImage = useImage(controller.state.backgroundRemovedUri ?? undefined);
  const effectiveImage = backgroundOverrideImage ?? image;
  useEffect(() => {
    if (!image || lockedAspect == null) return;
    dispatch({
      type: 'lockAspect',
      aspect: lockedAspect,
      imageAspect: image.width() / image.height(),
    });
  }, [image, lockedAspect, dispatch]);
  const insets = useSafeAreaInsets();
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [exporting, setExporting] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  // Floating panel is absolutely positioned; Yoga uses the border box, ignoring the SafeAreaView's
  // bottom padding — add insets.bottom so the panel butts against the toolbar's top edge.
  const panelBottom = toolbarHeight + insets.bottom;

  const activeTool = controller.state.activeTool;
  const [panelHidden, setPanelHidden] = useState(false);
  // Reset on tool change so crop-mode canvas sizing (cropLayoutReady) waits for the new panel to measure.
  const [panelHeight, setPanelHeight] = useState(0);
  const [stripHeight, setStripHeight] = useState(0);
  const [prevTool, setPrevTool] = useState(activeTool);
  if (prevTool !== activeTool) {
    setPrevTool(activeTool);
    setPanelHidden(false);
    setPanelHeight(0);
    setStripHeight(0);
  }

  const [drawSettings, setDrawSettings] = useState(createDefaultDrawSettings);
  // Live-stroke handoff: canvas renders this until state.strokes contains the id, so the reducer
  // echo takes over in the same commit and the stroke never blinks.
  const [liveStroke, setLiveStroke] = useState<DrawStroke | null>(null);
  const liveStrokeCommitted =
    liveStroke != null && controller.state.strokes.some((s) => s.id === liveStroke.id);
  if (liveStrokeCommitted) {
    setLiveStroke(null);
  }
  const pendingLiveStroke = liveStrokeCommitted ? null : liveStroke;

  // Focus-editor session: kept out of the reducer so a session collapses into one commit at Done.
  const [textFocus, setTextFocus] = useState<TextFocusSession | null>(null);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize({ width, height });
  };

  const inCropMode = activeTool === 'crop';
  const cropCanvasBottomInset = inCropMode ? (panelHidden ? stripHeight : panelHeight) : 0;
  // Gate crop-mode contents on the panel having measured so the first frame is the stable-layout frame
  // (avoids the "crop rect suddenly shrinks" race when onLayout lands post-commit).
  const cropLayoutReady = !inCropMode || (panelHidden ? stripHeight > 0 : panelHeight > 0);

  const cropOutputRect = useMemo(() => {
    if (!image || canvasSize.width === 0 || canvasSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return computeDisplayRect(image, controller.state, canvasSize);
  }, [image, canvasSize, controller.state]);

  const postRotationImageAspect = useMemo(() => {
    if (!image) return 1;
    const rotated = controller.state.rotation === 90 || controller.state.rotation === 270;
    return rotated ? image.height() / image.width() : image.width() / image.height();
  }, [image, controller.state.rotation]);

  // CropOverlay drags in post-rotation space; toPreRotation on dispatch keeps the reducer's canonical space intact.
  const postRotationCrop = useMemo(
    () =>
      toPostRotation(
        controller.state.crop,
        controller.state.rotation,
        controller.state.flipHorizontal
      ),
    [controller.state.crop, controller.state.rotation, controller.state.flipHorizontal]
  );

  const cropView = useMemo(
    () => computeCropView(canvasSize, postRotationCrop, postRotationImageAspect),
    [canvasSize, postRotationCrop, postRotationImageAspect]
  );

  const fullImageBaseRect = useMemo(() => {
    if (!image || canvasSize.width === 0 || canvasSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return computeFullImageContainRect(image, controller.state.rotation, canvasSize);
  }, [image, canvasSize, controller.state.rotation]);

  // Live photo rect during a frame-resize gesture (iOS Photos pull-to-zoom-out). Null when idle.
  const [resizePhotoRect, setResizePhotoRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Maps FULL_CROP base rect → target photoRect with transformOrigin '0 0'.
  const cropPhotoTransform = useMemo(() => {
    const base = fullImageBaseRect;
    const target = resizePhotoRect ?? cropView.photoRect;
    if (base.width <= 0 || base.height <= 0 || target.width <= 0) {
      return { scale: 1, translateX: 0, translateY: 0 };
    }
    const scale = target.width / base.width;
    return {
      scale,
      translateX: target.x - base.x * scale,
      translateY: target.y - base.y * scale,
    };
  }, [fullImageBaseRect, cropView.photoRect, resizePhotoRect]);

  // Resolve consumer image stickers once here — PhotoRender can't call useImage per-layer.
  const stickerImages = useResolvedStickerImages(controller.state.layers, stickerPacks);

  const customFontTypefaces = useCustomFontProvider(customFonts);

  // Live canvas strokes: committed + pending appended last so a live eraser clears what's drawn.
  const renderStrokes = useMemo(
    () =>
      pendingLiveStroke
        ? [...controller.state.strokes, pendingLiveStroke]
        : controller.state.strokes,
    [controller.state.strokes, pendingLiveStroke]
  );

  const handleStrokeEnd = useCallback(
    (stroke: DrawStroke) => {
      dispatch({ type: 'addStroke', stroke });
    },
    [dispatch]
  );

  const handleFocusInteractionStart = useCallback(
    () => dispatch({ type: 'checkpoint' }),
    [dispatch]
  );
  const handleFocusChange = useCallback(
    (focus: PhotoFocus) => dispatch({ type: 'setFocus', focus }),
    [dispatch]
  );

  /** Skia snapshot + encode + native-write. Throws on encode/write failure. */
  const runExport = useCallback(async (): Promise<PhotoExportResult | null> => {
    const baseImage = effectiveImage;
    if (!baseImage) return null;
    setExporting(true);
    try {
      const { state } = controller;
      const format = exportOptions?.format ?? 'jpeg';
      const quality = exportOptions?.quality ?? 90;
      const includeBase64 = exportOptions?.includeBase64 ?? false;
      const maxDimension = exportOptions?.maxDimension;

      const srcW = state.crop.width * baseImage.width();
      const srcH = state.crop.height * baseImage.height();
      const rotated = state.rotation === 90 || state.rotation === 270;
      let outW = rotated ? srcH : srcW;
      let outH = rotated ? srcW : srcH;
      // Cap the longest side; never upscale.
      if (maxDimension && maxDimension > 0) {
        const longest = Math.max(outW, outH);
        if (longest > maxDimension) {
          const scale = maxDimension / longest;
          outW *= scale;
          outH *= scale;
        }
      }
      outW = Math.round(outW);
      outH = Math.round(outH);
      const baseFontSize = Math.min(outW, outH) * TEXT_BASE_RATIO;
      const baseStickerSize = Math.min(outW, outH) * STICKER_BASE_RATIO;

      const snapshot = await drawAsImage(
        <PhotoRender
          image={baseImage}
          outputWidth={outW}
          outputHeight={outH}
          crop={state.crop}
          rotation={state.rotation}
          flipHorizontal={state.flipHorizontal}
          straighten={state.straighten}
          adjustments={state.adjustments}
          filterId={state.filterId}
          filterIntensity={state.filterIntensity}
          filterPacks={filterPacks}
          overlayId={state.overlayId}
          overlayIntensity={state.overlayIntensity}
          overlayPacks={overlayPacks}
          layers={state.layers}
          strokes={state.strokes}
          focus={state.focus}
          baseFontSize={baseFontSize}
          baseStickerSize={baseStickerSize}
          stickerImages={stickerImages}
          customFonts={customFonts}
          customFontTypefaces={customFontTypefaces}
        />,
        { width: outW, height: outH }
      );
      const finalSnapshot = snapshot ?? fallbackSnapshot(baseImage);
      const encoded = finalSnapshot?.encodeToBase64(
        format === 'png' ? ImageFormat.PNG : ImageFormat.JPEG,
        format === 'png' ? 100 : quality
      );
      if (!encoded) return null;
      const extension = format === 'png' ? 'png' : 'jpg';
      const uri = await MediaEditorModule.writeCacheFile(encoded, extension);
      return {
        uri,
        width: finalSnapshot?.width() ?? baseImage.width(),
        height: finalSnapshot?.height() ?? baseImage.height(),
        format,
        ...(includeBase64 ? { base64: encoded } : null),
      };
    } finally {
      setExporting(false);
    }
  }, [
    effectiveImage,
    controller,
    exportOptions,
    filterPacks,
    overlayPacks,
    stickerImages,
    customFonts,
    customFontTypefaces,
  ]);

  const handleExport = useCallback(async () => {
    try {
      const result = await runExport();
      if (result != null) onExport?.(result);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [runExport, onExport, onError]);

  useImperativeHandle(
    screenRef,
    () => ({
      exportAsync: runExport,
    }),
    [runExport]
  );

  useEffect(() => {
    onStateChange?.(controller.state);
  }, [controller.state, onStateChange]);

  const previewBaseFontSize =
    Math.min(cropOutputRect.width, cropOutputRect.height) * TEXT_BASE_RATIO;
  const previewBaseStickerSize =
    Math.min(cropOutputRect.width, cropOutputRect.height) * STICKER_BASE_RATIO;

  const handleSetBackgroundRemoved = useCallback(
    (uri: string | null) => {
      dispatch({ type: 'setBackgroundRemoved', uri });
    },
    [dispatch]
  );

  const handleAddCutoutSticker = useCallback(
    (uri: string, aspectRatio: number) => {
      const center = spawnCenterFor(controller.state.layers.length);
      const layer: StickerLayer = {
        id: generateLayerId(),
        kind: 'sticker',
        content: { variant: 'uri', uri, aspectRatio },
        x: center.x,
        y: center.y,
        scale: DEFAULT_STICKER_SPAWN_SCALE,
        rotation: 0,
      };
      dispatch({ type: 'addLayer', layer });
    },
    [dispatch, controller]
  );

  // Crop is a confirm/cancel session: snapshot geometry on entry, restore it if the user
  // leaves without tapping the tick (switching tools = cancel, like the video editor).
  const cropSessionRef = useRef<{
    crop: NormalizedCrop;
    aspect: AspectRatio;
    rotation: 0 | 90 | 180 | 270;
    flipHorizontal: boolean;
    straighten: number;
    pastLength: number;
  } | null>(null);

  // Tapping active tab toggles panel visibility (tool stays active so canvas overlays remain on).
  const handleToolSelect = useCallback(
    (tool: PhotoToolId) => {
      if (tool === activeTool) {
        setPanelHidden((v) => !v);
        return;
      }
      if (activeTool === 'crop' && cropSessionRef.current != null) {
        controller.dispatch({ type: 'restoreCropState', ...cropSessionRef.current });
        cropSessionRef.current = null;
      }
      if (tool === 'crop') {
        const { crop, aspect, rotation, flipHorizontal, straighten, past } = controller.state;
        cropSessionRef.current = {
          crop,
          aspect,
          rotation,
          flipHorizontal,
          straighten,
          pastLength: past.length,
        };
      }
      controller.dispatch({ type: 'setTool', tool });
    },
    [activeTool, controller]
  );

  const handleApplyCrop = useCallback(() => {
    cropSessionRef.current = null;
    controller.dispatch({ type: 'setTool', tool: null });
  }, [controller]);

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

  // Focus editor commit: empty text on new → discard; empty on existing → removeLayer;
  // non-empty → one checkpoint + addLayer/updateLayer (max one history entry per session).
  const handleTextFocusDone = useCallback(
    ({ session, draft }: TextFocusResult) => {
      const trimmed = draft.text.trim();
      if (session.kind === 'new') {
        if (trimmed.length === 0) {
          setTextFocus(null);
          return;
        }
        const center = spawnCenterFor(controller.state.layers.length);
        const layer: TextLayer = {
          id: generateLayerId(),
          kind: 'text',
          x: center.x,
          y: center.y,
          scale: DEFAULT_TEXT_SPAWN_SCALE,
          rotation: 0,
          ...draft,
        };
        controller.dispatch({ type: 'addLayer', layer });
      } else {
        if (trimmed.length === 0) {
          controller.dispatch({ type: 'removeLayer', id: session.layer.id });
        } else {
          // updateLayer is continuous; explicit checkpoint collapses the session to one undo entry.
          controller.dispatch({ type: 'checkpoint' });
          controller.dispatch({
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
    [controller]
  );

  const handleTextFocusCancel = useCallback(() => {
    setTextFocus(null);
  }, []);

  // Hide chrome with opacity (not unmount) during a focus session so measured heights stay stable.
  const focusOpen = textFocus != null;
  const panelVisible = activeTool != null && !panelHidden && !focusOpen;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={focusOpen ? styles.chromeHidden : null}
        pointerEvents={focusOpen ? 'none' : 'auto'}>
        {headerSlot ?? (
          <EditorHeader
            title={title ?? t('editPhoto')}
            onCancel={onCancel}
            actionLabel={t('done')}
            onAction={handleExport}
            actionDisabled={!image || exporting}
            history={{
              onUndo: () => controller.dispatch({ type: 'undo' }),
              onRedo: () => controller.dispatch({ type: 'redo' }),
              canUndo: canUndo(controller.state),
              canRedo: canRedo(controller.state),
            }}
          />
        )}
      </View>
      {/* Inner canvas region shrinks via `bottom:` (not padding — Yoga ignores padding for absolute children). */}
      <View style={styles.canvasWrapper}>
        <View
          style={[styles.canvasRegion, { bottom: cropCanvasBottomInset }]}
          onLayout={handleLayout}>
          {image && canvasSize.width > 0 && cropLayoutReady ? (
            <>
              {inCropMode ? (
                // Crop mode: render full image, translate+scale the canvas so the sub-crop lands under the fixed frame.
                // Straighten wraps as an OUTER rotate about the frame center; PhotoRender gets straighten=0.
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      transformOrigin: [
                        cropView.frame.x + cropView.frame.width / 2,
                        cropView.frame.y + cropView.frame.height / 2,
                        0,
                      ],
                      transform: [{ rotate: `${controller.state.straighten}deg` }],
                    },
                  ]}>
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        transformOrigin: '0 0',
                        transform: [
                          { translateX: cropPhotoTransform.translateX },
                          { translateY: cropPhotoTransform.translateY },
                          { scale: cropPhotoTransform.scale },
                        ],
                      },
                    ]}>
                    <Canvas style={StyleSheet.absoluteFill}>
                      <PhotoRender
                        image={effectiveImage ?? image}
                        outputWidth={canvasSize.width}
                        outputHeight={canvasSize.height}
                        crop={FULL_CROP}
                        rotation={controller.state.rotation}
                        flipHorizontal={controller.state.flipHorizontal}
                        adjustments={controller.state.adjustments}
                        filterId={controller.state.filterId}
                        filterIntensity={controller.state.filterIntensity}
                        filterPacks={filterPacks}
                        // Overlays/layers/strokes/focus are normalized over the CROPPED rect — omit during re-crop.
                        overlayId={null}
                        overlayIntensity={controller.state.overlayIntensity}
                        overlayPacks={overlayPacks}
                        layers={[]}
                        strokes={[]}
                        focus={FOCUS_OFF}
                        baseFontSize={previewBaseFontSize}
                        baseStickerSize={previewBaseStickerSize}
                        stickerImages={stickerImages}
                        customFonts={customFonts}
                        customFontTypefaces={customFontTypefaces}
                      />
                    </Canvas>
                  </View>
                </View>
              ) : (
                <Canvas style={StyleSheet.absoluteFill}>
                  <PhotoRender
                    image={effectiveImage ?? image}
                    outputWidth={canvasSize.width}
                    outputHeight={canvasSize.height}
                    crop={controller.state.crop}
                    rotation={controller.state.rotation}
                    flipHorizontal={controller.state.flipHorizontal}
                    straighten={controller.state.straighten}
                    adjustments={controller.state.adjustments}
                    filterId={controller.state.filterId}
                    filterIntensity={controller.state.filterIntensity}
                    filterPacks={filterPacks}
                    overlayId={controller.state.overlayId}
                    overlayIntensity={controller.state.overlayIntensity}
                    overlayPacks={overlayPacks}
                    // Hidden in text/sticker mode; LayerOverlay handles them interactively.
                    layers={
                      activeTool === 'text' || activeTool === 'stickers'
                        ? []
                        : controller.state.layers
                    }
                    strokes={renderStrokes}
                    focus={controller.state.focus}
                    baseFontSize={previewBaseFontSize}
                    baseStickerSize={previewBaseStickerSize}
                    stickerImages={stickerImages}
                    customFonts={customFonts}
                    customFontTypefaces={customFontTypefaces}
                  />
                </Canvas>
              )}
              {(activeTool === 'text' || activeTool === 'stickers') && (
                <LayerOverlay
                  layers={controller.state.layers}
                  displayRect={cropOutputRect}
                  selectedId={controller.state.selectedLayerId}
                  baseFontSize={previewBaseFontSize}
                  baseStickerSize={previewBaseStickerSize}
                  stickerPacks={stickerPacks}
                  customFonts={customFonts}
                  customFontTypefaces={customFontTypefaces}
                  onCommit={(id, transform) =>
                    controller.dispatch({ type: 'setLayerTransform', id, ...transform })
                  }
                  onSelect={(id) => controller.dispatch({ type: 'selectLayer', id })}
                  onActivateLayer={handleActivateLayer}
                  onDeselect={() => {
                    Keyboard.dismiss();
                    controller.dispatch({ type: 'selectLayer', id: null });
                  }}
                  onDelete={(id) => controller.dispatch({ type: 'removeLayer', id })}
                  onDuplicate={(id) => controller.dispatch({ type: 'duplicateLayer', id })}
                  onReorder={(id, direction) =>
                    controller.dispatch({ type: 'reorderLayer', id, direction })
                  }
                />
              )}
              {activeTool === 'draw' && (
                <DrawOverlay
                  displayRect={cropOutputRect}
                  brush={drawSettings.brush}
                  color={drawSettings.color}
                  size={drawSettings.sizes[drawSettings.brush]}
                  onStrokeUpdate={setLiveStroke}
                  onStrokeEnd={handleStrokeEnd}
                />
              )}
              {activeTool === 'focus' && controller.state.focus.mode !== 'off' && (
                <FocusOverlay
                  displayRect={cropOutputRect}
                  focus={controller.state.focus}
                  onInteractionStart={handleFocusInteractionStart}
                  onChange={handleFocusChange}
                />
              )}
              {inCropMode && (
                <CropOverlay
                  region={canvasSize}
                  crop={postRotationCrop}
                  imageAspect={postRotationImageAspect}
                  straighten={controller.state.straighten}
                  aspectRatio={aspectRatioValue(controller.state.aspect, {
                    imageAspect: postRotationImageAspect,
                  })}
                  onChange={(postCrop) =>
                    controller.dispatch({
                      type: 'setCrop',
                      crop: toPreRotation(
                        postCrop,
                        controller.state.rotation,
                        controller.state.flipHorizontal
                      ),
                      // Pre-rotation aspect: coverage is invariant under 90°-step + flip.
                      imageAspect: image.width() / image.height(),
                    })
                  }
                  onResizeChange={setResizePhotoRect}
                  onResizeEnd={() => setResizePhotoRect(null)}
                  onInteractionStart={() => controller.dispatch({ type: 'checkpoint' })}
                />
              )}
            </>
          ) : loadError ? (
            <View style={styles.loading}>
              <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing.sm }}>
                {t('photoLoadError')}
              </Text>
            </View>
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing.sm }}>
                {t('loading')}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View
        style={focusOpen ? styles.chromeHidden : null}
        pointerEvents={focusOpen ? 'none' : 'auto'}
        onLayout={(e) => setToolbarHeight(e.nativeEvent.layout.height)}>
        <PhotoToolbar active={activeTool} onSelect={handleToolSelect} tools={visibleTools} />
      </View>

      {image && panelVisible && activeTool === 'crop' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <CropTool
              controller={controller}
              imageAspect={image.width() / image.height()}
              allowedAspects={allowedAspects}
              onApply={handleApplyCrop}
            />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'adjust' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <AdjustTool controller={controller} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'effects' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <EffectsTool
              image={image}
              controller={controller}
              filterPacks={filterPacks}
              overlayPacks={overlayPacks}
            />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'focus' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <FocusTool controller={controller} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'draw' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <DrawTool
              controller={controller}
              settings={drawSettings}
              onSettingsChange={setDrawSettings}
            />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'stickers' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <StickerTool controller={controller} stickerPacks={stickerPacks} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'text' && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <TextTool onAddText={handleOpenTextFocus} />
          </ToolPanel>
        </FloatingPanel>
      )}
      {image && panelVisible && activeTool === 'ai' && backgroundRemoval && (
        <FloatingPanel bottom={panelBottom}>
          <ToolPanel onDismiss={() => setPanelHidden(true)} onLayoutHeight={setPanelHeight}>
            <AITool
              engine={backgroundRemoval}
              sourceUri={sourceUri}
              hasBackgroundRemoved={controller.state.backgroundRemovedUri != null}
              onSetBackgroundRemoved={handleSetBackgroundRemoved}
              onAddCutoutSticker={handleAddCutoutSticker}
            />
          </ToolPanel>
        </FloatingPanel>
      )}

      {image && activeTool != null && panelHidden && !focusOpen && (
        <View
          pointerEvents="box-none"
          style={[styles.floatingStripWrapper, { bottom: panelBottom }]}>
          <CollapsedPanelStrip
            onReveal={() => setPanelHidden(false)}
            onLayoutHeight={setStripHeight}
          />
        </View>
      )}

      {/* Absolute-fill sibling (not RN Modal) so theme/i18n/gesture-root contexts stay intact. */}
      {textFocus && (
        <TextFocusEditor
          session={textFocus}
          customFonts={customFonts}
          textColors={textColors}
          onDone={handleTextFocusDone}
          onCancel={handleTextFocusCancel}
        />
      )}

      {exporting && (
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

/** Anchors a tool panel above the bottom toolbar; `overflow:'hidden'` clips the slide animation at the toolbar's top. */
function FloatingPanel({
  children,
  bottom,
  keyboardAvoiding,
}: {
  children: React.ReactNode;
  bottom: number;
  keyboardAvoiding?: boolean;
}) {
  const wrapperStyle = [styles.floatingPanelWrapper, { bottom }];
  const animated = (
    <Animated.View
      entering={SlideInDown.duration(PANEL_ENTER_MS)}
      exiting={SlideOutDown.duration(PANEL_EXIT_MS)}>
      {children}
    </Animated.View>
  );
  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        pointerEvents="box-none"
        style={wrapperStyle}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {animated}
      </KeyboardAvoidingView>
    );
  }
  return (
    <View pointerEvents="box-none" style={wrapperStyle}>
      {animated}
    </View>
  );
}

function normalizeCropAspects(
  list: readonly AspectRatio[] | undefined
): readonly AspectRatio[] | null {
  if (list == null || list.length === 0) return null;
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const aspect of list) {
    if (!ASPECT_RATIO_PRESETS.includes(aspect) || seen.has(aspect)) continue;
    seen.add(aspect);
    out.push(aspect);
  }
  return out.length > 0 ? out : null;
}

/** `undefined` → null (use defaults); `[]` → honored verbatim. */
function normalizeTools(list: readonly PhotoToolId[] | undefined): readonly PhotoToolId[] | null {
  if (list == null) return null;
  if (list.length === 0) return list;
  const known = new Set<PhotoToolId>(PHOTO_TOOL_IDS);
  const seen = new Set<PhotoToolId>();
  const out: PhotoToolId[] = [];
  for (const id of list) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function computeDisplayRect(
  image: SkImage,
  state: PhotoEditorState,
  canvasSize: { width: number; height: number }
) {
  const srcW = state.crop.width * image.width();
  const srcH = state.crop.height * image.height();
  const rotated = state.rotation === 90 || state.rotation === 270;
  const contentW = rotated ? srcH : srcW;
  const contentH = rotated ? srcW : srcH;
  const scale = Math.min(canvasSize.width / contentW, canvasSize.height / contentH);
  const width = contentW * scale;
  const height = contentH * scale;
  return {
    x: (canvasSize.width - width) / 2,
    y: (canvasSize.height - height) / 2,
    width,
    height,
  };
}

function computeFullImageContainRect(
  image: SkImage,
  rotation: 0 | 90 | 180 | 270,
  canvasSize: { width: number; height: number }
) {
  const rotated = rotation === 90 || rotation === 270;
  const contentW = rotated ? image.height() : image.width();
  const contentH = rotated ? image.width() : image.height();
  const scale = Math.min(canvasSize.width / contentW, canvasSize.height / contentH);
  const width = contentW * scale;
  const height = contentH * scale;
  return {
    x: (canvasSize.width - width) / 2,
    y: (canvasSize.height - height) / 2,
    width,
    height,
  };
}

// Safety net for old Skia versions where drawAsImage returns null.
function fallbackSnapshot(image: SkImage): SkImage | null {
  const surface = Skia.Surface.MakeOffscreen(image.width(), image.height());
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);
  surface.flush();
  return surface.makeImageSnapshot();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  canvasWrapper: { flex: 1 },
  canvasRegion: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
