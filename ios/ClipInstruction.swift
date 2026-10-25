import AVFoundation
import CoreImage

/// Per-clip render parameters resolved at compile time (LUT cube prebuilt, wash decoded).
struct ClipRenderConfig {
  let matrix: [Double]?
  let colorCube: CIFilter?
  let lutIntensity: Float
  let washImage: CIImage?
  let washBlendMode: String?
  let washIntensity: Float
  let sourceTransform: CGAffineTransform
}

/// Pre-rasterized project overlay with its visibility window in composition (output) time.
struct TimedOverlayImage {
  let image: CIImage
  let timeRange: CMTimeRange
}

/// One pip video layer active during an instruction: graded like a clip, then placed over the main frame.
struct PipLayer {
  let trackID: CMPersistentTrackID
  let config: ClipRenderConfig
  let placement: PipPlacementRecord
  /// Aspect-fitted content rect inside the render frame — the pip is cropped to it before placement.
  let fittedRect: CGRect
}

/// Composition instruction carrying one segment's render config — read by TimelineCompositor per request.
/// All stored properties are immutable after init, hence `@unchecked Sendable`.
final class ClipInstruction: NSObject, AVVideoCompositionInstructionProtocol, @unchecked Sendable {
  let timeRange: CMTimeRange
  let enablePostProcessing = false
  let containsTweening = true
  let requiredSourceTrackIDs: [NSValue]?
  let passthroughTrackID = kCMPersistentTrackID_Invalid

  let trackID: CMPersistentTrackID
  let config: ClipRenderConfig
  let overlays: [TimedOverlayImage]
  let pipLayers: [PipLayer]

  init(
    timeRange: CMTimeRange,
    trackID: CMPersistentTrackID,
    config: ClipRenderConfig,
    overlays: [TimedOverlayImage],
    pipLayers: [PipLayer] = []
  ) {
    self.timeRange = timeRange
    self.trackID = trackID
    self.config = config
    self.overlays = overlays
    self.pipLayers = pipLayers
    self.requiredSourceTrackIDs = ([trackID] + pipLayers.map(\.trackID)).map { NSNumber(value: $0) }
    super.init()
  }
}
