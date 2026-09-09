import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { STRAIGHTEN_MAX, STRAIGHTEN_MIN } from '../state/photoEditorState';

export interface StraightenDialProps {
  /** Degrees in [STRAIGHTEN_MIN..STRAIGHTEN_MAX]. */
  value: number;
  onChange: (value: number) => void;
  /** Fired once at drag start / before tap-to-reset (consumers checkpoint here). */
  onSlidingStart?: () => void;
}

const PX_PER_DEG = 6;

// Magnetic detent so tap-to-reset isn't the only way back to straight.
const SNAP_TO_ZERO_DEG = 0.75;

const MINOR_STEP = 1;
const MAJOR_STEP = 15;

const DIAL_HEIGHT = 48;
const MINOR_TICK_H = 8;
const MAJOR_TICK_H = 14;
const INDICATOR_TOP_INSET = 12;
const TICK_WIDTH = StyleSheet.hairlineWidth;
const LABEL_FONT_SIZE = 10;
const READOUT_FONT_SIZE = 13;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** iOS Photos-style straighten ruler. Drag shifts ticks behind a fixed center indicator. */
export function StraightenDial({ value, onChange, onSlidingStart }: StraightenDialProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const [trackWidth, setTrackWidth] = useState(0);

  const latest = useRef({ value, onChange, onSlidingStart, isRTL });
  useEffect(() => {
    latest.current = { value, onChange, onSlidingStart, isRTL };
  });

  const dragOrigin = useRef(0);

  // eslint-disable-next-line react-hooks/refs -- refs are only read inside gesture callbacks, never during render
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOrigin.current = latest.current.value;
        latest.current.onSlidingStart?.();
      },
      onPanResponderMove: (_e, g) => {
        const s = latest.current;
        // Rightward drag decreases value (iOS Photos ruler-follows-finger). RTL mirrors.
        const signedDx = s.isRTL ? -g.dx : g.dx;
        const raw = clamp(
          dragOrigin.current - signedDx / PX_PER_DEG,
          STRAIGHTEN_MIN,
          STRAIGHTEN_MAX
        );
        const next = Math.abs(raw) < SNAP_TO_ZERO_DEG ? 0 : raw;
        s.onChange(next);
      },
    })
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const centerX = trackWidth / 2;
  const rulerSign = isRTL ? -1 : 1;

  // Tick list is deterministic from module constants — memoize so re-renders don't rebuild it.
  const ticks = useMemo(() => {
    const arr: { deg: number; major: boolean }[] = [];
    for (let d = STRAIGHTEN_MIN; d <= STRAIGHTEN_MAX; d += MINOR_STEP) {
      arr.push({ deg: d, major: d % MAJOR_STEP === 0 });
    }
    return arr;
  }, []);

  const accent = theme.colors.accent;
  const scrimText = '#FFFFFF';
  const scrimTextMuted = 'rgba(255,255,255,0.6)';
  const minorColor = 'rgba(255,255,255,0.35)';

  const handleReset = () => {
    latest.current.onSlidingStart?.();
    latest.current.onChange(0);
  };

  return (
    <View style={{ paddingVertical: theme.spacing.xs }} accessibilityLabel={t('straighten')}>
      <View style={styles.readoutRow}>
        <Pressable onPress={handleReset} hitSlop={8} accessibilityRole="button">
          <Text
            style={{
              color: value === 0 ? scrimTextMuted : accent,
              fontVariant: ['tabular-nums'],
              fontSize: READOUT_FONT_SIZE,
              fontWeight: '600',
            }}>
            {formatDegrees(value)}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.track, { height: DIAL_HEIGHT }]}>
        <View {...responder.panHandlers} onLayout={handleLayout} style={StyleSheet.absoluteFill}>
          {trackWidth > 0 &&
            ticks.map((tick) => {
              const offsetPx = (value - tick.deg) * PX_PER_DEG * rulerSign;
              const x = centerX + offsetPx;
              if (x < -20 || x > trackWidth + 20) return null;
              return (
                <React.Fragment key={tick.deg}>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: x - TICK_WIDTH / 2,
                      top: (DIAL_HEIGHT - (tick.major ? MAJOR_TICK_H : MINOR_TICK_H)) / 2,
                      width: TICK_WIDTH,
                      height: tick.major ? MAJOR_TICK_H : MINOR_TICK_H,
                      backgroundColor: tick.major ? scrimText : minorColor,
                    }}
                  />
                  {tick.major && (
                    <Text
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: x - 20,
                        width: 40,
                        textAlign: 'center',
                        top: DIAL_HEIGHT / 2 + MAJOR_TICK_H / 2 + 2,
                        fontSize: LABEL_FONT_SIZE,
                        color: scrimTextMuted,
                        fontVariant: ['tabular-nums'],
                      }}>
                      {tick.deg}
                    </Text>
                  )}
                </React.Fragment>
              );
            })}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: centerX - 1,
              top: INDICATOR_TOP_INSET,
              bottom: 0,
              width: 2,
              backgroundColor: accent,
            }}
          />
        </View>
      </View>
    </View>
  );
}

function formatDegrees(value: number): string {
  const rounded = Math.round(value);
  return `${rounded}°`;
}

const styles = StyleSheet.create({
  readoutRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 2,
  },
  track: {
    width: '100%',
    overflow: 'hidden',
  },
});
