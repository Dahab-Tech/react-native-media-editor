import Foundation

let projectSchemaVersion = 1

struct CropRecord: Decodable {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

/// Pip canvas placement — normalized center + scale/rotation(CW)/opacity, window start in timeline ms.
struct PipPlacementRecord: Decodable {
  let timelineStartMs: Int64
  let x: Double
  let y: Double
  let scale: Double
  let rotation: Double
  let opacity: Double
}

struct ClipRecord: Decodable {
  let id: String
  let source: String
  let sourceDurationMs: Int64
  let sourceStartMs: Int64
  let sourceEndMs: Int64
  let speed: Double
  /// Display dimensions (rotation already applied) — drive the render-size policy.
  let width: Int
  let height: Int
  let crop: CropRecord?
  let colorMatrix: [Double]?
  let lutUri: String?
  let lutIntensity: Double
  let washUri: String?
  let washBlendMode: String?
  let washIntensity: Double
  /// Present on pip-track clips only.
  let placement: PipPlacementRecord?

  var trimmedDurationMs: Int64 { sourceEndMs - sourceStartMs }

  private enum CodingKeys: String, CodingKey {
    case id, source, sourceDurationMs, sourceStartMs, sourceEndMs, speed, width, height
    case crop, colorMatrix, lutUri, lutIntensity, washUri, washBlendMode, washIntensity
    case placement
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    source = try c.decode(String.self, forKey: .source)
    sourceDurationMs = try c.decode(Int64.self, forKey: .sourceDurationMs)
    sourceStartMs = try c.decode(Int64.self, forKey: .sourceStartMs)
    sourceEndMs = try c.decode(Int64.self, forKey: .sourceEndMs)
    speed = try c.decodeIfPresent(Double.self, forKey: .speed) ?? 1.0
    width = try c.decode(Int.self, forKey: .width)
    height = try c.decode(Int.self, forKey: .height)
    crop = try c.decodeIfPresent(CropRecord.self, forKey: .crop)
    colorMatrix = try c.decodeIfPresent([Double].self, forKey: .colorMatrix)
    lutUri = try c.decodeIfPresent(String.self, forKey: .lutUri)
    lutIntensity = try c.decodeIfPresent(Double.self, forKey: .lutIntensity) ?? 1.0
    washUri = try c.decodeIfPresent(String.self, forKey: .washUri)
    washBlendMode = try c.decodeIfPresent(String.self, forKey: .washBlendMode)
    washIntensity = try c.decodeIfPresent(Double.self, forKey: .washIntensity) ?? 1.0
    placement = try c.decodeIfPresent(PipPlacementRecord.self, forKey: .placement)
  }
}

struct OverlayRecord: Decodable {
  let id: String
  let pngUri: String
  let timelineStartMs: Int64
  let timelineEndMs: Int64
}

struct CompressionRecord: Decodable {
  let preset: String?
  let maxDimension: Int?
  let bitrateMbps: Double?
}

struct OutputRecord: Decodable {
  let maxDimension: Int?
  let compression: CompressionRecord?
}

/// One pip layer = one track holding one clip; array order = z-order over the main track.
struct PipClipRecord {
  let clip: ClipRecord
  let placement: PipPlacementRecord
}

struct ProjectRecord {
  let clips: [ClipRecord]
  let pips: [PipClipRecord]
  let overlays: [OverlayRecord]
  let output: OutputRecord?
}

/// Parses + validates the schema v1 project JSON sent over the bridge.
enum ProjectRecords {
  private struct WireProject: Decodable {
    let schemaVersion: Int
    let tracks: [WireTrack]
    let overlays: [OverlayRecord]?
    let output: OutputRecord?
  }

  private struct WireTrack: Decodable {
    let kind: String?
    let clips: [ClipRecord]
  }

  static func parse(_ json: String) throws -> ProjectRecord {
    guard let data = json.data(using: .utf8) else {
      throw MediaEditorError.invalidProject("Project JSON is not valid UTF-8")
    }
    let wire: WireProject
    do {
      wire = try JSONDecoder().decode(WireProject.self, from: data)
    } catch {
      throw MediaEditorError.invalidProject("\(error)")
    }
    guard wire.schemaVersion == projectSchemaVersion else {
      throw MediaEditorError.invalidProject("Unsupported schemaVersion: \(wire.schemaVersion)")
    }
    guard let mainTrack = wire.tracks.first, mainTrack.kind != "pip" else {
      throw MediaEditorError.invalidProject("tracks[0] must be the main video track")
    }
    let clips = mainTrack.clips
    guard !clips.isEmpty else {
      throw MediaEditorError.invalidProject("Project has no clips")
    }
    for clip in clips { try validate(clip) }
    let pips = try wire.tracks.dropFirst().map(parsePip)
    return ProjectRecord(clips: clips, pips: pips, overlays: wire.overlays ?? [], output: wire.output)
  }

  private static func parsePip(_ track: WireTrack) throws -> PipClipRecord {
    guard track.kind == "pip" else {
      throw MediaEditorError.invalidProject("Only pip tracks may follow the main track")
    }
    guard track.clips.count == 1 else {
      throw MediaEditorError.invalidProject("Pip track must contain exactly one clip")
    }
    let clip = track.clips[0]
    try validate(clip)
    guard let placement = clip.placement else {
      throw MediaEditorError.invalidProject("Pip clip \(clip.id) is missing placement")
    }
    guard placement.scale > 0 else {
      throw MediaEditorError.invalidProject("Pip clip \(clip.id): invalid scale \(placement.scale)")
    }
    return PipClipRecord(clip: clip, placement: placement)
  }

  private static func validate(_ clip: ClipRecord) throws {
    guard clip.sourceStartMs >= 0, clip.sourceEndMs > clip.sourceStartMs else {
      throw MediaEditorError.invalidProject(
        "Clip \(clip.id): invalid source range \(clip.sourceStartMs)..\(clip.sourceEndMs)")
    }
    guard clip.speed > 0 else {
      throw MediaEditorError.invalidProject("Clip \(clip.id): invalid speed \(clip.speed)")
    }
    guard clip.colorMatrix == nil || clip.colorMatrix?.count == 20 else {
      throw MediaEditorError.invalidProject("Clip \(clip.id): colorMatrix must have 20 entries")
    }
  }
}
