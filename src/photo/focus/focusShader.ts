import {
  Skia,
  TileMode,
  type SkImageFilter,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { focusBlurSigma, focusMaskParams, type FocusRect } from './focusMath';
import type { PhotoFocus } from './types';

/** Selective blur via MakeRuntimeShaderWithChildren: sharp source + MakeBlur mixed by an analytic mask. */
const FOCUS_SHADER_SOURCE = /* glsl */ `
  uniform shader content;
  uniform shader blurred;
  uniform vec4 rect;      // x, y, w, h — drawn photo rect in canvas px
  uniform float mode;     // 0 = radial, 1 = linear
  uniform vec2 center;    // sharp-zone center in canvas px
  uniform float innerEdge;// px — blur ramp starts here
  uniform float feather;  // px — ramp width (>= 1)
  uniform vec2 dir;       // band direction unit vector (linear)

  half4 main(float2 pos) {
    vec4 sharp = content.eval(pos);
    vec2 local = pos - rect.xy;
    // Letterbox guard — leave anything outside the photo rect untouched.
    if (local.x < 0.0 || local.y < 0.0 || local.x > rect.z || local.y > rect.w) {
      return half4(sharp);
    }
    vec2 rel = pos - center;
    float d;
    if (mode < 0.5) {
      d = length(rel);
    } else {
      // Distance from the band's center line — project onto the normal.
      d = abs(dot(rel, vec2(-dir.y, dir.x)));
    }
    float mask = smoothstep(innerEdge, innerEdge + feather, d);
    if (mask <= 0.001) {
      return half4(sharp);
    }
    vec4 blur = blurred.eval(pos);
    return half4(mix(sharp, blur, mask));
  }
`;

let cachedFocusEffect: SkRuntimeEffect | null = null;

/** Lazy-compile + cache. */
export function getFocusShader(): SkRuntimeEffect | null {
  if (cachedFocusEffect) return cachedFocusEffect;
  cachedFocusEffect = Skia.RuntimeEffect.Make(FOCUS_SHADER_SOURCE);
  return cachedFocusEffect;
}

/** Returns null (skip-attach) when off / no visible blur / bad rect / compile failure. */
export function buildFocusImageFilter(focus: PhotoFocus, rect: FocusRect): SkImageFilter | null {
  if (focus.mode === 'off') return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const sigma = focusBlurSigma(focus.intensity, rect);
  if (sigma < 0.25) return null;
  const effect = getFocusShader();
  if (!effect) return null;

  const mask = focusMaskParams(focus, rect);
  const builder = Skia.RuntimeShaderBuilder(effect);
  builder.setUniform('rect', [rect.x, rect.y, rect.width, rect.height]);
  builder.setUniform('mode', [focus.mode === 'radial' ? 0 : 1]);
  builder.setUniform('center', [mask.centerX, mask.centerY]);
  builder.setUniform('innerEdge', [mask.innerEdge]);
  builder.setUniform('feather', [mask.feather]);
  builder.setUniform('dir', [mask.dirX, mask.dirY]);

  // Clamp tiling avoids the dark edge halo Decal would produce at the photo bounds.
  const blurredSource = Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null);
  return Skia.ImageFilter.MakeRuntimeShaderWithChildren(
    builder,
    0,
    ['content', 'blurred'],
    [null, blurredSource]
  );
}
