import AVFoundation
import CoreImage

/// Sentinel error for compositor source-buffer failures.
enum MediaEditorNativeError: LocalizedError {
  case noSourceBuffer

  var errorDescription: String? {
    switch self {
    case .noSourceBuffer: return "No source buffer for compositor request"
    }
  }
}

/// AVVideoCompositing that renders each frame per its ClipInstruction: main grade → pip layers → timed overlays.
final class TimelineCompositor: NSObject, AVVideoCompositing {
  let sourcePixelBufferAttributes: [String: any Sendable]? = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
  ]

  let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
  ]

  private var renderContext: AVVideoCompositionRenderContext?
  private let renderQueue = DispatchQueue(label: "com.dahabtech.mediaeditor.timelinecompositor")
  // AVFoundation creates a fresh compositor per compiled item; a per-instance context would
  // recompile Metal pipelines every recompile (first-apply freeze) and pile up GPU memory
  // under rapid edits. `cacheIntermediates` off is Apple's guidance for video pipelines.
  private static let sharedCIContext = CIContext(options: [
    .workingColorSpace: NSNull(),
    .cacheIntermediates: false,
  ])
  private var shouldCancelAllRequests = false

  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {
    renderQueue.sync { renderContext = newRenderContext }
  }

  func cancelAllPendingVideoCompositionRequests() {
    // Drop the backlog (AVCustomEdit pattern): after a seek, stale queued frames would render
    // before the first on-target one, forcing AVPlayer into visible resync loops.
    shouldCancelAllRequests = true
    renderQueue.async(flags: .barrier) { [weak self] in self?.shouldCancelAllRequests = false }
  }

  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    renderQueue.async { [weak self] in
      guard let self else { return }
      if self.shouldCancelAllRequests {
        request.finishCancelledRequest()
        return
      }
      autoreleasepool { self.render(request) }
    }
  }

  private func render(_ request: AVAsynchronousVideoCompositionRequest) {
    guard let instruction = request.videoCompositionInstruction as? ClipInstruction,
          let sourceBuffer = request.sourceFrame(byTrackID: instruction.trackID),
          let dst = request.renderContext.newPixelBuffer()
    else {
      request.finish(with: MediaEditorNativeError.noSourceBuffer)
      return
    }

    let renderSize = request.renderContext.size
    var image = Self.gradedFrame(
      CIImage(cvPixelBuffer: sourceBuffer), config: instruction.config, renderSize: renderSize)

    for layer in instruction.pipLayers {
      // Frame-boundary rounding can leave a pip without a source at its window edges — skip, never fail.
      guard let pipBuffer = request.sourceFrame(byTrackID: layer.trackID) else { continue }
      var pip = Self.gradedFrame(
        CIImage(cvPixelBuffer: pipBuffer), config: layer.config, renderSize: renderSize)
      // Crop before placing — the wash blend extends the extent to the full frame.
      pip = pip.cropped(to: layer.fittedRect)
      if layer.placement.opacity < 0.999 {
        pip = Self.faded(pip, opacity: layer.placement.opacity)
      }
      pip = pip.transformed(
        by: Self.placementTransform(
          layer.placement, fittedRect: layer.fittedRect, renderSize: renderSize))
      image = pip.composited(over: image)
    }

    let time = request.compositionTime
    for overlay in instruction.overlays where overlay.timeRange.containsTime(time) {
      let scaled = overlay.image.transformed(by: CGAffineTransform(
        scaleX: renderSize.width / overlay.image.extent.width,
        y: renderSize.height / overlay.image.extent.height))
      image = scaled.composited(over: image)
    }

    // Explicit bounds: after transform the CIImage extent can be negative/shifted; render the renderContext-sized region at (0,0).
    let bounds = CGRect(origin: .zero, size: renderSize)
    // Black backing: pool buffers are recycled, so letterbox areas outside the clip's extent would show stale frames.
    image = image.composited(over: CIImage(color: .black).cropped(to: bounds))
    Self.sharedCIContext.render(image, to: dst, bounds: bounds, colorSpace: nil)
    request.finish(withComposedVideoFrame: dst)
  }

  /// Source transform (flip-conjugated) → color matrix → LUT → wash; shared by main and pip layers.
  private static func gradedFrame(
    _ source: CIImage, config: ClipRenderConfig, renderSize: CGSize
  ) -> CIImage {
    var image = source

    // Custom compositors receive RAW track buffers; the layer instruction's transform (rotation + crop translation)
    // is bypassed and must be applied here so portrait sources don't render 90°-rotated into the portrait render buffer.
    // The transform assumes a top-left origin but Core Image is bottom-left — conjugate with vertical flips
    // (source height in, render height out) or rotations run backwards (90° source exported 180°-off).
    if !config.sourceTransform.isIdentity {
      let flipSrc = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: image.extent.height)
      let flipDst = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: renderSize.height)
      image = image.transformed(by: flipSrc.concatenating(config.sourceTransform).concatenating(flipDst))
    }

    if let matrix = config.matrix, let matrixFilter = ColorPipeline.colorMatrixFilter(from: matrix) {
      matrixFilter.setValue(image, forKey: kCIInputImageKey)
      if let output = matrixFilter.outputImage {
        image = output
      }
    }

    if let cube = config.colorCube {
      cube.setValue(image, forKey: kCIInputImageKey)
      if let cubed = cube.outputImage {
        image = ColorPipeline.mix(base: image, target: cubed, amount: config.lutIntensity)
      }
    }

    // Overlay wash: blend against the graded frame with the pack's CI blend filter — matches the
    // Skia preview's `blendMode` + `opacity` draw. Alpha-pasting the wash instead looks like a mask.
    if let wash = config.washImage, config.washIntensity > 1e-4 {
      let scaled = wash.transformed(by: CGAffineTransform(
        scaleX: renderSize.width / wash.extent.width,
        y: renderSize.height / wash.extent.height))
      if let blend = CIFilter(name: ColorPipeline.blendFilterName(config.washBlendMode)) {
        blend.setValue(scaled, forKey: kCIInputImageKey)
        blend.setValue(image, forKey: kCIInputBackgroundImageKey)
        if let blended = blend.outputImage {
          image = ColorPipeline.mix(base: image, target: blended, amount: config.washIntensity)
        }
      }
    }

    return image
  }

  /// Buffers are premultiplied — fade must scale all four channel vectors or edges fringe.
  private static func faded(_ image: CIImage, opacity: Double) -> CIImage {
    guard let filter = CIFilter(name: "CIColorMatrix") else { return image }
    let o = CGFloat(max(0.0, min(1.0, opacity)))
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(CIVector(x: o, y: 0, z: 0, w: 0), forKey: "inputRVector")
    filter.setValue(CIVector(x: 0, y: o, z: 0, w: 0), forKey: "inputGVector")
    filter.setValue(CIVector(x: 0, y: 0, z: o, w: 0), forKey: "inputBVector")
    filter.setValue(CIVector(x: 0, y: 0, z: 0, w: o), forKey: "inputAVector")
    return filter.outputImage ?? image
  }

  /// Scale/rotate about the fitted content center, then move it to the wire target position.
  private static func placementTransform(
    _ placement: PipPlacementRecord, fittedRect: CGRect, renderSize: CGSize
  ) -> CGAffineTransform {
    let s = CGFloat(placement.scale)
    // Wire rotation is clockwise on screen; Core Image's y-up coordinates rotate counter-clockwise.
    let angle = -CGFloat(placement.rotation) * .pi / 180
    let target = CGPoint(
      x: CGFloat(placement.x) * renderSize.width,
      y: (1 - CGFloat(placement.y)) * renderSize.height)
    return CGAffineTransform(translationX: -fittedRect.midX, y: -fittedRect.midY)
      .concatenating(CGAffineTransform(scaleX: s, y: s))
      .concatenating(CGAffineTransform(rotationAngle: angle))
      .concatenating(CGAffineTransform(translationX: target.x, y: target.y))
  }
}
