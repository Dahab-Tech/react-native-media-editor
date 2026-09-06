import {
  ASPECT_RATIO_PRESETS,
  type AspectRatio,
} from '@dahab-tech/react-native-media-editor/photoEditor';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PlaygroundConfig, TitleMode, ToolsPreset } from './editorConfig';

interface ConfigPanelProps {
  config: PlaygroundConfig;
  onChange: (config: PlaygroundConfig) => void;
}

const TITLE_MODES: readonly { value: TitleMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'hidden', label: 'Hidden' },
];

const COLOR_SCHEMES = ['dark', 'light', 'auto'] as const;

const MIN_TRIM_SECONDS = [1, 3, 5] as const;

const TOOLS_PRESET_OPTIONS: readonly { value: ToolsPreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'minimal', label: 'Minimal' },
];

export function ConfigPanel({ config, onChange }: ConfigPanelProps) {
  const set = <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) =>
    onChange({ ...config, [key]: value });

  const toggleAspect = (aspect: AspectRatio) => {
    const selected = config.cropAspectRatios.includes(aspect);
    set(
      'cropAspectRatios',
      selected
        ? config.cropAspectRatios.filter((value) => value !== aspect)
        : [...config.cropAspectRatios, aspect]
    );
  };

  const isAvatarPreset =
    config.cropAspectRatios.length === 1 && config.cropAspectRatios[0] === '1:1';

  return (
    <View style={styles.panel}>
      <Group title="General">
        <Text style={styles.sectionTitle}>Color scheme</Text>
        <View style={styles.chipRow}>
          {COLOR_SCHEMES.map((value) => (
            <Chip
              key={value}
              label={value[0].toUpperCase() + value.slice(1)}
              active={config.colorScheme === value}
              onPress={() => set('colorScheme', value)}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Header title</Text>
        <View style={styles.chipRow}>
          {TITLE_MODES.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              active={config.titleMode === value}
              onPress={() => set('titleMode', value)}
            />
          ))}
        </View>
        {config.titleMode === 'custom' && (
          <TextInput
            style={styles.input}
            value={config.customTitle}
            onChangeText={(text) => set('customTitle', text)}
            placeholder="Custom title…"
            placeholderTextColor="#5A5A63"
          />
        )}
        <Text style={styles.hint}>
          {config.titleMode === 'default'
            ? 'Prop omitted — the SDK shows its localized default.'
            : config.titleMode === 'hidden'
              ? "Passes '' — the header keeps its layout with no title."
              : 'Shown verbatim (not localized by the SDK).'}
        </Text>
      </Group>

      <Group title="Photo">
        <Text style={styles.sectionTitle}>Crop aspect ratios</Text>
        <View style={styles.chipRow}>
          {ASPECT_RATIO_PRESETS.map((aspect) => (
            <Chip
              key={aspect}
              label={aspect}
              active={config.cropAspectRatios.includes(aspect)}
              onPress={() => toggleAspect(aspect)}
            />
          ))}
        </View>
        <View style={styles.chipRow}>
          <Chip
            label="Avatar (1:1 only)"
            active={isAvatarPreset}
            onPress={() => set('cropAspectRatios', isAvatarPreset ? [] : ['1:1'])}
          />
        </View>
        <Text style={styles.hint}>
          None selected = all presets. Without “free” the editor locks to the first selection.
        </Text>

        <Text style={styles.sectionTitle}>Export format</Text>
        <View style={styles.chipRow}>
          {(['jpeg', 'png'] as const).map((value) => (
            <Chip
              key={value}
              label={value.toUpperCase()}
              active={config.photoExportFormat === value}
              onPress={() => set('photoExportFormat', value)}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>AI background removal</Text>
        <View style={styles.chipRow}>
          <Chip
            label={config.aiBackgroundRemoval ? 'On' : 'Off'}
            active={config.aiBackgroundRemoval}
            onPress={() => set('aiBackgroundRemoval', !config.aiBackgroundRemoval)}
          />
        </View>
        <Text style={styles.hint}>
          Injects the on-device AI engine from @dahab-tech/media-editor-ai. Tab appears once the
          engine reports availability.
        </Text>

        <Text style={styles.sectionTitle}>Multi-select</Text>
        <View style={styles.chipRow}>
          <Chip
            label={config.photoMultiSelect ? 'On' : 'Off'}
            active={config.photoMultiSelect}
            onPress={() => set('photoMultiSelect', !config.photoMultiSelect)}
          />
        </View>
        <Text style={styles.hint}>
          Picks up to 10 photos and opens PhotoEditor in batch mode (counter + Next/Done header).
        </Text>

        <Text style={styles.sectionTitle}>Tabs</Text>
        <View style={styles.chipRow}>
          {TOOLS_PRESET_OPTIONS.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              active={config.toolsPreset === value}
              onPress={() => set('toolsPreset', value)}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          All = SDK default (prop omitted). Minimal = ['crop', 'effects', 'text'].
        </Text>
      </Group>

      <Group title="Video">
        <Text style={styles.sectionTitle}>Min trim duration</Text>
        <View style={styles.chipRow}>
          {MIN_TRIM_SECONDS.map((seconds) => (
            <Chip
              key={seconds}
              label={seconds === 1 ? '1s (default)' : `${seconds}s`}
              active={config.minTrimDurationSec === seconds}
              onPress={() => set('minTrimDurationSec', seconds)}
            />
          ))}
        </View>
      </Group>
    </View>
  );
}

function Group({
  title,
  defaultExpanded = false,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View style={styles.group}>
      <Pressable
        style={styles.groupHeader}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}>
        <Text style={styles.groupTitle}>{title}</Text>
        <Text style={styles.groupChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded && <View style={styles.groupBody}>{children}</View>}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  group: {
    backgroundColor: '#141418',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#26262C',
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  groupTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  groupChevron: { color: '#9A9AA3', fontSize: 14 },
  groupBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  sectionTitle: {
    color: '#9A9AA3',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1B1B20',
  },
  chipActive: { backgroundColor: '#FFCE0A' },
  chipText: { color: '#FFFFFF', fontSize: 14 },
  chipTextActive: { color: '#17171C', fontWeight: '600' },
  input: {
    backgroundColor: '#1B1B20',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: '#FFFFFF',
    fontSize: 14,
  },
  hint: { color: '#5A5A63', fontSize: 12 },
});
