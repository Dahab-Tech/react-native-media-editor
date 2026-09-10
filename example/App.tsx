import { getVideoInfo } from '@dahab-tech/react-native-media-editor';
import {
  PhotoEditor,
  type PhotoExportResult,
} from '@dahab-tech/react-native-media-editor/photoEditor';
import {
  VideoEditor,
  type ThumbnailResult,
  type TrimResult,
} from '@dahab-tech/react-native-media-editor/videoEditor';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { ConfigPanel } from './ConfigPanel';
import {
  DEFAULT_CONFIG,
  photoEditorProps,
  sharedEditorProps,
  videoEditorProps,
  type PlaygroundConfig,
} from './editorConfig';

type Screen =
  | { kind: 'home' }
  | { kind: 'video'; uri: string }
  | { kind: 'photo'; uri: string }
  | { kind: 'photoMulti'; assets: readonly { uri: string }[] };

// Wraps ALL screens so the SDK shares these insets; initialMetrics fixes them on frame 1 (Fabric otherwise dispatches async).
export default function App() {
  return (
    <SafeAreaProvider
      initialMetrics={initialWindowMetrics}
      onLayout={() => SplashScreen.hideAsync()}>
      <Playground />
    </SafeAreaProvider>
  );
}

function Playground() {
  // useSafeAreaInsets, not native SafeAreaView — the native view re-measures after first paint on Android and flashes under the status bar.
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [config, setConfig] = useState<PlaygroundConfig>(DEFAULT_CONFIG);
  const [trimResult, setTrimResult] = useState<TrimResult | null>(null);
  const [cover, setCover] = useState<ThumbnailResult | null>(null);
  const [photo, setPhoto] = useState<PhotoExportResult | readonly PhotoExportResult[] | null>(null);

  const pickMedia = async (kind: 'video' | 'photo') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Media library access is needed.');
      return;
    }
    const multiPhoto = kind === 'photo' && config.photoMultiSelect;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'video' ? ['videos'] : ['images'],
      // Skia can't decode HEIC; Compatible mode transcodes to JPEG on iOS 14+.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      ...(multiPhoto ? { allowsMultipleSelection: true, selectionLimit: 10 } : null),
    });
    if (result.canceled || !result.assets[0]) return;
    if (kind === 'video') {
      setScreen({ kind: 'video', uri: result.assets[0].uri });
      return;
    }
    if (multiPhoto && result.assets.length > 1) {
      setScreen({ kind: 'photoMulti', assets: result.assets.map((a) => ({ uri: a.uri })) });
    } else {
      setScreen({ kind: 'photo', uri: result.assets[0].uri });
    }
  };

  if (screen.kind === 'video') {
    return (
      <VideoEditor
        source={screen.uri}
        {...sharedEditorProps(config)}
        {...videoEditorProps(config)}
        onCancel={() => setScreen({ kind: 'home' })}
        onExport={(result) => {
          setTrimResult(result);
          setScreen({ kind: 'home' });
        }}
        onCoverSelected={(result) => setCover(result)}
        onError={(error) => Alert.alert('Video editor error', error.message)}
      />
    );
  }

  if (screen.kind === 'photo') {
    return (
      <PhotoEditor
        source={screen.uri}
        {...sharedEditorProps(config)}
        {...photoEditorProps(config)}
        onCancel={() => setScreen({ kind: 'home' })}
        onExport={(result) => {
          setPhoto(result);
          setScreen({ kind: 'home' });
        }}
        onError={(error) => Alert.alert('Photo editor error', error.message)}
      />
    );
  }

  if (screen.kind === 'photoMulti') {
    return (
      <PhotoEditor
        source={screen.assets}
        {...sharedEditorProps(config)}
        {...photoEditorProps(config)}
        onCancel={() => setScreen({ kind: 'home' })}
        onExport={(results) => {
          setPhoto(results);
          setScreen({ kind: 'home' });
        }}
        onError={(error) => Alert.alert('Photo editor error', error.message)}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <Text style={styles.title}>@dahab-tech/react-native-media-editor</Text>
            <Pressable
              style={styles.localeToggle}
              onPress={() => setConfig({ ...config, locale: config.locale === 'en' ? 'ar' : 'en' })}
              accessibilityRole="button"
              accessibilityLabel={`Locale: ${config.locale === 'en' ? 'English' : 'Arabic'}. Tap to switch.`}>
              <Text
                style={[
                  styles.localeSegment,
                  config.locale === 'en' && styles.localeSegmentActive,
                ]}>
                EN
              </Text>
              <Text
                style={[
                  styles.localeSegment,
                  config.locale === 'ar' && styles.localeSegmentActive,
                ]}>
                عربي
              </Text>
            </Pressable>
          </View>

          <ConfigPanel config={config} onChange={setConfig} />

          {trimResult && <TrimResultPanel key={trimResult.uri} result={trimResult} />}

          {cover && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>Selected cover</Text>
              <Image
                source={{ uri: cover.uri }}
                style={[styles.mediaPreview, { aspectRatio: cover.width / cover.height }]}
                resizeMode="contain"
              />
            </View>
          )}

          {photo && <PhotoResultPanel result={photo} />}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: 8 + insets.bottom }]}>
          <Pressable style={styles.button} onPress={() => pickMedia('video')}>
            <Text style={styles.buttonText}>Open Video Editor</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => pickMedia('photo')}>
            <Text style={styles.buttonText}>Open Photo Editor</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

