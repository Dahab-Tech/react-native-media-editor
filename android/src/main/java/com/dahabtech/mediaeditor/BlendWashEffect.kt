package com.dahabtech.mediaeditor

import android.content.Context
import android.graphics.Bitmap
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

/**
 * Blends an overlay wash bitmap onto each frame with a real Skia-style blend mode.
 * Media3's BitmapOverlay only alpha-pastes, which renders blend washes as opaque "masks".
 */
@UnstableApi
class BlendWashEffect(
  private val wash: Bitmap,
  private val blendMode: String?,
  private val intensity: Float,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
    BlendWashShaderProgram(wash, blendMode, intensity)
}

@UnstableApi
private class BlendWashShaderProgram(
  private val wash: Bitmap,
  blendMode: String?,
  private val intensity: Float,
) : BaseGlShaderProgram(/* useHighPrecisionColorProcessing= */ false, /* texturePoolCapacity= */ 1) {
  private val glProgram: GlProgram
  private var washTexId = -1
  private val blendModeId = BLEND_MODE_IDS[blendMode] ?: 0

  init {
    try {
      glProgram = GlProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    } catch (e: GlUtil.GlException) {
      throw VideoFrameProcessingException(e)
    }
    glProgram.setBufferAttribute(
      "aFramePosition",
      GlUtil.getNormalizedCoordinateBounds(),
      GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
    )
  }

  override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

  override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
    try {
      // Texture upload needs the GL context; drawFrame is the first callback guaranteed to run on the GL thread.
      if (washTexId == -1) washTexId = GlUtil.createTexture(wash)
      glProgram.use()
      glProgram.setSamplerTexIdUniform("uTexSampler", inputTexId, /* texUnitIndex= */ 0)
      glProgram.setSamplerTexIdUniform("uWashSampler", washTexId, /* texUnitIndex= */ 1)
      glProgram.setIntUniform("uBlendMode", blendModeId)
      glProgram.setFloatUniform("uIntensity", intensity)
      glProgram.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, /* first= */ 0, /* count= */ 4)
    } catch (e: GlUtil.GlException) {
      throw VideoFrameProcessingException(e, presentationTimeUs)
    }
  }

  override fun release() {
    super.release()
    try {
      if (washTexId != -1) GlUtil.deleteTexture(washTexId)
      glProgram.delete()
    } catch (e: GlUtil.GlException) {
      throw VideoFrameProcessingException(e)
    }
  }

  private companion object {
    // Mirrors ciBlendFilterName on iOS; 0 (overlay) is the fallback for unknown names.
    val BLEND_MODE_IDS = mapOf(
      "softLight" to 1,
      "hardLight" to 2,
      "screen" to 3,
      "multiply" to 4,
      "lighten" to 5,
      "darken" to 6,
      "colorDodge" to 7,
      "colorBurn" to 8,
    )

    const val VERTEX_SHADER = """
attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
"""

    // W3C separable blend formulas; result mixed by wash alpha * uIntensity, matching Skia's
    // opacity+blendMode draw. Wash is unpremultiplied (GLUtils upload is premultiplied) and
    // sampled y-flipped (bitmap rows are top-down, GL coords bottom-up).
    const val FRAGMENT_SHADER = """
precision mediump float;
uniform sampler2D uTexSampler;
uniform sampler2D uWashSampler;
uniform int uBlendMode;
uniform float uIntensity;
varying vec2 vTexSamplingCoord;

float softLight(float b, float s) {
  float d = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return (s <= 0.5) ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b);
}
float hardLight(float b, float s) {
  return (s <= 0.5) ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}
float dodge(float b, float s) {
  return (s >= 1.0) ? 1.0 : min(1.0, b / (1.0 - s));
}
float burn(float b, float s) {
  return (s <= 0.0) ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s);
}
vec3 blend(vec3 b, vec3 s) {
  if (uBlendMode == 1) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
  if (uBlendMode == 2) return vec3(hardLight(b.r, s.r), hardLight(b.g, s.g), hardLight(b.b, s.b));
  if (uBlendMode == 3) return b + s - b * s;
  if (uBlendMode == 4) return b * s;
  if (uBlendMode == 5) return max(b, s);
  if (uBlendMode == 6) return min(b, s);
  if (uBlendMode == 7) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (uBlendMode == 8) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  return vec3(hardLight(s.r, b.r), hardLight(s.g, b.g), hardLight(s.b, b.b));
}
void main() {
  vec4 base = texture2D(uTexSampler, vTexSamplingCoord);
  vec4 ws = texture2D(uWashSampler, vec2(vTexSamplingCoord.x, 1.0 - vTexSamplingCoord.y));
  vec3 s = clamp(ws.rgb / max(ws.a, 1e-4), 0.0, 1.0);
  vec3 blended = blend(base.rgb, s);
  gl_FragColor = vec4(mix(base.rgb, blended, ws.a * uIntensity), base.a);
}
"""
  }
}
