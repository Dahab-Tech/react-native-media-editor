import Foundation

struct PhotoFileWriter {
  static func write(base64: String, fileExtension: String) throws -> URL {
    guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
      throw MediaEditorError.exportFailed("Invalid base64 payload")
    }
    let outputURL = try CacheFile.make(prefix: "photo", fileExtension: fileExtension)
    try data.write(to: outputURL, options: .atomic)
    return outputURL
  }

  /// Read a `file://` URI (or bare path) and return the base64-encoded contents.
  static func readAsBase64(uri: String) throws -> String {
    let url: URL
    if let parsed = URL(string: uri), parsed.scheme != nil {
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    let data = try Data(contentsOf: url)
    return data.base64EncodedString()
  }
}
