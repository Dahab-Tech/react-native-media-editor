import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useEditorTheme } from '../../core/theming/ThemeContext';
import { formatMs } from '../format';

export const RULER_HEIGHT = 18;
/** Smallest horizontal space a labeled tick may occupy before the interval widens. */
const MIN_LABEL_SPACING_PX = 56;
const INTERVAL_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300];

export interface TimeRulerProps {
  durationMs: number;
  pxPerSecond: number;
}

/** Zoom-aware tick row above the clip track; labeled major ticks with midpoint dots. */
export function TimeRuler({ durationMs, pxPerSecond }: TimeRulerProps) {
  const theme = useEditorTheme();
  const pxPerMs = pxPerSecond / 1000;
  const intervalS =
    INTERVAL_STEPS_S.find((s) => s * pxPerSecond >= MIN_LABEL_SPACING_PX) ??
    INTERVAL_STEPS_S[INTERVAL_STEPS_S.length - 1];
  const intervalMs = intervalS * 1000;

  const ticks: React.ReactNode[] = [];
  for (let t = 0; t <= durationMs; t += intervalMs) {
    ticks.push(
      <Text
        key={t}
        numberOfLines={1}
        style={[styles.label, { left: t * pxPerMs, color: theme.colors.textMuted }]}>
        {formatMs(t)}
      </Text>
    );
    const mid = t + intervalMs / 2;
    if (mid < durationMs) {
      ticks.push(
        <View
          key={`${t}-mid`}
          style={[styles.dot, { left: mid * pxPerMs, backgroundColor: theme.colors.textMuted }]}
        />
      );
    }
  }

  return <View style={[styles.ruler, { width: durationMs * pxPerMs }]}>{ticks}</View>;
}

const styles = StyleSheet.create({
  ruler: {
    height: RULER_HEIGHT,
    justifyContent: 'center',
  },
  // Explicit left offsets — Fabric collapses inset-stretched absolutes inside horizontal scroll content.
  label: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    transform: [{ translateX: -2 }],
  },
  dot: {
    position: 'absolute',
    width: 2.5,
    height: 2.5,
    borderRadius: 1.25,
    opacity: 0.6,
  },
});
