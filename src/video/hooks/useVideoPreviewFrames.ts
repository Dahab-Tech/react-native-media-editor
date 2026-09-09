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

const consumeSeek = (seekSv: SharedValue<number | null>, video: Video | null) => {
  'worklet';
  const position = seekSv.value;
  // With no video yet, leave the value; the reaction re-fires once video loads and consumes it.
  if (position !== null && video != null) {
    video.seek(position);
    seekSv.value = null;
  }
};

export interface VideoPreviewFramesOptions {
  /** Playback paused flag. */
  paused: SharedValue<boolean>;
  /** Seek position in milliseconds (Skia.Video.seek unit on both platforms); consumed (reset to null) once applied. */
  seek: SharedValue<number | null>;
}

/** Decodes video frames for the Skia color-preview canvas; always muted and looping (primary player owns audio/timeline). */
export function useVideoPreviewFrames(source: string, { paused, seek }: VideoPreviewFramesOptions) {
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
  // Pump every display frame even while paused: Android decoder converges over several nextImage() calls; gating freezes on garbage.
  useFrameCallback(() => {
    'worklet';
    if (!video) return;
    const img = video.nextImage();
    if (img) {
      currentFrame.value = img;
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
    () => consumeSeek(seek, video),
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
