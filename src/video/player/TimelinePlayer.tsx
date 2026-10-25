import { requireNativeView } from 'expo';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { WireProject } from '../project/wire';

/** Snapshot for UI-thread extrapolation: pos ≈ positionMs + (now − epochMs) × rate. */
export interface PlaybackClock {
  positionMs: number;
  epochMs: number;
  rate: number;
}

export interface TimelinePlayerHandle {
  seekTo(positionMs: number): Promise<void>;
  /** Scrubbing pauses playback natively and switches seeks to scrub-optimized mode. */
  setScrubbing(active: boolean): Promise<void>;
}

export interface TimelinePlayerProps {
  project: WireProject | null;
  paused?: boolean;
  /** Restart from 0 at composition end; `onPlayEnd` only fires when not looping. */
  loop?: boolean;
  volume?: number;
  timeUpdateIntervalMs?: number;
  /** Written on every native tick; frame callbacks extrapolate between ticks. */
  clock?: SharedValue<PlaybackClock | null>;
  /**
   * UI-thread scrub channel: worklets write a timeline position here and it reaches the
   * native player as an animated prop — scrub seeks never touch the JS thread. -1 = inactive.
   */
  scrubMs?: SharedValue<number>;
  onReady?: (event: { durationMs: number; clipDurationsMs: number[] }) => void;
  onTimeUpdate?: (event: { positionMs: number; clipIndex: number }) => void;
  onClipChanged?: (clipIndex: number) => void;
  onPlayEnd?: () => void;
  onError?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
}

interface NativeEvent<T> {
  nativeEvent: T;
}

interface NativeProps {
  project: string | null;
  paused: boolean;
  loop: boolean;
  volume: number;
  timeUpdateIntervalMs: number;
  scrubPositionMs?: number;
  onReady?: (event: NativeEvent<{ durationMs: number; clipDurationsMs: number[] }>) => void;
  onTimeUpdate?: (
    event: NativeEvent<{ positionMs: number; clipIndex: number; rate: number }>
  ) => void;
  onClipChanged?: (event: NativeEvent<{ clipIndex: number }>) => void;
  onPlayEnd?: (event: NativeEvent<Record<string, never>>) => void;
  onPlayerError?: (event: NativeEvent<{ message: string }>) => void;
  style?: StyleProp<ViewStyle>;
}

interface NativeHandle {
  seekTo(ms: number): Promise<void>;
  setScrubbing(active: boolean): Promise<void>;
}

const NativeTimelinePlayerView = requireNativeView(
  'MediaEditor',
  'TimelinePlayerView'
) as React.ComponentType<NativeProps & { ref?: React.Ref<NativeHandle> }>;

const AnimatedTimelinePlayerView = Animated.createAnimatedComponent(NativeTimelinePlayerView);

/** Preview player: renders the same compiled composition the export uses, so preview = export by construction. */
export const TimelinePlayer = forwardRef<TimelinePlayerHandle, TimelinePlayerProps>(
  function TimelinePlayer(
    {
      project,
      paused = false,
      loop = false,
      volume = 1,
      timeUpdateIntervalMs = 100,
      clock,
      scrubMs,
      onReady,
      onTimeUpdate,
      onClipChanged,
      onPlayEnd,
      onError,
      style,
    },
    ref
  ) {
    const nativeRef = useRef<NativeHandle>(null);
    const scrubbingRef = useRef(false);
    // Transport rate as reported by the native player — JS never asserts motion on intent.
    // Cleared on every JS-initiated transition (pause, seek, scrub, rebuild) until the next
    // native tick reports the real state; animating through those gaps snapped the bar back.
    const nativeRateRef = useRef(0);
    // JS-side clock mirror: JS reads of `clock.value` can be stale, so never read the shared value here.
    const lastSnapRef = useRef<PlaybackClock | null>(null);
    const projectJson = useMemo(() => (project ? JSON.stringify(project) : null), [project]);

    const rate = useCallback(
      () => (!paused && !scrubbingRef.current ? nativeRateRef.current : 0),
      [paused]
    );
    const writeClock = useCallback(
      (positionMs: number, clockRate: number) => {
        const snap = { positionMs, epochMs: performance.now(), rate: clockRate };
        lastSnapRef.current = snap;
        if (clock) clock.value = snap;
      },
      [clock]
    );
    const rebaseClock = useCallback(() => {
      const snap = lastSnapRef.current;
      if (!snap) return;
      writeClock(snap.positionMs + (performance.now() - snap.epochMs) * snap.rate, rate());
    }, [writeClock, rate]);

    // Pause/resume: park the clock until a native tick reports the new transport state — the
    // player may take a moment to actually start, and the bar must not run ahead of it.
    useEffect(() => {
      nativeRateRef.current = 0;
      rebaseClock();
    }, [paused, rebaseClock]);

    // A rebuild gates ticks while the native swap runs; freeze the clock so the bar holds with the
    // frozen video frame instead of extrapolating through the compile.
    useEffect(() => {
      nativeRateRef.current = 0;
      rebaseClock();
    }, [projectJson, rebaseClock]);

    useImperativeHandle(
      ref,
      () => ({
        async seekTo(positionMs: number) {
          // Park at the target until the native seek lands; running ahead of it snaps back on the next tick.
          nativeRateRef.current = 0;
          writeClock(positionMs, rate());
          await nativeRef.current?.seekTo(positionMs);
        },
        async setScrubbing(active: boolean) {
          scrubbingRef.current = active;
          nativeRateRef.current = 0;
          rebaseClock();
          await nativeRef.current?.setScrubbing(active);
        },
      }),
      [writeClock, rebaseClock, rate]
    );

    const idleScrub = useSharedValue(-1);
    const scrubSource = scrubMs ?? idleScrub;
    const animatedScrubProps = useAnimatedProps(() => ({
      scrubPositionMs: scrubSource.value,
    }));

    const handleTimeUpdate = useCallback(
      ({ nativeEvent }: NativeEvent<{ positionMs: number; clipIndex: number; rate: number }>) => {
        nativeRateRef.current = nativeEvent.rate;
        writeClock(nativeEvent.positionMs, rate());
        onTimeUpdate?.({ positionMs: nativeEvent.positionMs, clipIndex: nativeEvent.clipIndex });
      },
      [writeClock, rate, onTimeUpdate]
    );

    return (
      <AnimatedTimelinePlayerView
        ref={nativeRef}
        animatedProps={animatedScrubProps}
        project={projectJson}
        paused={paused}
        loop={loop}
        volume={volume}
        timeUpdateIntervalMs={timeUpdateIntervalMs}
        onReady={onReady ? ({ nativeEvent }) => onReady(nativeEvent) : undefined}
        onTimeUpdate={handleTimeUpdate}
        onClipChanged={
          onClipChanged ? ({ nativeEvent }) => onClipChanged(nativeEvent.clipIndex) : undefined
        }
        onPlayEnd={onPlayEnd ? () => onPlayEnd() : undefined}
        onPlayerError={onError ? ({ nativeEvent }) => onError(nativeEvent.message) : undefined}
        style={style}
      />
    );
  }
);
