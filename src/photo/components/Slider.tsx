import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { createRafCoalescer } from '../../core/hooks/rafCoalescer';
import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Fired once at drag start (consumers checkpoint here). */
  onSlidingStart?: () => void;
  /** Rendered as a subtle tick; defaults to (min + max) / 2. */
  neutral?: number;
  /** Overrides the value readout. Default is signed × 100. */
  formatValue?: (value: number) => string;
  /** Use on-scrim palette when hosted inside a ToolPanel. */
  onScrim?: boolean;
}

const THUMB_SIZE = 20;
const TRACK_HEIGHT = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  onSlidingStart,
  neutral,
  formatValue,
  onScrim,
}: SliderProps) {
  const theme = useEditorTheme();
  const { isRTL } = useEditorI18n();
  const [trackWidth, setTrackWidth] = useState(0);

  const latest = useRef({ value, min, max, trackWidth, onChange, onSlidingStart, isRTL });
  useEffect(() => {
    latest.current = { value, min, max, trackWidth, onChange, onSlidingStart, isRTL };
  });

  const dragOriginValue = useRef(0);
  // Coalesce Move dispatches to one per frame — Android touch outpaces render and each dispatch rebuilds the Skia LUT filter.
  const coalescer = useRef(createRafCoalescer());

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginValue.current = latest.current.value;
        latest.current.onSlidingStart?.();
      },
      onPanResponderMove: (_event, gesture) => {
        const s = latest.current;
        const usable = s.trackWidth - THUMB_SIZE;
        if (usable <= 0) {
          return;
        }
        const signedDx = s.isRTL ? -gesture.dx : gesture.dx;
        const deltaValue = (signedDx / usable) * (s.max - s.min);
        const next = clamp(dragOriginValue.current + deltaValue, s.min, s.max);
        coalescer.current.schedule(() => latest.current.onChange(next));
      },
      onPanResponderRelease: () => {
        coalescer.current.flush();
      },
      onPanResponderTerminate: () => {
        coalescer.current.flush();
      },
    })
  );

  useEffect(() => {
    const c = coalescer.current;
    return () => c.cancel();
  }, []);

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const usable = Math.max(0, trackWidth - THUMB_SIZE);
  const range = max - min;
  const ratio = range === 0 ? 0 : (value - min) / range;
  const thumbX = ratio * usable;
  const neutralPoint = neutral ?? (min + max) / 2;
  const neutralRatio = range === 0 ? 0 : (neutralPoint - min) / range;
  const neutralX = neutralRatio * usable + THUMB_SIZE / 2;

  const labelColor = onScrim ? '#FFFFFF' : theme.colors.text;
  const mutedColor = onScrim ? 'rgba(255,255,255,0.6)' : theme.colors.textMuted;
  const trackColor = onScrim ? 'rgba(255,255,255,0.25)' : theme.colors.border;

  // Fill spans from the neutral tick to the thumb so signed adjustments read as offset-from-center.
  const fillLeft = Math.min(neutralX, thumbX + THUMB_SIZE / 2);
  const fillWidth = Math.abs(thumbX + THUMB_SIZE / 2 - neutralX);

  return (
    <View style={{ paddingVertical: theme.spacing.xs }}>
      <View
        style={[
          styles.header,
          { flexDirection: isRTL ? 'row-reverse' : 'row', marginBottom: theme.spacing.xs },
        ]}>
        <Text style={{ color: labelColor, fontWeight: '600' }}>{label}</Text>
        <Text
          style={{
            color: mutedColor,
            fontVariant: ['tabular-nums'],
            fontSize: 13,
          }}>
          {formatValue ? formatValue(value) : formatSigned(value)}
        </Text>
      </View>
      <View style={styles.trackWrapper} onLayout={handleLayout}>
        <View
          style={[
            styles.track,
            {
              backgroundColor: trackColor,
              borderRadius: TRACK_HEIGHT,
              marginHorizontal: THUMB_SIZE / 2,
            },
          ]}
        />
        {usable > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.fill,
                {
                  left: isRTL ? undefined : fillLeft,
                  right: isRTL ? fillLeft : undefined,
                  width: fillWidth,
                  backgroundColor: theme.colors.accent,
                  borderRadius: TRACK_HEIGHT,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.neutralTick,
                {
                  left: neutralX - 1,
                  backgroundColor: mutedColor,
                },
              ]}
            />
            <View
              {...responder.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel={label}
              style={[
                styles.thumb,
                {
                  left: isRTL ? usable - thumbX : thumbX,
                  backgroundColor: theme.colors.onAccent,
                  borderColor: theme.colors.accent,
                  shadowColor: '#000',
                  shadowOpacity: 0.2,
                  shadowRadius: 3,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 2,
                },
              ]}
            />
          </>
        )}
      </View>
    </View>
  );
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100);
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackWrapper: {
    height: THUMB_SIZE,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
  },
  fill: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
  },
  neutralTick: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    width: 2,
    opacity: 0.5,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
});
