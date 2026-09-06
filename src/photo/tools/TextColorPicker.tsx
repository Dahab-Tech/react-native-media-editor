/* eslint-disable react-hooks/immutability -- Reanimated shared values are hook-owned mutable containers. Worklets assign to `.value` on the UI thread; that is the intended API and not a component-prop mutation. */
import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { useEditorTheme } from '../../core/theming/ThemeContext';

export interface TextColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const HUE_STOPS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

/** Inline hue + shade picker with Skia gradients; UI-thread shared values, JS dispatch per gesture end. */
export function TextColorPicker({ value, onChange }: TextColorPickerProps) {
  const theme = useEditorTheme();
  const [width, setWidth] = React.useState(0);

  // Seed shared values from `value` on first mount only (useSharedValue ignores later init changes).
  const initial = useMemo(() => hexToHueShade(value), [value]);
  const hue = useSharedValue(initial.hue);
  const shade = useSharedValue(initial.shade);
  const hueHex = useSharedValue(hslToHex(initial.hue, 1, 0.5));

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const huePan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          if (width <= 0) return;
          const next = clamp(e.x / width, 0, 1) * 360;
          hue.value = next;
          hueHex.value = hslToHex(next, 1, 0.5);
          runOnJS(onChange)(hslToHex(next, 1, 1 - shade.value));
        })
        .onChange((e) => {
          if (width <= 0) return;
          const next = clamp(e.x / width, 0, 1) * 360;
          hue.value = next;
          hueHex.value = hslToHex(next, 1, 0.5);
        })
        .onEnd(() => {
          runOnJS(onChange)(hslToHex(hue.value, 1, 1 - shade.value));
        }),
    [width, hue, hueHex, shade, onChange]
  );

  const shadePan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          if (width <= 0) return;
          const next = clamp(e.x / width, 0, 1);
          shade.value = next;
          runOnJS(onChange)(hslToHex(hue.value, 1, 1 - next));
        })
        .onChange((e) => {
          if (width <= 0) return;
          shade.value = clamp(e.x / width, 0, 1);
        })
        .onEnd(() => {
          runOnJS(onChange)(hslToHex(hue.value, 1, 1 - shade.value));
        }),
    [width, hue, shade, onChange]
  );

  const hueThumbStyle = useAnimatedStyle(() => ({
    left: (hue.value / 360) * Math.max(0, width - THUMB_SIZE),
  }));
  const shadeThumbStyle = useAnimatedStyle(() => ({
    left: shade.value * Math.max(0, width - THUMB_SIZE),
  }));

  // Bridge UI-thread hue into JS so the shade gradient's middle stop re-renders reactively.
  const [hueMidHex, setHueMidHex] = React.useState(() => hslToHex(initial.hue, 1, 0.5));
  useAnimatedReaction(
    () => hueHex.value,
    (next, prev) => {
      if (next !== prev) runOnJS(setHueMidHex)(next);
    }
  );

  const thumbBorder = 'rgba(255,255,255,0.9)';

  return (
    <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
      <View onLayout={handleLayout} style={{ width: '100%' }}>
        <GestureDetector gesture={huePan}>
          <View style={{ height: TRACK_HEIGHT, justifyContent: 'center' }}>
            {width > 0 && (
              <Canvas style={{ width, height: TRACK_HEIGHT }}>
                <RoundedRect x={0} y={0} width={width} height={TRACK_HEIGHT} r={theme.radius.md}>
                  <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={HUE_STOPS} />
                </RoundedRect>
              </Canvas>
            )}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
                  borderColor: thumbBorder,
                  backgroundColor: theme.colors.surface,
                },
                hueThumbStyle,
              ]}
            />
          </View>
        </GestureDetector>
        <GestureDetector gesture={shadePan}>
          <View style={{ height: TRACK_HEIGHT, justifyContent: 'center' }}>
            {width > 0 && (
              <Canvas style={{ width, height: TRACK_HEIGHT }}>
                <RoundedRect x={0} y={0} width={width} height={TRACK_HEIGHT} r={theme.radius.md}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(width, 0)}
                    colors={['#FFFFFF', hueMidHex, '#000000']}
                  />
                </RoundedRect>
              </Canvas>
            )}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
                  borderColor: thumbBorder,
                  backgroundColor: theme.colors.surface,
                },
                shadeThumbStyle,
              ]}
            />
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

/** HSL → hex; worklet so UI-thread gesture callbacks can call it directly. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  'worklet';
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  const to255 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${to255(r1)}${to255(g1)}${to255(b1)}`;
}

function hexToHueShade(hex: string): { hue: number; shade: number } {
  const parsed = parseHex(hex);
  if (!parsed) return { hue: 0, shade: 0.5 };
  const { r, g, b } = parsed;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { hue: h, shade: 1 - l };
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

const styles = StyleSheet.create({
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
});
