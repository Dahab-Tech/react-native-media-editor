import ExpoModulesCore

public class MediaEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaEditor")

    Events("onExportProgress")

    AsyncFunction("exportProject") { (projectJson: String, promise: Promise) in
      Task {
        do {
          let result = try await ProjectExporter.export(projectJson: projectJson) { progress in
            self.sendEvent("onExportProgress", ["progress": progress])
          }
          promise.resolve(result)
        } catch {
          promise.reject(MediaEditorException(code: "ERR_EXPORT", reason: error.localizedDescription))
        }
      }
    }

    AsyncFunction("getVideoInfo") { (uri: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await VideoInfoReader.read(from: uri))
        } catch {
          promise.reject(MediaEditorException(code: "ERR_VIDEO_INFO", reason: error.localizedDescription))
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

    AsyncFunction("getThumbnailStrip") { (uri: URL, options: ThumbnailStripOptions, promise: Promise) in
      Task {
        do {
          promise.resolve(try await ThumbnailGenerator.generateStrip(from: uri, options: options))
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

    View(TimelinePlayerView.self) {
      Events("onReady", "onTimeUpdate", "onClipChanged", "onPlayEnd", "onPlayerError")

      Prop("project") { (view: TimelinePlayerView, value: String?) in
        view.projectJson = value
      }
      Prop("paused") { (view: TimelinePlayerView, value: Bool) in
        view.paused = value
      }
      Prop("loop") { (view: TimelinePlayerView, value: Bool) in
        view.loop = value
      }
      Prop("volume") { (view: TimelinePlayerView, value: Double) in
        view.volume = value
      }
      Prop("timeUpdateIntervalMs") { (view: TimelinePlayerView, value: Double) in
        view.timeUpdateIntervalMs = value
      }
      Prop("scrubPositionMs") { (view: TimelinePlayerView, value: Double) in
        view.scrubPositionMs = value
      }

      AsyncFunction("seekTo") { (view: TimelinePlayerView, ms: Double) in
        view.seekTo(ms: ms)
      }
      AsyncFunction("setScrubbing") { (view: TimelinePlayerView, active: Bool) in
        view.setScrubbing(active)
      }

      OnViewDidUpdateProps { (view: TimelinePlayerView) in
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
