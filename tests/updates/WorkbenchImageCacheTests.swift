import XCTest
import AppKit
@testable import EquationLab

final class WorkbenchImageCacheTests: XCTestCase {
    private func makePNGDataURI(red: UInt8, green: UInt8, blue: UInt8, alpha: UInt8 = 255) throws -> String {
        let colorSpace = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        var pixels: [UInt8] = [
            red, green, blue, alpha, red, green, blue, alpha,
            red, green, blue, alpha, red, green, blue, alpha
        ]
        let cgImage = try pixels.withUnsafeMutableBytes { rawBuffer -> CGImage in
            let context = try XCTUnwrap(CGContext(
                data: rawBuffer.baseAddress,
                width: 2,
                height: 2,
                bitsPerComponent: 8,
                bytesPerRow: 2 * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            return try XCTUnwrap(context.makeImage())
        }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        return "data:image/png;base64," + png.base64EncodedString()
    }

    private func decodeFormula(id: Int, image: String?) throws -> SidebarFormula {
        var object: [String: Any] = ["id": id, "label": "Eq \(id)", "detail": "", "latex": "x_\(id)", "readOnly": false]
        if let image { object["image"] = image }
        return try JSONDecoder().decode(SidebarFormula.self, from: JSONSerialization.data(withJSONObject: object))
    }

    private func pixelRGBA(_ image: NSImage) -> (Int, Int, Int, Int)? {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        var pixel: [UInt8] = [0, 0, 0, 0]
        guard let context = CGContext(
            data: &pixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return (Int(pixel[0]), Int(pixel[1]), Int(pixel[2]), Int(pixel[3]))
    }

    override func tearDown() {
        FormulaImageCache.shared.removeAllObjects()
        super.tearDown()
    }

    func testCompactCacheKeysDistinguishIdenticalLengthPNGsAndTrackImageUpdates() throws {
        let redURI = try makePNGDataURI(red: 255, green: 0, blue: 0)
        let blueURI = try makePNGDataURI(red: 0, green: 0, blue: 255)
        XCTAssertEqual(redURI.prefix(32), blueURI.prefix(32))
        XCTAssertEqual(redURI.count, blueURI.count)

        let redKey = FormulaImageCache.cacheKey(for: redURI)
        let blueKey = FormulaImageCache.cacheKey(for: blueURI)
        XCTAssertNotEqual(redKey, blueKey)
        XCTAssertEqual(redKey.length, 44, "SHA-256 base64 key should stay compact")

        var formula = try decodeFormula(id: 0, image: redURI)
        let second = try decodeFormula(id: 1, image: blueURI)
        let redImage = try XCTUnwrap(formula.thumbnail)
        let blueImage = try XCTUnwrap(second.thumbnail)
        XCTAssertEqual(pixelRGBA(redImage)?.0, 255)
        XCTAssertEqual(pixelRGBA(redImage)?.2, 0)
        XCTAssertEqual(pixelRGBA(blueImage)?.0, 0)
        XCTAssertEqual(pixelRGBA(blueImage)?.2, 255)

        // Mutating image must refresh the cached key instead of returning the old thumbnail.
        formula.image = blueURI
        let updatedImage = try XCTUnwrap(formula.thumbnail)
        XCTAssertEqual(pixelRGBA(updatedImage)?.0, 0)
        XCTAssertEqual(pixelRGBA(updatedImage)?.2, 255)
    }

    func testBoundedBackgroundPrewarmPopulatesCacheUpToLimit() throws {
        let uris = try (0..<6).map { index in
            try makePNGDataURI(red: UInt8(index * 51), green: 51, blue: 204)
        }
        let entries = uris.map { ($0, FormulaImageCache.cacheKey(for: $0)) }
        let done = expectation(description: "bounded prewarm finishes")
        FormulaImageCache.shared.prewarm(entries, limit: 3) {
            done.fulfill()
        }
        wait(for: [done], timeout: 5)

        for uri in uris.prefix(3) {
            XCTAssertNotNil(FormulaImageCache.shared.cachedImage(for: uri))
        }
        for uri in uris.dropFirst(3) {
            XCTAssertNil(FormulaImageCache.shared.cachedImage(for: uri))
        }
    }

    @MainActor
    func testWordWorkspacePollingStaysIdleWhenWordClosedAndReconcilesLifecycle() throws {
        let bridge = DesktopBridge()
        XCTAssertFalse(bridge.shouldPollWordWorkspace(wordRunning: false))
        XCTAssertTrue(bridge.shouldPollWordWorkspace(wordRunning: true))

        try bridge.state.apply(["wordWorkspaceConnected": true])
        XCTAssertTrue(bridge.shouldPollWordWorkspace(wordRunning: false), "must reconcile Word exit while connected")

        try bridge.state.apply(["wordWorkspaceConnected": false, "openWordDocuments": [["identity": "doc:1", "name": "Draft.docx", "readOnly": false]]])
        XCTAssertTrue(bridge.shouldPollWordWorkspace(wordRunning: false), "must reconcile remaining open document catalog")

        try bridge.state.apply(["openWordDocuments": []])
        XCTAssertFalse(bridge.shouldPollWordWorkspace(wordRunning: false), "returns to zero polling after Word exit is reconciled")

        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": String(repeating: "a", count: 64)])
        XCTAssertTrue(bridge.shouldPollWordWorkspace(wordRunning: false), "bound Word session continues polling")
    }
}
