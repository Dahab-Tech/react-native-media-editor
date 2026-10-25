package com.dahabtech.mediaeditor

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.FileOutputStream
import kotlin.math.roundToInt

object ThumbnailGenerator {
  fun generate(context: Context, uri: String, options: ThumbnailOptions): Map<String, Any> {
    validateSource(uri, "ERR_THUMBNAIL")
    val retriever = MediaMetadataRetriever()
    val frame = try {
      retriever.setSource(context, uri)
      retriever.getFrameAtTime(
        (options.timeMs * 1000).toLong(),
        MediaMetadataRetriever.OPTION_CLOSEST,
      ) ?: throw MediaEditorException("ERR_THUMBNAIL", "Could not extract a frame")
    } finally {
      retriever.release()
    }
    val (fileUri, width, height) = encode(context, frame, options.maxWidth, options.quality)
    return mapOf("uri" to fileUri, "width" to width, "height" to height)
  }

  /** One retriever pass, nearest-sync-frame accuracy: strip tiles don't need exact frames. */
  fun generateStrip(context: Context, uri: String, options: ThumbnailStripOptions): List<String?> {
    validateSource(uri, "ERR_THUMBNAIL")
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setSource(context, uri)
      return options.timesMs.map { timeMs ->
        val frame = retriever.getFrameAtTime(
          (timeMs * 1000).toLong(),
          MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
        ) ?: return@map null
        try {
          encode(context, frame, options.maxWidth, options.quality).first
        } catch (_: Exception) {
          null
        }
      }
    } finally {
      retriever.release()
    }
  }

  private fun encode(
    context: Context,
    frame: Bitmap,
    maxWidth: Double,
    quality: Double,
  ): Triple<String, Int, Int> {
    val bitmap = if (maxWidth > 0 && frame.width > maxWidth) {
      val scale = maxWidth / frame.width
      Bitmap.createScaledBitmap(
        frame,
        maxWidth.roundToInt(),
        (frame.height * scale).roundToInt(),
        true,
      )
    } else {
      frame
    }

    try {
      val outputFile = cacheFile(context, "cover", "jpg")
      FileOutputStream(outputFile).use { stream ->
        val clamped = (quality * 100).roundToInt().coerceIn(0, 100)
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, clamped, stream)) {
          throw MediaEditorException("ERR_THUMBNAIL", "Could not encode the thumbnail")
        }
      }
      return Triple(Uri.fromFile(outputFile).toString(), bitmap.width, bitmap.height)
    } finally {
      // createScaledBitmap may return the same instance when no rescale is needed; avoid double-recycle.
      if (bitmap !== frame) frame.recycle()
      bitmap.recycle()
    }
  }
}
