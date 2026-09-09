package com.dahabtech.mediaeditor

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs

/** Warm MediaCodec pipeline for scrubbing; decoder never tears down between seeks. Latest-wins target — the decode loop always honors the newest. */
class ScrubEngine private constructor(
  private val context: Context,
  private val uri: String,
  sessionId: Int,
) {
  data class Info(val width: Int, val height: Int, val rotation: Int, val durationUs: Long)

  private val thread = HandlerThread("MediaEditor-Scrub-$sessionId").also { it.start() }
  private val handler = Handler(thread.looper)

  // Extractor/codec/surface are touched ONLY on the worker thread after prepare.
  private var extractor: MediaExtractor? = null
  private var codec: MediaCodec? = null
  private var surface: Surface? = null
  private var videoTrackIndex: Int = -1
  private var durationUs: Long = 0L
  private var trackRotation: Int = 0
  // Keyframe PTS index built once at prepare: lets the loop decide flush-vs-forward without peeking the extractor (peek can't restore mid-GOP).
  private var syncTimesUs: LongArray = LongArray(0)

  private val pendingTargetUs = AtomicLong(NO_TARGET)
  private val lastRenderedUs = AtomicLong(-1L)
  private val released = AtomicBoolean(false)
  private val fatal = AtomicBoolean(false)
  private val decodeScheduled = AtomicBoolean(false)

  private var sawInputEos = false
  // Highest fed PTS (not decode order) so B-frame reordering can't regress the forward/flush decision.
  private var maxQueuedUs = -1L
  // Consecutive decode passes that produced zero output; bounded before going fatal.
  private var stalledPasses = 0
  // Written on the UI thread (view bind), read on the worker (reportFatal).
  @Volatile private var errorListener: ((String) -> Unit)? = null

  fun setOnError(listener: (String) -> Unit) {
    errorListener = listener
  }

  /** Attach/swap the render Surface and lazily configure the codec on the worker thread; idempotent. */
  fun attachSurface(newSurface: Surface?) {
    handler.post {
      if (released.get() || fatal.get()) return@post
      surface = newSurface
      if (newSurface == null) return@post
      val current = codec
      try {
        if (current == null) {
          configureLocked(newSurface)
          if (pendingTargetUs.get() != NO_TARGET) scheduleDecode()
        } else {
          current.setOutputSurface(newSurface)
          // The new surface has no frame yet; force a full re-render of the last target.
          val target = lastRenderedUs.getAndSet(-1L)
          if (target >= 0) {
            pendingTargetUs.set(target)
            scheduleDecode()
          }
        }
      } catch (t: Throwable) {
        reportFatal("attachSurface: ${t.message}")
      }
    }
  }

  /** Release Surface/SurfaceTexture on the worker AFTER in-flight decode — vendor codecs throw when releasing into an abandoned surface; returns false if the session is already gone. */
  fun detachSurface(oldSurface: Surface?, surfaceTexture: SurfaceTexture): Boolean {
    return handler.post {
      if (surface === oldSurface) surface = null
      oldSurface?.release()
      surfaceTexture.release()
    }
  }

  /** Open the source and index the video track. Worker-independent; called once at create. */
  fun prepareBlocking(): Info {
    val ex = MediaExtractor()
    val parsed = Uri.parse(uri)
    if (parsed.scheme == null) ex.setDataSource(uri) else ex.setDataSource(context, parsed, null)

    var trackIndex = -1
    var format: MediaFormat? = null
    for (i in 0 until ex.trackCount) {
      val f = ex.getTrackFormat(i)
      val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("video/")) {
        trackIndex = i
        format = f
        break
      }
    }
    if (trackIndex < 0 || format == null) {
      ex.release()
      throw MediaEditorException("ERR_SCRUB", "No video track")
    }
    ex.selectTrack(trackIndex)

    val width = format.getInteger(MediaFormat.KEY_WIDTH)
    val height = format.getInteger(MediaFormat.KEY_HEIGHT)
    val duration =
      if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION)
      else 0L
    // KEY_ROTATION may be absent on older files; MediaMetadataRetriever fills the gap.
    val rotation =
      if (format.containsKey(MediaFormat.KEY_ROTATION)) format.getInteger(MediaFormat.KEY_ROTATION)
      else readRotationFallback()

    // seekTo lands only on keyframes; stepping seekTo(t+1, NEXT_SYNC) enumerates them all with no decoding.
    val syncTimes = ArrayList<Long>()
    ex.seekTo(0L, MediaExtractor.SEEK_TO_NEXT_SYNC)
    var t = ex.sampleTime
    while (t >= 0) {
      syncTimes.add(t)
      ex.seekTo(t + 1, MediaExtractor.SEEK_TO_NEXT_SYNC)
      val next = ex.sampleTime
      if (next <= t) break
      t = next
    }
    ex.seekTo(0L, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    extractor = ex
    videoTrackIndex = trackIndex
    durationUs = duration
    trackRotation = rotation
    syncTimesUs = syncTimes.toLongArray()

    return Info(width, height, rotation, duration)
  }

  fun scrubTo(timeUs: Long) {
    if (released.get() || fatal.get()) return
    pendingTargetUs.set(timeUs.coerceAtLeast(0L))
    scheduleDecode()
  }

  fun release() {
    if (!released.compareAndSet(false, true)) return
    handler.post {
      try {
        codec?.stop()
      } catch (_: Throwable) {}
      try {
        codec?.release()
      } catch (_: Throwable) {}
      codec = null
      try {
        extractor?.release()
      } catch (_: Throwable) {}
      extractor = null
      surface = null
      thread.quitSafely()
    }
  }

  // ---- worker-thread internals ----

  private fun configureLocked(out: Surface) {
    val ex = extractor ?: throw MediaEditorException("ERR_SCRUB", "Not prepared")
    val fmt = ex.getTrackFormat(videoTrackIndex)
    val mime = fmt.getString(MediaFormat.KEY_MIME)!!
    codec =
      MediaCodec.createDecoderByType(mime).also {
        it.configure(fmt, out, null, 0)
        it.start()
      }
  }

  private fun scheduleDecode() {
    if (decodeScheduled.compareAndSet(false, true)) {
      handler.post(decodeRunnable)
    }
  }

  private val decodeRunnable = Runnable {
    decodeScheduled.set(false)
    if (released.get() || fatal.get()) return@Runnable
    try {
      runDecodePass()
    } catch (t: Throwable) {
      reportFatal(t.message ?: "decode")
    }
  }

  /** True when a keyframe sits strictly after `afterUs` and at or before `uptoUs`. */
  private fun hasSyncBetween(afterUs: Long, uptoUs: Long): Boolean {
    if (uptoUs <= afterUs) return false
    val times = syncTimesUs
    var lo = 0
    var hi = times.size - 1
    var found = -1L
    // Largest sync <= uptoUs.
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      if (times[mid] <= uptoUs) {
        found = times[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found > afterUs
  }

  private fun runDecodePass() {
    val ex = extractor ?: return
    val c = codec ?: return
    // No surface (backgrounded / TextureView recycled): leave target pending; attachSurface re-schedules.
    if (surface == null) return
    var target = pendingTargetUs.get()
    if (target == NO_TARGET) return

    val currentPos = lastRenderedUs.get()
    // Already showing (within one frame of) the target — nothing to do.
    if (currentPos >= 0 && abs(target - currentPos) <= FRAME_TOLERANCE_US) return

    // Flush when moving backward, starting fresh, or a keyframe sits between fed samples and target — jumping is cheaper than decoding across a GOP.
    val needFlush =
      currentPos < 0 || maxQueuedUs < 0 || target < currentPos || hasSyncBetween(maxQueuedUs, target)
    if (needFlush) {
      c.flush()
      ex.seekTo(target, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      sawInputEos = false
      maxQueuedUs = -1L
      lastRenderedUs.set(-1L)
    }

    val bufferInfo = MediaCodec.BufferInfo()
    var emptyDequeues = 0

    while (!released.get() && !fatal.get()) {
      // Re-read every iteration: mid-decode retargeting.
      target = pendingTargetUs.get()
      if (target == NO_TARGET) return

      if (!sawInputEos) {
        val inIndex = c.dequeueInputBuffer(0L)
        if (inIndex >= 0) {
          val inBuf: ByteBuffer? = c.getInputBuffer(inIndex)
          val size = if (inBuf == null) -1 else ex.readSampleData(inBuf, 0)
          if (size < 0) {
            sawInputEos = true
            c.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          } else {
            val ptsUs = ex.sampleTime
            c.queueInputBuffer(inIndex, 0, size, ptsUs, 0)
            if (ptsUs > maxQueuedUs) maxQueuedUs = ptsUs
            ex.advance()
          }
        }
      }

      val outIndex = c.dequeueOutputBuffer(bufferInfo, DEQUEUE_TIMEOUT_US)
      when {
        outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          // Bounded retries then fatal so JS swaps to the image-strip fallback — a held finger produces no further scrubTo to unstick us.
          emptyDequeues++
          if (emptyDequeues > MAX_EMPTY_DEQUEUES) {
            stalledPasses++
            if (stalledPasses >= MAX_STALLED_PASSES) {
              reportFatal("decoder stalled")
            } else if (decodeScheduled.compareAndSet(false, true)) {
              handler.postDelayed(decodeRunnable, STALL_RETRY_DELAY_MS)
            }
            return
          }
        }
        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          // Nothing to do; Surface mode handles format internally.
        }
        outIndex >= 0 -> {
          emptyDequeues = 0
          stalledPasses = 0
          val ptsUs = bufferInfo.presentationTimeUs
          val eos = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
          val newTarget = pendingTargetUs.get()
          if (newTarget != NO_TARGET && newTarget < ptsUs - FRAME_TOLERANCE_US) {
            // Newest target moved behind this frame: flush inline (rescheduling would ping-pong — the next pass sees only lastRenderedUs, not how far the codec drained).
            c.releaseOutputBuffer(outIndex, false)
            c.flush()
            ex.seekTo(newTarget, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            sawInputEos = false
            maxQueuedUs = -1L
            lastRenderedUs.set(-1L)
            continue
          }
          val effectiveTarget = if (newTarget == NO_TARGET) target else newTarget
          if (ptsUs + FRAME_TOLERANCE_US >= effectiveTarget || eos) {
            // Render: reached the newest target (or clamped to the last frame at EOS).
            c.releaseOutputBuffer(outIndex, true)
            lastRenderedUs.set(ptsUs)
            if (eos) return
            val after = pendingTargetUs.get()
            if (after == NO_TARGET || abs(after - ptsUs) <= FRAME_TOLERANCE_US) return
            if (after < ptsUs) {
              // Target moved backward mid-render: reschedule — next pass flushes since target is behind lastRenderedUs.
              scheduleDecode()
              return
            }
            // An even newer target moved ahead meanwhile — keep draining forward.
          } else {
            c.releaseOutputBuffer(outIndex, false)
            if (eos) return
          }
        }
      }
    }
  }

  private fun readRotationFallback(): Int {
    val r = MediaMetadataRetriever()
    return try {
      r.setSource(context, uri)
      r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    } catch (_: Throwable) {
      0
    } finally {
      try {
        r.release()
      } catch (_: Throwable) {}
    }
  }

  private fun reportFatal(msg: String) {
    if (!fatal.compareAndSet(false, true)) return
    errorListener?.invoke(msg)
  }

  companion object {
    private const val NO_TARGET: Long = Long.MIN_VALUE
    // Half a 30fps frame; treat "close enough" targets as hits so a settled finger doesn't spin.
    private const val FRAME_TOLERANCE_US: Long = 16_000L
    private const val DEQUEUE_TIMEOUT_US: Long = 10_000L
    private const val MAX_EMPTY_DEQUEUES = 100
    private const val MAX_STALLED_PASSES = 3
    private const val STALL_RETRY_DELAY_MS = 50L

    private val sessions = ConcurrentHashMap<Int, ScrubEngine>()
    private val nextId = AtomicInteger(1)

    fun create(context: Context, uri: String): Pair<Int, Info> {
      validateSource(uri, "ERR_SCRUB")
      val id = nextId.getAndIncrement()
      val engine = ScrubEngine(context, uri, id)
      val info =
        try {
          engine.prepareBlocking()
        } catch (t: Throwable) {
          engine.release()
          if (t is MediaEditorException) throw t
          throw MediaEditorException("ERR_SCRUB", t.message ?: "prepare failed")
        }
      sessions[id] = engine
      return id to info
    }

    fun get(id: Int): ScrubEngine? = sessions[id]

    fun destroy(id: Int) {
      sessions.remove(id)?.release()
    }
  }
}
