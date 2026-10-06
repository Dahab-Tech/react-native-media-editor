# Media Editor Example

This directory contains the **Expo example application** for [`@dahab-tech/react-native-media-editor`](https://github.com/Dahab-Tech/react-native-media-editor).

It demonstrates how to integrate and use the media editor SDK in a real React Native + Expo application, including photo editing, video editing, editor configuration, theming, localization, and the functional video APIs.

> This is an **Expo development-build example**, not a bare React Native application.

## Requirements

* Node.js
* npm
* Expo CLI
* Android Studio and an Android device/emulator for Android development
* Xcode and an iOS device/simulator for iOS development
* A development build is required because the media editor contains native modules.

### Current example stack

The example currently uses:

* Expo SDK 57
* React Native 0.86
* React 19
* React Native Skia
* React Native Reanimated
* React Native Worklets
* React Native Gesture Handler
* Expo Video
* Expo Image Picker
* Expo File System
* Expo Font

See `package.json` for the exact dependency versions.

## Project Structure

```text
example/
├── App.tsx
├── ConfigPanel.tsx
├── editorConfig.ts
├── index.ts
├── app.json
├── babel.config.js
├── metro.config.js
├── assets/
└── package.json
```

### Important files

#### `App.tsx`

The main example application.

It demonstrates the media editor UI and how the editor components and APIs can be used from a React Native application.

#### `ConfigPanel.tsx`

Provides controls for experimenting with editor configuration and different SDK options.

#### `editorConfig.ts`

Contains the editor configuration used by the example.

This makes it easier to test different editor settings without changing the main application component.

#### `app.json`

Contains the Expo application configuration, including native configuration required by the example.

#### `metro.config.js`

Contains the Metro configuration required for developing the example together with the local media editor package.

## Installation

From the repository root:

```bash
cd example
npm install
```

The example references the local media editor package directly:

```json
"@dahab-tech/react-native-media-editor": "file:.."
```

This allows the example to run against the current source code of the SDK instead of a published npm version.

## Start the Development Server

Run:

```bash
npm start
```

or:

```bash
npx expo start
```

This starts the Expo development server.

Because the media editor contains native functionality, **Expo Go is not supported** for this example.

You need to use a development build.

## Android

To build and run the example on Android:

```bash
npm run android
```

This runs:

```bash
expo run:android
```

The first build may take some time because the native Android project and dependencies need to be compiled.

After the development build is installed, Metro can be used for JavaScript/TypeScript development.

### Android production build

To test a release build:

```bash
npm run android-production
```

This runs:

```bash
npx expo run:android --variant release --device
```

## iOS

To build and run the example on iOS:

```bash
npm run ios
```

This runs:

```bash
expo run:ios
```

A macOS environment with Xcode is required for iOS native development.

### iOS production build

To test a release configuration:

```bash
npm run ios-production
```

This runs:

```bash
npx expo run:ios --configuration Release --device
```

## Web

The example also contains an Expo web script:

```bash
npm run web
```

However, the media editor's native video/photo editing functionality is designed for native Android and iOS environments. Web support should therefore not be considered equivalent to the native example.

## What This Example Demonstrates

The example application is intended to provide a practical reference for using the SDK.

### Photo Editor

The example can be used to explore the photo editing functionality provided by the SDK, including:

* Cropping
* Straightening
* Adjustments
* Filters
* Overlays
* Selective focus
* Drawing
* Text
* Stickers
* Multi-photo editing

### Video Editor

The example demonstrates the video editor and its current capabilities, including:

* Video trimming
* Cropping
* Cover selection
* Filters
* Adjustments
* Playback speed
* Text overlays
* Stickers
* Drawing layers
* Video export
* Optional compression

### Functional Video APIs

The SDK also provides functional APIs that can be used without rendering the full editor UI.

These include:

```ts
getVideoInfo()
getVideoThumbnail()
trimVideo()
```

The example can therefore serve as a reference for both the editor components and the lower-level video APIs.

## Editor Configuration

The example separates editor configuration from the main application.

This makes it easier to experiment with options such as:

* Editor tools
* Theme
* Colors
* Spacing
* Localization
* Direction
* Video configuration
* Photo configuration

For configuration examples, see:

```text
editorConfig.ts
```

and:

```text
ConfigPanel.tsx
```

## RTL and Localization

The SDK supports per-editor text direction and localization.

The example can be used to test:

* English
* Arabic
* RTL layouts
* Custom strings
* Direction-specific editor behavior

The editor does not require the application to globally change React Native's `I18nManager` configuration.

## Theming

The example also demonstrates the SDK's theming capabilities.

The editor supports light and dark themes with configurable visual properties such as:

* Colors
* Spacing
* Corner radius
* Other editor UI values

This provides a reference for integrating the editor into applications with an existing design system.

## Native Processing

The video editor currently uses the platform-native media frameworks:

```text
Android
    ↓
Media3 Transformer

iOS
    ↓
AVFoundation
```

The example therefore runs the same native processing pipeline used by applications integrating the SDK.

This is important when testing video export, trimming, cropping, filters, playback speed, and other native video operations.

## Development Workflow

The recommended workflow when developing the SDK itself is:

```text
Modify SDK source
      ↓
Run example
      ↓
Test on Android/iOS
      ↓
Verify editor behavior
      ↓
Update SDK
```

Because the example depends on the local package:

```text
example/
    ↓
../
    ↓
@dahab-tech/react-native-media-editor
```

changes made to the SDK can be tested directly from the example application.

## Troubleshooting

### Expo Go does not work

This is expected.

The media editor contains native modules and therefore requires a development build.

Use:

```bash
npm run android
```

or:

```bash
npm run ios
```

instead of opening the project in Expo Go.

### Native changes are not reflected

If native dependencies or native configuration change, rebuild the development application.

For Android:

```bash
npm run android
```

For iOS:

```bash
npm run ios
```

Restarting Metro alone is not sufficient for native changes.

### Metro/cache issues

If you encounter unexpected bundling issues, try restarting Expo with a cleared cache:

```bash
npx expo start --clear
```

If the issue involves native dependencies, rebuild the development application after clearing the cache.

## Example Scripts

| Command                      | Description                             |
| ---------------------------- | --------------------------------------- |
| `npm start`                  | Start Expo development server           |
| `npm run android`            | Build and run Android development build |
| `npm run ios`                | Build and run iOS development build     |
| `npm run web`                | Start Expo web                          |
| `npm run android-production` | Run Android release build               |
| `npm run ios-production`     | Run iOS Release configuration           |

## Purpose of This Example

The example is primarily a **development and integration reference** for the media editor SDK.

It is useful for:

* Testing new SDK features
* Testing native video processing
* Verifying Android and iOS behavior
* Experimenting with editor configuration
* Testing RTL/localization
* Testing themes
* Demonstrating SDK usage
* Reproducing issues
* Developing new editor functionality

The example should remain focused on demonstrating the public SDK rather than becoming a separate production application.

## Related Documentation

For the SDK documentation, see the main repository README.

For implementation details, native processing, and supported functionality, refer to the source code and documentation in the repository root.

---

## License

This example is provided under the same project licensing terms documented in the repository.
