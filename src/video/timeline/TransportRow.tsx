import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { formatMs } from '../format';
import type { PlaybackClock } from '../player/TimelinePlayer';

const READOUT_INTERVAL_MS = 250;

export interface TransportRowProps {
  paused: boolean;
  onTogglePlay: () => void;
  clock: SharedValue<PlaybackClock | null>;
  durationMs: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** Play/pause + position readout + undo/redo strip between the preview and the timeline. */
export function TransportRow({
  paused,
  onTogglePlay,
  clock,
  durationMs,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TransportRowProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();

  const [positionLabel, setPositionLabel] = useState(() => formatMs(0));
  useEffect(() => {
    const tick = () => {
      const snap = clock.value;
      const positionMs =
        snap == null ? 0 : snap.positionMs + (performance.now() - snap.epochMs) * snap.rate;
      const label = formatMs(Math.min(Math.max(positionMs, 0), durationMs));
      setPositionLabel((prev) => (prev === label ? prev : label));
    };
    tick();
    const id = setInterval(tick, READOUT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [clock, durationMs]);

  const mirror = isRTL ? [{ scaleX: -1 as const }] : undefined;

  return (
    <View
      style={[
        styles.row,
        {
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingHorizontal: theme.spacing.md,
        },
      ]}>
      <Pressable
        onPress={onTogglePlay}
        accessibilityRole="button"
        accessibilityLabel={paused ? t('play') : t('pause')}
        hitSlop={10}
        style={({ pressed }) => [styles.playButton, { opacity: pressed ? 0.6 : 1 }]}>
        <EditorIcon name={paused ? 'play' : 'pause'} size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={[styles.readout, { color: theme.colors.textMuted }]}>
        {`${positionLabel} / ${formatMs(durationMs)}`}
      </Text>
      <View style={styles.spacer} />
      <View style={[styles.historyCluster, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('undo')}
          style={({ pressed }) => [
            styles.historyButton,
            { opacity: canUndo ? (pressed ? 0.6 : 1) : 0.35 },
          ]}>
          <View style={mirror ? { transform: mirror } : undefined}>
            <EditorIcon name="undo" size={20} color={theme.colors.text} />
          </View>
        </Pressable>
        <Pressable
          onPress={onRedo}
          disabled={!canRedo}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('redo')}
          style={({ pressed }) => [
            styles.historyButton,
            { opacity: canRedo ? (pressed ? 0.6 : 1) : 0.35 },
          ]}>
          <View style={mirror ? { transform: mirror } : undefined}>
            <EditorIcon name="redo" size={20} color={theme.colors.text} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    minHeight: 40,
  },
  playButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    marginHorizontal: 4,
  },
  spacer: { flex: 1 },
  historyCluster: { alignItems: 'center' },
  historyButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
