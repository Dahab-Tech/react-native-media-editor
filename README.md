# @dahab-tech/react-native-media-editor

The **React Native photo & video editor SDK** for Expo — customizable, RTL-first, free and MIT-licensed.

→ Full docs & demo at [dahab-tech.com/apps/react-native-media-editor](https://dahab-tech.com/apps/react-native-media-editor)

- **Photo**: crop with straighten dial + aspect presets, 15 adjustments, 64 built-in filters, overlays, selective focus (radial + linear tilt-shift), draw (4 brushes), text with per-line pill backgrounds, stickers/emoji, multi-photo batch, full-resolution export.
- **Video**: trim (lossless passthrough), crop, cover selection, filters + adjustments with live preview, playback speed (audio retimed), text/sticker/draw layers burned into export, opt-in compression — powered by AVFoundation (iOS) and Media3 Transformer (Android). No FFmpeg.
- **RTL & i18n**: English and Arabic built in, custom strings supported, per-editor direction control (no global `I18nManager` reliance).
- **Theming**: light + dark themes, fully overridable colors/spacing/radius.

## Platform support

The editor is built for both Android and iOS using native media frameworks for video processing.

| Feature                             | Android | iOS |
| ----------------------------------- | :-----: | :-: |
| Photo editing                       |    ✅    |  ✅  |
| Crop & straighten                   |    ✅    |  ✅  |
| Adjustments                         |    ✅    |  ✅  |
| Filters                             |    ✅    |  ✅  |
| Overlays                            |    ✅    |  ✅  |
| Selective focus                     |    ✅    |  ✅  |
| Drawing                             |    ✅    |  ✅  |
| Text & stickers                     |    ✅    |  ✅  |
| Multi-photo editing                 |    ✅    |  ✅  |
| Full-resolution photo export        |    ✅    |  ✅  |
| Video trimming                      |    ✅    |  ✅  |
| Video cropping                      |    ✅    |  ✅  |
| Video cover selection               |    ✅    |  ✅  |
| Video filters & adjustments         |    ✅    |  ✅  |
| Playback speed                      |    ✅    |  ✅  |
| Video text/sticker/drawing overlays |    ✅    |  ✅  |
| Video compression                   |    ✅    |  ✅  |
| Video information                   |    ✅    |  ✅  |
| Video thumbnails                    |    ✅    |  ✅  |

### Native architecture

The package provides a React Native / Expo API while keeping media processing in the native platform layer.

```text
React Native / Expo
        │
        ▼
@dahab-tech/react-native-media-editor
        │
        ├── Photo Editor
        │
        └── Video Editor
                │
        ┌───────┴────────┐
        ▼                ▼
     Android             iOS
        │                │
        ▼                ▼
   Media3 Transformer  AVFoundation
```

Video processing is performed by the native media frameworks rather than by JavaScript.

* **Android:** AndroidX Media3 Transformer
* **iOS:** AVFoundation and related Apple media frameworks
* **JavaScript/TypeScript:** editor UI, configuration, and public APIs

The package does **not** use FFmpeg for video processing.

This architecture allows the editor to use the media capabilities provided by each platform while keeping the React Native API consistent across Android and iOS.

## Installation

```sh
npx expo install @dahab-tech/react-native-media-editor
```

Autolinking picks up the native module, and `expo install` auto-adds the SDK's config plugin to your `app.json` (only matters for `VideoEditor` on Android — see below).

Requires a development build (Expo Go is not supported because the package contains native code):

```sh
npx expo run:ios   # or run:android
```
## Requirements

The editor uses native modules and therefore requires a development build. It is not supported in Expo Go.

### React Native / Expo

* Expo development build or a native React Native application
* React Native Reanimated **v4+**
* `react-native-worklets`
* `@shopify/react-native-skia`
* `react-native-gesture-handler`
* `react-native-safe-area-context`

Additional dependencies are required depending on which editor is used. See the installation section above for the complete peer dependency list.

### Android

The Android VideoEditor requires:

* `minSdkVersion 26+`

The Expo config plugin automatically raises the Android minimum SDK when required.

For bare React Native projects, make sure the Android project uses:

```properties
android.minSdkVersion=26
```

### Video editor

The VideoEditor additionally uses:

* `expo-video`

The functional video APIs such as `getVideoInfo`, `getVideoThumbnail`, and `trimVideo` can be used without mounting the `VideoEditor` component itself.


### Optional peer dependencies

Only install what you use:

| Feature | Extra dependencies |
| --- | --- |
| `PhotoEditor` component | `npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets react-native-gesture-handler react-native-safe-area-context @expo/vector-icons expo-font` |
| `VideoEditor` component | `npx expo install @shopify/react-native-skia expo-video react-native-reanimated react-native-worklets react-native-gesture-handler react-native-safe-area-context @expo/vector-icons expo-font` |
| Functional video API (`trimVideo`, `getVideoThumbnail`, `getVideoInfo`) | none |

Both editors need `@shopify/react-native-skia` (the video editor renders its effects preview and overlays with Skia too) and `react-native-reanimated` **v4+** with `react-native-worklets`. On Android, `VideoEditor` requires `minSdkVersion` 26+ — Skia's video decoder throws below 26 on every device. The SDK's config plugin raises it for you; `npx expo install` adds it automatically, or add it yourself:

```json
{
  "expo": {
    "plugins": ["@dahab-tech/react-native-media-editor"]
  }
}
```

The plugin is raise-only — it never lowers a `minSdkVersion` you've set higher — and photo-only apps can skip it. Bare React Native projects set `android.minSdkVersion=26` in `android/gradle.properties` manually. The default Expo template already ships most peers, so usually only `@shopify/react-native-skia` and/or `expo-video` are new. A Metro `Unable to resolve module <package>` error means that peer is missing: install it and rebuild your development build.

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

## Video processing

Video operations are performed natively using the media framework provided by the operating system.

### Processing vs. re-encoding

Not every video operation requires the same type of processing.

| Operation        | Processing                                                      |
| ---------------- | --------------------------------------------------------------- |
| Trim             | Lossless/pass-through when supported by the requested operation |
| Crop             | Re-encoding required                                            |
| Compression      | Re-encoding required                                            |
| Filters          | Re-encoding required                                            |
| Adjustments      | Re-encoding required                                            |
| Text overlays    | Re-encoding required                                            |
| Sticker overlays | Re-encoding required                                            |
| Drawing overlays | Re-encoding required                                            |
| Playback speed   | Re-encoding may be required depending on the operation          |

A trim operation can preserve the original encoded media when the requested operation allows it. Operations that modify video pixels, such as cropping, filters, adjustments, or burned-in overlays, require the video to be processed and re-encoded.

### Native processing

The implementation uses the native media stack on each platform:

* **Android:** Media3 Transformer
* **iOS:** AVFoundation

No FFmpeg runtime is required by the editor.

Because encoding is performed by the native platform, the codecs and export capabilities available to an individual device or operating-system version can affect the final output.

### Input and output formats

The ability to read or play a media format does not necessarily mean that the same format can be exported.

Input support and export support depend on the native media framework and the codecs available on the target platform.

For this reason, applications should treat the exported file format and codec as an implementation detail of the native export pipeline rather than assuming that every input format can be exported unchanged.

## Functional video API

The package also exposes functional APIs for working with videos without rendering the full `VideoEditor` UI.

| API                   | Description                                                 | Re-encoding        |
| --------------------- | ----------------------------------------------------------- | ------------------ |
| `getVideoInfo()`      | Reads metadata and information about a video                | No                 |
| `getVideoThumbnail()` | Generates a thumbnail from a video at a requested timestamp | No                 |
| `trimVideo()`         | Trims a video and can optionally crop or compress it        | Depends on options |

### `getVideoInfo()`

Reads information about a video, such as its dimensions, duration, and media metadata.

### `getVideoThumbnail()`

Generates a thumbnail from a selected point in the video.

The API supports options such as:

* timestamp
* output quality
* maximum width

### `trimVideo()`

Trims a video and can optionally apply:

* crop
* compression

A basic trim can use the native pass-through/lossless path when possible.

Crop and compression require re-encoding because the video data itself must be modified.


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

Edited media and generated thumbnails are written to:

```text
caches/MediaEditor/
```

These files are stored in the application's cache directory.

If an exported video or photo needs to be retained permanently or shared outside the application's temporary workflow, copy or move the resulting file to an appropriate persistent location.

Applications should not assume that files in the cache directory will remain available indefinitely, because the operating system may remove cached data when storage needs to be reclaimed.

## Known limitations

The following are important implementation details to keep in mind when integrating the editor:

* **Expo Go is not supported.** The package contains native code and requires a development build or a native React Native application.
* **Android VideoEditor requires `minSdkVersion 26+`.**
* **Video crop requires re-encoding** because the video pixels and output dimensions must be changed.
* **Video compression requires re-encoding.**
* **Video filters, adjustments, and burned-in overlays require video processing and re-encoding.**
* **Export capabilities depend on the native platform.** A codec or container that can be read on a device is not necessarily available for export.
* **Hardware acceleration is platform-dependent.** Actual encoding/decoding performance depends on the device, operating-system version, and available hardware codecs.
* **Video processing uses native platform frameworks rather than FFmpeg.**
* **Generated media files are stored in the application's cache directory** and should be copied to a persistent location if they need to survive cache cleanup.
* **Large or high-resolution videos can require significant processing time and temporary storage**, particularly when re-encoding is required.

## Example app

See [`example/`](./example) for a working demo with a video picker, photo picker, and an English/Arabic RTL toggle.

## License

MIT © DahabTech LLC
