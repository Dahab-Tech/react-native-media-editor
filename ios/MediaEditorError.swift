import ExpoModulesCore
import Foundation

// Overrides `reason` so Promise.reject surfaces the message to JS (default is "undefined reason").
internal final class MediaEditorException: Exception, @unchecked Sendable {
  private let rejectionReason: String

  init(code: String, reason: String) {
    self.rejectionReason = reason
    super.init(name: code, description: reason, code: code)
  }

  override var reason: String {
    rejectionReason
  }
}

enum MediaEditorError: Error, LocalizedError {
  case fileNotFound(String)
  case noVideoTrack
  case invalidTrimRange
  case exportSessionUnavailable
  case exportFailed(String)
  case frameExtractionFailed
  case thumbnailEncodingFailed

  static func validateSource(_ url: URL) throws {
    if url.isFileURL && !FileManager.default.fileExists(atPath: url.path) {
      throw MediaEditorError.fileNotFound(url.absoluteString)
    }
  }

  var errorDescription: String? {
    switch self {
    case .fileNotFound(let uri):
      return "No file exists at \(uri)"
    case .noVideoTrack:
      return "The asset does not contain a video track"
    case .invalidTrimRange:
      return "endMs must be greater than startMs and startMs must not be negative"
    case .exportSessionUnavailable:
      return "Could not create an export session for this asset"
    case .exportFailed(let reason):
      return "Export failed: \(reason)"
    case .frameExtractionFailed:
      return "Could not extract a frame at the requested time"
    case .thumbnailEncodingFailed:
      return "Could not encode the extracted frame as JPEG"
    }
  }
}
