import ExpoModulesCore

public class MediaEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaEditor")

    AsyncFunction("getVideoInfo") { (uri: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await VideoInfoReader.read(from: uri))
        } catch {
          promise.reject(MediaEditorException(code: "ERR_VIDEO_INFO", reason: error.localizedDescription))
        }
      }
    }

    AsyncFunction("trim") { (uri: URL, options: TrimOptions, promise: Promise) in
      Task {
        do {
          promise.resolve(try await VideoTrimmer.trim(url: uri, options: options))
        } catch {
          promise.reject(MediaEditorException(code: "ERR_TRIM", reason: error.localizedDescription))
        }
      }
    }

    AsyncFunction("getThumbnail") { (uri: URL, options: ThumbnailOptions, promise: Promise) in
      Task {
        do {
          promise.resolve(try await ThumbnailGenerator.generate(from: uri, options: options))
        } catch {
          promise.reject(MediaEditorException(code: "ERR_THUMBNAIL", reason: error.localizedDescription))
        }
      }
    }

    AsyncFunction("writeCacheFile") { (base64: String, fileExtension: String, promise: Promise) in
      Task {
        do {
          let url = try PhotoFileWriter.write(base64: base64, fileExtension: fileExtension)
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject(MediaEditorException(code: "ERR_WRITE_FILE", reason: error.localizedDescription))
        }
      }
    }

    AsyncFunction("readCacheFile") { (uri: String, promise: Promise) in
      Task {
        do {
          promise.resolve(try PhotoFileWriter.readAsBase64(uri: uri))
        } catch {
          promise.reject(MediaEditorException(code: "ERR_READ_FILE", reason: error.localizedDescription))
        }
      }
    }
  }
}
