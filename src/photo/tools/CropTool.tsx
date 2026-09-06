import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEditorI18n } from '../../core/i18n/I18nContext';
import { EditorIcon, type EditorIconName } from '../../core/icons/IconContext';
import { useEditorTheme } from '../../core/theming/ThemeContext';
import { StraightenDial } from '../components/StraightenDial';
import {
  aspectRatioValue,
  fitCropToAspect,
  type AspectRatio,
  type PhotoEditorController,
} from '../state/photoEditorState';

export interface CropToolProps {
  controller: PhotoEditorController;
  /** Intrinsic image width / height (pre-rotation). */
  imageAspect: number;
  /** Consumer-constrained preset list (already normalized). When 'free' is absent, first entry is the reset target. */
  allowedAspects?: readonly AspectRatio[] | null;
}

const SCRIM_TEXT = '#FFFFFF';
const SCRIM_TEXT_MUTED = 'rgba(255,255,255,0.6)';
const SCRIM_BORDER = 'rgba(255,255,255,0.35)';

const ASPECTS: { id: AspectRatio; label?: string }[] = [
  { id: 'free' },
  { id: 'original' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
];

export function CropTool({ controller, imageAspect, allowedAspects }: CropToolProps) {
  const theme = useEditorTheme();
  const { t, isRTL } = useEditorI18n();
  const { state, dispatch } = controller;

  const aspectOptions =
    allowedAspects != null && allowedAspects.length > 0
      ? allowedAspects.flatMap((id) => ASPECTS.filter((option) => option.id === id))
      : ASPECTS;
  const resetAspect =
    allowedAspects != null && allowedAspects.length > 0 && !allowedAspects.includes('free')
      ? allowedAspects[0]
      : undefined;

  // Post-rotation aspect for 'original' so it resolves to what's on screen.
  const rotated = state.rotation === 90 || state.rotation === 270;
  const seenImageAspect = rotated ? 1 / imageAspect : imageAspect;

  const resolveSeenAspect = (aspect: AspectRatio): number | null =>
    aspectRatioValue(aspect, { imageAspect: seenImageAspect });

  // Invert seen aspect at 90°/270° before fitting since the crop is stored pre-rotation.
  const seenToStoredAspect = (seen: number): number => (rotated ? 1 / seen : seen);

  const applyAspect = (aspect: AspectRatio) => {
    dispatch({ type: 'setAspect', aspect });
    if (aspect === 'free') return;
    const seenAspect = resolveSeenAspect(aspect);
    if (seenAspect == null || imageAspect <= 0) return;
    dispatch({
      type: 'setCrop',
      crop: fitCropToAspect(state.crop, seenToStoredAspect(seenAspect), imageAspect),
      imageAspect,
    });
  };

  const labelFor = (option: { id: AspectRatio; label?: string }): string => {
    if (option.id === 'free') return t('free');
    if (option.id === 'original') return t('original');
    return option.label ?? option.id;
  };

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.xs,
        paddingBottom: theme.spacing.md,
        gap: theme.spacing.xs,
      }}>
      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.md,
        }}>
        <IconAction
          icon="rotate"
          label={t('rotate')}
          onPress={() => dispatch({ type: 'rotate' })}
        />
        <IconAction icon="flip" label={t('flip')} onPress={() => dispatch({ type: 'flip' })} />
        <IconAction
          icon="reset"
          label={t('reset')}
          onPress={() => dispatch({ type: 'resetCrop', aspect: resetAspect, imageAspect })}
          muted
        />
      </View>

      <StraightenDial
        value={state.straighten}
        onSlidingStart={() => dispatch({ type: 'checkpoint' })}
        onChange={(value) =>
          dispatch({
            type: 'setStraighten',
            value,
            imageAspect,
          })
        }
      />

      <View
        style={{
          flexDirection: isRTL ? 'row-reverse' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        {aspectOptions.map((option) => {
          const active = state.aspect === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => applyAspect(option.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={6}
              style={[
                styles.chip,
                {
                  borderColor: active ? theme.colors.accent : SCRIM_BORDER,
                  backgroundColor: active ? theme.colors.accent : 'transparent',
                  borderRadius: 999,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                },
              ]}>
              <Text
                style={{
                  color: active ? theme.colors.onAccent : SCRIM_TEXT,
                  fontWeight: '600',
                  fontSize: 13,
                  fontVariant: ['tabular-nums'],
                }}>
                {labelFor(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IconAction({
  icon,
  label,
  onPress,
  muted,
}: {
  icon: EditorIconName;
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  const color = muted ? SCRIM_TEXT_MUTED : SCRIM_TEXT;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // 32×32 visible + hitSlop restores 44pt hit target.
      hitSlop={12}
      style={styles.action}>
      <EditorIcon name={icon} size={22} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  action: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
});
