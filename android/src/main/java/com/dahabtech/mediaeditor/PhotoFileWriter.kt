package com.dahabtech.mediaeditor

import android.content.Context
import android.net.Uri
import android.util.Base64
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
}
