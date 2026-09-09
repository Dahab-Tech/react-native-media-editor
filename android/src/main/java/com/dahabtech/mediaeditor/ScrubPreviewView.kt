package com.dahabtech.mediaeditor

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Scrub preview using TextureView, not SurfaceView — SurfaceView punches through overlapping RN views and ignores transform matrix. */
class ScrubPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val textureView = TextureView(context)
  private var currentSessionId: Int = -1
  private var videoRotation: Int = 0
  private var surface: Surface? = null

  val onFatalError by EventDispatcher<Map<String, Any>>()

  init {
    addView(textureView)
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        surface = Surface(surfaceTexture)
        bindEngineSurface()
      }

      override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        applyRotationTransform(width, height)
      }

      override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        // Hand teardown to the engine's worker — releasing under an in-flight decode makes vendor codecs throw and we'd misread it as fatal.
        val s = surface
        surface = null
        val engine = ScrubEngine.get(currentSessionId)
        if (engine != null && engine.detachSurface(s, surfaceTexture)) return false
        s?.release()
        return true
      }

      override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {}
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    textureView.layout(0, 0, r - l, b - t)
    applyRotationTransform(width, height)
  }

  fun setSessionId(id: Int) {
    if (currentSessionId == id) return
    // Detach previous.
    if (currentSessionId != -1) {
      ScrubEngine.get(currentSessionId)?.attachSurface(null)
    }
    currentSessionId = id
    val engine = ScrubEngine.get(id)
    if (engine == null) {
      onFatalError(mapOf("message" to "session not found"))
      return
    }
    engine.setOnError { msg ->
      onFatalError(mapOf("message" to msg))
    }
    bindEngineSurface()
  }

  // Named videoRotation because RN core's built-in `rotation` view prop would rotate the Android view itself and shadow this one.
  fun setVideoRotation(deg: Int) {
    videoRotation = ((deg % 360) + 360) % 360
    applyRotationTransform(width, height)
  }

  private fun bindEngineSurface() {
    val engine = ScrubEngine.get(currentSessionId) ?: return
    val s = surface ?: return
    // Attach + lazy codec configure run on the engine's worker; failures surface through its error listener.
    engine.attachSurface(s)
  }

  private fun applyRotationTransform(viewW: Int, viewH: Int) {
    if (viewW <= 0 || viewH <= 0) return
    val matrix = Matrix()
    if (videoRotation != 0) {
      matrix.postRotate(videoRotation.toFloat(), viewW / 2f, viewH / 2f)
      // 90/270 leaves content in H×W; scale by (W/H, H/W) about center to restore a full-bleed W×H fill.
      if (videoRotation == 90 || videoRotation == 270) {
        val scaleX = viewW.toFloat() / viewH.toFloat()
        val scaleY = viewH.toFloat() / viewW.toFloat()
        matrix.postScale(scaleX, scaleY, viewW / 2f, viewH / 2f)
      }
    }
    textureView.setTransform(matrix)
  }
}
