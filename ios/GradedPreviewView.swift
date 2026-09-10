import AVFoundation
import ExpoModulesCore

/// Rate-controlled graded preview: AVPlayerLooper over the trim range, rendered through the SAME
/// AVVideoComposition pipeline the export uses (PreviewColorCompositor, config slot 1) — so the graded
/// preview matches the export by construction and plays at any rate without the seek-per-frame ceiling.
final class GradedPreviewView: ExpoView {
  private static let identityMatrix: [Double] = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ]

  private let playerLayer = AVPlayerLayer()
  private let player = AVQueuePlayer()
  private var looper: AVPlayerLooper?
  private var sourceTransform: CGAffineTransform = .identity
  // Guards against a stale async build landing after props changed again mid-flight.
  private var buildGeneration = 0

  let onPreviewError = EventDispatcher()

  // MARK: Props — mutated individually by the module DSL, committed as a batch in commitProps().

  var sourceUri: String? { didSet { if sourceUri != oldValue { needsRebuild = true } } }
  var startMs: Double = 0 { didSet { if startMs != oldValue { needsRebuild = true } } }
  var endMs: Double = 0 { didSet { if endMs != oldValue { needsRebuild = true } } }
  var colorMatrix: [Double]? { didSet { if colorMatrix != oldValue { needsGradeUpdate = true } } }
  var lutUri: String? { didSet { if lutUri != oldValue { needsGradeUpdate = true } } }
  var lutIntensity: Double = 1 { didSet { if lutIntensity != oldValue { needsGradeUpdate = true } } }
  var washUri: String? { didSet { if washUri != oldValue { needsGradeUpdate = true } } }
  var washBlendMode: String? { didSet { if washBlendMode != oldValue { needsGradeUpdate = true } } }
  var washIntensity: Double = 1 { didSet { if washIntensity != oldValue { needsGradeUpdate = true } } }
  // Accepted for cross-platform prop parity; AVPlayer scales its composition output to the layer, so
  // no explicit downscale is needed here (Android caps the Media3 GL chain with this).
  var renderHeight: Int = 0
  var rate: Double = 1
  var paused: Bool = false
  var positionMs: Double = -1 {
    didSet { if positionMs >= 0, positionMs != oldValue { pendingSeekMs = positionMs } }
  }

  private var needsRebuild = false
  private var needsGradeUpdate = false
  private var pendingSeekMs: Double?
  // Decode the HALD PNG once per URI — same-instance CGImage lets the compositor's cube cache hit,
  // keeping intensity-only slider drags free of per-tick decode + cube rebuilds.
  private var cachedLutUri: String?
  private var cachedLutImage: CGImage?
  private var cachedWashUri: String?
  private var cachedWashImage: CGImage?

  private func resolveLutImage() -> CGImage? {
    if lutUri != cachedLutUri {
      cachedLutUri = lutUri
      cachedLutImage = lutUri.flatMap { VideoTrimmer.loadCGImage(fromURIString: $0) }
    }
    return cachedLutImage
  }

  private func resolveWashImage() -> CGImage? {
    if washUri != cachedWashUri {
      cachedWashUri = washUri
      cachedWashImage = washUri.flatMap { VideoTrimmer.loadCGImage(fromURIString: $0) }
    }
    return cachedWashImage
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Audio/timeline belong to the primary expo-video player; this view is video-only.
    player.isMuted = true
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspect
    layer.addSublayer(playerLayer)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  func commitProps() {
    if needsRebuild {
      needsRebuild = false
      needsGradeUpdate = false
      rebuild()
    } else if needsGradeUpdate {
      needsGradeUpdate = false
      applyGrade()
    }
    drainPendingSeek()
    applyPlayback()
  }

  /// No-op until the player has an item — a seek arriving in the same prop batch as the (async) build
  /// would otherwise be consumed against an empty player and lost; rebuild() re-drains after the looper lands.
  private func drainPendingSeek() {
    guard let target = pendingSeekMs, player.currentItem != nil else { return }
    pendingSeekMs = nil
    player.seek(
      to: CMTime(value: CMTimeValue(target), timescale: 1000),
      toleranceBefore: .zero, toleranceAfter: .zero)
  }

  private func applyPlayback() {
    if paused {
      player.pause()
    } else if player.rate != Float(rate) {
      // Setting rate both starts playback and applies the speed multiplier; AVPlayerLooper preserves it across loops.
      player.rate = Float(rate)
    }
  }

  /// Grade-only change: reconfigure compositor slot 1 in place — no composition/looper rebuild, no frame hitch.
  private func applyGrade() {
    PreviewColorCompositor.configure(
      matrix: colorMatrix ?? Self.identityMatrix,
      lutImage: resolveLutImage(),
      lutIntensity: Float(lutIntensity),
      washImage: resolveWashImage(),
      washBlendMode: washBlendMode,
      washIntensity: Float(washIntensity),
      sourceTransform: sourceTransform)
  }

  private func rebuild() {
    buildGeneration += 1
    let generation = buildGeneration
    looper?.disableLooping()
    looper = nil
    player.removeAllItems()
    guard let sourceUri else { return }

    let url: URL =
      URL(string: sourceUri).flatMap { $0.scheme != nil ? $0 : nil } ?? URL(fileURLWithPath: sourceUri)
    let asset = AVURLAsset(url: url)
    let matrix = colorMatrix
    let lutImage = resolveLutImage()
    let intensity = Float(lutIntensity)
    let start = startMs
    let end = endMs

    Task { [weak self] in
      do {
        // Identity fallback keeps the compositor installed even if the grade momentarily clears,
        // so later applyGrade() calls still take effect without a rebuild.
        let (composition, transform) = try await VideoTrimmer.makePreviewComposition(
          asset: asset,
          colorMatrix: matrix ?? Self.identityMatrix,
          lutImage: lutImage,
          lutIntensity: intensity)
        let duration = try await asset.load(.duration)
        await MainActor.run {
          guard let self, self.buildGeneration == generation else { return }
          self.sourceTransform = transform
          // Reassert current grade props: a commit racing the async build could have configured slot 1
          // with the stale (identity) transform.
          self.applyGrade()
          let item = AVPlayerItem(asset: asset)
          item.videoComposition = composition
          let startTime = CMTime(value: CMTimeValue(max(0, start)), timescale: 1000)
          let endTime =
            end > start
            ? CMTime(value: CMTimeValue(end), timescale: 1000)
            : duration
          let range = CMTimeRange(start: startTime, end: min(endTime, duration))
          guard range.duration.seconds > 0 else { return }
          self.looper = AVPlayerLooper(player: self.player, templateItem: item, timeRange: range)
          self.drainPendingSeek()
          self.applyPlayback()
        }
      } catch {
        await MainActor.run {
          guard let self, self.buildGeneration == generation else { return }
          self.onPreviewError(["message": error.localizedDescription])
        }
      }
    }
  }
}
