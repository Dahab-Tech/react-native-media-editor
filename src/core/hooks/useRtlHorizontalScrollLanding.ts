import { useCallback, useRef } from 'react';
import type { ScrollView } from 'react-native';

import { useEditorI18n } from '../i18n/I18nContext';

/** Scrolls a horizontal `ScrollView` to the far right on first content-size event in RTL, so `row-reverse` rows open at the leading edge. LTR is a passthrough. */
export function useRtlHorizontalScrollLanding(): readonly [
  setRef: (instance: ScrollView | null) => void,
  onContentSizeChange: (w: number, h: number) => void,
] {
  const { isRTL } = useEditorI18n();
  // Refs are only written in setRef and read in onContentSizeChange, never during render.
  const scrollRef = useRef<ScrollView | null>(null);
  // Latch: flip once so pack switches don't yank the user back to the leading edge.
  const didLandRef = useRef(false);

  const setRef = useCallback((instance: ScrollView | null) => {
    scrollRef.current = instance;
  }, []);

  const onContentSizeChange = useCallback(
    (_w: number, _h: number) => {
      if (!isRTL) return;
      if (didLandRef.current) return;
      scrollRef.current?.scrollToEnd({ animated: false });
      didLandRef.current = true;
    },
    [isRTL]
  );

  return [setRef, onContentSizeChange] as const;
}
