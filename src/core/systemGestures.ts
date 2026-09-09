import { Platform } from 'react-native';

/** Horizontal padding keeping edge-anchored drag handles clear of Android's back-gesture strip; undefined on iOS. */
export const EDGE_GESTURE_MARGIN: number | undefined = Platform.OS === 'android' ? 30 : undefined;
