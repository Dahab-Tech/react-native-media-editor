package com.dahabtech.mediaeditor

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Crop
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.RgbMatrix
import androidx.media3.effect.SingleColorLut
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import java.io.InputStream
import kotlin.math.roundToInt

@androidx.annotation.OptIn(UnstableApi::class)
object VideoTrimmer {
  fun trim(context: Context, uri: String, options: TrimOptions, promise: Promise) {
    if (options.startMs < 0 || options.endMs <= options.startMs) {
      promise.reject(MediaEditorException("ERR_TRIM", "Invalid trim range"))
      return
    }
    try {
      validateSource(uri, "ERR_TRIM")
    } catch (exception: MediaEditorException) {
      promise.reject(exception)
      return
    }

    val effects: List<Effect> = try {
      buildEffects(context, uri, options)
    } catch (exception: MediaEditorException) {
      promise.reject(exception)
      return
    }

    val outputFile = cacheFile(context, "trim", "mp4")
    val mediaItem = MediaItem.Builder()
      .setUri(Uri.parse(uri))
      .setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs(options.startMs.toLong())
          .setEndPositionMs(options.endMs.toLong())
          .build()
      )
      .build()

    val editedMediaItem = EditedMediaItem.Builder(mediaItem)
      .apply {
        if (effects.isNotEmpty()) {
          setEffects(Effects(emptyList(), effects))
        }
      }
      .build()

    val speedFactor = normalizeSpeed(options.speedFactor)
    val outputDurationMs = if (speedFactor != null) {
      // SpeedChangeEffect scales the composition by 1/speedFactor; match for the JS caller.
      ((options.endMs - options.startMs) / speedFactor).roundToInt().toLong()
    } else {
      (options.endMs - options.startMs).toLong()
    }

