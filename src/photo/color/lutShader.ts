import {
  Skia,
  type SkRuntimeEffect,
  type SkImage,
  type SkImageFilter,
} from '@shopify/react-native-skia';

/** HALD LUT via MakeRuntimeShaderWithChildren (declarative <RuntimeShader> only supports one child).
 *  Trilinear along blue over Skia's default bilinear per-slice sampling. Square HALD only (image edge = k³). */
const LUT_SHADER_SOURCE = /* glsl */ `
  uniform shader content;
  uniform shader lut;
  uniform float lutSize;
  uniform float lutTexSize;
  uniform float intensity;

  vec4 sampleLutSlice(vec2 rgUV, float slice) {
    // Locate the slice's NxN tile inside the HALD image, then map rgUV onto
    // cell centers within that tile.
    float tilesPerRow = lutTexSize / lutSize;
    float sliceX = mod(slice, tilesPerRow);
    float sliceY = floor(slice / tilesPerRow);
    // +0.5 keeps samples on texel centers so bilinear filtering returns clean cube values.
    vec2 uvInTile = rgUV * (lutSize - 1.0) + 0.5;
    vec2 pixel = vec2(sliceX * lutSize, sliceY * lutSize) + uvInTile;
    // lut.eval expects local coords in pixels for the bound image filter.
    return lut.eval(pixel);
  }

  half4 main(float2 pos) {
    vec4 base = content.eval(pos);
    // Guard alpha=0 pixels — the LUT undefined for pre-multiplied 0 alpha.
    if (base.a < 0.001) {
      return half4(base);
    }
    // Convert to un-premultiplied rgb for a stable LUT input; recompose alpha
    // at the end. Skia layer contents come through premultiplied by default.
    vec3 rgb = base.rgb / base.a;
    rgb = clamp(rgb, 0.0, 1.0);

    // Trilinear along blue: mix two bilinear samples on the bracketing slices.
    float b = rgb.b * (lutSize - 1.0);
    float bLo = floor(b);
    float bHi = min(bLo + 1.0, lutSize - 1.0);
    float bFrac = b - bLo;

    vec2 rgUV = rgb.rg;
    vec4 loSample = sampleLutSlice(rgUV, bLo);
    vec4 hiSample = sampleLutSlice(rgUV, bHi);
    vec3 lutted = mix(loSample.rgb, hiSample.rgb, bFrac);

    vec3 outRgb = mix(rgb, lutted, intensity);
    // Re-premultiply so the layer's downstream compositing keeps working.
    return half4(outRgb * base.a, base.a);
  }
`;

let cachedLutEffect: SkRuntimeEffect | null = null;

/** Lazy-compile + cache. */
export function getLutShader(): SkRuntimeEffect | null {
  if (cachedLutEffect) return cachedLutEffect;
  cachedLutEffect = Skia.RuntimeEffect.Make(LUT_SHADER_SOURCE);
  return cachedLutEffect;
}

/** Returns N (= k²) when the image is a square HALD (edge = k³); null otherwise. */
export function detectHaldCubeSize(image: SkImage): number | null {
  const edge = image.width();
  if (edge <= 0 || edge !== image.height()) return null;
  const k = Math.round(Math.cbrt(edge));
  if (k <= 1) return null;
  if (k * k * k !== edge) return null;
  return k * k;
}

/** Returns null on compile fail / invalid HALD (callers render without the LUT stage). */
export function buildLutImageFilter(lutImage: SkImage, intensity: number): SkImageFilter | null {
  const effect = getLutShader();
  if (!effect) return null;
  const cubeSize = detectHaldCubeSize(lutImage);
  if (cubeSize == null) return null;

  const builder = Skia.RuntimeShaderBuilder(effect);
  builder.setUniform('lutSize', [cubeSize]);
  builder.setUniform('lutTexSize', [lutImage.width()]);
  builder.setUniform('intensity', [Math.min(1, Math.max(0, intensity))]);

  const lutImageFilter = Skia.ImageFilter.MakeImage(lutImage);
  // `null` for "content" auto-binds the source; the LUT filter binds to "lut".
  return Skia.ImageFilter.MakeRuntimeShaderWithChildren(
    builder,
    0,
    ['content', 'lut'],
    [null, lutImageFilter]
  );
}
