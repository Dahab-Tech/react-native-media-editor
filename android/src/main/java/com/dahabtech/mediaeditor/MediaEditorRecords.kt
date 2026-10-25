package com.dahabtech.mediaeditor

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ThumbnailOptions : Record {
  @Field val timeMs: Double = 0.0
  @Field val quality: Double = 0.9
  @Field val maxWidth: Double = 0.0
}

class ThumbnailStripOptions : Record {
  @Field val timesMs: List<Double> = emptyList()
  @Field val quality: Double = 0.9
  @Field val maxWidth: Double = 0.0
}
