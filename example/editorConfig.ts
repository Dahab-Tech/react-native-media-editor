import { createBackgroundRemovalEngine } from '@dahab-tech/media-editor-ai';
import type { MediaEditorColorScheme } from '@dahab-tech/react-native-media-editor';
import type {
  AspectRatio,
  BackgroundRemovalEngine,
  PhotoEditorProps,
  PhotoToolId,
} from '@dahab-tech/react-native-media-editor/photoEditor';
import type {
  VideoCompressionOptions,
  VideoEditorProps,
  VideoToolId,
} from '@dahab-tech/react-native-media-editor/videoEditor';

export type Locale = 'en' | 'ar';

export type ToolsPreset = 'all' | 'minimal';

export const TOOLS_PRESETS: Record<ToolsPreset, readonly PhotoToolId[] | undefined> = {
  all: undefined,
  minimal: ['crop', 'effects', 'text'],
};

export const VIDEO_TOOLS_PRESETS: Record<ToolsPreset, readonly VideoToolId[] | undefined> = {
  all: undefined,
  minimal: ['effects', 'text'],
};

export const DEMO_TEXT_COLORS: readonly string[] = [
  '#FFFFFF',
  '#FFCE0A',
  '#FF5A5F',
  '#4ADE80',
  '#60A5FA',
  '#17171C',
];

// '' is meaningful to the SDK (hides the title); distinct from omitting the prop.
export type TitleMode = 'default' | 'custom' | 'hidden';

export interface PlaygroundConfig {
  locale: Locale;
  colorScheme: MediaEditorColorScheme;
  titleMode: TitleMode;
  customTitle: string;
  cropAspectRatios: AspectRatio[];
  photoExportFormat: NonNullable<NonNullable<PhotoEditorProps['exportOptions']>['format']>;
  photoExportQuality: number;
  toolsPreset: ToolsPreset;
  aiBackgroundRemoval: boolean;
  photoMultiSelect: boolean;
  videoMultiSelect: boolean;
  videoToolsPreset: ToolsPreset;
  /** Passes `onAddClip` in the single-source flow, surfacing the timeline + add tile. */
  singleVideoAddClip: boolean;
  customTextColors: boolean;
  minTrimDurationSec: number;
  videoCompression: CompressionSetting;
  /** Kept as raw text so partial input ('', '2.') doesn't fight the keyboard. */
  customBitrateMbps: string;
}

export type CompressionSetting = 'off' | 'custom' | NonNullable<VideoCompressionOptions['preset']>;

export const DEFAULT_CONFIG: PlaygroundConfig = {
  locale: 'en',
  colorScheme: 'dark',
  titleMode: 'default',
  customTitle: '',
  cropAspectRatios: [],
  photoExportFormat: 'jpeg',
  photoExportQuality: 90,
  toolsPreset: 'all',
  aiBackgroundRemoval: false,
  photoMultiSelect: false,
  videoMultiSelect: false,
  videoToolsPreset: 'all',
  singleVideoAddClip: false,
  customTextColors: false,
  minTrimDurationSec: 1,
  videoCompression: 'off',
  customBitrateMbps: '10',
};

export const FALLBACK_BITRATE_MBPS = 10;

export function parseBitrateMbps(text: string): number {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_BITRATE_MBPS;
}

// Module-scoped so the `backgroundRemoval` prop stays referentially stable across renders.
export const aiEngine: BackgroundRemovalEngine = createBackgroundRemovalEngine();

export function sharedEditorProps(
  config: PlaygroundConfig
): Pick<PhotoEditorProps & VideoEditorProps, 'locale' | 'colorScheme' | 'title'> {
  return {
    locale: config.locale,
    colorScheme: config.colorScheme,
    title:
      config.titleMode === 'default'
        ? undefined
        : config.titleMode === 'hidden'
          ? ''
          : config.customTitle,
  };
}

export function photoEditorProps(
  config: PlaygroundConfig
): Pick<
  PhotoEditorProps,
  'cropAspectRatios' | 'exportOptions' | 'tools' | 'backgroundRemoval' | 'textColors'
> {
  return {
    cropAspectRatios: config.cropAspectRatios.length > 0 ? config.cropAspectRatios : undefined,
    exportOptions: { format: config.photoExportFormat, quality: config.photoExportQuality },
    tools: TOOLS_PRESETS[config.toolsPreset],
    backgroundRemoval: config.aiBackgroundRemoval ? aiEngine : undefined,
    textColors: config.customTextColors ? [...DEMO_TEXT_COLORS] : undefined,
  };
}

export function videoEditorProps(
  config: PlaygroundConfig
): Pick<
  VideoEditorProps,
  'minDurationMs' | 'compression' | 'videoTools' | 'cropAspectRatios' | 'textColors'
> {
  return {
    minDurationMs: config.minTrimDurationSec * 1000,
    videoTools: VIDEO_TOOLS_PRESETS[config.videoToolsPreset],
    cropAspectRatios: config.cropAspectRatios.length > 0 ? config.cropAspectRatios : undefined,
    textColors: config.customTextColors ? DEMO_TEXT_COLORS : undefined,
    compression:
      config.videoCompression === 'off'
        ? undefined
        : config.videoCompression === 'custom'
          ? { bitrateMbps: parseBitrateMbps(config.customBitrateMbps) }
          : { preset: config.videoCompression, maxDimension: 1080 },
  };
}
