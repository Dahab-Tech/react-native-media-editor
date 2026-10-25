import AVFoundation
import Foundation

/// Exports a compiled timeline: passthrough for single pure trims, export session otherwise,
/// reader/writer when compression is requested.
struct ProjectExporter {
  /// Internal failure type carrying the NSError code so the retry wrapper can gate on -11819 (mediaServicesWereReset).
  private struct ExportFailure: Error {
    let message: String
    let code: Int?
    var isMediaServicesReset: Bool { code == -11819 }
  }

  static func export(
    projectJson: String, onProgress: @escaping (Double) -> Void
  ) async throws -> [String: Any] {
    let project = try ProjectRecords.parse(projectJson)
    for clip in project.clips {
      try MediaEditorError.validateSource(TimelineCompiler.resolveSourceURL(clip.source))
    }
    for pip in project.pips {
      try MediaEditorError.validateSource(TimelineCompiler.resolveSourceURL(pip.clip.source))
    }
    do {
      return try await exportOnce(project, onProgress: onProgress)
    } catch let failure as ExportFailure {
      // Apple's documented remedy for mediaServicesWereReset (-11819) is a single retry; any other export error is fatal.
      guard failure.isMediaServicesReset else {
        throw MediaEditorError.exportFailed(failure.message)
      }
      do {
        return try await exportOnce(project, onProgress: onProgress)
      } catch let retryFailure as ExportFailure {
        throw MediaEditorError.exportFailed(retryFailure.message)
      }
    }
  }

  private static func exportOnce(
    _ project: ProjectRecord, onProgress: @escaping (Double) -> Void
  ) async throws -> [String: Any] {
    if isPurePassthroughTrim(project) {
      return try await exportPassthrough(project.clips[0], onProgress: onProgress)
    }

    let timeline = try await TimelineCompiler.compile(project)
    let outputURL: URL
    if let compression = project.output?.compression {
      outputURL = try await exportWithCompression(
        timeline: timeline, compression: compression, onProgress: onProgress)
    } else {
      outputURL = try await exportWithSession(
        asset: timeline.composition,
        videoComposition: timeline.videoComposition,
        timeRange: nil,
        preset: AVAssetExportPresetHighestQuality,
        onProgress: onProgress)
    }
    onProgress(1.0)
    return [
      "uri": outputURL.absoluteString,
      "durationMs": Int(timeline.totalDurationMs.rounded()),
    ]
  }

  /// Lossless codec-copy is only possible for a single clip with zero edits and no output constraints.
  private static func isPurePassthroughTrim(_ project: ProjectRecord) -> Bool {
    guard project.clips.count == 1, project.pips.isEmpty, project.overlays.isEmpty,
      project.output?.compression == nil
    else { return false }
    let clip = project.clips[0]
    if clip.crop != nil || clip.colorMatrix != nil || clip.lutUri != nil || clip.washUri != nil {
      return false
    }
    if abs(clip.speed - 1.0) > 1e-4 { return false }
    if let cap = project.output?.maxDimension, cap > 0, max(clip.width, clip.height) > cap {
      return false
    }
    return true
  }

  private static func exportPassthrough(
    _ clip: ClipRecord, onProgress: @escaping (Double) -> Void
  ) async throws -> [String: Any] {
    let asset = AVURLAsset(url: TimelineCompiler.resolveSourceURL(clip.source))
    let timeRange = CMTimeRange(
      start: CMTime(value: clip.sourceStartMs, timescale: 1000),
      end: CMTime(value: clip.sourceEndMs, timescale: 1000))
    let passthroughSupported = await AVAssetExportSession.compatibility(
      ofExportPreset: AVAssetExportPresetPassthrough, with: asset, outputFileType: nil)
    let preset = passthroughSupported
      ? AVAssetExportPresetPassthrough
      : AVAssetExportPresetHighestQuality
    let outputURL = try await exportWithSession(
      asset: asset,
      videoComposition: nil,
      timeRange: timeRange,
      preset: preset,
      onProgress: onProgress)
    onProgress(1.0)
    return [
      "uri": outputURL.absoluteString,
      "durationMs": Int(clip.trimmedDurationMs),
    ]
  }

  private static func exportWithSession(
    asset: AVAsset,
    videoComposition: AVMutableVideoComposition?,
    timeRange: CMTimeRange?,
    preset: String,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
      throw MediaEditorError.exportSessionUnavailable
    }
    let fileType: AVFileType = session.supportedFileTypes.contains(.mp4) ? .mp4 : .mov
    let outputURL = try CacheFile.make(
      prefix: "export", fileExtension: fileType == .mp4 ? "mp4" : "mov")
    session.outputURL = outputURL
    session.outputFileType = fileType
    session.videoComposition = videoComposition
    if let timeRange {
      session.timeRange = timeRange
    }

