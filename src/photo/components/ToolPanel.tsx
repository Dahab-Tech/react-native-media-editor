import React, { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';

export interface ToolPanelProps {
  onDismiss: () => void;
  grabberAccessibilityLabel?: string;
  /** Reports measured height so the parent can inset the crop canvas above it. */
  onLayoutHeight?: (height: number) => void;
  children?: React.ReactNode;
  style?: ViewStyle;
}

const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;
/** Also the collapsed strip's height — exported so hosts can clear the strip when it floats over content. */
export const GRABBER_HIT_HEIGHT = 28;
const DISMISS_TRAVEL_FRACTION = 1 / 3;
const DISMISS_FLICK_VELOCITY = 700;
const SPRING_BACK_MS = 180;

/** Floating scrim wrapper for tool panels; pan gesture is scoped to the grabber to not fight sliders/inputs. */
export function ToolPanel({
  onDismiss,
  grabberAccessibilityLabel,
  onLayoutHeight,
  children,
  style,
}: ToolPanelProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();

  const translateY = useSharedValue(0);
  const heightRef = useSharedValue(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    const h = event.nativeEvent.layout.height;
    heightRef.value = h;
    onLayoutHeight?.(h);
  };

  const [dragGesture] = useState(() =>
    Gesture.Pan()
      .activeOffsetY(6)
      .failOffsetX([-20, 20])
      .onChange((e) => {
        const next = translateY.value + e.changeY;
        translateY.value = next < 0 ? 0 : next;
      })
      .onEnd((e) => {
        const h = heightRef.value;
        const past = h > 0 && translateY.value > h * DISMISS_TRAVEL_FRACTION;
        const flick = e.velocityY > DISMISS_FLICK_VELOCITY;
        if (past || flick) {
          runOnJS(onDismiss)();
        } else {
          translateY.value = withTiming(0, { duration: SPRING_BACK_MS });
        }
      })
  );

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.panelSurface,
          borderTopLeftRadius: theme.radius.lg,
          borderTopRightRadius: theme.radius.lg,
        },
        dragStyle,
        style,
      ]}>
      <GestureDetector gesture={dragGesture}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={grabberAccessibilityLabel ?? t('hidePanel')}
          hitSlop={8}
          style={styles.grabberHit}>
          <View style={styles.grabber} />
        </Pressable>
      </GestureDetector>
      {children}
    </Animated.View>
  );
}

export interface CollapsedPanelStripProps {
  onReveal: () => void;
  onLayoutHeight?: (height: number) => void;
}

const REVEAL_SWIPE_THRESHOLD = 8;

/** Collapsed affordance above the toolbar; tap or swipe-up reveals the panel. */
export function CollapsedPanelStrip({ onReveal, onLayoutHeight }: CollapsedPanelStripProps) {
  const theme = useEditorTheme();
  const { t } = useEditorI18n();

  const [swipeUpGesture] = useState(() =>
    Gesture.Pan()
      .activeOffsetY(-REVEAL_SWIPE_THRESHOLD)
      .failOffsetX([-20, 20])
      .onStart(() => {
        runOnJS(onReveal)();
      })
  );

  return (
    <GestureDetector gesture={swipeUpGesture}>
      <Pressable
        onPress={onReveal}
        onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
        accessibilityRole="button"
        accessibilityLabel={t('showPanel')}
        style={[
          styles.stripContainer,
          {
            backgroundColor: theme.colors.panelSurface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
          },
        ]}>
        <View style={styles.grabber} />
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  grabberHit: {
    height: GRABBER_HIT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: GRABBER_WIDTH,
    height: GRABBER_HEIGHT,
    borderRadius: GRABBER_HEIGHT / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  stripContainer: {
    height: GRABBER_HIT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
