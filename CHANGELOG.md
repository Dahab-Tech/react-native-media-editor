# Changelog

All notable changes to `@dahab-tech/react-native-media-editor` follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semver.

## [Unreleased]

## [0.1.0] — 2026-08-24
### Added
- Initial public release.
- **Photo editor**: crop with straighten dial + aspect presets, 15 adjustments, 64 built-in filter packs (8×8), overlays (Light + Mood packs), selective focus (radial + linear tilt-shift), draw with 4 brushes, layers (text + stickers), full-resolution JPEG export.
- **Video editor**: lossless trim (passthrough), crop with re-encode, cover/thumbnail selection.
- **RTL**: English + Arabic built-in, custom strings via context, per-editor direction control (no global `I18nManager` reliance).
- **Theming**: light + dark themes with DahabTech brand accents (blue #1C5E83 on light, yellow #FFCE0A on dark), fully overridable.
- **Tools API**: `tools?: readonly PhotoToolId[]` allowlist for filtering + reordering PhotoEditor tabs.
- **AI**: separate opt-in package `@dahab-tech/media-editor-ai` for on-device background removal + cutout-to-sticker (iOS Vision / Android ML Kit).
