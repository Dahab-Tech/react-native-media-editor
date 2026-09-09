import { requireNativeView } from 'expo';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import MediaEditorModule, { type ScrubSessionInfo } from '../../native/MediaEditorModule';
import type { CropRect, VideoInfo } from '../../types';

// Warm MediaCodec preview via TextureView + persistent decoder; falls back to ScrubFrameOverlay if a second HW decoder isn't available.

interface NativeScrubPreviewProps {
  sessionId: number;
  // Not `rotation`: RN core owns a built-in view prop by that name and would rotate the view itself.
  videoRotation?: number;
  onFatalError?: (event: { nativeEvent: { message: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

// Android-only: fail closed on other platforms (component is gated by caller).
const NativeScrubPreview = (
  Platform.OS === 'android' ? requireNativeView('MediaEditor') : null
) as React.ComponentType<NativeScrubPreviewProps> | null;

export interface ScrubEnginePreviewProps {
  source: string;
  durationMs: number;
  info: VideoInfo;
  /** Committed crop in source pixels, or null for the full frame (mirrors CropAwareVideo). */
  crop: CropRect | null;
  displayRect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  /** Hands the parent a per-tick time callback; called with null on unmount. */
  registerListener: (cb: ((timeMs: number) => void) | null) => void;
  /** Triggered once on session-create failure OR any fatal decoder error. */
  onFallback: () => void;
}

export function ScrubEnginePreview({
  source,
  info,
  crop,
  displayRect,
  visible,
  registerListener,
  onFallback,
}: ScrubEnginePreviewProps) {
  const [session, setSession] = useState<ScrubSessionInfo | null>(null);
  const fallbackFiredRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null);
  // Ref so the create-session effect doesn't re-run on parent re-renders and thrash native sessions.
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  const fireFallback = useCallback(() => {
    if (fallbackFiredRef.current) return;
    fallbackFiredRef.current = true;
    onFallbackRef.current();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !NativeScrubPreview) {
      fireFallback();
      return;
    }
    let cancelled = false;
    fallbackFiredRef.current = false;
    (async () => {
      try {
        const info = await MediaEditorModule.createScrubSession(source);
        if (cancelled) {
          MediaEditorModule.releaseScrubSession(info.sessionId).catch(() => {});
          return;
        }
        sessionIdRef.current = info.sessionId;
        setSession(info);
      } catch {
        if (!cancelled) fireFallback();
      }
    })();
    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id != null) MediaEditorModule.releaseScrubSession(id).catch(() => {});
      setSession(null);
    };
  }, [source, fireFallback]);

  useEffect(() => {
    const id = session?.sessionId;
    if (id == null) {
      registerListener(null);
      return;
    }
    // Fire-and-forget per-tick: latest-wins native-side, no round-trip through React state.
    const onScrubTime = (timeMs: number) => {
      MediaEditorModule.scrubSessionTo(id, timeMs).catch(() => {});
    };
    registerListener(onScrubTime);
    return () => registerListener(null);
  }, [session, registerListener]);

  const displayStyles = useMemo(() => {
    if (!session) return null;
    if (displayRect.width <= 0) return null;
    if (!crop) {
      // No-crop = contain-fit; JS computes it because the native TextureView stretches its bounds (no internal letterbox).
      const rect = containFit(info.width, info.height, displayRect);
      return {
        container: { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 },
        inner: {
          position: 'absolute' as const,
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    }
    // Crop math mirrors CropAwareVideo — scale so crop.width fills displayRect, translate so crop origin lands at (0,0) of the clip container.
    const scale = displayRect.width / crop.width;
    return {
      container: {
        position: 'absolute' as const,
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        overflow: 'hidden' as const,
      },
      inner: {
        position: 'absolute' as const,
        left: -crop.x * scale,
        top: -crop.y * scale,
        width: info.width * scale,
        height: info.height * scale,
      },
    };
  }, [session, info.width, info.height, crop, displayRect]);

  if (!NativeScrubPreview || !session || !displayStyles) return null;

  return (
    <View pointerEvents="none" style={[displayStyles.container, !visible && styles.hiddenPreview]}>
      <NativeScrubPreview
        sessionId={session.sessionId}
        videoRotation={session.rotation}
        onFatalError={fireFallback}
        style={displayStyles.inner}
      />
    </View>
  );
}

// Contain-fit inside a rect (mirrors CropAwareVideo's contentFit="contain" branch).
function containFit(
  srcW: number,
  srcH: number,
  rect: { x: number; y: number; width: number; height: number }
) {
  if (srcW <= 0 || srcH <= 0) return rect;
  const scale = Math.min(rect.width / srcW, rect.height / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + (rect.height - h) / 2,
    width: w,
    height: h,
  };
}

const styles = StyleSheet.create({
  hiddenPreview: {
    opacity: 0,
  },
});
