import { Skia, type SkRuntimeEffect, type Uniforms } from '@shopify/react-native-skia';

import type { PhotoAdjustmentKey, PhotoAdjustments } from './adjustments';

/** Nonlinear + spatial stage (tone / vibrance / sharpness / vignette / grain).
 *  Matrix stage runs before this in the same Paint. Uniforms packed to keep count low for older GL backends. */
const SHADER_SOURCE = /* glsl */ `
  uniform shader content;
  uniform vec4 rect;      // x, y, w, h — drawn content rect in canvas px
  uniform vec4 toneAmt;   // highlights, shadows, whites, blacks
  uniform vec4 colorAmt;  // vibrance, sharpness, vignette, grain
  uniform float grainSeed;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  float hash(vec2 p) {
    // Cheap, stable hash for grain — a canonical trig-based scatter.
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 applyTone(vec3 rgb) {
    float luma = dot(rgb, LUMA);
    float highlights = toneAmt.x;
    float shadows    = toneAmt.y;
    float whites     = toneAmt.z;
    float blacks     = toneAmt.w;

    // Highlights weight peaks in the upper mids (0.5..1.0), falls off in
    // shadows — a smooth Hermite curve keeps the transition free of banding.
    float highlightMask = smoothstep(0.5, 1.0, luma);
    float shadowMask    = smoothstep(0.5, 0.0, luma);
    // Whites/blacks masks reach further into the extremes — a toe/shoulder
    // push rather than a global level shift.
    float whitesMask = smoothstep(0.7, 1.0, luma);
    float blacksMask = smoothstep(0.3, 0.0, luma);

    rgb += rgb * (highlights * 0.5) * highlightMask;
    rgb += rgb * (shadows    * 0.5) * shadowMask;
    rgb += (vec3(1.0) - rgb) * (whites * 0.5) * whitesMask;
    rgb -= rgb * (-blacks * 0.5) * blacksMask;
    return rgb;
  }

  vec3 applyVibrance(vec3 rgb, float amount) {
    // Push saturation of DESATURATED pixels harder than already-saturated ones
    // — the classic "vibrance" behavior. Standard-deviation-style weighting
    // (max−min channel) is a good stand-in for HSV saturation on the GPU.
    float mx = max(max(rgb.r, rgb.g), rgb.b);
    float mn = min(min(rgb.r, rgb.g), rgb.b);
    float sat = mx - mn;
    float weight = 1.0 - sat;
    float luma = dot(rgb, LUMA);
    return mix(vec3(luma), rgb, 1.0 + amount * weight);
  }

  vec4 sampleLocal(vec2 uv) {
    // uv is in [0,1] over the rect; convert back to absolute px for the
    // child sampler.
    return content.eval(rect.xy + uv * rect.zw);
  }

  half4 main(float2 pos) {
    // Everything downstream works in the rect's local [0,1] uv space.
    vec2 uv = (pos - rect.xy) / rect.zw;
    vec4 base = content.eval(pos);
    // Reject fragments outside the drawn photo rect (letterbox) — leave them
    // untouched so vignette/grain don't bleed into the letterbox area.
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      return half4(base);
    }
    vec3 rgb = base.rgb;

    // Tone stage — highlights/shadows/whites/blacks.
    rgb = applyTone(rgb);

    // Vibrance.
    if (abs(colorAmt.x) > 0.001) {
      rgb = applyVibrance(rgb, colorAmt.x);
    }

    // Sharpness — 4-tap unsharp mask, weight ∈ [0, 1]. Pixel step is 1/rect
    // so the neighborhood scales with the drawn content, not the canvas.
    float sharp = colorAmt.y;
    if (sharp > 0.001) {
      vec2 step = 1.0 / rect.zw;
      vec3 blur = (
        sampleLocal(clamp(uv + vec2( step.x, 0.0), 0.0, 1.0)).rgb +
        sampleLocal(clamp(uv + vec2(-step.x, 0.0), 0.0, 1.0)).rgb +
        sampleLocal(clamp(uv + vec2(0.0,  step.y), 0.0, 1.0)).rgb +
        sampleLocal(clamp(uv + vec2(0.0, -step.y), 0.0, 1.0)).rgb
      ) * 0.25;
      rgb = rgb + (rgb - blur) * (sharp * 1.5);
    }

    // Vignette — radial darkening from the rect center. Uses a squared
    // distance for a soft-ish falloff without a per-pixel sqrt.
    float vignette = colorAmt.z;
    if (vignette > 0.001) {
      vec2 centered = uv - vec2(0.5);
      // Normalize by the shorter half-axis so vignette reaches the corners of
      // any aspect without stretching.
      float aspect = rect.z / rect.w;
      if (aspect > 1.0) { centered.x *= aspect; }
      else { centered.y /= aspect; }
      float dist2 = dot(centered, centered) * 2.0;
      float dark = 1.0 - vignette * smoothstep(0.3, 1.2, dist2);
      rgb *= dark;
    }

    // Grain — hash noise centered on 0 so it's a signed offset. Seed and uv
    // are both scaled to keep the pattern sub-pixel-ish on high-DPI displays.
    float grain = colorAmt.w;
    if (grain > 0.001) {
      float n = hash(uv * rect.zw + vec2(grainSeed)) - 0.5;
      rgb += vec3(n) * (grain * 0.15);
    }

    return half4(clamp(rgb, 0.0, 1.0), base.a);
  }
`;

/** Keys handled by the SkSL shader; the rest fold into the color matrix. */
export const SHADER_KEYS: readonly PhotoAdjustmentKey[] = [
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'vibrance',
  'sharpness',
  'vignette',
  'grain',
];

let cachedEffect: SkRuntimeEffect | null = null;

/** Lazy-compile + cache. Null on failure (very old Skia / web); caller skips the stage. */
export function getColorShader(): SkRuntimeEffect | null {
  if (cachedEffect) return cachedEffect;
  cachedEffect = Skia.RuntimeEffect.Make(SHADER_SOURCE);
  return cachedEffect;
}

/** Plain-number uniform payload; works under drawAsImage as well as inline. */
export function buildColorShaderUniforms(
  adjustments: PhotoAdjustments,
  rect: { x: number; y: number; width: number; height: number },
  grainSeed: number
): Uniforms {
  return {
    rect: [rect.x, rect.y, rect.width, rect.height],
    toneAmt: [adjustments.highlights, adjustments.shadows, adjustments.whites, adjustments.blacks],
    colorAmt: [
      adjustments.vibrance,
      adjustments.sharpness,
      adjustments.vignette,
      adjustments.grain,
    ],
    grainSeed,
  };
}
