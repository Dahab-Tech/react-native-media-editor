# @dahab-tech/react-native-media-editor

The **React Native photo & video editor SDK** for Expo — customizable, RTL-first, free and MIT-licensed.

→ Full docs & demo at [dahab-tech.com/apps/react-native-media-editor](https://dahab-tech.com/apps/react-native-media-editor)

- **Photo**: crop with straighten dial + aspect presets, 15 adjustments, 64 built-in filters, overlays, selective focus (radial + linear tilt-shift), draw (4 brushes), text with per-line pill backgrounds, stickers/emoji, multi-photo batch, full-resolution export.
- **Video**: trim (lossless passthrough), crop, cover selection, filters + adjustments with live preview, playback speed (audio retimed), text/sticker/draw layers burned into export, opt-in compression — powered by AVFoundation (iOS) and Media3 Transformer (Android). No FFmpeg.
- **RTL & i18n**: English and Arabic built in, custom strings supported, per-editor direction control (no global `I18nManager` reliance).
- **Theming**: light + dark themes, fully overridable colors/spacing/radius.

## Installation

```sh
npx expo install @dahab-tech/react-native-media-editor
```

That's it — no config plugin required. Autolinking picks up the native module.

Requires a development build (Expo Go is not supported because the package contains native code):

```sh
npx expo run:ios   # or run:android
```

### Optional peer dependencies

Only install what you use:

| Feature | Extra dependencies |
| --- | --- |
| `PhotoEditor` component | `npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets react-native-gesture-handler react-native-safe-area-context @expo/vector-icons expo-font` |
| `VideoEditor` component | `npx expo install @shopify/react-native-skia expo-video react-native-reanimated react-native-worklets react-native-gesture-handler react-native-safe-area-context @expo/vector-icons expo-font` |
| Functional video API (`trimVideo`, `getVideoThumbnail`, `getVideoInfo`) | none |

Both editors need `@shopify/react-native-skia` — the video editor renders its effects preview and text/sticker overlays with Skia too. Both editors also require `react-native-reanimated` **v4 or later** with `react-native-worklets` alongside it (Reanimated 4 moved the worklet-core APIs out into `react-native-worklets`); Expo SDK 54+ templates install both by default. On Android, `VideoEditor` requires `minSdkVersion` 26+ (Skia's video decoder is compiled against your app's minSdk and throws below 26 — on every device, regardless of OS version). With Expo, set it via [`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/): `"android": { "minSdkVersion": 26 }`. The default Expo (expo-router) template already includes `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-safe-area-context`, `@expo/vector-icons`, and `expo-font` — in that case only `@shopify/react-native-skia` and/or `expo-video` are new. If Metro fails with `Unable to resolve module <package>`, that peer is missing: run the matching install line above and rebuild your development build.

## Usage

### Video editor (trim, crop, cover, filters, adjustments, speed, text/sticker/draw layers)

```tsx
import { VideoEditor } from '@dahab-tech/react-native-media-editor/videoEditor';

<VideoEditor
  source={videoUri}
  onCancel={() => {}}
  onExport={(result) => console.log(result.uri, result.durationMs)}
  // Fires when the user picks a cover; defaults to the exported video's first frame otherwise.
  onCoverSelected={(cover) => console.log(cover.uri)}
  onError={(error) => console.warn(error)}
/>
```

### Functional video API (no UI, no extra dependencies)

```ts
import {
  getVideoInfo,
  getVideoThumbnail,
  trimVideo,
} from '@dahab-tech/react-native-media-editor';

const info = await getVideoInfo(videoUri);
// { durationMs, width, height, rotation, fps } — display dimensions, rotation applied

const trimmed = await trimVideo(videoUri, { startMs: 1000, endMs: 6000 });
// { uri, durationMs } — lossless passthrough when the source allows it

const cropped = await trimVideo(videoUri, {
  startMs: 1000,
  endMs: 6000,
  crop: { x: 100, y: 50, width: 640, height: 360 }, // display-space pixels; forces re-encode
});

const compressed = await trimVideo(videoUri, {
  startMs: 0,
  endMs: 30_000,
  compression: { preset: 'medium', maxDimension: 1080 }, // presence forces re-encode
});
// `compression.preset` = 'high' | 'medium' | 'low' (bpp/frame heuristic on OUTPUT dims)
// `compression.maxDimension` caps the long edge post-crop; never upscales
// `compression.bitrateMbps` overrides `preset` when you need an exact target

const cover = await getVideoThumbnail(videoUri, {
  timeMs: 2500,
  quality: 0.9,
  maxWidth: 720,
});
// { uri, width, height }
```

### Photo editor

```tsx
import { PhotoEditor } from '@dahab-tech/react-native-media-editor/photoEditor';

<PhotoEditor
  source={photoUri}
  onCancel={() => {}}
  onExport={(result) => console.log(result.width, result.height)} // result.base64 = JPEG
  exportQuality={90}
/>
```

Built-in tools: **Crop** (free/1:1/4:3/16:9/9:16 aspect presets, straighten dial, 90° rotate, flip), **Adjust** (15 parameters including brightness, contrast, saturation, exposure, highlights/shadows, temperature/tint, sharpen, structure, vignette), **Filters** (64 built-in presets with live previews), **Overlays** (Light + Mood packs), **Focus** (radial + linear tilt-shift), **Draw** (4 brushes), **Text** (draggable overlays with color, font, alignment, and per-line pill backgrounds), and **Stickers/emoji**. Multi-photo batch mode is supported. Export renders at the image's intrinsic resolution, not the screen size.

## RTL & localization

English and Arabic ship built in. Pass `locale` to switch, or provide your own strings:

```tsx
<VideoEditor source={uri} locale="ar" />

<VideoEditor
  source={uri}
  locale="fr"
  strings={{ cancel: 'Annuler', export: 'Exporter' /* ... */ }}
  direction="auto" // 'ltr' | 'rtl' | 'auto' (default: from locale, then I18nManager)
/>
```

Layout direction is resolved per editor: explicit `direction` prop → locale script → `I18nManager`. The trim timeline intentionally stays LTR in RTL locales, matching platform media conventions.

## Theming

```tsx
<VideoEditor
  source={uri}
  theme={{ colors: { accent: '#FF375F', background: '#000000' } }}
/>
```

Any subset of `colors`, `spacing`, and `radius` can be overridden; the rest falls back to the default dark theme.

## Output files

Trimmed videos and thumbnails are written to the app's cache directory (`caches/MediaEditor/`). Move them somewhere permanent (e.g. with `expo-file-system`) if you need them to survive cache eviction.

## Example app

See [`example/`](./example) for a working demo with a video picker, photo picker, and an English/Arabic RTL toggle.

## License

MIT © DahabTech LLC
