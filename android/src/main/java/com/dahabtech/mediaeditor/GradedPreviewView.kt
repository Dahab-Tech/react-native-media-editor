package com.dahabtech.mediaeditor

import android.content.Context
import android.net.Uri
import android.view.TextureView
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.exoplayer.ExoPlayer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Rate-controlled graded preview: ExoPlayer looping the trim range with the SAME Media3 effects the
 * export builds (RgbMatrix/SingleColorLut) — graded playback at any speed without seek-per-frame.
 * TextureView, not SurfaceView (SurfaceView punches through overlapping RN views).
 */
@androidx.annotation.OptIn(UnstableApi::class)
class GradedPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val textureView = TextureView(context)
  private var player: ExoPlayer? = null

  val onPreviewError by EventDispatcher<Map<String, Any>>()

  var sourceUri: String? = null
    set(value) { if (value != field) { field = value; needsRebuild = true } }
  var startMs: Double = 0.0
    set(value) { if (value != field) { field = value; needsRebuild = true } }
  var endMs: Double = 0.0
    set(value) { if (value != field) { field = value; needsRebuild = true } }
  var colorMatrix: List<Double>? = null
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  var lutUri: String? = null
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  // Accepted for cross-platform prop parity; Android's SingleColorLut has no intensity mix (matches export).
  var lutIntensity: Double = 1.0
  var washUri: String? = null
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  var washBlendMode: String? = null
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  var washIntensity: Double = 1.0
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  var rate: Double = 1.0
  var paused: Boolean = false
  // Cap on the GL effect-chain output height; 0 = source resolution. Preview-only (export untouched).
  var renderHeight: Int = 0
    set(value) { if (value != field) { field = value; needsGradeUpdate = true } }
  var positionMs: Double = -1.0
    set(value) { if (value >= 0 && value != field) { pendingSeekMs = value }; field = value }

  private var needsRebuild = false
  private var needsGradeUpdate = false
  private var pendingSeekMs: Double? = null

  // Debounce grade rebuilds: setVideoEffects only applies before prepare(), so each grade change costs a
  // stop→prepare cycle — coalesce slider ticks instead of rebuilding per frame.
  private val gradeRebuildRunnable = Runnable { rebuild(keepPosition = true) }

  private val playerListener = object : Player.Listener {
    override fun onPlayerError(error: PlaybackException) {
      onPreviewError(mapOf("message" to (error.message ?: error.errorCodeName)))
    }
  }

  init {
    addView(textureView)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    textureView.layout(0, 0, r - l, b - t)
  }

  fun commitProps() {
    if (needsRebuild) {
      needsRebuild = false
      needsGradeUpdate = false
      removeCallbacks(gradeRebuildRunnable)
      rebuild(keepPosition = false)
    } else if (needsGradeUpdate) {
      needsGradeUpdate = false
      removeCallbacks(gradeRebuildRunnable)
      postDelayed(gradeRebuildRunnable, 150)
    }
    pendingSeekMs?.let { absolute ->
      pendingSeekMs = null
      // ClippingConfiguration makes seekTo relative to the clip start.
      player?.seekTo((absolute - startMs).toLong().coerceAtLeast(0L))
    }
    applyPlayback()
  }

  fun release() {
    removeCallbacks(gradeRebuildRunnable)
    player?.release()
    player = null
  }

  private fun applyPlayback() {
    val p = player ?: return
    p.setPlaybackSpeed(rate.toFloat().coerceIn(0.25f, 4f))
    p.playWhenReady = !paused
  }

  private fun rebuild(keepPosition: Boolean) {
    val uri = sourceUri ?: run { release(); return }
    // Media3 honors setVideoEffects only before the FIRST prepare. Re-preparing a reused player
    // races its internal GL video-graph teardown and can kill video output silently and permanently
    // (frames stop, playback keeps "running", no onPlayerError). Always build a fresh player;
    // releasing the old one first also frees its codec before the new one requests it.
    val old = player
    val resumeMs = if (keepPosition) (old?.currentPosition ?: 0L) else 0L
    old?.release()
    val p = ExoPlayer.Builder(context).build().also {
      player = it
      // Audio/timeline belong to the primary expo-video player; this view is video-only.
      it.volume = 0f
      it.repeatMode = Player.REPEAT_MODE_ONE
      it.setVideoEffects(buildPreviewEffects())
      it.setVideoTextureView(textureView)
      it.addListener(playerListener)
    }
    val clipping = MediaItem.ClippingConfiguration.Builder()
      .setStartPositionMs(startMs.toLong().coerceAtLeast(0L))
      .apply { if (endMs > startMs) setEndPositionMs(endMs.toLong()) }
      .build()
    p.setMediaItem(
      MediaItem.Builder().setUri(Uri.parse(uri)).setClippingConfiguration(clipping).build()
    )
    p.prepare()
    if (resumeMs > 0L) p.seekTo(resumeMs)
    applyPlayback()
  }

  private fun buildPreviewEffects(): List<Effect> {
    val out = mutableListOf<Effect>()
    // Downscale FIRST so the grade passes below run at preview res, not source res (~4x less GL at 1080p→608).
    if (renderHeight > 0) out.add(Presentation.createForHeight(renderHeight))
    colorMatrix?.let { m -> VideoTrimmer.buildRgbMatrixEffect(m)?.let { out.add(it) } }
    lutUri?.let { lut -> VideoTrimmer.buildLutEffect(context, lut)?.let { out.add(it) } }
    washUri?.let { wash ->
      VideoTrimmer.buildWashEffect(context, wash, washBlendMode, washIntensity)?.let { out.add(it) }
    }
    return out
  }
}
