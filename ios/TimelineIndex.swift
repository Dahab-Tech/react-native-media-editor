import Foundation

/// Position inside a clip resolved from a global timeline position.
struct TimelinePosition {
  let clipIndex: Int
  let clipOutputMs: Double
  let sourceMs: Double
}

/// Prefix sums mapping global timeline positions to (clip, source time) and back.
/// Mirrors src/video/project/timelineIndex.ts — keep the formulas in sync.
struct TimelineIndex {
  private let clips: [ClipRecord]
  /// startsMs[i] = timeline start of clip i; startsMs[count] = total duration.
  private let startsMs: [Double]

  init(clips: [ClipRecord]) {
    self.clips = clips
    var starts = [0.0]
    starts.reserveCapacity(clips.count + 1)
    for clip in clips {
      starts.append(starts[starts.count - 1] + TimelineIndex.clipOutputDurationMs(clip))
    }
    startsMs = starts
  }

  var totalDurationMs: Double { startsMs[startsMs.count - 1] }

  func clipStartMs(_ clipIndex: Int) -> Double { startsMs[clipIndex] }

  /// Boundary positions belong to the later clip.
  func positionToClip(_ positionMs: Double) -> TimelinePosition {
    if clips.isEmpty { return TimelinePosition(clipIndex: 0, clipOutputMs: 0, sourceMs: 0) }
    let clamped = min(max(positionMs, 0), totalDurationMs)
    var index = clips.count - 1
    for i in clips.indices where clamped < startsMs[i + 1] {
      index = i
      break
    }
    let clip = clips[index]
    let clipOutputMs = clamped - startsMs[index]
    return TimelinePosition(
      clipIndex: index,
      clipOutputMs: clipOutputMs,
      sourceMs: Double(clip.sourceStartMs) + clipOutputMs * clip.speed)
  }

  func clipToPosition(clipIndex: Int, sourceMs: Double) -> Double {
    let clip = clips[clipIndex]
    return startsMs[clipIndex] + (sourceMs - Double(clip.sourceStartMs)) / clip.speed
  }

  static func clipOutputDurationMs(_ clip: ClipRecord) -> Double {
    Double(clip.trimmedDurationMs) / clip.speed
  }
}
