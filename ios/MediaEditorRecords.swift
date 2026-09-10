import ExpoModulesCore

struct CropRectOptions: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
}

struct CompressionOptions: Record {
  // 'high' | 'medium' | 'low'; drives the bits-per-pixel-per-frame target when bitrateMbps is absent.
  @Field var preset: String? = nil
  // Long-edge cap for the post-crop output, preserving aspect. 0 keeps native dims.
  @Field var maxDimension: Double = 0
  // Explicit average video bitrate override; takes precedence over `preset`.
  @Field var bitrateMbps: Double = 0
}

struct TrimOptions: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var crop: CropRectOptions? = nil
  // Static PNG overlay baked into every frame; forces re-encode (incompatible with passthrough).
  @Field var overlayImageUri: String? = nil
  // Overlay wash PNG blended per-frame against the graded frame (unlike overlayImageUri's alpha paste).
  @Field var washImageUri: String? = nil
  // Skia blend-mode name ('screen', 'softLight', ...); mapped to the matching CI blend filter.
  @Field var washBlendMode: String? = nil
  @Field var washIntensity: Double = 1.0
  // 20-float row-major 4×5 color matrix (Skia layout); absent skips the color pipeline.
  @Field var colorMatrix: [Double]? = nil
  // HALD LUT PNG; applied after the matrix so both filter kinds share the same seam.
  @Field var lutImageUri: String? = nil
  @Field var lutIntensity: Double = 1.0
  // Playback speed in [0.5..2.0]; 1.0 skips the time-scaling stage.
  @Field var speedFactor: Double = 1.0
  // Opt-in re-encode target. Presence forces the writer path even for pure trims.
  @Field var compression: CompressionOptions? = nil
}

struct ThumbnailOptions: Record {
  @Field var timeMs: Double = 0
  @Field var quality: Double = 0.9
  @Field var maxWidth: Double = 0
}
