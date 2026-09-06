import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { type VideoToolId } from '../state/videoEditorState';

export interface VideoToolbarProps {
  active: VideoToolId | null;
  /** Tap dispatch — parent decides re-tap semantics. */
  onSelect: (tool: VideoToolId) => void;
  /** Ordered tab list; presentation only, allowlist owned by parent. */
  tools: readonly VideoToolId[];
}

const TOOL_META: Record<VideoToolId, { labelKey: keyof MediaEditorStrings; icon: EditorIconName }> =
  {
    trim: { labelKey: 'trim', icon: 'trim' },
    crop: { labelKey: 'crop', icon: 'crop' },
    adjust: { labelKey: 'adjust', icon: 'adjust' },
    effects: { labelKey: 'effects', icon: 'effects' },
    // Speed reuses the trim glyph — no bespoke speed glyph in the shared icon table yet.
    speed: { labelKey: 'speed', icon: 'trim' },
    text: { labelKey: 'text', icon: 'text' },
    stickers: { labelKey: 'stickers', icon: 'stickers' },
    draw: { labelKey: 'draw', icon: 'draw' },
    cover: { labelKey: 'setCover', icon: 'cover' },
  };

export function VideoToolbar({ active, onSelect, tools }: VideoToolbarProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const [setTabsRef, onTabsContentSizeChange] = useRtlHorizontalScrollLanding();

  return (
    <ScrollView
      ref={setTabsRef}
      onContentSizeChange={onTabsContentSizeChange}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{
        backgroundColor: theme.colors.surface,
        borderTopColor: theme.colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexGrow: 0,
      }}
      contentContainerStyle={{
        paddingVertical: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        flexDirection: isRTL ? 'row-reverse' : 'row',
        justifyContent: 'space-around',
        flexGrow: 1,
      }}>
      {tools.map((id) => {
        const meta = TOOL_META[id];
        const isActive = active === id;
        const tint = isActive ? theme.colors.accent : theme.colors.textMuted;
        return (
          <View key={id} style={styles.slot}>
            <Pressable
              onPress={() => onSelect(id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t(meta.labelKey)}
              hitSlop={8}
              style={[
                styles.tool,
                {
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  borderRadius: theme.radius.lg,
                  backgroundColor: isActive ? withAlpha(theme.colors.accent, 0.14) : 'transparent',
                },
              ]}>
              <EditorIcon name={meta.icon} size={20} color={tint} />
              <Text
                numberOfLines={1}
                style={{
                  color: tint,
                  fontWeight: '600',
                  fontSize: 10,
                  marginTop: 2,
                }}>
                {t(meta.labelKey)}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Overlay a hex color at the given alpha. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const full =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  slot: {
    flexGrow: 1,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tool: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
