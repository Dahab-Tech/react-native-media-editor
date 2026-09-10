import { Skia, type SkImage, type Video } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import {
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
// runOnRuntime (not scheduleOnRuntime) keeps the react-native-worklets peer floor at 0.5.x for Expo 54.
import {
  createWorkletRuntime,
  runOnRuntime,
  scheduleOnRN,
  scheduleOnUI,
  type WorkletRuntime,
} from 'react-native-worklets';

// Replaces rn-skia useVideo: Android nextImage() reuses one HardwareBuffer — NEVER dispose frames manually; JS GC handles it.

// Lazy so sessions that never open color preview don't spin up a worklet runtime.
let videoRuntime: WorkletRuntime | null = null;
const getVideoRuntime = (): WorkletRuntime => {
  if (videoRuntime == null) {
    videoRuntime = createWorkletRuntime('media-editor-video-preview');
  }
  return videoRuntime;
};

// AVPlayer/MediaPlayer serialize seeks: a new seekToTime cancels the in-flight one (finished=NO, no frame delivered).
// Firing at 30 Hz means ~27/sec get cancelled and only the "last of the burst" produces a frame — the source of the
// ~3 fps symptom on iOS. Guard by tracking the in-flight target and coalescing writes until the previous lands.
// Landing is detected by video.currentTime() (last-decoded-frame timestamp) advancing past the pre-seek value.

// Same-frame tolerance: sub-frame seek deltas at 30 fps video are decoder no-ops. Anything within ~1 frame counts
// as "already there" so we don't wait for a currentTime change that will never come.
const SAME_FRAME_TOLERANCE_MS = 34;

// Release valve for the in-flight guard: a seek that never stamps a new currentTime (e.g. target clamped onto the
// frame we're already on at a loop edge) would otherwise wedge the guard shut and park every future seek forever.
const SEEK_LANDING_TIMEOUT_FRAMES = 20;

const requestSeek = (
  position: number,
  video: Video,
  inFlight: SharedValue<number | null>,
  pending: SharedValue<number | null>,
  frameTimeAtIssue: SharedValue<number>,
  stalledFrames: SharedValue<number>
) => {
  'worklet';
  if (inFlight.value != null) {
    pending.value = position;
    return;
  }
  const now = video.currentTime();
  if (Math.abs(now - position) <= SAME_FRAME_TOLERANCE_MS) return;
  inFlight.value = position;
  frameTimeAtIssue.value = now;
  stalledFrames.value = 0;
  video.seek(position);
};

const drainSeek = (
  video: Video,
  inFlight: SharedValue<number | null>,
  pending: SharedValue<number | null>,
  frameTimeAtIssue: SharedValue<number>,
  stalledFrames: SharedValue<number>
) => {
  'worklet';
  const target = inFlight.value;
  if (target == null) return;
  // Post-seek frames stamp a new currentTime (updated in onDisplayLink after copyPixelBuffer); until it advances,
  // the seek is still in flight and any new seekToTime call would cancel it (finished=NO, no frame delivered).
  const now = video.currentTime();
  if (now === frameTimeAtIssue.value) {
    stalledFrames.value += 1;
    if (stalledFrames.value < SEEK_LANDING_TIMEOUT_FRAMES) return;
  }
  stalledFrames.value = 0;
  const next = pending.value;
  if (next != null && next !== target && Math.abs(now - next) > SAME_FRAME_TOLERANCE_MS) {
    pending.value = null;
    inFlight.value = next;
    frameTimeAtIssue.value = now;
    video.seek(next);
  } else {
    pending.value = null;
    inFlight.value = null;
  }
};

const consumeSeek = (
  seekSv: SharedValue<number | null>,
  video: Video | null,
  inFlight: SharedValue<number | null>,
  pending: SharedValue<number | null>,
  frameTimeAtIssue: SharedValue<number>,
  stalledFrames: SharedValue<number>
) => {
  'worklet';
  const position = seekSv.value;
  if (position == null || video == null) return;
  seekSv.value = null;
  requestSeek(position, video, inFlight, pending, frameTimeAtIssue, stalledFrames);
};

export interface VideoPreviewFramesOptions {
  /** Playback paused flag. */
  paused: SharedValue<boolean>;
  /** Seek position in milliseconds (Skia.Video.seek unit on both platforms); consumed (reset to null) once applied. */
  seek: SharedValue<number | null>;
  /** Position (ms) the first published frame must come from. The decoder opens at t=0 of the file; without this, the pump publishes original frame 0 before the mount seek lands — a visible flash when t=0 is outside the trim range. Captured once at mount. */
  initialSeekMs?: number | null;
}

/** Decodes video frames for the Skia color-preview canvas; always muted and looping (primary player owns audio/timeline). */
export function useVideoPreviewFrames(
  source: string,
  { paused, seek, initialSeekMs }: VideoPreviewFramesOptions
) {
  const [video, setVideo] = useState<Video | null>(null);
  useEffect(() => {
    const load = (src: string) => {
      'worklet';
      const vid = Skia.Video(src) as Video;
      scheduleOnRN(setVideo, vid);
    };
    runOnRuntime(getVideoRuntime(), load)(source);
  }, [source]);

  const duration = useMemo(() => video?.duration() ?? 0, [video]);
  const size = useMemo(() => video?.size() ?? { width: 0, height: 0 }, [video]);
  const rotation = useMemo(() => video?.rotation() ?? 0, [video]);

  const currentFrame = useSharedValue<SkImage | null>(null);
  // Target of the seek issued to the decoder but not yet landed (null when idle) — coalescing key for the in-flight guard.
  const inFlightSeekMs = useSharedValue<number | null>(null);
  // Latest requested target while a seek is in flight; drained onto the decoder once the in-flight one lands.
  const pendingSeekMs = useSharedValue<number | null>(null);
  // Snapshot of currentTime() taken when the in-flight seek was issued; a new value proves the seek landed.
  const frameTimeAtSeekIssue = useSharedValue<number>(0);
  // Pump frames spent waiting on the in-flight seek; feeds the landing-timeout release valve.
  const seekStalledFrames = useSharedValue<number>(0);
  // Mount-time seek target, captured on first render (useSharedValue ignores later initial values).
  const initialSeekTarget = useSharedValue<number | null>(initialSeekMs ?? null);
  const initialSeekIssued = useSharedValue(false);
  // Publication gate: closed until the mount-time seek settles so pre-seek frames (t=0 of the file) never paint.
  const framePublished = useSharedValue(false);

  // 60 Hz pump: emit newest decoded frame; also drain the coalesced seek queue when the in-flight seek lands so the
  // next rate-sync target reaches the decoder instead of getting cancelled mid-flight (the AVPlayer 3-fps trap).
  useFrameCallback(() => {
    'worklet';
    if (!video) return;
    if (!initialSeekIssued.value) {
      initialSeekIssued.value = true;
      const target = initialSeekTarget.value;
      if (target != null) {
        requestSeek(
          target,
          video,
          inFlightSeekMs,
          pendingSeekMs,
          frameTimeAtSeekIssue,
          seekStalledFrames
        );
      }
    }
    const img = video.nextImage();
    drainSeek(video, inFlightSeekMs, pendingSeekMs, frameTimeAtSeekIssue, seekStalledFrames);
    if (img) {
      if (framePublished.value) {
        currentFrame.value = img;
      } else if (inFlightSeekMs.value == null && pendingSeekMs.value == null) {
        // Initial seek landed (or no-op'd / hit the stall valve) — open the gate for good.
        framePublished.value = true;
        currentFrame.value = img;
      }
    }
  }, true);

  useAnimatedReaction(
    () => paused.value,
    (isPaused) => {
      if (isPaused) {
        video?.pause();
      } else {
        video?.play();
      }
    },
    [video]
  );

  useAnimatedReaction(
    () => seek.value,
    () =>
      consumeSeek(
        seek,
        video,
        inFlightSeekMs,
        pendingSeekMs,
        frameTimeAtSeekIssue,
        seekStalledFrames
      ),
    [video]
  );

  useEffect(() => {
    if (!video) return;
    // Android Skia.Video owns a real MediaPlayer — any volume >0 double-plays audio over the primary player.
    video.setVolume(0);
    video.setLooping(true);
    if (paused.value) {
      video.pause();
    } else {
      video.play();
    }
    return () => {
      scheduleOnUI((v: Video) => {
        'worklet';
        v.dispose();
      }, video);
    };
  }, [video, paused]);

  return { currentFrame, duration, size, rotation };
}
