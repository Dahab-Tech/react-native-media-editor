import AVFoundation
import CoreGraphics
import CoreImage
import QuartzCore

struct VideoTrimmer {
  static func trim(url: URL, options: TrimOptions) async throws -> [String: Any] {
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
    let speedFactor = options.speedFactor
    let hasSpeedEdit = speedFactor > 0 && abs(speedFactor - 1.0) > 1e-4
    let hasColorEdit = colorMatrix != nil || lutImage != nil
    let compression = options.compression

    // Any non-passthrough edit (crop/overlay/color/speed/compression) forces re-encode; pure trims stay passthrough.
    let needsComposition =
      options.crop != nil || overlayImage != nil || hasColorEdit || hasSpeedEdit
      || compression != nil

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
        maxDimension: compression.maxDimension > 0 ? compression.maxDimension : nil)
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
        maxDimension: nil)
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
      throw MediaEditorError.exportFailed(session.error?.localizedDescription ?? "unknown")
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
    maxDimension: Double?
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
    let fps = nominalFrameRate > 0 ? nominalFrameRate : 30
    composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(round(fps)))
    composition.instructions = [instruction]

    // AVFoundation instantiates compositors from a class ref; configure the shared holder before install.
    if colorMatrix != nil || lutImage != nil {
      ColorCompositor.configure(
        matrix: colorMatrix,
        lutImage: lutImage,
        lutIntensity: lutIntensity)
      composition.customVideoCompositorClass = ColorCompositor.self
    }

    return composition
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
  private static func loadCGImage(fromURIString uri: String) -> CGImage? {
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
    let nominalFrameRate = try await videoTrack.load(.nominalFrameRate)
    let fps = nominalFrameRate > 0 ? Double(nominalFrameRate) : 30.0

    let outputURL = try CacheFile.make(prefix: "trim", fileExtension: "mp4")

    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      throw MediaEditorError.exportFailed(error.localizedDescription)
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
      throw MediaEditorError.exportFailed(error.localizedDescription)
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
      throw MediaEditorError.exportFailed(reader.error?.localizedDescription ?? "reader start failed")
    }
    guard writer.startWriting() else {
      throw MediaEditorError.exportFailed(writer.error?.localizedDescription ?? "writer start failed")
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
      throw MediaEditorError.exportFailed(reader.error?.localizedDescription ?? "read failed")
    }

    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }

    guard writer.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      throw MediaEditorError.exportFailed(writer.error?.localizedDescription ?? "write failed")
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
final class ColorCompositor: NSObject, AVVideoCompositing {
  // MARK: Configuration

  private static var configLock = NSLock()
  private static var configMatrix: [Double]? = nil
  private static var configLutImage: CGImage? = nil
  private static var configLutIntensity: Float = 1.0
  private static var cachedColorCube: CIFilter? = nil

  static func configure(matrix: [Double]?, lutImage: CGImage?, lutIntensity: Float) {
    configLock.lock()
    defer { configLock.unlock() }
    configMatrix = matrix
    configLutImage = lutImage
    configLutIntensity = lutIntensity
    cachedColorCube = lutImage.flatMap { makeColorCubeFilter(from: $0) }
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

      // CI pipeline: input → matrix → LUT; each stage is optional.
      var image = CIImage(cvPixelBuffer: sourceBuffer)
      Self.configLock.lock()
      let matrix = Self.configMatrix
      let cube = Self.cachedColorCube
      let cubeIntensity = Self.configLutIntensity
      Self.configLock.unlock()

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
          if abs(cubeIntensity - 1.0) < 1e-4 {
            image = cubed
          } else if let dissolve = CIFilter(name: "CIDissolveTransition") {
            dissolve.setValue(image, forKey: kCIInputImageKey)
            dissolve.setValue(cubed, forKey: kCIInputTargetImageKey)
            dissolve.setValue(cubeIntensity, forKey: kCIInputTimeKey)
            if let out = dissolve.outputImage {
              image = out
            }
          } else {
            image = cubed
          }
        }
      }

      self.ciContext.render(image, to: dst)
      request.finish(withComposedVideoFrame: dst)
    }
  }
}

/// Build a CIColorMatrix filter from the Skia 20-float row-major 4×5 matrix.
private func makeColorMatrixFilter(from m: [Double]) -> CIFilter? {
  guard m.count == 20, let filter = CIFilter(name: "CIColorMatrix") else { return nil }
  // CIColorMatrix takes INPUT vectors, so transpose Skia rows into columns.
  let rVector = CIVector(x: CGFloat(m[0]), y: CGFloat(m[5]), z: CGFloat(m[10]), w: CGFloat(m[15]))
  let gVector = CIVector(x: CGFloat(m[1]), y: CGFloat(m[6]), z: CGFloat(m[11]), w: CGFloat(m[16]))
  let bVector = CIVector(x: CGFloat(m[2]), y: CGFloat(m[7]), z: CGFloat(m[12]), w: CGFloat(m[17]))
  let aVector = CIVector(x: CGFloat(m[3]), y: CGFloat(m[8]), z: CGFloat(m[13]), w: CGFloat(m[18]))
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
