# Changelog

All notable changes to `@dahab-tech/react-native-media-editor` follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semver.

## [0.3.1] — 2026-09-09
### Added
- Expo config plugin: raises `android.minSdkVersion` to 26, required by `VideoEditor` (Skia's video decoder throws below 26). `npx expo install` adds it to `app.json` automatically; raise-only — never lowers a higher value — and photo-only apps can skip it.

## [0.3.0] — 2026-09-09
### Changed
- Peer floor raised: `react-native-reanimated` is now `>=4.1.0` and `react-native-worklets` is a new peer (`>=0.5.0`, optional in `peerDependenciesMeta` to mirror Reanimated). Reanimated 4 moved the worklet-core APIs (`runOnJS`, `runOnUI`, `createWorkletRuntime`, `runOnRuntime`, `WorkletRuntime`) into `react-native-worklets` and deprecated its own re-exports (removal slated for v5), so the SDK imports them from `react-native-worklets` directly — `scheduleOnRN` / `scheduleOnUI` plus curried `runOnRuntime` (its `scheduleOnRuntime` replacement needs worklets 0.6, which would exclude Expo 54's 0.5.x pin). Floors are the oldest pairing that ships every API used: Reanimated 4.0 pairs with worklets 0.4.x, which predates `scheduleOnRN`. Expo SDK 54+ templates install both peers by default.
- Perf: drag gestures (intensity/adjust sliders, trim handles, cover scrub) now dispatch at most one update per frame. Android touch sampling outpaces render, so every extra event was rebuilding the Skia LUT filter (photo) or seeking the native player (video) for nothing; the final value still commits exactly on release.
- Perf: trim handles now track the finger from local state and commit to the editor once at release. Each touch sample previously round-tripped through the parent editor's state, re-rendering the player, panels, and thumbnail strip per frame — the visible "handle lags behind the finger" on mid-range Android.
- Perf: brush strokes now draw in an isolated Skia canvas inside the draw overlay, so per-point moves re-render only that leaf instead of the whole editor (toolbar, panels, full-res photo render). The eraser still composites live against committed strokes, and a stroke still commits as one undo entry.
- Perf: multi-photo batch export no longer retains every exported photo's base64 payload in memory for the whole session when `includeBase64` is on. Results are cached by file URI and the base64 is read back from disk only at final delivery — a batch of N photos previously held N full-resolution encoded strings until the last export (OOM risk on low-end Android).

### Fixed
- Android: filters and adjustments now show in the video color preview on real devices. `@shopify/react-native-skia`'s `useVideo` (2.6.x) disposes every Android frame right after publishing it (a leftover from a removed frame-copy), so the graded canvas drew transparent and the ungraded player showed through. The preview now uses an internal frame hook on the public `Skia.Video` API that never disposes frames manually — Android's decoder hands back the same `HardwareBuffer` in consecutive frames (while paused, and while playing whenever display Hz outpaces the decoder), so any eager dispose can destroy the on-screen frame's backing store. Wrappers are GC-reclaimed, and the pump runs every display frame even while paused — the Android decoder needs several pulls to converge after a seek/flush. No library patch required.
- Video preview: scrubbing the trim handles or cover picker now decodes frames live on Android — frame-by-frame like iOS. A dedicated warm `MediaCodec` pipeline (bespoke, not `expo-video`'s player) is created for the drag session and renders straight to a `TextureView`; the decoder is never torn down between seeks, so successive targets skip GOP re-decodes. Latest-wins on the native side: stale targets are overwritten atomically, forward targets drain existing output buffers (dropping frames until the target's presentation time is hit) with no flush, backward or far-forward jumps flush and re-seek to the previous sync sample. The pre-extracted image-strip preview from 0.2.x remains as an automatic fallback for devices that can't allocate a second hardware decoder while the player is holding one (or for any fatal decoder error) — JS transparently swaps to it and never comes back for the session. The player underneath still follows with throttled frame-exact seeks (invisible until release) and settles precisely on the released frame. iOS watches the player live throughout the drag — exact seeks are cheap on AVFoundation.
- Video color preview: scrubbing the trim handles or cover picker now seeks the graded preview to the correct position — `Skia.Video.seek` takes milliseconds on both platforms and the preview was passing seconds, landing every scrub near 0:00.
- Both editors: opening an editor no longer flashes content under the status/nav bars for a frame. The SDK's nested `SafeAreaProvider` re-measured insets asynchronously on Fabric (zero insets on the first frame); when the host app already has a provider, its measured insets are now reused, and the video editor pads via `useSafeAreaInsets()` instead of the native `SafeAreaView` (which re-measures after first paint on Android).
- Video editor: picking a cover no longer resets the trim range. The video-info seed effect re-ran whenever the consumer component re-rendered (its `onError` callback prop is usually an inline arrow, so its identity changes every render) and re-seeded the range to the full duration; the effect now runs only when `source` changes.
- Text editor: typing on the first line no longer flashes a mis-wrapped frame per keystroke. The multiline input auto-sized to its content, so each insert changed its width one frame after the text itself (Android splits text mutation and re-measure across frames) — the new character briefly wrapped alone before the width caught up. The input now stretches to a fixed width and `textAlign` positions the glyphs.
- Android: swiping from a screen edge (e.g. grabbing a trim handle or slider near the edge) triggered the system back gesture and backgrounded the app mid-edit. Both editors now consume Android back events while open — exiting stays on the explicit close action — and the trim bar + cover-picker strips are inset 30dp on Android so their handles at 0%/100% sit clear of the gesture strip (iOS layout unchanged).
- iOS: trimming with `compression` enabled produced a file with the source's full duration — the trimmed-off prefix played as black and the default cover captured inside that dead zone. The writer session now starts at the trim-in point so the output begins at the first kept frame.
- Android: speed edits now retime the audio track too. The previous video-only `SpeedChangeEffect` left audio at 1× — desynced audio and mismatched track lengths on any source with sound (now `EditedMediaItem.setSpeed`, which drives both tracks).
- Android: the compression bitrate heuristic now reads the real playback frame rate from the track format. It previously read the capture-rate metadata, which is absent on most files and 120/240 on slo-mo clips — inflating the requested bitrate up to 8×.
- Android: the text editor's controls (colors, fonts, alignment) were hidden under the keyboard in both editors. Edge-to-edge (default since Expo 53) stops the window from resizing for the keyboard, so the control dock now keyboard-avoids via padding on Android too.
- Android: multi-select header chevrons sat off the counter's baseline (they were raw `›` text glyphs, whose font metrics differ per platform) — now vector icons like the rest of the header.
- Android: a one-frame safe-area "twitch" when advancing to the next photo in multi-select — the batch shell remounts the editor screen and the native `SafeAreaView` re-measures its insets after first paint. The screen now pads via `useSafeAreaInsets()`, which applies on the first frame.
- Android: with a pill background active, edit-mode text wrapped at different points than its measured pills (the native input and the measuring mirror used different line-breakers and widths) and the first line clipped at the top. The input now matches the mirror's break strategy, drops the EditText intrinsic padding, and disables Android font padding; committed text layers get the same font-padding fix.

### Docs
- README: documented that `VideoEditor` on Android requires `minSdkVersion` 26+ — `@shopify/react-native-skia` compiles its video decoder against the app's minSdk and throws `Skia Videos are only support on API 26 and above` below that, on every device regardless of OS version. The example app now sets it via `android.minSdkVersion=26`.

## [0.2.0] — 2026-09-06
### Added
- **Video compression**: opt-in `compression` option on `trimVideo` and `<VideoEditor>` (`preset: 'high' | 'medium' | 'low'`, `maxDimension`, `bitrateMbps`). Presence forces a re-encode; omitted keeps the existing lossless-passthrough behavior. iOS uses an AVAssetReader/AVAssetWriter H.264 pipeline; Android uses Media3 `DefaultEncoderFactory` + `Presentation` for the long-edge cap. Audio re-encodes to AAC 128 kbps.
- Photo crop tool: confirm (✓) action in the crop panel to apply the session and close the tool.

### Fixed
- Video editor: the trim bar no longer renders underneath other tools' panels — it also intercepted touches, making the effects samples strip and intensity slider untappable.
- Video effects panel: touches landed offset from the visuals (the panel resized mid slide-in animation once its poster loaded), so taps hit the wrong item and the intensity slider wouldn't move. The poster is now prefetched and panels fade in instead of sliding.
- Video color preview: the Skia preview decoder no longer runs while no filter/adjustment is active — it decoded continuously on the UI thread, draining battery and delaying touch delivery.
- Android: thumbnail generation now recycles its bitmaps, fixing a native memory leak (including on error paths).
- Video editor: the play/pause button now clears the collapsed panel strip instead of sitting partially behind it.
- Video crop: panning the video under the crop window no longer moves in the inverted direction.
- Video color preview: rotated source videos now render with the correct orientation (Skia decodes unrotated frames; the display rotation is applied explicitly).

### Docs
- README: the `VideoEditor` install line now includes `@shopify/react-native-skia` (required since V2 effects), and both editor rows list `@expo/vector-icons` + `expo-font`.
- README: corrected the optional peer dependency table — both editors also need `react-native-reanimated` and `react-native-gesture-handler`; added a note that the default Expo template already includes most peers, plus a Metro "Unable to resolve module" troubleshooting pointer.

## [0.1.0] — 2026-08-24
### Added
- Initial public release.
- **Photo editor**: crop with straighten dial + aspect presets, 15 adjustments, 64 built-in filter packs (8×8), overlays (Light + Mood packs), selective focus (radial + linear tilt-shift), draw with 4 brushes, layers (text + stickers), full-resolution JPEG export.
- **Video editor**: lossless trim (passthrough), crop with re-encode, cover/thumbnail selection.
- **RTL**: English + Arabic built-in, custom strings via context, per-editor direction control (no global `I18nManager` reliance).
- **Theming**: light + dark themes with DahabTech brand accents (blue #1C5E83 on light, yellow #FFCE0A on dark), fully overridable.
- **Tools API**: `tools?: readonly PhotoToolId[]` allowlist for filtering + reordering PhotoEditor tabs.
- **AI**: separate opt-in package `@dahab-tech/media-editor-ai` for on-device background removal + cutout-to-sticker (iOS Vision / Android ML Kit).
