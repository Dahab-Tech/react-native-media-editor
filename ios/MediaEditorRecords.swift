import ExpoModulesCore

struct ThumbnailOptions: Record {
  @Field var timeMs: Double = 0
  @Field var quality: Double = 0.9
  @Field var maxWidth: Double = 0
}

struct ThumbnailStripOptions: Record {
  @Field var timesMs: [Double] = []
  @Field var quality: Double = 0.9
  @Field var maxWidth: Double = 0
}
