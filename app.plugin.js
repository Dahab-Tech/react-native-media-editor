const { withGradleProperties } = require('expo/config-plugins');

// VideoEditor requires Android minSdk 26 — @shopify/react-native-skia compiles
// its video decoder against the consumer app's minSdk and throws below 26.
// Raise-only: if the consumer already targets >= 26, leave their value alone.
const MIN_SDK_KEY = 'android.minSdkVersion';
const REQUIRED_MIN_SDK = 26;

function updateGradleProperties(properties) {
  const existing = properties.find(
    (item) => item.type === 'property' && item.key === MIN_SDK_KEY
  );
  if (existing) {
    const parsed = parseInt(existing.value, 10);
    if (Number.isFinite(parsed) && parsed >= REQUIRED_MIN_SDK) {
      return properties;
    }
    existing.value = String(REQUIRED_MIN_SDK);
    return properties;
  }
  properties.push({
    type: 'property',
    key: MIN_SDK_KEY,
    value: String(REQUIRED_MIN_SDK),
  });
  return properties;
}

const withMediaEditorMinSdk = (config) =>
  withGradleProperties(config, (cfg) => {
    cfg.modResults = updateGradleProperties(cfg.modResults);
    return cfg;
  });

module.exports = withMediaEditorMinSdk;
module.exports.updateGradleProperties = updateGradleProperties;
