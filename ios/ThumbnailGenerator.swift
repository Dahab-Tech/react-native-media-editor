import AVFoundation
import UIKit

struct ThumbnailGenerator {
  static func generate(from url: URL, options: ThumbnailOptions) async throws -> [String: Any] {
    try MediaEditorError.validateSource(url)
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // Exact frame required for cover selection.
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    if options.maxWidth > 0 {
      generator.maximumSize = CGSize(width: options.maxWidth, height: 0)
    }

    let time = CMTime(value: Int64(options.timeMs), timescale: 1000)
    let cgImage = try await extractImage(with: generator, at: time)
    guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: options.quality) else {
      throw MediaEditorError.thumbnailEncodingFailed
    }

    let outputURL = try CacheFile.make(prefix: "cover", fileExtension: "jpg")
    try data.write(to: outputURL)

    return [
      "uri": outputURL.absoluteString,
      "width": cgImage.width,
      "height": cgImage.height,
    ]
  }

  private static func extractImage(
    with generator: AVAssetImageGenerator, at time: CMTime
  ) async throws -> CGImage {
    try await withCheckedThrowingContinuation { continuation in
      generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) {
        _, cgImage, _, result, error in
        if result == .succeeded, let cgImage {
          continuation.resume(returning: cgImage)
        } else {
          continuation.resume(throwing: error ?? MediaEditorError.frameExtractionFailed)
        }
      }
    }
  }
}
