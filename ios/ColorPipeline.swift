import CoreImage
import CoreGraphics
import Foundation

/// Shared CI building blocks for the timeline compositor (color matrix, HALD cube, blend wash).
enum ColorPipeline {
  /// Linear mix of two images via CIDissolveTransition (amount 0 = base, 1 = target).
  static func mix(base: CIImage, target: CIImage, amount: Float) -> CIImage {
    if amount >= 1.0 - 1e-4 { return target }
    if amount <= 1e-4 { return base }
    guard let dissolve = CIFilter(name: "CIDissolveTransition") else { return target }
    dissolve.setValue(base, forKey: kCIInputImageKey)
    dissolve.setValue(target, forKey: kCIInputTargetImageKey)
    dissolve.setValue(amount, forKey: kCIInputTimeKey)
    return dissolve.outputImage ?? target
  }

  /// Map a Skia blend-mode name to the equivalent Core Image blend filter.
  static func blendFilterName(_ mode: String?) -> String {
    switch mode {
    case "screen": return "CIScreenBlendMode"
    case "softLight": return "CISoftLightBlendMode"
    case "hardLight": return "CIHardLightBlendMode"
    case "multiply": return "CIMultiplyBlendMode"
    case "lighten": return "CILightenBlendMode"
    case "darken": return "CIDarkenBlendMode"
    case "colorDodge": return "CIColorDodgeBlendMode"
    case "colorBurn": return "CIColorBurnBlendMode"
    default: return "CIOverlayBlendMode"
    }
  }

  /// Build a CIColorMatrix filter from the Skia 20-float row-major 4×5 matrix.
  static func colorMatrixFilter(from m: [Double]) -> CIFilter? {
    guard m.count == 20, let filter = CIFilter(name: "CIColorMatrix") else { return nil }
    // Each CI vector IS a Skia row (the "input" prefix is CI parameter naming). Do NOT transpose.
    let rVector = CIVector(x: CGFloat(m[0]), y: CGFloat(m[1]), z: CGFloat(m[2]), w: CGFloat(m[3]))
    let gVector = CIVector(x: CGFloat(m[5]), y: CGFloat(m[6]), z: CGFloat(m[7]), w: CGFloat(m[8]))
    let bVector = CIVector(x: CGFloat(m[10]), y: CGFloat(m[11]), z: CGFloat(m[12]), w: CGFloat(m[13]))
    let aVector = CIVector(x: CGFloat(m[15]), y: CGFloat(m[16]), z: CGFloat(m[17]), w: CGFloat(m[18]))
    let biasVector = CIVector(x: CGFloat(m[4]), y: CGFloat(m[9]), z: CGFloat(m[14]), w: CGFloat(m[19]))
    filter.setValue(rVector, forKey: "inputRVector")
    filter.setValue(gVector, forKey: "inputGVector")
    filter.setValue(bVector, forKey: "inputBVector")
    filter.setValue(aVector, forKey: "inputAVector")
    filter.setValue(biasVector, forKey: "inputBiasVector")
    return filter
  }

  /// Convert a square HALD PNG into a configured CIColorCube filter; nil on invalid dimensions.
  static func colorCubeFilter(from haldImage: CGImage) -> CIFilter? {
    let edge = haldImage.width
    guard edge > 0, edge == haldImage.height else { return nil }
    let k = Int(round(pow(Double(edge), 1.0 / 3.0)))
    guard k > 1, k * k * k == edge else { return nil }
    let cubeSize = k * k

    let bytesPerRow = edge * 4
    var pixelBytes = [UInt8](repeating: 0, count: edge * bytesPerRow)
    guard let colorSpace = haldImage.colorSpace,
          let ctx = CGContext(
            data: &pixelBytes,
            width: edge,
            height: edge,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else {
      return nil
    }
    ctx.draw(haldImage, in: CGRect(x: 0, y: 0, width: edge, height: edge))

    // HALD blue-slices tile at (slice % k, slice / k); rearrange into CIColorCube's linear layout.
    let tilesPerRow = k
    var cubeData = [Float32](repeating: 0, count: cubeSize * cubeSize * cubeSize * 4)
    for b in 0..<cubeSize {
      let sliceX = b % tilesPerRow
      let sliceY = b / tilesPerRow
      for g in 0..<cubeSize {
        for r in 0..<cubeSize {
          let srcX = sliceX * cubeSize + r
          let srcY = sliceY * cubeSize + g
          let srcOffset = srcY * bytesPerRow + srcX * 4
          let dstOffset = (b * cubeSize * cubeSize + g * cubeSize + r) * 4
          cubeData[dstOffset + 0] = Float32(pixelBytes[srcOffset + 0]) / 255.0
          cubeData[dstOffset + 1] = Float32(pixelBytes[srcOffset + 1]) / 255.0
          cubeData[dstOffset + 2] = Float32(pixelBytes[srcOffset + 2]) / 255.0
          cubeData[dstOffset + 3] = Float32(pixelBytes[srcOffset + 3]) / 255.0
        }
      }
    }
    let data = cubeData.withUnsafeBufferPointer { Data(buffer: $0) }
    guard let filter = CIFilter(name: "CIColorCube") else { return nil }
    filter.setValue(cubeSize, forKey: "inputCubeDimension")
    filter.setValue(data, forKey: "inputCubeData")
    return filter
  }

  /// Resolve a `file://` or plain-path URI into a CGImage; nil on any failure.
  static func loadCGImage(fromURIString uri: String) -> CGImage? {
    let url: URL
    if let parsed = URL(string: uri), parsed.scheme != nil {
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }
}
