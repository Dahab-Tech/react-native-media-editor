package com.dahabtech.mediaeditor

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MediaEditorModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MediaEditor")

    AsyncFunction("getVideoInfo") { uri: String ->
      VideoInfoReader.read(context, uri)
    }

    AsyncFunction("trim") { uri: String, options: TrimOptions, promise: Promise ->
      VideoTrimmer.trim(context, uri, options, promise)
    }

    AsyncFunction("getThumbnail") { uri: String, options: ThumbnailOptions ->
      ThumbnailGenerator.generate(context, uri, options)
    }

    AsyncFunction("writeCacheFile") { base64: String, extension: String ->
      PhotoFileWriter.write(context, base64, extension)
    }
  }
}
