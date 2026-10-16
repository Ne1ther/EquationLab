import Foundation
import CoreText
import CoreGraphics
import ImageIO

// Register the shipped OFL font in this helper only. No user/system font
// installation. A URL-backed descriptor also avoids choosing an older system
// font with the same family name when the bundled face is available.
func bundledMathDescriptor() -> CTFontDescriptor? {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
    var candidates = [executable.deletingLastPathComponent().appendingPathComponent("../fonts/STIXTwoMath-Regular.otf").standardizedFileURL]
    var parent = executable.deletingLastPathComponent()
    for _ in 0..<8 { candidates.append(parent.appendingPathComponent("assets/fonts/STIXTwoMath-Regular.otf")); parent.deleteLastPathComponent() }
    candidates.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("assets/fonts/STIXTwoMath-Regular.otf"))
    for url in candidates where FileManager.default.fileExists(atPath: url.path) {
        var error: Unmanaged<CFError>?
        _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        if let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let descriptor = descriptors.first { return descriptor }
    }
    return nil
}
let shippedMathDescriptor = bundledMathDescriptor()

// Process-local CoreText glyph extraction. No font installation, system writes,
// or browser font substitution. Geometry is returned in a 1000-unit em square.
struct Face: Decodable { let font: String; let style: Int; let characters: [Int] }
struct OutlineCommand: Decodable { let op: String; let values: [Double] }
struct VectorClip: Decodable { let matrix: [Double]; let rect: [Double] }
struct VectorOutline: Decodable { let matrix: [Double]; let commands: [OutlineCommand]; let fill: String; let stroke: String; let strokeWidth: Double; let clips: [VectorClip]?; let lineCap: String?; let lineJoin: String? }
struct Request: Decodable { let faces: [Face]?; let vector: [VectorOutline]?; let viewBox: [Double]?; let png: String?; let width: Double?; let height: Double?; let format: String?; let scale: Double? }
func vectorPDF(_ request: Request) throws -> Data {
    func invalid() -> NSError { NSError(domain: "EquationFont", code: 9, userInfo: [NSLocalizedDescriptionKey: "Invalid vector PDF geometry"]) }
    guard request.faces == nil, request.png == nil, let vector = request.vector, !vector.isEmpty, vector.count <= 50000,
          let v = request.viewBox, v.count == 4, v.allSatisfy(\.isFinite), v[2] > 0, v[3] > 0,
          let width = request.width, let height = request.height, width.isFinite, height.isFinite, width > 0, height > 0, width <= 10000, height <= 10000 else { throw invalid() }
    let pdf = NSMutableData(); var box = CGRect(x: 0, y: 0, width: width, height: height)
    let info = [kCGPDFContextCreator: "Equation Lab Vector Preview v1"] as CFDictionary
    guard let consumer = CGDataConsumer(data: pdf as CFMutableData), let context = CGContext(consumer: consumer, mediaBox: &box, info) else { throw invalid() }
    context.beginPDFPage(nil)
    context.translateBy(x: 0, y: height); context.scaleBy(x: width / v[2], y: -height / v[3]); context.translateBy(x: -v[0], y: -v[1])
    try drawVectors(vector, context)
    context.endPDFPage(); context.closePDF(); return pdf as Data
}
func drawVectors(_ vector: [VectorOutline], _ context: CGContext) throws {
    func invalid() -> NSError { NSError(domain: "EquationFont", code: 9, userInfo: [NSLocalizedDescriptionKey: "Invalid vector geometry"]) }
    func color(_ value: String) throws -> CGColor? {
        if value == "none" { return nil }
        guard value.count == 7, value.first == "#", let rgb = UInt32(value.dropFirst(), radix: 16) else { throw invalid() }
        return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [CGFloat((rgb >> 16) & 255) / 255, CGFloat((rgb >> 8) & 255) / 255, CGFloat(rgb & 255) / 255, 1])
    }
    for outline in vector {
        let m = outline.matrix
        guard m.count == 6, m.allSatisfy(\.isFinite), outline.commands.count <= 200000, outline.strokeWidth.isFinite, outline.strokeWidth >= 0 else { throw invalid() }
        let path = CGMutablePath()
        for command in outline.commands {
            let p = command.values
            guard p.allSatisfy(\.isFinite) else { throw invalid() }
            switch (command.op, p.count) {
            case ("M", 2): path.move(to: CGPoint(x: p[0], y: p[1]))
            case ("L", 2): path.addLine(to: CGPoint(x: p[0], y: p[1]))
            case ("Q", 4): path.addQuadCurve(to: CGPoint(x: p[2], y: p[3]), control: CGPoint(x: p[0], y: p[1]))
            case ("C", 6): path.addCurve(to: CGPoint(x: p[4], y: p[5]), control1: CGPoint(x: p[0], y: p[1]), control2: CGPoint(x: p[2], y: p[3]))
            case ("Z", 0): path.closeSubpath()
            default: throw invalid()
            }
        }
        let fill = try color(outline.fill), stroke = try color(outline.stroke)
        context.saveGState()
        guard (outline.clips?.count ?? 0) <= 64 else { throw invalid() }
        for clip in outline.clips ?? [] {
            let c = clip.matrix, r = clip.rect
            guard c.count == 6, r.count == 4, (c + r).allSatisfy(\.isFinite), r[2] > 0, r[3] > 0 else { throw invalid() }
            var transform = CGAffineTransform(a: c[0], b: c[1], c: c[2], d: c[3], tx: c[4], ty: c[5])
            context.addPath(CGPath(rect: CGRect(x: r[0], y: r[1], width: r[2], height: r[3]), transform: &transform)); context.clip()
        }
        context.concatenate(CGAffineTransform(a: m[0], b: m[1], c: m[2], d: m[3], tx: m[4], ty: m[5])); context.addPath(path)
        if let fill { context.setFillColor(fill) }
        if let stroke { context.setStrokeColor(stroke); context.setLineWidth(outline.strokeWidth)
            switch outline.lineCap ?? "butt" { case "butt": context.setLineCap(.butt); case "round": context.setLineCap(.round); case "square": context.setLineCap(.square); default: throw invalid() }
            switch outline.lineJoin ?? "miter" { case "miter": context.setLineJoin(.miter); case "round": context.setLineJoin(.round); case "bevel": context.setLineJoin(.bevel); default: throw invalid() }
        }
        if fill != nil { context.drawPath(using: stroke != nil && outline.strokeWidth > 0 ? .fillStroke : .fill) }
        else if stroke != nil && outline.strokeWidth > 0 { context.strokePath() }
        context.restoreGState()
    }
}
func vectorPNG(_ request: Request) throws -> Data {
    guard request.faces == nil, request.png == nil, let vector = request.vector, !vector.isEmpty, vector.count <= 50000,
          let v = request.viewBox, v.count == 4, v.allSatisfy(\.isFinite), v[2] > 0, v[3] > 0,
          let width = request.width, let height = request.height, width.isFinite, height.isFinite, width > 0, height > 0, width <= 10000, height <= 10000,
          let scale = request.scale, scale.isFinite, scale > 0, scale <= 8 else { throw NSError(domain: "EquationFont", code: 10) }
    let w = Int(ceil(width * scale)), h = Int(ceil(height * scale))
    guard w > 0, h > 0, w <= 32000000 / h,
          let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw NSError(domain: "EquationFont", code: 11) }
    context.setAllowsAntialiasing(true); context.setShouldAntialias(true)
    context.translateBy(x: 0, y: Double(h)); context.scaleBy(x: width * scale / v[2], y: -height * scale / v[3]); context.translateBy(x: -v[0], y: -v[1])
    try drawVectors(vector, context)
    guard let image = context.makeImage() else { throw NSError(domain: "EquationFont", code: 12) }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, "public.png" as CFString, 1, nil) else { throw NSError(domain: "EquationFont", code: 13) }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "EquationFont", code: 14) }
    return data as Data
}
func number(_ x: CGFloat) -> String { String(format: "%.3f", Double(x)) }
func pathData(_ path: CGPath) -> String {
    var parts: [String] = []
    path.applyWithBlock { element in
        let e = element.pointee, p = e.points
        func point(_ i: Int) -> String { "\(number(p[i].x)) \(number(p[i].y))" }
        switch e.type {
        case .moveToPoint: parts.append("M" + point(0))
        case .addLineToPoint: parts.append("L" + point(0))
        case .addQuadCurveToPoint: parts.append("Q" + point(0) + " " + point(1))
        case .addCurveToPoint: parts.append("C" + point(0) + " " + point(1) + " " + point(2))
        case .closeSubpath: parts.append("Z")
        @unknown default: break
        }
    }
    return parts.joined()
}
func process(_ bytes: Data) throws -> [String: Any] {
    guard bytes.count <= 24_000_000 else { throw NSError(domain: "EquationFont", code: 1, userInfo: [NSLocalizedDescriptionKey: "Font request too large"]) }
    let request = try JSONDecoder().decode(Request.self, from: bytes)
    if request.vector != nil {
        if request.format == "png" { return ["png": try vectorPNG(request).base64EncodedString()] }
        return ["pdf": try vectorPDF(request).base64EncodedString()]
    }
    if let png = request.png {
        guard request.faces == nil, let width = request.width, let height = request.height, width.isFinite, height.isFinite, width > 0, height > 0, width <= 10000, height <= 10000,
              let data = Data(base64Encoded: png), data.count <= 16_777_216,
              let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width * image.height <= 32_000_000 else { throw NSError(domain: "EquationFont", code: 7, userInfo: [NSLocalizedDescriptionKey: "Invalid PDF preview request"]) }
        let pdf = NSMutableData(); var box = CGRect(x: 0, y: 0, width: width, height: height)
        guard let consumer = CGDataConsumer(data: pdf as CFMutableData), let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { throw NSError(domain: "EquationFont", code: 8) }
        context.beginPDFPage(nil); context.draw(image, in: box); context.endPDFPage(); context.closePDF()
        return ["pdf": (pdf as Data).base64EncodedString()]
    }
    guard let faces = request.faces, faces.count <= 64, bytes.count <= 500_000 else { throw NSError(domain: "EquationFont", code: 2) }
    var result: [[String: Any]] = []
    for face in faces {
        let base: CTFont
        if face.font.caseInsensitiveCompare("STIX Two Math") == .orderedSame, let descriptor = shippedMathDescriptor { base = CTFontCreateWithFontDescriptor(descriptor, 1000, nil) }
        else { base = CTFontCreateWithName(face.font as CFString, 1000, nil) }
        let actual = CTFontCopyFamilyName(base) as String
        guard actual.caseInsensitiveCompare(face.font) == .orderedSame else {
            throw NSError(domain: "EquationFont", code: 3, userInfo: [NSLocalizedDescriptionKey: "Font unavailable: \(face.font) (system resolved \(actual))"])
        }
        let traits = CTFontSymbolicTraits(rawValue: (face.style & 1 != 0 ? CTFontSymbolicTraits.traitBold.rawValue : 0) | (face.style & 2 != 0 ? CTFontSymbolicTraits.traitItalic.rawValue : 0))
        let font = CTFontCreateCopyWithSymbolicTraits(base, 1000, nil, traits, [.traitBold, .traitItalic]) ?? base
        let actualTraits = CTFontGetSymbolicTraits(font)
        let syntheticItalic = face.style & 2 != 0 && !actualTraits.contains(.traitItalic)
        let syntheticBold = face.style & 1 != 0 && !actualTraits.contains(.traitBold)
        var glyphs: [String: Any] = [:]
        for code in Set(face.characters) {
            guard code > 0 && code <= 65535 else { throw NSError(domain: "EquationFont", code: 5) }
            var ch = UniChar(code), glyph = CGGlyph()
            guard CTFontGetGlyphsForCharacters(font, &ch, &glyph, 1), glyph != 0 else {
                throw NSError(domain: "EquationFont", code: 6, userInfo: [NSLocalizedDescriptionKey: "Missing glyph U+\(String(code, radix: 16)) in \(face.font)"])
            }
            var advance = CGSize.zero
            CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &advance, 1)
            var transform = CGAffineTransform(a: 1, b: 0, c: syntheticItalic ? 0.2 : 0, d: 1, tx: 0, ty: 0)
            let raw = CTFontCreatePathForGlyph(font, glyph, &transform)
            var outline = raw
            if syntheticBold, let raw = raw {
                let combined = CGMutablePath(); combined.addPath(raw)
                combined.addPath(raw.copy(strokingWithWidth: 20, lineCap: .round, lineJoin: .round, miterLimit: 4))
                outline = combined
            }
            let rect = outline?.boundingBoxOfPath ?? .zero
            glyphs[String(code)] = ["advance": advance.width, "height": max(0, rect.maxY), "depth": max(0, -rect.minY), "left": rect.minX, "right": rect.maxX, "path": outline.map(pathData) ?? ""]
        }
        result.append(["font": actual, "style": face.style, "postscript": CTFontCopyPostScriptName(font) as String, "syntheticItalic": syntheticItalic, "syntheticBold": syntheticBold, "glyphs": glyphs, "metrics": ["ascent": CTFontGetAscent(font), "descent": CTFontGetDescent(font), "xHeight": CTFontGetXHeight(font), "capHeight": CTFontGetCapHeight(font)]])
    }
    return ["faces": result]
}
func response(_ bytes: Data) -> Data {
    do { return try JSONSerialization.data(withJSONObject: process(bytes), options: [.sortedKeys]) }
    catch { return try! JSONSerialization.data(withJSONObject: ["error": error.localizedDescription]) }
}
if CommandLine.arguments.contains("--stdio") {
    // Newline framing keeps one CoreText process warm without a listener.
    while let line = readLine() { FileHandle.standardOutput.write(response(Data(line.utf8))); FileHandle.standardOutput.write(Data([10])) }
} else { FileHandle.standardOutput.write(response(FileHandle.standardInput.readDataToEndOfFile())) }

