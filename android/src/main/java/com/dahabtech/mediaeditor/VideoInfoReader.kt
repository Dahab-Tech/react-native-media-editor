package com.dahabtech.mediaeditor

import android.content.Context
import android.media.MediaMetadataRetriever

object VideoInfoReader {
  fun read(context: Context, uri: String): Map<String, Any> {
    validateSource(uri, "ERR_VIDEO_INFO")
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setSource(context, uri)
      if (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == null) {
        throw MediaEditorException("ERR_VIDEO_INFO", "The file has no video track")
      }

      val durationMs = retriever.metadataLong(MediaMetadataRetriever.METADATA_KEY_DURATION)
      val rotation = retriever.metadataLong(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
      val codedWidth = retriever.metadataLong(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
      val codedHeight = retriever.metadataLong(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
      // Match iOS: report display dimensions with rotation applied.
      val swapped = rotation == 90L || rotation == 270L
      val frameCount = retriever.metadataLong(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)
      val fps = if (durationMs > 0) frameCount * 1000.0 / durationMs else 0.0

      return mapOf(
        "durationMs" to durationMs.toDouble(),
        "width" to (if (swapped) codedHeight else codedWidth).toDouble(),
        "height" to (if (swapped) codedWidth else codedHeight).toDouble(),
        "rotation" to rotation.toDouble(),
        "fps" to fps,
      )
    } finally {
      retriever.release()
    }
  }

  private fun MediaMetadataRetriever.metadataLong(key: Int): Long =
    extractMetadata(key)?.toLongOrNull() ?: 0L
}
