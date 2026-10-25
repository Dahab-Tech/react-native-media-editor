package com.dahabtech.mediaeditor.compile

import android.content.Context
import android.graphics.Bitmap
import androidx.media3.common.OverlaySettings
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import com.dahabtech.mediaeditor.records.OverlayRecord
import com.google.common.collect.ImmutableList

/**
 * Timeline-windowed overlays. Effect presentationTimeUs is composition-global output time
 * (spike-verified), so windows compare directly — no per-clip offset.
 */
@androidx.annotation.OptIn(UnstableApi::class)
object TimedOverlayFactory {
  /** One OverlayEffect holding every overlay whose window intersects [clipStartUs, clipEndUs). */
  fun build(
    context: Context,
    overlays: List<OverlayRecord>,
    clipStartUs: Long,
    clipEndUs: Long,
    renderWidth: Int,
    renderHeight: Int,
  ): OverlayEffect? {
    val sliced = overlays.filter { it.timelineStartMs * 1000 < clipEndUs && it.timelineEndMs * 1000 > clipStartUs }
    if (sliced.isEmpty()) return null
    val textureOverlays = sliced.mapNotNull { record ->
      SourceProbe.decodeBitmap(context, record.pngUri)?.let { bitmap ->
        windowedOverlay(scaleToCanvas(bitmap, renderWidth, renderHeight), record)
      }
    }
    if (textureOverlays.isEmpty()) return null
    return OverlayEffect(ImmutableList.copyOf<TextureOverlay>(textureOverlays))
  }

  /** Overlays are full-canvas rasterizations; pre-scale so the default centered placement covers the frame. */
  private fun scaleToCanvas(bitmap: Bitmap, width: Int, height: Int): Bitmap =
    if (bitmap.width == width && bitmap.height == height) bitmap
    else Bitmap.createScaledBitmap(bitmap, width, height, true)

  private fun windowedOverlay(bitmap: Bitmap, record: OverlayRecord): BitmapOverlay {
    val startUs = record.timelineStartMs * 1000
    val endUs = record.timelineEndMs * 1000
    return object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long): Bitmap = bitmap

      override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
        val visible = presentationTimeUs in startUs until endUs
        return StaticOverlaySettings.Builder().setAlphaScale(if (visible) 1f else 0f).build()
      }
    }
  }
}
