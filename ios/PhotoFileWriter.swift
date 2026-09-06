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
}