    // Transformer must be created and started on the main looper.
    Handler(Looper.getMainLooper()).post {
      val transformer = Transformer.Builder(context)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            promise.resolve(
              mapOf(
                "uri" to Uri.fromFile(outputFile).toString(),
                "durationMs" to outputDurationMs,
              )
            )
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException,
          ) {
            outputFile.delete()
            promise.reject(
              MediaEditorException("ERR_TRIM", exportException.message ?: "Export failed")
            )
          }
        })
        .build()

      transformer.start(editedMediaItem, outputFile.absolutePath)
    }
  }

  /**
   * Effects order: color (matrix+LUT) → speed → crop → overlay. Matches the live preview seam
   * so overlays land on the color-graded, cropped frame. Empty chain keeps pure trims passthrough.
   */
  private fun buildEffects(context: Context, uri: String, options: TrimOptions): List<Effect> {
    val out = mutableListOf<Effect>()

    options.colorMatrix?.let { m ->
      buildRgbMatrixEffect(m)?.let { out.add(it) }
    }

    options.lutImageUri?.let { lutUri ->
      buildLutEffect(context, lutUri)?.let { out.add(it) }
    }

    normalizeSpeed(options.speedFactor)?.let { speed ->
      out.add(SpeedChangeEffect(speed.toFloat()))
    }

    options.crop?.let { out.add(buildCropEffect(context, uri, it)) }
    options.overlayImageUri?.let { overlayUri ->
      buildOverlayEffect(context, overlayUri)?.let { out.add(it) }
    }
    return out
  }

  /**
   * Skia 4×5 row-major → Media3 RgbMatrix 4×4 column-major. Alpha row dropped (RgbMatrix is RGB-only);
   * bias collapses into col3 so `M * vec4(rgb, 1)` = `M_3x3 * rgb + bias`.
   */
  private fun buildRgbMatrixEffect(m: List<Double>): RgbMatrix? {
    if (m.size != 20) return null
    val gl = FloatArray(16)
    gl[0] = m[0].toFloat();  gl[1] = m[5].toFloat();  gl[2] = m[10].toFloat(); gl[3] = 0f
    gl[4] = m[1].toFloat();  gl[5] = m[6].toFloat();  gl[6] = m[11].toFloat(); gl[7] = 0f
    gl[8] = m[2].toFloat();  gl[9] = m[7].toFloat();  gl[10] = m[12].toFloat(); gl[11] = 0f
    gl[12] = m[4].toFloat(); gl[13] = m[9].toFloat(); gl[14] = m[14].toFloat(); gl[15] = 1f
    return RgbMatrix { _, _ -> gl }
  }

  /**
   * Build a Media3 SingleColorLut from a HALD PNG. `SingleColorLut` has no intensity mix on Android,
   * so fractional-intensity LUTs degrade to full strength (platform limitation).
   */
  private fun buildLutEffect(context: Context, lutUri: String): SingleColorLut? {
    val bitmap = decodeBitmap(context, lutUri) ?: return null
    return try {
      SingleColorLut.createFromBitmap(bitmap)
    } catch (_: Throwable) {
      null
    }
  }

  /**
   * Clamp to [0.5, 2.0]; null near 1.0 short-circuits the shader (SpeedChangeEffect(1.0) still runs it).
   */
  private fun normalizeSpeed(value: Double): Double? {
    val clamped = value.coerceIn(0.5, 2.0)
    if (kotlin.math.abs(clamped - 1.0) < 1e-4) return null
    return clamped
  }

  // Media3 Crop takes NDC [-1,1] centered; convert from display-pixel top-left with Y inverted.
  private fun buildCropEffect(context: Context, uri: String, crop: CropRectOptions): Crop {
    val (displayWidth, displayHeight) = readDisplaySize(context, uri)
    if (displayWidth <= 0 || displayHeight <= 0) {
      throw MediaEditorException("ERR_TRIM", "Video track has zero display size")
    }

    val cropX = crop.x.coerceIn(0.0, displayWidth)
    val cropY = crop.y.coerceIn(0.0, displayHeight)
    val cropW = crop.width.coerceIn(0.0, displayWidth - cropX)
    val cropH = crop.height.coerceIn(0.0, displayHeight - cropY)
    if (cropW <= 0.0 || cropH <= 0.0) {
      throw MediaEditorException("ERR_TRIM", "Invalid trim range")
    }

    val left = (2.0 * cropX / displayWidth - 1.0).toFloat()
    val right = (2.0 * (cropX + cropW) / displayWidth - 1.0).toFloat()
    val top = (1.0 - 2.0 * cropY / displayHeight).toFloat()
    val bottom = (1.0 - 2.0 * (cropY + cropH) / displayHeight).toFloat()
    return Crop(left, right, bottom, top)
  }

  /**
   * Build a Media3 OverlayEffect from a static PNG; nil skips the stage (unreadable overlay is non-fatal).
   */
  private fun buildOverlayEffect(context: Context, overlayUri: String): OverlayEffect? {
    val bitmap = decodeBitmap(context, overlayUri) ?: return null
    val overlay = BitmapOverlay.createStaticBitmapOverlay(bitmap)
    return OverlayEffect(listOf(overlay))
  }

  /** Decode a bitmap from a `file://` URI or plain path; null on any failure. */
  private fun decodeBitmap(context: Context, uri: String): Bitmap? {
    val parsed = try {
      Uri.parse(uri)
    } catch (_: Throwable) {
      null
    }
    if (parsed != null && parsed.scheme == "file") {
      val path = parsed.path ?: return null
      return BitmapFactory.decodeFile(path)
    }
    if (parsed != null && parsed.scheme != null) {
      return runCatching {
        val stream: InputStream? = context.contentResolver.openInputStream(parsed)
        stream?.use { BitmapFactory.decodeStream(it) }
      }.getOrNull()
    }
    return BitmapFactory.decodeFile(uri)
  }

  private fun readDisplaySize(context: Context, uri: String): Pair<Double, Double> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setSource(context, uri)
      val rotation = retriever.extractMetadata(
        MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION
      )?.toLongOrNull() ?: 0L
      val codedWidth = retriever.extractMetadata(
        MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH
      )?.toLongOrNull() ?: 0L
      val codedHeight = retriever.extractMetadata(
        MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT
      )?.toLongOrNull() ?: 0L
      val swapped = rotation == 90L || rotation == 270L
      val displayWidth = (if (swapped) codedHeight else codedWidth).toDouble()
      val displayHeight = (if (swapped) codedWidth else codedHeight).toDouble()
      return displayWidth to displayHeight
    } finally {
      retriever.release()
    }
  }
}
