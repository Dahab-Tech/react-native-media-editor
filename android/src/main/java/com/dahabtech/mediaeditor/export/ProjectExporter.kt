package com.dahabtech.mediaeditor.export

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.dahabtech.mediaeditor.MediaEditorException
import com.dahabtech.mediaeditor.cacheFile
import com.dahabtech.mediaeditor.compile.SourceProbe
import com.dahabtech.mediaeditor.compile.TimelineCompiler
import com.dahabtech.mediaeditor.records.CompressionRecord
import com.dahabtech.mediaeditor.records.ProjectRecords
import com.dahabtech.mediaeditor.validateSource
import expo.modules.kotlin.Promise
import kotlin.math.max

/** Renders a compiled project to an mp4 via Transformer; progress reported in [0, 1]. */
@androidx.annotation.OptIn(UnstableApi::class)
object ProjectExporter {
  private const val PROGRESS_INTERVAL_MS = 500L

  fun export(context: Context, projectJson: String, promise: Promise, onProgress: (Double) -> Unit) {
    val project = try {
      val parsed = ProjectRecords.parse(projectJson)
      parsed.clips.forEach { validateSource(it.source, "ERR_EXPORT") }
      parsed.pips.forEach { validateSource(it.clip.source, "ERR_EXPORT") }
      parsed
    } catch (exception: MediaEditorException) {
      promise.reject(exception)
      return
    } catch (exception: Exception) {
      promise.reject(MediaEditorException("ERR_EXPORT", exception.message ?: "Invalid project"))
      return
    }

    val timeline = try {
      TimelineCompiler.compile(context, project)
    } catch (exception: MediaEditorException) {
      promise.reject(exception)
      return
    }

    val outputFile = cacheFile(context, "export", "mp4")
    // Transformer must be created and started on the main looper.
    Handler(Looper.getMainLooper()).post {
      val builder = Transformer.Builder(context)
      project.output?.compression?.let { compression ->
        val fps = SourceProbe.readFrameRate(context, project.clips.first().source)
        val bitrate = resolveTargetBitrate(timeline.renderWidth, timeline.renderHeight, fps, compression)
        builder.setEncoderFactory(
          DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .build()
        )
      }

      lateinit var transformer: Transformer
      val handler = Handler(Looper.getMainLooper())
      val progressHolder = ProgressHolder()
      lateinit var pollProgress: Runnable
      var finished = false

      transformer = builder
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            finished = true
            onProgress(1.0)
            promise.resolve(
              mapOf(
                "uri" to Uri.fromFile(outputFile).toString(),
                "durationMs" to timeline.totalDurationMs,
              )
            )
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException,
          ) {
            finished = true
            outputFile.delete()
            val message = exportException.message ?: "Export failed"
            promise.reject(MediaEditorException("ERR_EXPORT", "$message (${exportException.errorCodeName})"))
          }
        })
        .build()

      pollProgress = Runnable {
        if (finished) return@Runnable
        if (transformer.getProgress(progressHolder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          onProgress(progressHolder.progress / 100.0)
        }
        handler.postDelayed(pollProgress, PROGRESS_INTERVAL_MS)
      }

      transformer.start(timeline.composition, outputFile.absolutePath)
      handler.postDelayed(pollProgress, PROGRESS_INTERVAL_MS)
    }
  }

  /** Resolve target average video bitrate (bits per second) with a 250 kbps floor. */
  private fun resolveTargetBitrate(
    width: Int,
    height: Int,
    fps: Double,
    compression: CompressionRecord,
  ): Int {
    val floorBps = 250_000
    compression.bitrateMbps?.takeIf { it > 0 }?.let { return max(floorBps, (it * 1_000_000).toInt()) }
    val bpp = when (compression.preset?.lowercase()) {
      "high" -> 0.15
      "low" -> 0.04
      else -> 0.08
    }
    val effectiveFps = if (fps > 0) fps else 30.0
    val bps = width.toDouble() * height.toDouble() * effectiveFps * bpp
    return max(floorBps, bps.toInt())
  }
}
