// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// npm v7+ will install ../node_modules/react and ../node_modules/react-native because of peerDependencies.
// To prevent the incompatible react-native between ./node_modules/react-native and ../node_modules/react-native,
// excludes the one from the parent folder when bundling.
config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  // On windows the path will resolve with `\`. We need to escape it with `\\` for the RegExp.
  new RegExp(path.resolve('..', 'node_modules', 'react').replace(/\\/g, '\\\\')),
  new RegExp(path.resolve('..', 'node_modules', 'react-native').replace(/\\/g, '\\\\')),
  // Same dedupe for the linked AI add-on package: its devDependency copies of
  // react/react-native/expo must never be bundled alongside the example's.
  new RegExp(path.resolve(__dirname, '../../media-editor-ai', 'node_modules', 'react').replace(/\\/g, '\\\\')),
  new RegExp(path.resolve(__dirname, '../../media-editor-ai', 'node_modules', 'react-native').replace(/\\/g, '\\\\')),
  new RegExp(path.resolve(__dirname, '../../media-editor-ai', 'node_modules', 'expo').replace(/\\/g, '\\\\')),
];

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

// Map the package entry points straight to source so the example picks up
// src/ edits live, without rebuilding. Consumers resolve via package.json
// "exports" instead.
const moduleSourceEntries = {
  '@dahab-tech/react-native-media-editor': path.resolve(__dirname, '../src/index.ts'),
  '@dahab-tech/react-native-media-editor/photoEditor': path.resolve(__dirname, '../src/photo/index.ts'),
  '@dahab-tech/react-native-media-editor/videoEditor': path.resolve(__dirname, '../src/video/index.ts'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleSourceEntries[moduleName]) {
    return { type: 'sourceFile', filePath: moduleSourceEntries[moduleName] };
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.watchFolders = [
  path.resolve(__dirname, '..'),
  // The AI add-on is npm-linked from a sibling repo, outside the default
  // watched roots — without this Metro cannot resolve the symlinked package.
  path.resolve(__dirname, '../../media-editor-ai'),
];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
