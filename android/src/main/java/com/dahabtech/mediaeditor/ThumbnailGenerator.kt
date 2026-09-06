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

    val bitmap = if (options.maxWidth > 0 && frame.width > options.maxWidth) {
      val scale = options.maxWidth / frame.width
      Bitmap.createScaledBitmap(
        frame,
        options.maxWidth.roundToInt(),
        (frame.height * scale).roundToInt(),
        true,
      )
    } else {
      frame
    }

    try {
      val outputFile = cacheFile(context, "cover", "jpg")
      FileOutputStream(outputFile).use { stream ->
        val quality = (options.quality * 100).roundToInt().coerceIn(0, 100)
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)) {
          throw MediaEditorException("ERR_THUMBNAIL", "Could not encode the thumbnail")
        }
      }

      return mapOf(
        "uri" to Uri.fromFile(outputFile).toString(),
        "width" to bitmap.width,
        "height" to bitmap.height,
      )
    } finally {
      // createScaledBitmap may return the same instance when no rescale is needed; avoid double-recycle.
      if (bitmap !== frame) frame.recycle()
      bitmap.recycle()
    }
  }
}