    let poller = Task {
      while !Task.isCancelled {
        onProgress(Double(session.progress))
        try? await Task.sleep(nanoseconds: 500_000_000)
      }
    }
    await withCheckedContinuation { continuation in
      session.exportAsynchronously { continuation.resume() }
    }
    poller.cancel()

    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      throw makeExportFailure(session.error, fallback: "unknown")
    }
    return outputURL
  }

  /// AVAssetReader→AVAssetWriter over the compiled composition (both A/B video tracks). H.264 + AAC 128 kbps.
  private static func exportWithCompression(
    timeline: CompiledTimeline,
    compression: CompressionRecord,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    let composition = timeline.composition
    let videoComposition = timeline.videoComposition
    let videoTracks = composition.tracks(withMediaType: .video)
    guard !videoTracks.isEmpty else {
      throw MediaEditorError.noVideoTrack
    }
    let frameSeconds = CMTimeGetSeconds(videoComposition.frameDuration)
    let fps = frameSeconds > 0 ? 1.0 / frameSeconds : 30.0
    let totalSeconds = timeline.totalDurationMs / 1000.0

    let outputURL = try CacheFile.make(prefix: "export", fileExtension: "mp4")

    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: composition)
    } catch {
      throw makeExportFailure(error, fallback: "reader init failed")
    }

    let readerVideoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: videoTracks,
      videoSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
      ])
    readerVideoOutput.videoComposition = videoComposition
    readerVideoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerVideoOutput) else {
      throw MediaEditorError.exportFailed("Cannot add video output to reader")
    }
    reader.add(readerVideoOutput)

    let audioTracks = composition.tracks(withMediaType: .audio)
    let readerAudioOutput: AVAssetReaderAudioMixOutput?
    if !audioTracks.isEmpty {
      let output = AVAssetReaderAudioMixOutput(
        audioTracks: audioTracks,
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsNonInterleaved: false,
        ])
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        readerAudioOutput = output
      } else {
        readerAudioOutput = nil
      }
    } else {
      readerAudioOutput = nil
    }

    let writer: AVAssetWriter
    do {
      writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    } catch {
      throw makeExportFailure(error, fallback: "writer init failed")
    }

    let renderSize = videoComposition.renderSize
    let targetBitrate = resolveTargetBitrate(
      renderSize: renderSize, fps: fps, compression: compression)
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(renderSize.width),
      AVVideoHeightKey: Int(renderSize.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: targetBitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
    let writerVideoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    writerVideoInput.expectsMediaDataInRealTime = false
    // Composition already bakes rotation into the render; identity avoids a double-rotate.
    writerVideoInput.transform = .identity
    guard writer.canAdd(writerVideoInput) else {
      throw MediaEditorError.exportFailed("Cannot add video input to writer")
    }
    writer.add(writerVideoInput)

    let writerAudioInput: AVAssetWriterInput?
    if readerAudioOutput != nil {
      let audioSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44100,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: 128_000,
      ]
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        writerAudioInput = input
      } else {
        writerAudioInput = nil
      }
    } else {
      writerAudioInput = nil
    }

    guard reader.startReading() else {
      throw makeExportFailure(reader.error, fallback: "reader start failed")
    }
    guard writer.startWriting() else {
      throw makeExportFailure(writer.error, fallback: "writer start failed")
    }
    writer.startSession(atSourceTime: .zero)

    let videoQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.export.video")
    let audioQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.export.audio")

    async let videoDone: Void = pump(
      input: writerVideoInput, output: readerVideoOutput, queue: videoQueue,
      onSampleTime: { time in
        guard totalSeconds > 0 else { return }
        onProgress(min(1.0, CMTimeGetSeconds(time) / totalSeconds))
      })
    if let writerAudioInput, let readerAudioOutput {
      async let audioDone: Void = pump(
        input: writerAudioInput, output: readerAudioOutput, queue: audioQueue, onSampleTime: nil)
      _ = await (videoDone, audioDone)
    } else {
      _ = await videoDone
    }

    if reader.status == .failed {
      try? FileManager.default.removeItem(at: outputURL)
      throw makeExportFailure(reader.error, fallback: "read failed")
    }

    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }

    guard writer.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      throw makeExportFailure(writer.error, fallback: "write failed")
    }
    return outputURL
  }

  /// Drain a reader output into a writer input, one buffer at a time, honoring `isReadyForMoreMediaData`.
  private static func pump(
    input: AVAssetWriterInput,
    output: AVAssetReaderOutput,
    queue: DispatchQueue,
    onSampleTime: ((CMTime) -> Void)?
  ) async {
    await withCheckedContinuation { continuation in
      input.requestMediaDataWhenReady(on: queue) {
        while input.isReadyForMoreMediaData {
          if let buffer = output.copyNextSampleBuffer() {
            onSampleTime?(CMSampleBufferGetPresentationTimeStamp(buffer))
            if !input.append(buffer) {
              input.markAsFinished()
              continuation.resume()
              return
            }
          } else {
            input.markAsFinished()
            continuation.resume()
            return
          }
        }
      }
    }
  }

  /// Resolve target average video bitrate (bits per second) with a floor of 250 kbps.
  private static func resolveTargetBitrate(
    renderSize: CGSize, fps: Double, compression: CompressionRecord
  ) -> Int {
    let floorBps = 250_000
    if let bitrateMbps = compression.bitrateMbps, bitrateMbps > 0 {
      return max(floorBps, Int(bitrateMbps * 1_000_000))
    }
    let bpp: Double
    switch (compression.preset ?? "medium").lowercased() {
    case "high": bpp = 0.15
    case "low": bpp = 0.04
    default: bpp = 0.08
    }
    let effectiveFps = fps > 0 ? fps : 30.0
    let bps = Double(renderSize.width) * Double(renderSize.height) * effectiveFps * bpp
    return max(floorBps, Int(bps))
  }

  /// Build an ExportFailure that appends the NSError code so callers can diagnose transient AVFoundation resets.
  private static func makeExportFailure(_ error: Error?, fallback: String) -> ExportFailure {
    guard let error else {
      return ExportFailure(message: fallback, code: nil)
    }
    let ns = error as NSError
    return ExportFailure(message: "\(error.localizedDescription) (\(ns.code))", code: ns.code)
  }
}
