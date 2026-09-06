package com.dahabtech.mediaeditor

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.util.UUID

class MediaEditorException(code: String, message: String) : CodedException(code, message, null)

internal fun MediaMetadataRetriever.setSource(context: Context, uri: String) {
  val parsed = Uri.parse(uri)
  if (parsed.scheme == null) {
    setDataSource(uri)
  } else {
    setDataSource(context, parsed)
  }
}

internal fun validateSource(uri: String, errorCode: String) {
  val parsed = Uri.parse(uri)
  val path = when (parsed.scheme) {
    null -> uri
    "file" -> parsed.path
    else -> return
  }
  if (path == null || !File(path).exists()) {
    throw MediaEditorException(errorCode, "No file exists at $uri")
  }
}

internal fun cacheFile(context: Context, prefix: String, extension: String): File {
  val directory = File(context.cacheDir, "MediaEditor")
  directory.mkdirs()
  return File(directory, "$prefix-${UUID.randomUUID()}.$extension")
}
