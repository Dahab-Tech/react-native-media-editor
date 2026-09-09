package com.dahabtech.mediaeditor

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.File
import java.io.FileOutputStream

object PhotoFileWriter {
  fun write(context: Context, base64: String, extension: String): String {
    val bytes = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (exception: IllegalArgumentException) {
      throw MediaEditorException("ERR_WRITE_FILE", "Invalid base64 payload")
    }
    val outputFile = cacheFile(context, "photo", extension)
    FileOutputStream(outputFile).use { stream ->
      stream.write(bytes)
    }
    return Uri.fromFile(outputFile).toString()
  }

  /** Read a `file://` URI (or bare path) and return the base64-encoded contents. */
  fun readAsBase64(uri: String): String {
    val parsed = Uri.parse(uri)
    val path = when (parsed.scheme) {
      null -> uri
      "file" -> parsed.path
      else -> null
    } ?: throw MediaEditorException("ERR_READ_FILE", "Unsupported URI scheme: $uri")
    val file = File(path)
    if (!file.exists()) {
      throw MediaEditorException("ERR_READ_FILE", "No file exists at $uri")
    }
    // NO_WRAP matches the shape writeCacheFile consumers (Skia's encodeToBase64) produce.
    return Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
  }
}
