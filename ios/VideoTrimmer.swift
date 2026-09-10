import AVFoundation
import CoreGraphics
import CoreImage
import QuartzCore

struct VideoTrimmer {
  /// Internal failure type for export-path errors; carries the NSError code so the retry wrapper can gate on -11819 (mediaServicesWereReset).
  private struct ExportFailure: Error {
    let message: String
    let code: Int?
    var isMediaServicesReset: Bool { code == -11819 }
  }

  static func trim(url: URL, options: TrimOptions) async throws -> [String: Any] {
    do {
      return try await trimOnce(url: url, options: options)
    } catch let failure as ExportFailure {
      // Apple's documented remedy for mediaServicesWereReset (-11819) is a single retry; any other export error is fatal.
      guard failure.isMediaServicesReset else {
        throw MediaEditorError.exportFailed(failure.message)
      }
      do {
        return try await trimOnce(url: url, options: options)
      } catch let retryFailure as ExportFailure {
        throw MediaEditorError.exportFailed(retryFailure.message)
      }
    }
  }

  private static func trimOnce(url: URL, options: TrimOptions) async throws -> [String: Any] {
    guard options.startMs >= 0, options.endMs > options.startMs else {
      throw MediaEditorError.invalidTrimRange
    }
    try MediaEditorError.validateSource(url)

    let asset = AVURLAsset(url: url)
    let sourceTimeRange = CMTimeRange(
      start: CMTime(value: Int64(options.startMs), timescale: 1000),
      end: CMTime(value: Int64(options.endMs), timescale: 1000))

    // Overlay presence forces re-encode; AVVideoCompositionCoreAnimationTool is incompatible with passthrough.
    let overlayImage: CGImage? = options.overlayImageUri.flatMap { loadCGImage(fromURIString: $0) }

    let colorMatrix: [Double]? = normalizeMatrix(options.colorMatrix)
    let lutImage: CGImage? = options.lutImageUri.flatMap { loadCGImage(fromURIString: $0) }
    let lutIntensity = Float(max(0.0, min(1.0, options.lutIntensity)))
    let washImage: CGImage? = options.washImageUri.flatMap { loadCGImage(fromURIString: $0) }
    let washIntensity = Float(max(0.0, min(1.0, options.washIntensity)))
    let speedFactor = options.speedFactor
    let hasSpeedEdit = speedFactor > 0 && abs(speedFactor - 1.0) > 1e-4
    let hasColorEdit = colorMatrix != nil || lutImage != nil || washImage != nil
    let compression = options.compression

    // Any non-passthrough edit (crop/overlay/color/speed/compression) forces re-encode; pure trims stay passthrough.
    let needsComposition =
      options.crop != nil || overlayImage != nil || hasColorEdit || hasSpeedEdit
      || compression != nil

    // Sped-up content carries frames at sourceFps × factor after scaleTimeRange; sample the
    // composition at exactly that rate so every source frame survives (no cap — 60fps at 2x
    // exports 120fps, matching Android where setSpeed re-times all frames uncapped). The scaled
    // composition track's own nominalFrameRate is unreliable, so derive from the source asset.
    let outputFps: Double?
    if hasSpeedEdit, speedFactor > 1 {
      let nominal =
        try await asset.loadTracks(withMediaType: .video).first?.load(.nominalFrameRate) ?? 0
      let sourceFps = nominal > 0 ? Double(nominal) : 30.0
      outputFps = sourceFps * speedFactor
    } else {
      outputFps = nil
    }

    // Speed changes require AVMutableComposition for scaleTimeRange.
    let workingAsset: AVAsset
    let workingTimeRange: CMTimeRange
    if hasSpeedEdit {
      let (mutable, scaledRange) = try await makeScaledComposition(
        asset: asset, sourceRange: sourceTimeRange, speedFactor: speedFactor)
      workingAsset = mutable
      workingTimeRange = scaledRange
    } else {
      workingAsset = asset
      workingTimeRange = sourceTimeRange
    }

    // Compression path: reuse the composition builder so crop/color/overlay/speed stay bit-identical to the export-session path.
    if let compression {
      let composition = try await makeVideoComposition(
        asset: workingAsset,
        crop: options.crop,
        colorMatrix: colorMatrix,
        lutImage: lutImage,
        lutIntensity: lutIntensity,
        washImage: washImage,
        washBlendMode: options.washBlendMode,
        washIntensity: washIntensity,
        maxDimension: compression.maxDimension > 0 ? compression.maxDimension : nil,
        outputFps: outputFps)
      if let overlayImage {
        composition.animationTool = makeAnimationTool(
          overlayImage: overlayImage, renderSize: composition.renderSize)
      }
      let outputURL = try await exportWithCompression(
        asset: workingAsset,
        timeRange: workingTimeRange,
        videoComposition: composition,
        compression: compression)
      let outputDurationMs = Int(round(CMTimeGetSeconds(workingTimeRange.duration) * 1000.0))
      return [
        "uri": outputURL.absoluteString,
        "durationMs": outputDurationMs,
      ]
    }

    let videoComposition: AVMutableVideoComposition?
    let preset: String
    if needsComposition {
      let composition = try await makeVideoComposition(
        asset: workingAsset,
        crop: options.crop,
        colorMatrix: colorMatrix,
        lutImage: lutImage,
        lutIntensity: lutIntensity,
        washImage: washImage,
        washBlendMode: options.washBlendMode,
        washIntensity: washIntensity,
        maxDimension: nil,
        outputFps: outputFps)
      if let overlayImage {
        composition.animationTool = makeAnimationTool(
          overlayImage: overlayImage, renderSize: composition.renderSize)
      }
      videoComposition = composition
      preset = AVAssetExportPresetHighestQuality
    } else {
      videoComposition = nil
      let passthroughSupported = await AVAssetExportSession.compatibility(
        ofExportPreset: AVAssetExportPresetPassthrough, with: workingAsset, outputFileType: nil)
      preset = passthroughSupported
        ? AVAssetExportPresetPassthrough
        : AVAssetExportPresetHighestQuality
    }

    guard let session = AVAssetExportSession(asset: workingAsset, presetName: preset) else {
      throw MediaEditorError.exportSessionUnavailable
    }

    let fileType: AVFileType = session.supportedFileTypes.contains(.mp4) ? .mp4 : .mov
    let outputURL = try CacheFile.make(
      prefix: "trim", fileExtension: fileType == .mp4 ? "mp4" : "mov")
    session.outputURL = outputURL
    session.outputFileType = fileType
    session.timeRange = workingTimeRange
    session.videoComposition = videoComposition

    await withCheckedContinuation { continuation in
      session.exportAsynchronously { continuation.resume() }
    }

    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      throw makeExportFailure(session.error, fallback: "unknown")
    }

