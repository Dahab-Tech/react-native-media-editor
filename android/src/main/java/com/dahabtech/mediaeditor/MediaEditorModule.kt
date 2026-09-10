package com.dahabtech.mediaeditor

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MediaEditorModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MediaEditor")

    AsyncFunction("getVideoInfo") { uri: String ->
      VideoInfoReader.read(context, uri)
    }

    AsyncFunction("trim") { uri: String, options: TrimOptions, promise: Promise ->
      VideoTrimmer.trim(context, uri, options, promise)
    }

    AsyncFunction("getThumbnail") { uri: String, options: ThumbnailOptions ->
      ThumbnailGenerator.generate(context, uri, options)
    }

    AsyncFunction("writeCacheFile") { base64: String, extension: String ->
      PhotoFileWriter.write(context, base64, extension)
    }

    AsyncFunction("readCacheFile") { uri: String ->
      PhotoFileWriter.readAsBase64(uri)
    }

    // Warm MediaCodec scrub session; JS falls back to ScrubFrameOverlay on reject or onFatalError.
    AsyncFunction("createScrubSession") { uri: String ->
      val (id, info) = ScrubEngine.create(context, uri)
      mapOf(
        "sessionId" to id,
        "width" to info.width,
        "height" to info.height,
        "rotation" to info.rotation,
        "durationMs" to (info.durationUs / 1000.0),
      )
    }

    // Fire-and-forget: latest-wins on the native side, JS never awaits.
    AsyncFunction("scrubSessionTo") { sessionId: Int, timeMs: Double ->
      ScrubEngine.get(sessionId)?.scrubTo((timeMs * 1000.0).toLong())
    }

    AsyncFunction("releaseScrubSession") { sessionId: Int ->
      ScrubEngine.destroy(sessionId)
    }

    View(ScrubPreviewView::class) {
      Events("onFatalError")
      Prop("sessionId") { view: ScrubPreviewView, sessionId: Int? ->
        if (sessionId != null && sessionId >= 0) view.setSessionId(sessionId)
      }
      Prop("videoRotation") { view: ScrubPreviewView, rotation: Int? ->
        view.setVideoRotation(rotation ?: 0)
      }
    }

    View(GradedPreviewView::class) {
      Events("onPreviewError")
      Prop("sourceUri") { view: GradedPreviewView, value: String? -> view.sourceUri = value }
      Prop("startMs") { view: GradedPreviewView, value: Double -> view.startMs = value }
      Prop("endMs") { view: GradedPreviewView, value: Double -> view.endMs = value }
      Prop("colorMatrix") { view: GradedPreviewView, value: List<Double>? -> view.colorMatrix = value }
      Prop("lutUri") { view: GradedPreviewView, value: String? -> view.lutUri = value }
      Prop("lutIntensity") { view: GradedPreviewView, value: Double -> view.lutIntensity = value }
      Prop("washUri") { view: GradedPreviewView, value: String? -> view.washUri = value }
      Prop("washBlendMode") { view: GradedPreviewView, value: String? -> view.washBlendMode = value }
      Prop("washIntensity") { view: GradedPreviewView, value: Double -> view.washIntensity = value }
      Prop("renderHeight") { view: GradedPreviewView, value: Int -> view.renderHeight = value }
      Prop("rate") { view: GradedPreviewView, value: Double -> view.rate = value }
      Prop("paused") { view: GradedPreviewView, value: Boolean -> view.paused = value }
      Prop("positionMs") { view: GradedPreviewView, value: Double -> view.positionMs = value }
      OnViewDidUpdateProps { view: GradedPreviewView -> view.commitProps() }
      OnViewDestroys { view: GradedPreviewView -> view.release() }
    }
  }
}
