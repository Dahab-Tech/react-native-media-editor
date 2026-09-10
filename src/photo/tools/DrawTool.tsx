import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEFAULT_TEXT_COLORS } from './TextFocusEditor';
import { useRtlHorizontalScrollLanding } from '../../core/hooks/useRtlHorizontalScrollLanding';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import type { MediaEditorStrings } from '../../core/i18n/strings';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { getPanelPalette } from '../../core/theming/theme';
import { Slider } from '../components/Slider';
import {
  DRAW_DEFAULT_COLOR,
  DRAW_DEFAULT_SIZES,
  DRAW_SIZE_MAX,
  DRAW_SIZE_MIN,
  type DrawBrush,
} from '../draw';
import { type PhotoEditorController } from '../state/photoEditorState';

/** Ephemeral draw settings for the next stroke; sizes are per-brush. */
export interface DrawToolSettings {
  brush: DrawBrush;
  color: string;
  sizes: Record<DrawBrush, number>;
}

export function createDefaultDrawSettings(): DrawToolSettings {
  return {
    brush: 'pen',
    color: DRAW_DEFAULT_COLOR,
    sizes: { ...DRAW_DEFAULT_SIZES },
  };
}

export interface DrawToolProps {
  controller: PhotoEditorController;
  settings: DrawToolSettings;
  onSettingsChange: (next: DrawToolSettings) => void;
}

const CHIP_HEIGHT = 30;
const CHIP_MIN_WIDTH = 64;
const CHIP_HIT_SLOP = 8;

const BRUSHES: { id: DrawBrush; labelKey: keyof MediaEditorStrings }[] = [
  { id: 'pen', labelKey: 'brushPen' },
  { id: 'marker', labelKey: 'brushMarker' },
  { id: 'neon', labelKey: 'brushNeon' },
  { id: 'eraser', labelKey: 'brushEraser' },
];

export function DrawTool({ controller, settings, onSettingsChange }: DrawToolProps) {
  const theme = useEditorTheme();
  const panel = getPanelPalette(theme);
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;
  const [setBrushRowRef, onBrushRowContentSizeChange] = useRtlHorizontalScrollLanding();
  const [setColorRowRef, onColorRowContentSizeChange] = useRtlHorizontalScrollLanding();

  const size = settings.sizes[settings.brush];
  const isEraser = settings.brush === 'eraser';
  const hasStrokes = state.strokes.length > 0;

  const setBrush = (brush: DrawBrush) => onSettingsChange({ ...settings, brush });
  const setColor = (color: string) => onSettingsChange({ ...settings, color });
  const setSize = (value: number) =>
    onSettingsChange({
      ...settings,
      sizes: { ...settings.sizes, [settings.brush]: value },
    });

  return (
    <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
      <ScrollView
        ref={setBrushRowRef}
        onContentSizeChange={onBrushRowContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.xs,
          flexGrow: 1,
        }}>
        {BRUSHES.map((brush) => {
          const active = brush.id === settings.brush;
          return (
            <Pressable
              key={brush.id}
              onPress={() => setBrush(brush.id)}
              accessibilityRole="button"
              accessibilityLabel={t(brush.labelKey)}
              accessibilityState={{ selected: active }}
              hitSlop={CHIP_HIT_SLOP}
              style={[
                styles.chip,
                {
                  minWidth: CHIP_MIN_WIDTH,
                  height: CHIP_HEIGHT,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.sm,
                  backgroundColor: active ? panel.chipBgActive : panel.chipBg,
                  borderColor: active ? theme.colors.accent : 'transparent',
                },
              ]}>
              <Text
                numberOfLines={1}
                style={{
                  color: active ? panel.text : panel.textMuted,
                  fontSize: 12,
                  fontWeight: active ? '700' : '500',
                }}>
                {t(brush.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.md }}>
        <Slider
          label={t('drawSize')}
          value={size}
          min={DRAW_SIZE_MIN}
          max={DRAW_SIZE_MAX}
          neutral={DRAW_SIZE_MIN}
          formatValue={(v) =>
            `${Math.round(((v - DRAW_SIZE_MIN) / (DRAW_SIZE_MAX - DRAW_SIZE_MIN)) * 100)}`
          }
          onChange={setSize}
          onScrim
        />
      </View>

      {!isEraser && (
        <ScrollView
          ref={setColorRowRef}
          onContentSizeChange={onColorRowContentSizeChange}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexDirection: isRTL ? 'row-reverse' : 'row',
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.xs,
            alignItems: 'center',
            flexGrow: 1,
          }}>
          {DEFAULT_TEXT_COLORS.map((color) => {
            const active = settings.color.toUpperCase() === color.toUpperCase();
            return (
              <Pressable
                key={color}
                onPress={() => setColor(color)}
                accessibilityRole="button"
                accessibilityLabel={color}
                accessibilityState={{ selected: active }}
                style={[
                  styles.swatchRing,
                  {
                    borderWidth: active ? 2 : 0,
                    borderColor: active ? theme.colors.accent : 'transparent',
                  },
                ]}>
                <View
                  style={[styles.swatch, { backgroundColor: color, borderColor: panel.border }]}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.md,
          marginTop: theme.spacing.xs,
        }}>
        <Pressable
          onPress={() => dispatch({ type: 'clearStrokes' })}
          accessibilityRole="button"
          accessibilityLabel={t('clearDrawing')}
          disabled={!hasStrokes}
          style={[
            styles.clearButton,
            {
              borderColor: panel.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
              opacity: hasStrokes ? 1 : 0.4,
            },
          ]}>
          <Text style={{ color: panel.textMuted, fontSize: 12 }}>{t('clearDrawing')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clearButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  swatchRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
