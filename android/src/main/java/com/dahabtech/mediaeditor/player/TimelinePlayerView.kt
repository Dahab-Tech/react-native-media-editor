package com.dahabtech.mediaeditor.player

import android.content.Context
import android.view.SurfaceView
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.CompositionPlayer
import com.dahabtech.mediaeditor.compile.TimelineCompiler
import com.dahabtech.mediaeditor.records.ProjectRecords
import com.dahabtech.mediaeditor.records.TimelineIndex
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Timeline preview: CompositionPlayer over the same compiled composition the export uses,
 * so preview and export match by construction.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class TimelinePlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val surfaceView = SurfaceView(context)
  private var player: CompositionPlayer? = null
  private var index: TimelineIndex? = null
  private var tickRunnable: Runnable? = null
  private var lastClipIndex = -1

  val onReady by EventDispatcher<Map<String, Any>>()
  val onTimeUpdate by EventDispatcher<Map<String, Any>>()
  val onClipChanged by EventDispatcher<Map<String, Any>>()
  val onPlayEnd by EventDispatcher<Map<String, Any>>()
  val onPlayerError by EventDispatcher<Map<String, Any>>()

  var projectJson: String? = null
    set(value) { if (value != field) { field = value; rebuild() } }
  var paused: Boolean = false
    set(value) { field = value; applyPlayback() }
  var loop: Boolean = false
  var volume: Double = 1.0
    set(value) { field = value; player?.volume = value.toFloat() }
  var timeUpdateIntervalMs: Double = 250.0

  private var scrubbing = false
  // Resume truth for rebuilds: while paused, sampled currentPosition lags an in-flight seek —
  // the last requested target is the position the user chose, and resuming anywhere else shows
  // up as a small timeline nudge after every recompile.
  private var lastSeekTargetMs: Long? = null
  // High-water mark for emitted ticks; reset on every explicit discontinuity (seek, rebuild).
  private var lastEmittedMs = -1.0

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
      if (state == Player.STATE_READY && !readySent) {
        readySent = true
        onReady(mapOf(
          "durationMs" to (index?.totalDurationUs ?: 0L) / 1000.0,
          "clipDurationsMs" to clipDurationsMs,
        ))
      }
      if (state == Player.STATE_ENDED) {
        if (loop) {
          seekTo(0.0)
          applyPlayback()
        } else {
          onPlayEnd(emptyMap())
        }
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) lastSeekTargetMs = null
      // Transport edges tick immediately with the real rate — the poll alone leaves JS without
      // evidence for up to a full interval, and a stop must park JS so it never animates through.
      emitTick(if (isPlaying) 1.0 else 0.0)
    }

    override fun onPlayerError(error: PlaybackException) {
      this@TimelinePlayerView.onPlayerError(mapOf("message" to (error.message ?: error.errorCodeName)))
    }
  }

  private var readySent = false
  private var clipDurationsMs: List<Double> = emptyList()

  init {
    addView(surfaceView)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    surfaceView.layout(0, 0, r - l, b - t)
  }

  fun seekTo(ms: Double) {
    lastEmittedMs = -1.0
    // Never land on the exact end: position == duration is STATE_ENDED, and with loop on the
    // ENDED handler would instantly restart from 0 — a settle seek must park, not restart.
    val maxMs = index?.let { (it.totalDurationUs / 1000 - 1).coerceAtLeast(0L) } ?: Long.MAX_VALUE
    val targetMs = ms.toLong().coerceIn(0L, maxMs)
    lastSeekTargetMs = targetMs
    player?.seekTo(targetMs)
  }

  fun setScrubbing(active: Boolean) {
    if (active == scrubbing) return
    scrubbing = active
    player?.setScrubbingModeEnabled(active)
    applyPlayback()
  }

  fun release() {
    tickRunnable?.let { removeCallbacks(it) }
    tickRunnable = null
    // Detach first: teardown errors from a discarded player (e.g. release timeout) are noise.
    player?.removeListener(listener)
    player?.release()
    player = null
    index = null
    lastClipIndex = -1
    lastEmittedMs = -1.0
    readySent = false
  }

  private fun applyPlayback() {
    player?.playWhenReady = !paused && !scrubbing
  }

  private fun rebuild() {
    val json = projectJson
    if (json == null) {
      release()
      return
    }
    // Edits recompile the composition; keep the playhead where the user left it.
    val resumeMs = player?.let { p ->
      if (p.isPlaying) p.currentPosition else lastSeekTargetMs ?: p.currentPosition
    } ?: 0L
    try {
      // Compile before teardown so the outgoing frame stays on screen through the heavy work.
      val project = ProjectRecords.parse(json)
      val compiled = TimelineCompiler.compile(context, project)
      release()
      index = compiled.index
      clipDurationsMs = project.clips.map { TimelineIndex.clipOutputDurationUs(it) / 1000.0 }
      val p = CompositionPlayer.Builder(context).build()
      player = p
      p.addListener(listener)
      p.setVideoSurfaceView(surfaceView)
      p.volume = volume.toFloat()
      p.setComposition(compiled.composition)
      // duration − 1: resuming on the exact end trips STATE_ENDED → loop restarts from 0.
      val resumeClampedMs =
        resumeMs.coerceIn(0L, (compiled.index.totalDurationUs / 1000 - 1).coerceAtLeast(0L))
      if (resumeClampedMs > 0L) {
        // Land the restore position before prepare — a post-prepare seek renders frame 0 first,
        // a visible jump back on every recompile.
        p.seekTo(resumeClampedMs)
      }
      p.prepare()
      // SimpleBasePlayer ignores seeks its state doesn't accept; if the pre-prepare one was
      // dropped the reported position stays 0 and the old post-prepare path takes over.
      if (resumeClampedMs > 0L && p.currentPosition < resumeClampedMs - 50) {
        p.seekTo(resumeClampedMs)
      }
      applyPlayback()
      startTicks()
      // One authoritative tick after the swap (matches iOS): JS holds its parked clock through
      // the rebuild and trusts this landed position and transport state.
      lastEmittedMs = -1.0
      emitTick(if (p.isPlaying) 1.0 else 0.0)
    } catch (t: Throwable) {
      onPlayerError(mapOf("message" to (t.message ?: t.toString())))
    }
  }

  // Single emission path (matches iOS). Two invariants JS animates against: positions never move
  // backwards between explicit discontinuities (seek/rebuild reset the mark), and every tick
  // carries the transport rate so JS never animates through a stall it cannot see.
  private fun emitTick(rate: Double = 1.0) {
    val p = player ?: return
    if (rate > 0.0 && !p.isPlaying) return
    var positionMs = p.currentPosition.toDouble()
    if (positionMs < lastEmittedMs) positionMs = lastEmittedMs
    lastEmittedMs = positionMs
    val clipIndex = index?.positionToClip((positionMs * 1000).toLong())?.clipIndex ?: 0
    if (clipIndex != lastClipIndex) {
      lastClipIndex = clipIndex
      onClipChanged(mapOf("clipIndex" to clipIndex))
    }
    onTimeUpdate(mapOf("positionMs" to positionMs, "clipIndex" to clipIndex, "rate" to rate))
  }

  private fun startTicks() {
    val tick = object : Runnable {
      override fun run() {
        emitTick()
        postDelayed(this, timeUpdateIntervalMs.toLong().coerceAtLeast(16L))
      }
    }
    tickRunnable = tick
    postDelayed(tick, timeUpdateIntervalMs.toLong().coerceAtLeast(16L))
  }
}
