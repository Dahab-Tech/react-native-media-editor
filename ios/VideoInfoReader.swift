import AVFoundation

struct VideoInfoReader {
  static func read(from url: URL) async throws -> [String: Any] {
    try MediaEditorError.validateSource(url)
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw MediaEditorError.noVideoTrack
    }
    let (naturalSize, transform, frameRate) = try await track.load(
      .naturalSize, .preferredTransform, .nominalFrameRate)
    let displayRect = CGRect(origin: .zero, size: naturalSize).applying(transform)

    return [
      "durationMs": CMTimeGetSeconds(duration) * 1000,
      "width": abs(displayRect.width),
      "height": abs(displayRect.height),
      "rotation": rotationDegrees(of: transform),
      "fps": Double(frameRate),
    ]
  }

  private static func rotationDegrees(of transform: CGAffineTransform) -> Double {
    let degrees = atan2(transform.b, transform.a) * 180 / .pi
    return (degrees + 360).truncatingRemainder(dividingBy: 360).rounded()
  }
}