function useFileSize(uri: string): string | null {
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    try {
      const bytes = new File(uri).size;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading external filesystem state, not deriving from props.
      setSize(bytes != null ? formatBytes(bytes) : null);
    } catch {
      setSize(null);
    }
  }, [uri]);
  return size;
}

function TrimResultPanel({ result }: { result: TrimResult }) {
  const player = useVideoPlayer(result.uri, (p) => {
    p.loop = true;
  });
  const size = useFileSize(result.uri);
  const [resolution, setResolution] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getVideoInfo(result.uri)
      .then((info) => {
        if (!cancelled) setResolution(`${info.width}×${info.height}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [result.uri]);

  const details = [`${Math.round(result.durationMs / 1000)}s`, resolution, size]
    .filter(Boolean)
    .join(' • ');
  return (
    <View style={styles.result}>
      <Text style={styles.resultTitle}>Trimmed video</Text>
      <Text style={styles.resultText}>{details}</Text>
      <VideoView player={player} style={styles.videoPreview} contentFit="contain" nativeControls />
    </View>
  );
}

function PhotoResultPanel({
  result,
}: {
  result: PhotoExportResult | readonly PhotoExportResult[];
}) {
  if (Array.isArray(result)) {
    return (
      <View style={styles.result}>
        <Text style={styles.resultTitle}>Exported {result.length} photos</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbStrip}>
          {result.map((entry, i) => (
            <Image
              key={`${entry.uri}-${i}`}
              source={{ uri: entry.uri }}
              style={styles.thumb}
              resizeMode="cover"
            />
          ))}
        </ScrollView>
      </View>
    );
  }
  const one = result as PhotoExportResult;
  return (
    <View style={styles.result}>
      <Text style={styles.resultTitle}>
        Exported photo ({one.format}, {one.width}×{one.height})
      </Text>
      <Image
        source={{ uri: one.uri }}
        style={[styles.mediaPreview, { aspectRatio: one.width / one.height }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E0E11' },
  flex: { flex: 1 },
  scrollContent: { padding: 20, gap: 12 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginVertical: 16,
  },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flexShrink: 1 },
  localeToggle: {
    flexDirection: 'row',
    backgroundColor: '#1B1B20',
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  localeSegment: {
    color: '#9A9AA3',
    fontSize: 12,
    fontWeight: '600',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  localeSegmentActive: { backgroundColor: '#FFCE0A', color: '#17171C' },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
    backgroundColor: '#0E0E11',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#26262C',
  },
  button: {
    backgroundColor: '#1B1B20',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#FFCE0A', fontSize: 16, fontWeight: '600' },
  result: { backgroundColor: '#1B1B20', borderRadius: 10, padding: 12, gap: 8 },
  resultTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  resultText: { color: '#9A9AA3', fontSize: 12 },
  mediaPreview: { width: '100%', borderRadius: 6, backgroundColor: '#000000' },
  videoPreview: { width: '100%', height: 320, borderRadius: 6, backgroundColor: '#000000' },
  thumbStrip: { gap: 8 },
  thumb: { width: 72, height: 72, borderRadius: 6 },
});
