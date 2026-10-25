package com.dahabtech.mediaeditor.records

/** Position inside a clip resolved from a global timeline position. */
data class TimelinePosition(val clipIndex: Int, val clipOutputUs: Long, val sourceUs: Long)

/**
 * Prefix sums mapping global timeline positions to (clip, source time) and back.
 * Mirrors src/video/project/timelineIndex.ts — keep the formulas in sync.
 */
class TimelineIndex(private val clips: List<ClipRecord>) {
  /** startsUs[i] = timeline start of clip i; startsUs[size] = total duration. */
  private val startsUs = LongArray(clips.size + 1).also { starts ->
    for (i in clips.indices) starts[i + 1] = starts[i] + clipOutputDurationUs(clips[i])
  }

  val totalDurationUs: Long get() = startsUs.last()

  fun clipStartUs(clipIndex: Int): Long = startsUs[clipIndex]

  /** Boundary positions belong to the later clip. */
  fun positionToClip(positionUs: Long): TimelinePosition {
    if (clips.isEmpty()) return TimelinePosition(0, 0L, 0L)
    val clamped = positionUs.coerceIn(0L, totalDurationUs)
    var index = clips.size - 1
    for (i in clips.indices) {
      if (clamped < startsUs[i + 1]) {
        index = i
        break
      }
    }
    val clip = clips[index]
    val clipOutputUs = clamped - startsUs[index]
    val sourceUs = clip.sourceStartMs * 1000L + (clipOutputUs * clip.speed).toLong()
    return TimelinePosition(index, clipOutputUs, sourceUs)
  }

  fun clipToPosition(clipIndex: Int, sourceUs: Long): Long {
    val clip = clips[clipIndex]
    return startsUs[clipIndex] + ((sourceUs - clip.sourceStartMs * 1000L) / clip.speed).toLong()
  }

  companion object {
    fun clipOutputDurationUs(clip: ClipRecord): Long =
      (clip.trimmedDurationMs * 1000L / clip.speed).toLong()
  }
}
