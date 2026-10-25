package com.dahabtech.mediaeditor.records

import org.json.JSONArray
import org.json.JSONObject

const val PROJECT_SCHEMA_VERSION = 1

data class CropRecord(val x: Int, val y: Int, val width: Int, val height: Int)

data class ClipRecord(
  val id: String,
  val source: String,
  val sourceDurationMs: Long,
  val sourceStartMs: Long,
  val sourceEndMs: Long,
  val speed: Double,
  /** Display dimensions (rotation already applied) — drive the render-size policy. */
  val width: Int,
  val height: Int,
  val crop: CropRecord?,
  val colorMatrix: List<Double>?,
  val lutUri: String?,
  val lutIntensity: Double,
  val washUri: String?,
  val washBlendMode: String?,
  val washIntensity: Double,
) {
  val trimmedDurationMs: Long get() = sourceEndMs - sourceStartMs
}

/** Pip canvas placement — normalized center + scale/rotation(CW)/opacity, window start in timeline ms. */
data class PipPlacementRecord(
  val timelineStartMs: Long,
  val x: Double,
  val y: Double,
  val scale: Double,
  val rotation: Double,
  val opacity: Double,
)

/** One pip layer = one track holding one clip; array order = z-order over the main track. */
data class PipClipRecord(val clip: ClipRecord, val placement: PipPlacementRecord)

data class OverlayRecord(
  val id: String,
  val pngUri: String,
  val timelineStartMs: Long,
  val timelineEndMs: Long,
)

data class CompressionRecord(
  val preset: String?,
  val maxDimension: Int?,
  val bitrateMbps: Double?,
)

data class OutputRecord(val maxDimension: Int?, val compression: CompressionRecord?)

data class ProjectRecord(
  val clips: List<ClipRecord>,
  val pips: List<PipClipRecord>,
  val overlays: List<OverlayRecord>,
  val output: OutputRecord?,
)

/** Parses + validates the schema v1 project JSON sent over the bridge. */
object ProjectRecords {
  fun parse(json: String): ProjectRecord {
    val root = JSONObject(json)
    val version = root.optInt("schemaVersion", -1)
    require(version == PROJECT_SCHEMA_VERSION) { "Unsupported schemaVersion: $version" }
    val tracks = root.getJSONArray("tracks")
    require(tracks.length() >= 1) { "Project has no tracks" }
    val main = tracks.getJSONObject(0)
    require(main.optString("kind", "video") != "pip") { "tracks[0] must be the main video track" }
    val clips = parseClips(main.getJSONArray("clips"))
    require(clips.isNotEmpty()) { "Project has no clips" }
    return ProjectRecord(
      clips = clips,
      pips = (1 until tracks.length()).map { i -> parsePip(tracks.getJSONObject(i)) },
      overlays = parseOverlays(root.optJSONArray("overlays")),
      output = root.optJSONObject("output")?.let(::parseOutput),
    )
  }

  private fun parseClips(array: JSONArray): List<ClipRecord> =
    (0 until array.length()).map { i -> parseClip(array.getJSONObject(i)) }

  private fun parseClip(obj: JSONObject): ClipRecord {
    val clip = ClipRecord(
      id = obj.getString("id"),
      source = obj.getString("source"),
      sourceDurationMs = obj.getLong("sourceDurationMs"),
      sourceStartMs = obj.getLong("sourceStartMs"),
      sourceEndMs = obj.getLong("sourceEndMs"),
      speed = obj.optDouble("speed", 1.0),
      width = obj.getInt("width"),
      height = obj.getInt("height"),
      crop = obj.optJSONObject("crop")?.let {
        CropRecord(it.getInt("x"), it.getInt("y"), it.getInt("width"), it.getInt("height"))
      },
      colorMatrix = obj.optJSONArray("colorMatrix")?.let { m -> (0 until m.length()).map(m::getDouble) },
      lutUri = obj.optStringOrNull("lutUri"),
      lutIntensity = obj.optDouble("lutIntensity", 1.0),
      washUri = obj.optStringOrNull("washUri"),
      washBlendMode = obj.optStringOrNull("washBlendMode"),
      washIntensity = obj.optDouble("washIntensity", 1.0),
    )
    require(clip.sourceStartMs >= 0 && clip.sourceEndMs > clip.sourceStartMs) {
      "Clip ${clip.id}: invalid source range ${clip.sourceStartMs}..${clip.sourceEndMs}"
    }
    require(clip.speed > 0.0) { "Clip ${clip.id}: invalid speed ${clip.speed}" }
    require(clip.colorMatrix == null || clip.colorMatrix.size == 20) {
      "Clip ${clip.id}: colorMatrix must have 20 entries"
    }
    return clip
  }

  private fun parsePip(track: JSONObject): PipClipRecord {
    require(track.optString("kind") == "pip") { "Only pip tracks may follow the main track" }
    val clips = track.getJSONArray("clips")
    require(clips.length() == 1) { "Pip track must contain exactly one clip" }
    val obj = clips.getJSONObject(0)
    val clip = parseClip(obj)
    val placement = obj.optJSONObject("placement")
    requireNotNull(placement) { "Pip clip ${clip.id} is missing placement" }
    val record = PipPlacementRecord(
      timelineStartMs = placement.getLong("timelineStartMs"),
      x = placement.getDouble("x"),
      y = placement.getDouble("y"),
      scale = placement.getDouble("scale"),
      rotation = placement.getDouble("rotation"),
      opacity = placement.getDouble("opacity"),
    )
    require(record.scale > 0.0) { "Pip clip ${clip.id}: invalid scale ${record.scale}" }
    return PipClipRecord(clip = clip, placement = record)
  }

  private fun parseOverlays(array: JSONArray?): List<OverlayRecord> {
    if (array == null) return emptyList()
    return (0 until array.length()).map { i ->
      val obj = array.getJSONObject(i)
      OverlayRecord(
        id = obj.getString("id"),
        pngUri = obj.getString("pngUri"),
        timelineStartMs = obj.getLong("timelineStartMs"),
        timelineEndMs = obj.getLong("timelineEndMs"),
      )
    }
  }

  private fun parseOutput(obj: JSONObject) = OutputRecord(
    maxDimension = if (obj.has("maxDimension")) obj.getInt("maxDimension") else null,
    compression = obj.optJSONObject("compression")?.let {
      CompressionRecord(
        preset = it.optStringOrNull("preset"),
        maxDimension = if (it.has("maxDimension")) it.getInt("maxDimension") else null,
        bitrateMbps = if (it.has("bitrateMbps")) it.getDouble("bitrateMbps") else null,
      )
    },
  )

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
}
