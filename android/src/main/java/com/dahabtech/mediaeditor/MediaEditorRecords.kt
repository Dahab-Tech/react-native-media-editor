package com.dahabtech.mediaeditor

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CropRectOptions : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val width: Double = 0.0
  @Field val height: Double = 0.0
}

class TrimOptions : Record {
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val crop: CropRectOptions? = null
  // Static PNG overlay applied after crop so it lands in the cropped space.
  @Field val overlayImageUri: String? = null
  // 20-float row-major 4×5 color matrix (Skia layout); absent skips the color pipeline.
  @Field val colorMatrix: List<Double>? = null
  // HALD LUT PNG; applied after the matrix so both filter kinds share the same seam.
  @Field val lutImageUri: String? = null
  @Field val lutIntensity: Double = 1.0
  // Playback speed in [0.5..2.0]; 1.0 skips the time-scaling stage.
  @Field val speedFactor: Double = 1.0
}

class ThumbnailOptions : Record {
  @Field val timeMs: Double = 0.0
  @Field val quality: Double = 0.9
  @Field val maxWidth: Double = 0.0
}
