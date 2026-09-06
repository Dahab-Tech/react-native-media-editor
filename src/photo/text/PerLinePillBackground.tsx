import React, { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextLayoutEvent, type TextStyle } from 'react-native';

import type { TextAlign } from '../layers';

/** Per-line pill backgrounds; pills overlap by 2*padV to hide the rounded corners
 *  (requires paddingVertical >= borderRadius). Measures via a hidden <Text> mirror. */

export interface PerLinePillBackgroundProps {
  text: string;
  /** Must match the visible child's style so measured frames don't drift. */
  textStyle: TextStyle;
  background: string;
  /** MUST be <= paddingVertical. */
  borderRadius: number;
  paddingHorizontal: number;
  /** MUST be >= borderRadius. */
  paddingVertical: number;
  align: TextAlign;
  maxWidth?: number;
  /** Painted on top of the pills; MUST be transparent-background. */
  children: ReactNode;
}

interface LineFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PerLinePillBackground({
  text,
  textStyle,
  background,
  borderRadius,
  paddingHorizontal,
  paddingVertical,
  align,
  maxWidth,
  children,
}: PerLinePillBackgroundProps) {
  const [lines, setLines] = useState<readonly LineFrame[]>([]);

  const handleTextLayout = (event: TextLayoutEvent) => {
    const next = event.nativeEvent.lines.map((l) => ({
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
    }));
    // Bail on no-op updates; RN fires onTextLayout multiple times per pass.
    if (
      next.length === lines.length &&
      next.every(
        (l, i) =>
          lines[i]?.x === l.x &&
          lines[i]?.y === l.y &&
          lines[i]?.width === l.width &&
          lines[i]?.height === l.height
      )
    ) {
      return;
    }
    setLines(next);
  };

  return (
    <View
      style={{
        paddingHorizontal,
        paddingVertical,
        ...(maxWidth != null ? { maxWidth } : null),
      }}>
      {/* opacity:0 (not display:none) so RN still fires onTextLayout. */}
      <Text
        allowFontScaling={false}
        onTextLayout={handleTextLayout}
        style={[textStyle, styles.mirror, { textAlign: align }]}>
        {text}
      </Text>

      {lines.length > 0 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {lines.map((line, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: line.x,
                top: line.y,
                width: line.width + paddingHorizontal * 2,
                height: line.height + paddingVertical * 2,
                borderRadius,
                backgroundColor: background,
              }}
            />
          ))}
        </View>
      )}

      <View
        style={{
          position: 'absolute',
          left: paddingHorizontal,
          top: paddingVertical,
          right: paddingHorizontal,
          bottom: paddingVertical,
        }}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Kept in flow (opacity:0) so its height contributes to the container measurement.
  mirror: {
    opacity: 0,
  },
});
