import Foundation

enum CacheFile {
  static func make(prefix: String, fileExtension: String) throws -> URL {
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("MediaEditor", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("\(prefix)-\(UUID().uuidString).\(fileExtension)")
  }
}
