import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/** Swallow Android back while mounted — an edge swipe during a slider/trim drag would background the app. No-op on iOS. */
export function useConsumeAndroidBack() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);
}
