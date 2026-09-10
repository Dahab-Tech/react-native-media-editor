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

    View(GradedPreviewView.self) {
      Events("onPreviewError")

      Prop("sourceUri") { (view: GradedPreviewView, value: String?) in
        view.sourceUri = value
      }
      Prop("startMs") { (view: GradedPreviewView, value: Double) in
        view.startMs = value
      }
      Prop("endMs") { (view: GradedPreviewView, value: Double) in
        view.endMs = value
      }
      Prop("colorMatrix") { (view: GradedPreviewView, value: [Double]?) in
        view.colorMatrix = value
      }
      Prop("lutUri") { (view: GradedPreviewView, value: String?) in
        view.lutUri = value
      }
      Prop("lutIntensity") { (view: GradedPreviewView, value: Double) in
        view.lutIntensity = value
      }
      Prop("washUri") { (view: GradedPreviewView, value: String?) in
        view.washUri = value
      }
      Prop("washBlendMode") { (view: GradedPreviewView, value: String?) in
        view.washBlendMode = value
      }
      Prop("washIntensity") { (view: GradedPreviewView, value: Double) in
        view.washIntensity = value
      }
      Prop("renderHeight") { (view: GradedPreviewView, value: Int) in
        view.renderHeight = value
      }
      Prop("rate") { (view: GradedPreviewView, value: Double) in
        view.rate = value
      }
      Prop("paused") { (view: GradedPreviewView, value: Bool) in
        view.paused = value
      }
      Prop("positionMs") { (view: GradedPreviewView, value: Double) in
        view.positionMs = value
      }

      OnViewDidUpdateProps { (view: GradedPreviewView) in
        view.commitProps()
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
