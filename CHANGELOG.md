# Changelog

All notable changes to `@dahab-tech/react-native-media-editor` follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semver.

## [Unreleased]

## [0.2.0] — 2026-09-06
### Added
- **Video compression**: opt-in `compression` option on `trimVideo` and `<VideoEditor>` (`preset: 'high' | 'medium' | 'low'`, `maxDimension`, `bitrateMbps`). Presence forces a re-encode; omitted keeps the existing lossless-passthrough behavior. iOS uses an AVAssetReader/AVAssetWriter H.264 pipeline; Android uses Media3 `DefaultEncoderFactory` + `Presentation` for the long-edge cap. Audio re-encodes to AAC 128 kbps.
- Photo crop tool: confirm (✓) action in the crop panel to apply the session and close the tool.

### Fixed
- Video editor: the trim bar no longer renders underneath other tools' panels — it also intercepted touches, making the effects samples strip and intensity slider untappable.
- Video editor: the play/pause button now clears the collapsed panel strip instead of sitting partially behind it.
- Video crop: panning the video under the crop window no longer moves in the inverted direction.
- Video color preview: rotated source videos now render with the correct orientation (Skia decodes unrotated frames; the display rotation is applied explicitly).

### Docs
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
