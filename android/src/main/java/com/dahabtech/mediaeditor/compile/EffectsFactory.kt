package com.dahabtech.mediaeditor.compile

import android.content.Context
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Crop
import androidx.media3.effect.RgbMatrix
import androidx.media3.effect.SingleColorLut
import com.dahabtech.mediaeditor.BlendWashEffect
import com.dahabtech.mediaeditor.MediaEditorException
import com.dahabtech.mediaeditor.records.ClipRecord

/** Per-clip grade chain: matrix → LUT → crop → wash, matching the live preview order. */
@androidx.annotation.OptIn(UnstableApi::class)
object EffectsFactory {
  fun build(context: Context, clip: ClipRecord): List<Effect> {
    val out = mutableListOf<Effect>()
    clip.colorMatrix?.let { m -> rgbMatrix(m)?.let(out::add) }
    clip.lutUri?.let { uri -> lut(context, uri)?.let(out::add) }
    clip.crop?.let { out.add(crop(clip)) }
    clip.washUri?.let { uri ->
      wash(context, uri, clip.washBlendMode, clip.washIntensity)?.let(out::add)
    }
    return out
  }

  /** Skia 4×5 row-major → Media3 RgbMatrix 4×4 column-major; alpha row dropped, bias collapses into col3. */
  fun rgbMatrix(m: List<Double>): RgbMatrix? {
    if (m.size != 20) return null
    val gl = FloatArray(16)
    gl[0] = m[0].toFloat();  gl[1] = m[5].toFloat();  gl[2] = m[10].toFloat(); gl[3] = 0f
    gl[4] = m[1].toFloat();  gl[5] = m[6].toFloat();  gl[6] = m[11].toFloat(); gl[7] = 0f
    gl[8] = m[2].toFloat();  gl[9] = m[7].toFloat();  gl[10] = m[12].toFloat(); gl[11] = 0f
    gl[12] = m[4].toFloat(); gl[13] = m[9].toFloat(); gl[14] = m[14].toFloat(); gl[15] = 1f
    return RgbMatrix { _, _ -> gl }
  }

  /** HALD PNG → SingleColorLut; Android has no intensity mix so fractional LUTs degrade to full strength. */
  fun lut(context: Context, lutUri: String): SingleColorLut? {
    val bitmap = SourceProbe.decodeBitmap(context, lutUri) ?: return null
    return runCatching { SingleColorLut.createFromBitmap(bitmap) }.getOrNull()
  }

  /** Blend-mode wash stage; null skips it (unreadable wash is non-fatal). */
  fun wash(context: Context, washUri: String, blendMode: String?, intensity: Double): BlendWashEffect? {
    val bitmap = SourceProbe.decodeBitmap(context, washUri) ?: return null
    return BlendWashEffect(bitmap, blendMode, intensity.coerceIn(0.0, 1.0).toFloat())
  }

  // Media3 Crop takes NDC [-1,1] centered; convert from display-pixel top-left with Y inverted.
  private fun crop(clip: ClipRecord): Crop {
    val displayWidth = clip.width.toDouble()
    val displayHeight = clip.height.toDouble()
    if (displayWidth <= 0 || displayHeight <= 0) {
      throw MediaEditorException("ERR_EXPORT", "Clip ${clip.id}: zero display size")
    }
    val rect = clip.crop!!
    val cropX = rect.x.toDouble().coerceIn(0.0, displayWidth)
    val cropY = rect.y.toDouble().coerceIn(0.0, displayHeight)
    val cropW = rect.width.toDouble().coerceIn(0.0, displayWidth - cropX)
    val cropH = rect.height.toDouble().coerceIn(0.0, displayHeight - cropY)
    if (cropW <= 0.0 || cropH <= 0.0) {
      throw MediaEditorException("ERR_EXPORT", "Clip ${clip.id}: empty crop")
    }
    val left = (2.0 * cropX / displayWidth - 1.0).toFloat()
    val right = (2.0 * (cropX + cropW) / displayWidth - 1.0).toFloat()
    val top = (1.0 - 2.0 * cropY / displayHeight).toFloat()
    val bottom = (1.0 - 2.0 * (cropY + cropH) / displayHeight).toFloat()
    return Crop(left, right, bottom, top)
  }
}