    // Report post-speed-scale duration so the JS caller's UI matches the file on disk.
    let outputDurationMs = Int(round(CMTimeGetSeconds(workingTimeRange.duration) * 1000.0))
    return [
      "uri": outputURL.absoluteString,
      "durationMs": outputDurationMs,
    ]
  }

  /// Build a composition mirroring the source with the trim range time-scaled by `speedFactor`.
  private static func makeScaledComposition(
    asset: AVAsset, sourceRange: CMTimeRange, speedFactor: Double
  ) async throws -> (AVMutableComposition, CMTimeRange) {
    let composition = AVMutableComposition()
    let videoTracks = try await asset.loadTracks(withMediaType: .video)
    guard let sourceVideoTrack = videoTracks.first else {
      throw MediaEditorError.noVideoTrack
    }
    let videoTrack = composition.addMutableTrack(
      withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    try videoTrack?.insertTimeRange(sourceRange, of: sourceVideoTrack, at: .zero)

    // Preserve rotation metadata — crop/color/overlay math relies on preferredTransform.
    let preferredTransform = try await sourceVideoTrack.load(.preferredTransform)
    videoTrack?.preferredTransform = preferredTransform

    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    if let sourceAudioTrack = audioTracks.first {
      let audioTrack = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
      try audioTrack?.insertTimeRange(sourceRange, of: sourceAudioTrack, at: .zero)
    }

    let sourceDuration = sourceRange.duration
    let scaledDuration = CMTimeMultiplyByFloat64(sourceDuration, multiplier: 1.0 / speedFactor)
    composition.scaleTimeRange(
      CMTimeRange(start: .zero, duration: sourceDuration),
      toDuration: scaledDuration)

    return (composition, CMTimeRange(start: .zero, duration: scaledDuration))
  }

  /// Composition sized to crop-or-display; installs ColorCompositor when color is active. maxDimension caps long edge (never upscales), even-rounded for H.264.
  private static func makeVideoComposition(
    asset: AVAsset,
    crop: CropRectOptions?,
    colorMatrix: [Double]?,
    lutImage: CGImage?,
    lutIntensity: Float,
    washImage: CGImage? = nil,
    washBlendMode: String? = nil,
    washIntensity: Float = 1,
    maxDimension: Double?,
    outputFps: Double? = nil,
    compositorType: ColorCompositor.Type = ColorCompositor.self
  ) async throws -> AVMutableVideoComposition {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw MediaEditorError.noVideoTrack
    }
    let (naturalSize, preferredTransform, nominalFrameRate) = try await track.load(
      .naturalSize, .preferredTransform, .nominalFrameRate)

    let displayRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
    let displayWidth = abs(displayRect.width)
    let displayHeight = abs(displayRect.height)
    guard displayWidth > 0, displayHeight > 0 else {
      throw MediaEditorError.exportFailed("Video track has zero display size")
    }

    // Normalize crop to rotation-corrected display bounds.
    let normalizeTransform = preferredTransform.concatenating(
      CGAffineTransform(translationX: -displayRect.minX, y: -displayRect.minY))

    let baseRenderSize: CGSize
    let baseLayerTransform: CGAffineTransform
    if let crop {
      let cropX = max(0, min(crop.x, displayWidth))
      let cropY = max(0, min(crop.y, displayHeight))
      let cropW = max(0, min(crop.width, displayWidth - cropX))
      let cropH = max(0, min(crop.height, displayHeight - cropY))
      guard cropW > 0, cropH > 0 else {
        throw MediaEditorError.invalidTrimRange
      }
      baseRenderSize = CGSize(width: cropW, height: cropH)
      baseLayerTransform = normalizeTransform.concatenating(
        CGAffineTransform(translationX: -cropX, y: -cropY))
    } else {
      baseRenderSize = CGSize(width: displayWidth, height: displayHeight)
      baseLayerTransform = normalizeTransform
    }

    let scale = maxDimensionScale(size: baseRenderSize, maxLongEdge: maxDimension)
    let renderSize = evenSize(scaling: baseRenderSize, by: scale)
    let layerTransform: CGAffineTransform =
      scale < 1.0
      ? baseLayerTransform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
      : baseLayerTransform

    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layerInstruction.setTransform(layerTransform, at: .zero)

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: .positiveInfinity)
    instruction.layerInstructions = [layerInstruction]

    let composition = AVMutableVideoComposition()
    composition.renderSize = renderSize
    let fps = outputFps ?? (nominalFrameRate > 0 ? Double(nominalFrameRate) : 30)
    composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(round(fps)))
    composition.instructions = [instruction]

    // AVFoundation instantiates compositors from a class ref; configure the shared holder before install.
    // Custom compositors receive RAW track pixel buffers (rotation metadata + crop translation live in `layerInstruction`
    // and are bypassed once the default compositor is replaced). Bake the same transform into the CI pipeline so
    // portrait-source frames land rotated + cropped identically to the non-color re-encode path.
    if colorMatrix != nil || lutImage != nil || washImage != nil {
      compositorType.configure(
        matrix: colorMatrix,
        lutImage: lutImage,
        lutIntensity: lutIntensity,
        washImage: washImage,
        washBlendMode: washBlendMode,
        washIntensity: washIntensity,
        sourceTransform: layerTransform)
      composition.customVideoCompositorClass = compositorType
    }

    return composition
  }

  /// Preview flavor of the export composition: no crop, capped long edge, PreviewColorCompositor (config slot 1).
  /// Returns the layer transform too so grade changes can reconfigure the slot without rebuilding the composition.
  static func makePreviewComposition(
    asset: AVAsset,
    colorMatrix: [Double]?,
    lutImage: CGImage?,
    lutIntensity: Float,
    washImage: CGImage? = nil,
    washBlendMode: String? = nil,
    washIntensity: Float = 1
  ) async throws -> (composition: AVMutableVideoComposition, sourceTransform: CGAffineTransform) {
    let composition = try await makeVideoComposition(
      asset: asset,
      crop: nil,
      colorMatrix: colorMatrix,
      lutImage: lutImage,
      lutIntensity: lutIntensity,
      washImage: washImage,
      washBlendMode: washBlendMode,
      washIntensity: washIntensity,
      maxDimension: 1920,
      compositorType: PreviewColorCompositor.self)
    // makeVideoComposition already stashed the layer transform in slot 1; read it back so grade-prop
    // changes can reconfigure the slot live without recomputing (or drifting from) the export math.
    return (composition, PreviewColorCompositor.configuredSourceTransform() ?? .identity)
  }

  /// Build the CALayer hierarchy for `AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer:in:)`.
  private static func makeAnimationTool(overlayImage: CGImage, renderSize: CGSize)
    -> AVVideoCompositionCoreAnimationTool
  {
    let bounds = CGRect(origin: .zero, size: renderSize)
    let parent = CALayer()
    parent.bounds = bounds
    parent.position = CGPoint(x: bounds.midX, y: bounds.midY)
    parent.isGeometryFlipped = false

    let videoLayer = CALayer()
    videoLayer.bounds = bounds
    videoLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
    parent.addSublayer(videoLayer)

    let overlayLayer = CALayer()
    overlayLayer.bounds = bounds
    overlayLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
    overlayLayer.contents = overlayImage
    // PNG is emitted at renderSize by the JS side; `resize` is pixel-accurate.
    overlayLayer.contentsGravity = .resize
    overlayLayer.isOpaque = false
    parent.addSublayer(overlayLayer)

    return AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: videoLayer, in: parent)
  }

  /// Resolve a `file://` or plain-path URI into a CGImage; nil on any failure.
  static func loadCGImage(fromURIString uri: String) -> CGImage? {
    let url: URL
    if let parsed = URL(string: uri), parsed.scheme != nil {
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  /// Validate the 20-float row-major 4×5 matrix payload; nil skips the color pipeline.
  private static func normalizeMatrix(_ raw: [Double]?) -> [Double]? {
    guard let raw, raw.count == 20 else { return nil }
    return raw
  }

  /// AVAssetReader→AVAssetWriter pipeline for compression; shares the export-session composition (bit-identical crop/color/overlay/speed). H.264 + AAC 128 kbps.
  private static func exportWithCompression(
    asset: AVAsset,
    timeRange: CMTimeRange,
    videoComposition: AVMutableVideoComposition,
    compression: CompressionOptions
  ) async throws -> URL {
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw MediaEditorError.noVideoTrack
    }
    // The composition's frameDuration is the actual output cadence (already speed-adjusted); the
    // scaled composition track's nominalFrameRate is unreliable for bitrate math.
    let frameSeconds = CMTimeGetSeconds(videoComposition.frameDuration)
    let fps = frameSeconds > 0 ? 1.0 / frameSeconds : 30.0

    let outputURL = try CacheFile.make(prefix: "trim", fileExtension: "mp4")

    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      throw makeExportFailure(error, fallback: "reader init failed")
    }
    reader.timeRange = timeRange

    let readerVideoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
      ])
    readerVideoOutput.videoComposition = videoComposition
    readerVideoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerVideoOutput) else {
      throw MediaEditorError.exportFailed("Cannot add video output to reader")
    }
    reader.add(readerVideoOutput)

    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    let audioTrack = audioTracks.first
    let readerAudioOutput: AVAssetReaderAudioMixOutput?
    if let audioTrack {
      let output = AVAssetReaderAudioMixOutput(
        audioTracks: [audioTrack],
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
    writer.startSession(atSourceTime: timeRange.start)

    let videoQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.compression.video")
    let audioQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.compression.audio")

    async let videoDone: Void = pump(
      input: writerVideoInput, output: readerVideoOutput, queue: videoQueue)
    if let writerAudioInput, let readerAudioOutput {
      async let audioDone: Void = pump(
        input: writerAudioInput, output: readerAudioOutput, queue: audioQueue)
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
    queue: DispatchQueue
  ) async {
    await withCheckedContinuation { continuation in
      input.requestMediaDataWhenReady(on: queue) {
        while input.isReadyForMoreMediaData {
          if let buffer = output.copyNextSampleBuffer() {
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

  /// Build an ExportFailure that appends the NSError code (e.g. "Cannot Complete Action (-11819)") so callers can diagnose transient AVFoundation resets.
  private static func makeExportFailure(_ error: Error?, fallback: String) -> ExportFailure {
    guard let error else {
      return ExportFailure(message: fallback, code: nil)
    }
    let ns = error as NSError
    return ExportFailure(message: "\(error.localizedDescription) (\(ns.code))", code: ns.code)
  }

  /// Scale factor to cap `size`'s long edge at `maxLongEdge`. Returns 1.0 for null / non-shrinking inputs.
  private static func maxDimensionScale(size: CGSize, maxLongEdge: Double?) -> CGFloat {
    guard let maxLongEdge, maxLongEdge > 0 else { return 1.0 }
    let longEdge = max(size.width, size.height)
    guard longEdge > CGFloat(maxLongEdge) else { return 1.0 }
    return CGFloat(maxLongEdge) / longEdge
  }

  /// Round `size * scale` to even integers (H.264 encoder requirement); enforce a 2-pixel floor.
  private static func evenSize(scaling size: CGSize, by scale: CGFloat) -> CGSize {
    let w = max(2, Int((size.width * scale).rounded()) & ~1)
    let h = max(2, Int((size.height * scale).rounded()) & ~1)
    return CGSize(width: w, height: h)
  }

  /// Resolve target average video bitrate (bits per second) with a floor of 250 kbps.
  private static func resolveTargetBitrate(
    renderSize: CGSize, fps: Double, compression: CompressionOptions
  ) -> Int {
    let floorBps = 250_000
    if compression.bitrateMbps > 0 {
      return max(floorBps, Int(compression.bitrateMbps * 1_000_000))
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
}

// MARK: - Color compositor

/// AVVideoCompositing running each frame through CIColorMatrix + optional CIColorCube.
class ColorCompositor: NSObject, AVVideoCompositing {
  // MARK: Configuration

  struct Config {
    let matrix: [Double]?
    let lutIntensity: Float
    let sourceTransform: CGAffineTransform
    let colorCube: CIFilter?
    let washImage: CIImage?
    let washBlendMode: String?
    let washIntensity: Float
  }

  private static var configLock = NSLock()
  private static var configs: [Int: Config] = [:]
  // Cube construction is expensive (CGContext draw + O(n³) rearrange) — cache per slot by image identity
  // so intensity-only reconfigures (preview slider drags) don't rebuild it.
  private static var cubeCache: [Int: (image: CGImage, filter: CIFilter?)] = [:]

  // Slot-keyed config: AVFoundation instantiates compositors from a class ref, so statics are the only channel.
  // Export (slot 0) and the native graded preview (slot 1, PreviewColorCompositor) can run concurrently.
  class var configSlot: Int { 0 }

  class func configure(
    matrix: [Double]?, lutImage: CGImage?, lutIntensity: Float,
    washImage: CGImage? = nil, washBlendMode: String? = nil, washIntensity: Float = 1,
    sourceTransform: CGAffineTransform
  ) {
    configLock.lock()
    defer { configLock.unlock() }
    let colorCube: CIFilter?
    if let lutImage {
      if let cached = cubeCache[configSlot], cached.image === lutImage {
        colorCube = cached.filter
      } else {
        colorCube = makeColorCubeFilter(from: lutImage)
        cubeCache[configSlot] = (lutImage, colorCube)
      }
    } else {
      colorCube = nil
      cubeCache[configSlot] = nil
    }
    configs[configSlot] = Config(
      matrix: matrix,
      lutIntensity: lutIntensity,
      sourceTransform: sourceTransform,
      colorCube: colorCube,
      washImage: washImage.map { CIImage(cgImage: $0) },
      washBlendMode: washBlendMode,
      washIntensity: washIntensity)
  }

  class func configuredSourceTransform() -> CGAffineTransform? {
    configLock.lock()
    defer { configLock.unlock() }
    return configs[configSlot]?.sourceTransform
  }

  // MARK: AVVideoCompositing

  let sourcePixelBufferAttributes: [String: Any]? = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
  ]

  let requiredPixelBufferAttributesForRenderContext: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
  ]

  private var renderContext: AVVideoCompositionRenderContext?
  private let renderQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.colorcompositor")
  private let ciContext = CIContext(options: [.workingColorSpace: NSNull()])

  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {
    renderQueue.sync { renderContext = newRenderContext }
  }

  func cancelAllPendingVideoCompositionRequests() {}

  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    renderQueue.async { [weak self] in
      guard let self else { return }
      guard let trackID = request.sourceTrackIDs.first as? CMPersistentTrackID,
            let sourceBuffer = request.sourceFrame(byTrackID: trackID),
            let dst = request.renderContext.newPixelBuffer()
      else {
        request.finish(with: MediaEditorNativeError.noSourceBuffer)
        return
      }

      // CI pipeline: rotation/crop transform → matrix → LUT; each stage is optional.
      var image = CIImage(cvPixelBuffer: sourceBuffer)
      Self.configLock.lock()
      let config = Self.configs[Self.configSlot]
      Self.configLock.unlock()
      let matrix = config?.matrix
      let cube = config?.colorCube
      let cubeIntensity = config?.lutIntensity ?? 1
      let sourceTransform = config?.sourceTransform ?? .identity

      // Custom compositors receive RAW track buffers; the layer instruction's transform (rotation + crop translation)
      // is bypassed and must be applied here so portrait sources don't render 90°-rotated into the portrait render buffer.
      // The transform assumes a top-left origin but Core Image is bottom-left — conjugate with vertical flips
      // (source height in, render height out) or rotations run backwards (90° source exported 180°-off).
      if !sourceTransform.isIdentity {
        let renderHeight = request.renderContext.size.height
        let flipSrc = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: image.extent.height)
        let flipDst = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: renderHeight)
        image = image.transformed(by: flipSrc.concatenating(sourceTransform).concatenating(flipDst))
      }

      if let matrix, matrix.count == 20, let matrixFilter = makeColorMatrixFilter(from: matrix) {
        matrixFilter.setValue(image, forKey: kCIInputImageKey)
        if let output = matrixFilter.outputImage {
          image = output
        }
      }
      if let cube {
        cube.setValue(image, forKey: kCIInputImageKey)
        if let cubed = cube.outputImage {
          // Mix cubed with un-cubed per lutIntensity — mirrors the LUT SkSL shader's `intensity` uniform.
          image = mixImages(base: image, target: cubed, amount: cubeIntensity)
        }
      }

      let renderSize = request.renderContext.size

      // Overlay wash: blend against the graded frame with the pack's CI blend filter — matches the
      // Skia preview's `blendMode` + `opacity` draw. Alpha-pasting the wash instead looks like a mask.
      if let wash = config?.washImage, (config?.washIntensity ?? 0) > 1e-4 {
        let scaled = wash.transformed(by: CGAffineTransform(
          scaleX: renderSize.width / wash.extent.width,
          y: renderSize.height / wash.extent.height))
        if let blend = CIFilter(name: ciBlendFilterName(config?.washBlendMode)) {
          blend.setValue(scaled, forKey: kCIInputImageKey)
          blend.setValue(image, forKey: kCIInputBackgroundImageKey)
          if let blended = blend.outputImage {
            image = mixImages(base: image, target: blended, amount: config?.washIntensity ?? 1)
          }
        }
      }

      // Explicit bounds: after transform the CIImage extent can be negative/shifted; render the renderContext-sized region at (0,0).
      let bounds = CGRect(origin: .zero, size: renderSize)
      self.ciContext.render(image, to: dst, bounds: bounds, colorSpace: nil)
      request.finish(withComposedVideoFrame: dst)
    }
  }
}

/// Same pipeline as export, isolated to config slot 1 so a live preview never clobbers an in-flight export.
final class PreviewColorCompositor: ColorCompositor {
  override class var configSlot: Int { 1 }
}

/// Linear mix of two images via CIDissolveTransition (amount 0 = base, 1 = target).
private func mixImages(base: CIImage, target: CIImage, amount: Float) -> CIImage {
  if amount >= 1.0 - 1e-4 { return target }
  if amount <= 1e-4 { return base }
  guard let dissolve = CIFilter(name: "CIDissolveTransition") else { return target }
  dissolve.setValue(base, forKey: kCIInputImageKey)
  dissolve.setValue(target, forKey: kCIInputTargetImageKey)
  dissolve.setValue(amount, forKey: kCIInputTimeKey)
  return dissolve.outputImage ?? target
}

/// Map a Skia blend-mode name to the equivalent Core Image blend filter.
private func ciBlendFilterName(_ mode: String?) -> String {
  switch mode {
  case "screen": return "CIScreenBlendMode"
  case "softLight": return "CISoftLightBlendMode"
  case "hardLight": return "CIHardLightBlendMode"
  case "multiply": return "CIMultiplyBlendMode"
  case "lighten": return "CILightenBlendMode"
  case "darken": return "CIDarkenBlendMode"
  case "colorDodge": return "CIColorDodgeBlendMode"
  case "colorBurn": return "CIColorBurnBlendMode"
  default: return "CIOverlayBlendMode"
  }
}

/// Build a CIColorMatrix filter from the Skia 20-float row-major 4×5 matrix.
private func makeColorMatrixFilter(from m: [Double]) -> CIFilter? {
  guard m.count == 20, let filter = CIFilter(name: "CIColorMatrix") else { return nil }
  // CIColorMatrix computes output.r = dot(source, rVector) + bias.r — each vector IS a Skia row
  // (the "input" prefix is CI parameter naming, not "per input channel"). Do NOT transpose.
  let rVector = CIVector(x: CGFloat(m[0]), y: CGFloat(m[1]), z: CGFloat(m[2]), w: CGFloat(m[3]))
  let gVector = CIVector(x: CGFloat(m[5]), y: CGFloat(m[6]), z: CGFloat(m[7]), w: CGFloat(m[8]))
  let bVector = CIVector(x: CGFloat(m[10]), y: CGFloat(m[11]), z: CGFloat(m[12]), w: CGFloat(m[13]))
  let aVector = CIVector(x: CGFloat(m[15]), y: CGFloat(m[16]), z: CGFloat(m[17]), w: CGFloat(m[18]))
  let biasVector = CIVector(x: CGFloat(m[4]), y: CGFloat(m[9]), z: CGFloat(m[14]), w: CGFloat(m[19]))
  filter.setValue(rVector, forKey: "inputRVector")
  filter.setValue(gVector, forKey: "inputGVector")
  filter.setValue(bVector, forKey: "inputBVector")
  filter.setValue(aVector, forKey: "inputAVector")
  filter.setValue(biasVector, forKey: "inputBiasVector")
  return filter
}

/// Convert a square HALD PNG into a configured CIColorCube filter; nil on invalid dimensions.
private func makeColorCubeFilter(from haldImage: CGImage) -> CIFilter? {
  let edge = haldImage.width
  guard edge > 0, edge == haldImage.height else { return nil }
  let k = Int(round(pow(Double(edge), 1.0 / 3.0)))
  guard k > 1, k * k * k == edge else { return nil }
  let cubeSize = k * k

  let bytesPerRow = edge * 4
  var pixelBytes = [UInt8](repeating: 0, count: edge * bytesPerRow)
  guard let colorSpace = haldImage.colorSpace,
        let ctx = CGContext(
          data: &pixelBytes,
          width: edge,
          height: edge,
          bitsPerComponent: 8,
          bytesPerRow: bytesPerRow,
          space: colorSpace,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else {
    return nil
  }
  ctx.draw(haldImage, in: CGRect(x: 0, y: 0, width: edge, height: edge))

  // HALD blue-slices tile at (slice % k, slice / k); rearrange into CIColorCube's linear layout.
  let tilesPerRow = k
  var cubeData = [Float32](repeating: 0, count: cubeSize * cubeSize * cubeSize * 4)
  for b in 0..<cubeSize {
    let sliceX = b % tilesPerRow
    let sliceY = b / tilesPerRow
    for g in 0..<cubeSize {
      for r in 0..<cubeSize {
        let srcX = sliceX * cubeSize + r
        let srcY = sliceY * cubeSize + g
        let srcOffset = srcY * bytesPerRow + srcX * 4
        let dstOffset = (b * cubeSize * cubeSize + g * cubeSize + r) * 4
        cubeData[dstOffset + 0] = Float32(pixelBytes[srcOffset + 0]) / 255.0
        cubeData[dstOffset + 1] = Float32(pixelBytes[srcOffset + 1]) / 255.0
        cubeData[dstOffset + 2] = Float32(pixelBytes[srcOffset + 2]) / 255.0
        cubeData[dstOffset + 3] = Float32(pixelBytes[srcOffset + 3]) / 255.0
      }
    }
  }
  let data = cubeData.withUnsafeBufferPointer { Data(buffer: $0) }
  guard let filter = CIFilter(name: "CIColorCube") else { return nil }
  filter.setValue(cubeSize, forKey: "inputCubeDimension")
  filter.setValue(data, forKey: "inputCubeData")
  return filter
}

/// Sentinel error for compositor source-buffer failures.
enum MediaEditorNativeError: LocalizedError {
  case noSourceBuffer

  var errorDescription: String? {
    switch self {
    case .noSourceBuffer: return "No source buffer for compositor request"
    }
  }
}
