# @dahab-tech/react-native-media-editor

The **React Native photo & video editor SDK** for Expo — customizable, RTL-first, IMG.LY alternative.

→ Full docs & demo at [dahab-tech.com/apps/media-editor](https://dahab-tech.com/apps/media-editor)

- **Video**: lossless trim (passthrough export), crop, cover/thumbnail selection, video metadata — powered by AVFoundation (iOS) and Media3 Transformer (Android). No FFmpeg.
- **Photo**: Skia-based editor with crop/rotate/flip, brightness/contrast/saturation adjustments, filter presets, text overlays, and full-resolution JPEG export.
- **RTL & i18n**: English and Arabic built in, custom strings supported, per-editor direction control (no global `I18nManager` reliance).
- **Theming**: dark theme by default, fully overridable colors/spacing/radius.

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

| Feature | Extra dependency |
| --- | --- |
| `PhotoEditor` component | `npx expo install @shopify/react-native-skia react-native-safe-area-context` |
| `VideoEditor` component | `npx expo install expo-video react-native-safe-area-context` |
| Functional video API (`trimVideo`, `getVideoThumbnail`, `getVideoInfo`) | none |

## Usage

### Video editor (trim + crop + cover selection)

```tsx
import { VideoEditor } from '@dahab-tech/react-native-media-editor/videoEditor';

<VideoEditor
  source={videoUri}
  onCancel={() => {}}
  onExport={(result) => console.log(result.uri, result.durationMs)}
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

Built-in tools: **Crop** (free/1:1/4:3/16:9/9:16 aspect presets, 90° rotate, flip), **Adjust** (brightness, contrast, saturation), **Filters** (Original, Mono, Sepia, Vivid, Warm, Cool, Fade with live previews), and **Text** (draggable overlays with color and scale controls). Export renders at the image's intrinsic resolution, not the screen size.

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
