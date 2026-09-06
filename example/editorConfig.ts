import { createBackgroundRemovalEngine } from '@dahab-tech/media-editor-ai';
import type { MediaEditorColorScheme } from '@dahab-tech/react-native-media-editor';
import type {
  AspectRatio,
  BackgroundRemovalEngine,
  PhotoEditorProps,
  PhotoToolId,
} from '@dahab-tech/react-native-media-editor/photoEditor';
import type { VideoEditorProps } from '@dahab-tech/react-native-media-editor/videoEditor';

export type Locale = 'en' | 'ar';

export type ToolsPreset = 'all' | 'minimal';

export const TOOLS_PRESETS: Record<ToolsPreset, readonly PhotoToolId[] | undefined> = {
  all: undefined,
  minimal: ['crop', 'effects', 'text'],
};

// '' is meaningful to the SDK (hides the title); distinct from omitting the prop.
export type TitleMode = 'default' | 'custom' | 'hidden';

export interface PlaygroundConfig {
  locale: Locale;
  colorScheme: MediaEditorColorScheme;
  titleMode: TitleMode;
  customTitle: string;
  cropAspectRatios: AspectRatio[];
  photoExportFormat: NonNullable<NonNullable<PhotoEditorProps['exportOptions']>['format']>;
  toolsPreset: ToolsPreset;
  aiBackgroundRemoval: boolean;
  photoMultiSelect: boolean;
  minTrimDurationSec: number;
}

export const DEFAULT_CONFIG: PlaygroundConfig = {
  locale: 'en',
  colorScheme: 'dark',
  titleMode: 'default',
  customTitle: '',
  cropAspectRatios: [],
  photoExportFormat: 'jpeg',
  toolsPreset: 'all',
  aiBackgroundRemoval: false,
  photoMultiSelect: false,
  minTrimDurationSec: 1,
};

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
): Pick<PhotoEditorProps, 'cropAspectRatios' | 'exportOptions' | 'tools' | 'backgroundRemoval'> {
  return {
    cropAspectRatios: config.cropAspectRatios.length > 0 ? config.cropAspectRatios : undefined,
    exportOptions: { format: config.photoExportFormat },
    tools: TOOLS_PRESETS[config.toolsPreset],
    backgroundRemoval: config.aiBackgroundRemoval ? aiEngine : undefined,
  };
}

export function videoEditorProps(
  config: PlaygroundConfig
): Pick<VideoEditorProps, 'minDurationMs'> {
  return { minDurationMs: config.minTrimDurationSec * 1000 };
}
