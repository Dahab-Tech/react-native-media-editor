package com.dahabtech.mediaeditor.compile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.InputStream

/** Container-level probes and asset decoding shared by the compile pipeline. */
object SourceProbe {
  fun hasAudioTrack(context: Context, uri: String): Boolean {
    val extractor = MediaExtractor()
    return try {
      setSource(extractor, context, uri)
      (0 until extractor.trackCount).any {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      }
    } catch (_: Throwable) {
      // Unreadable metadata: assume audio exists so a real track is never silently stripped.
      true
    } finally {
      extractor.release()
    }
  }

  // Use playback fps, not CAPTURE_FRAMERATE — slo-mo reports 120/240 and inflates the bitrate heuristic.
  fun readFrameRate(context: Context, uri: String): Double {
    val extractor = MediaExtractor()
    try {
      setSource(extractor, context, uri)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("video/")) continue
        if (!format.containsKey(MediaFormat.KEY_FRAME_RATE)) return 0.0
        return runCatching { format.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble() }
          .recoverCatching { format.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble() }
          .getOrDefault(0.0)
      }
      return 0.0
    } catch (_: Throwable) {
      return 0.0
    } finally {
      extractor.release()
    }
  }

  /** Decode a bitmap from a `file://`/content URI or plain path; null on any failure. */
  fun decodeBitmap(context: Context, uri: String): Bitmap? {
    val parsed = runCatching { Uri.parse(uri) }.getOrNull()
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

  private fun setSource(extractor: MediaExtractor, context: Context, uri: String) {
    val parsed = Uri.parse(uri)
    if (parsed.scheme == null) extractor.setDataSource(uri) else extractor.setDataSource(context, parsed, null)
  }
}
