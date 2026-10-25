import AVFoundation
import CoreGraphics
import CoreImage

/// Compiled artifact shared by preview and export: composition + instruction-driven video composition.
struct CompiledTimeline {
  let composition: AVMutableComposition
  let videoComposition: AVMutableVideoComposition
  let renderSize: CGSize
  let totalDurationMs: Double
  let index: TimelineIndex
}

/// Compiles a ProjectRecord into an AVMutableComposition with per-segment ClipInstructions.
enum TimelineCompiler {
  private struct MainSegment {
    let startMs: Int64
    let endMs: Int64
    let trackID: CMPersistentTrackID
    let config: ClipRenderConfig
  }

  private struct CompiledPip {
    let startMs: Int64
    let endMs: Int64
    let layer: PipLayer
  }

  static func compile(_ project: ProjectRecord) async throws -> CompiledTimeline {
    let index = TimelineIndex(clips: project.clips)
    let renderSize = resolveRenderSize(project)

    let composition = AVMutableComposition()
    guard
      let trackA = composition.addMutableTrack(
        withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else {
      throw MediaEditorError.exportFailed("Could not create composition video track")
    }
    // Alternating A/B video tracks isolate per-clip rotation and leave room for cross-clip transitions.
    let trackB: AVMutableCompositionTrack? =
      project.clips.count > 1
      ? composition.addMutableTrack(
        withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
      : nil
    var audioTrack: AVMutableCompositionTrack?

    let overlayImages = loadOverlayImages(project.overlays)
    var lutCache: [String: CIFilter] = [:]
    var mainSegments: [MainSegment] = []
    var maxFps = 0.0
    // Integer-ms cursor: instructions must partition the composition exactly, so every timeline
    // value stays CMTime(value: ms, timescale: 1000) — Double round-trips drift and fail export.
    var cursorMs: Int64 = 0

    for (clipIndex, clip) in project.clips.enumerated() {
      let asset = AVURLAsset(url: resolveSourceURL(clip.source))
      guard let sourceVideoTrack = try await asset.loadTracks(withMediaType: .video).first else {
        throw MediaEditorError.noVideoTrack
      }
      let (naturalSize, preferredTransform, nominalFrameRate) = try await sourceVideoTrack.load(
        .naturalSize, .preferredTransform, .nominalFrameRate)

      let sourceRange = CMTimeRange(
        start: CMTime(value: clip.sourceStartMs, timescale: 1000),
        end: CMTime(value: clip.sourceEndMs, timescale: 1000))
      let cursor = CMTime(value: cursorMs, timescale: 1000)
      let videoTrack = clipIndex % 2 == 0 ? trackA : (trackB ?? trackA)
      do {
        try videoTrack.insertTimeRange(sourceRange, of: sourceVideoTrack, at: cursor)
        if let sourceAudioTrack = try await asset.loadTracks(withMediaType: .audio).first {
          if audioTrack == nil {
            audioTrack = composition.addMutableTrack(
              withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
          }
          try audioTrack?.insertTimeRange(sourceRange, of: sourceAudioTrack, at: cursor)
        }
      } catch {
        throw MediaEditorError.exportFailed("Clip \(clip.id): \(error.localizedDescription)")
      }

      // Scale immediately after inserting this clip — later clips and pips aren't in the
      // composition yet, so the scale re-times exactly this clip's video + audio and nothing else.
      let scaledMs: Int64
      if abs(clip.speed - 1.0) > 1e-4 {
        scaledMs = Int64((Double(clip.trimmedDurationMs) / clip.speed).rounded())
        composition.scaleTimeRange(
          CMTimeRange(start: cursor, duration: sourceRange.duration),
          toDuration: CMTime(value: scaledMs, timescale: 1000))
      } else {
        scaledMs = clip.trimmedDurationMs
      }

      let (config, _) = try clipConfig(
        clip: clip,
        naturalSize: naturalSize,
        preferredTransform: preferredTransform,
        renderSize: renderSize,
        lutCache: &lutCache)
      mainSegments.append(
        MainSegment(
          startMs: cursorMs, endMs: cursorMs + scaledMs,
          trackID: videoTrack.trackID, config: config))

      let sourceFps = nominalFrameRate > 0 ? Double(nominalFrameRate) : 30.0
      maxFps = max(maxFps, sourceFps * max(1.0, clip.speed))
      cursorMs += scaledMs
    }

    var pips: [CompiledPip] = []
    for pip in project.pips {
      if let compiled = try await compilePip(
        pip,
        composition: composition,
        totalDurationMs: cursorMs,
        renderSize: renderSize,
        lutCache: &lutCache,
        maxFps: &maxFps)
      {
        pips.append(compiled)
      }
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(round(maxFps)))
    videoComposition.instructions = buildInstructions(
      mainSegments: mainSegments, pips: pips, overlays: overlayImages)
    videoComposition.customVideoCompositorClass = TimelineCompositor.self

    return CompiledTimeline(
      composition: composition,
      videoComposition: videoComposition,
      renderSize: renderSize,
      totalDurationMs: index.totalDurationMs,
      index: index)
  }

  /// Inserts one pip clip on its own video/audio tracks; nil when its window misses the timeline.
  private static func compilePip(
    _ pip: PipClipRecord,
    composition: AVMutableComposition,
    totalDurationMs: Int64,
    renderSize: CGSize,
    lutCache: inout [String: CIFilter],
    maxFps: inout Double
  ) async throws -> CompiledPip? {
    let clip = pip.clip
    let startMs = pip.placement.timelineStartMs
    guard startMs >= 0, startMs < totalDurationMs else { return nil }

    // Clamp the output window to the main timeline by shortening the source read before insert,
    // so playback speed is preserved and the window end stays exact integer ms.
    let availableMs = totalDurationMs - startMs
    let desiredMs = Int64((Double(clip.trimmedDurationMs) / clip.speed).rounded())
    let outputMs = min(desiredMs, availableMs)
    guard outputMs > 0 else { return nil }
    let sourceLenMs =
      outputMs == desiredMs
      ? clip.trimmedDurationMs
      : min(clip.trimmedDurationMs, Int64((Double(outputMs) * clip.speed).rounded()))
    guard sourceLenMs > 0 else { return nil }

    let asset = AVURLAsset(url: resolveSourceURL(clip.source))
    guard let sourceVideoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw MediaEditorError.noVideoTrack
    }
    let (naturalSize, preferredTransform, nominalFrameRate) = try await sourceVideoTrack.load(
      .naturalSize, .preferredTransform, .nominalFrameRate)
    guard
      let videoTrack = composition.addMutableTrack(
        withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else {
      throw MediaEditorError.exportFailed("Could not create pip video track")
    }

    let start = CMTime(value: startMs, timescale: 1000)
    let sourceRange = CMTimeRange(
      start: CMTime(value: clip.sourceStartMs, timescale: 1000),
      duration: CMTime(value: sourceLenMs, timescale: 1000))
    let insertedRange = CMTimeRange(start: start, duration: sourceRange.duration)
    let outputDuration = CMTime(value: outputMs, timescale: 1000)
    do {
      try videoTrack.insertTimeRange(sourceRange, of: sourceVideoTrack, at: start)
      // Track-level scaling only — composition.scaleTimeRange would re-time the built main tracks.
      if sourceLenMs != outputMs {
        videoTrack.scaleTimeRange(insertedRange, toDuration: outputDuration)
      }
      if let sourceAudioTrack = try await asset.loadTracks(withMediaType: .audio).first,
        let pipAudioTrack = composition.addMutableTrack(
          withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
      {
        try pipAudioTrack.insertTimeRange(sourceRange, of: sourceAudioTrack, at: start)
        if sourceLenMs != outputMs {
          pipAudioTrack.scaleTimeRange(insertedRange, toDuration: outputDuration)
        }
      }
    } catch {
      throw MediaEditorError.exportFailed("Clip \(clip.id): \(error.localizedDescription)")
    }

    let (config, fittedRect) = try clipConfig(
      clip: clip,
      naturalSize: naturalSize,
      preferredTransform: preferredTransform,
      renderSize: renderSize,
      lutCache: &lutCache)
    let sourceFps = nominalFrameRate > 0 ? Double(nominalFrameRate) : 30.0
    maxFps = max(maxFps, sourceFps * max(1.0, clip.speed))
    return CompiledPip(
      startMs: startMs,
      endMs: startMs + outputMs,
      layer: PipLayer(
        trackID: videoTrack.trackID, config: config, placement: pip.placement,
        fittedRect: fittedRect))
  }

  /// Partitions the timeline at main-clip and pip-window edges; each segment carries its active pips.
  private static func buildInstructions(
    mainSegments: [MainSegment],
    pips: [CompiledPip],
    overlays: [TimedOverlayImage]
  ) -> [ClipInstruction] {
    var boundaries: Set<Int64> = []
    for segment in mainSegments {
      boundaries.insert(segment.startMs)
      boundaries.insert(segment.endMs)
    }
    for pip in pips {
      boundaries.insert(pip.startMs)
      boundaries.insert(pip.endMs)
    }
    let cuts = boundaries.sorted()
    guard cuts.count > 1 else { return [] }

    var instructions: [ClipInstruction] = []
    for i in 0..<(cuts.count - 1) {
      let startMs = cuts[i]
      let endMs = cuts[i + 1]
      guard
        let owner = mainSegments.first(where: { $0.startMs <= startMs && startMs < $0.endMs })
      else { continue }
      let range = CMTimeRange(
        start: CMTime(value: startMs, timescale: 1000),
        end: CMTime(value: endMs, timescale: 1000))
      let layers = pips
        .filter { $0.startMs <= startMs && startMs < $0.endMs }
        .map(\.layer)
      let active = overlays.filter {
        !CMTimeRangeGetIntersection($0.timeRange, otherRange: range).duration.seconds.isZero
      }
      instructions.append(
        ClipInstruction(
          timeRange: range, trackID: owner.trackID, config: owner.config,
          overlays: active, pipLayers: layers))
    }
    return instructions
  }

  /// First clip's crop-or-full display size, long edge capped (never upscaled), even-rounded.
  static func resolveRenderSize(_ project: ProjectRecord) -> CGSize {
    let first = project.clips[0]
    var width = Double(first.crop?.width ?? first.width)
    var height = Double(first.crop?.height ?? first.height)
    let caps = [project.output?.maxDimension, project.output?.compression?.maxDimension]
      .compactMap { $0 }.filter { $0 > 0 }.map(Double.init)
    if let cap = caps.min() {
      let longEdge = max(width, height)
      if longEdge > cap {
        let scale = cap / longEdge
        width *= scale
        height *= scale
      }
    }
    return CGSize(width: evenClamp(width), height: evenClamp(height))
  }

  /// Resolve a `file://` or plain-path URI into a URL.
  static func resolveSourceURL(_ uri: String) -> URL {
    if let parsed = URL(string: uri), parsed.scheme != nil { return parsed }
    return URL(fileURLWithPath: uri)
  }

  private static func clipConfig(
    clip: ClipRecord,
    naturalSize: CGSize,
    preferredTransform: CGAffineTransform,
    renderSize: CGSize,
    lutCache: inout [String: CIFilter]
  ) throws -> (config: ClipRenderConfig, fittedRect: CGRect) {
    var colorCube: CIFilter?
    if let lutUri = clip.lutUri {
      if let cached = lutCache[lutUri] {
        colorCube = cached
      } else if let lutImage = ColorPipeline.loadCGImage(fromURIString: lutUri),
        let filter = ColorPipeline.colorCubeFilter(from: lutImage)
      {
        lutCache[lutUri] = filter
        colorCube = filter
      }
    }
    let washImage = clip.washUri
      .flatMap { ColorPipeline.loadCGImage(fromURIString: $0) }
      .map { CIImage(cgImage: $0) }
    let (sourceTransform, fittedRect) = try clipTransform(
      clip: clip,
      naturalSize: naturalSize,
      preferredTransform: preferredTransform,
      renderSize: renderSize)
    return (
      ClipRenderConfig(
        matrix: clip.colorMatrix,
        colorCube: colorCube,
        lutIntensity: Float(max(0.0, min(1.0, clip.lutIntensity))),
        washImage: washImage,
        washBlendMode: clip.washBlendMode,
        washIntensity: Float(max(0.0, min(1.0, clip.washIntensity))),
        sourceTransform: sourceTransform),
      fittedRect
    )
  }

  /// Rotation normalization → crop translation → aspect-fit scale → center; reports the fitted rect.
  private static func clipTransform(
    clip: ClipRecord,
    naturalSize: CGSize,
    preferredTransform: CGAffineTransform,
    renderSize: CGSize
  ) throws -> (transform: CGAffineTransform, fittedRect: CGRect) {
    let displayRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
    let displayWidth = abs(displayRect.width)
    let displayHeight = abs(displayRect.height)
    guard displayWidth > 0, displayHeight > 0 else {
      throw MediaEditorError.exportFailed("Clip \(clip.id): video track has zero display size")
    }
    var transform = preferredTransform.concatenating(
      CGAffineTransform(translationX: -displayRect.minX, y: -displayRect.minY))

    let baseSize: CGSize
    if let crop = clip.crop {
      let cropX = max(0, min(Double(crop.x), displayWidth))
      let cropY = max(0, min(Double(crop.y), displayHeight))
      let cropW = max(0, min(Double(crop.width), displayWidth - cropX))
      let cropH = max(0, min(Double(crop.height), displayHeight - cropY))
      guard cropW > 0, cropH > 0 else {
        throw MediaEditorError.exportFailed("Clip \(clip.id): empty crop")
      }
      transform = transform.concatenating(CGAffineTransform(translationX: -cropX, y: -cropY))
      baseSize = CGSize(width: cropW, height: cropH)
    } else {
      baseSize = CGSize(width: displayWidth, height: displayHeight)
    }

    let scale = min(renderSize.width / baseSize.width, renderSize.height / baseSize.height)
    let fitted = CGSize(width: baseSize.width * scale, height: baseSize.height * scale)
    let origin = CGPoint(
      x: (renderSize.width - fitted.width) / 2,
      y: (renderSize.height - fitted.height) / 2)
    let full = transform
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(CGAffineTransform(translationX: origin.x, y: origin.y))
    return (full, CGRect(origin: origin, size: fitted))
  }

  private static func loadOverlayImages(_ overlays: [OverlayRecord]) -> [TimedOverlayImage] {
    overlays.compactMap { record in
      guard let cgImage = ColorPipeline.loadCGImage(fromURIString: record.pngUri) else {
        return nil
      }
      let range = CMTimeRange(
        start: CMTime(value: record.timelineStartMs, timescale: 1000),
        end: CMTime(value: record.timelineEndMs, timescale: 1000))
      return TimedOverlayImage(image: CIImage(cgImage: cgImage), timeRange: range)
    }
  }

  private static func evenClamp(_ value: Double) -> Int {
    max(2, Int(value.rounded()) & ~1)
  }
}
