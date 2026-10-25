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

  /** One generator pass with default (sync-frame) tolerance: strip tiles don't need exact frames. */
  static func generateStrip(from url: URL, options: ThumbnailStripOptions) async throws -> [String?] {
    try MediaEditorError.validateSource(url)
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    if options.maxWidth > 0 {
      generator.maximumSize = CGSize(width: options.maxWidth, height: 0)
    }

    let times = options.timesMs.map { NSValue(time: CMTime(value: Int64($0), timescale: 1000)) }
    if times.isEmpty { return [] }
    return await withCheckedContinuation { continuation in
      var uris = [String?](repeating: nil, count: times.count)
      var completed = 0
      // Callbacks arrive serially, in request order.
      generator.generateCGImagesAsynchronously(forTimes: times) { _, cgImage, _, result, _ in
        if result == .succeeded, let cgImage,
           let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: options.quality),
           let outputURL = try? CacheFile.make(prefix: "cover", fileExtension: "jpg"),
           (try? data.write(to: outputURL)) != nil {
          uris[completed] = outputURL.absoluteString
        }
        completed += 1
        if completed == times.count {
          continuation.resume(returning: uris)
        }
      }
    }
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
