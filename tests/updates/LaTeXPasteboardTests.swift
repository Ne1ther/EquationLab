import AppKit
import XCTest
@testable import EquationLab

final class LaTeXPasteboardTests: XCTestCase {
    private final class Pasteboard: LaTeXPasteboardSource {
        var changeCount = 0
        var item = NSPasteboardItem() { didSet { changeCount += 1 } }
        var copyDuringRead = false

        func string(forType type: NSPasteboard.PasteboardType) -> String? {
            let value = item.string(forType: type)
            if copyDuringRead { item = NSPasteboardItem() }
            return value
        }

        func data(forType type: NSPasteboard.PasteboardType) -> Data? {
            item.data(forType: type)
        }
    }

    func testCrossDocumentCopyReadsCurrentPlainFlavorWithoutChangingPasteboard() throws {
        let pasteboard = Pasteboard()
        let prose = "技术进步与要素投入增量的影响相当"
        let equation = #"""
        \begin{gathered}
        a=b\\
        c=d
        \end{gathered}
        """#
        XCTAssertTrue(pasteboard.item.setString(prose, forType: .string))
        XCTAssertEqual(LaTeXPasteboard.snapshot(pasteboard), .text(prose))

        let selection = NSPasteboardItem()
        XCTAssertTrue(selection.setString("<p>\(prose)</p>", forType: .html))
        let rtf = try XCTUnwrap(NSAttributedString(string: prose).rtf(
            from: NSRange(location: 0, length: (prose as NSString).length),
            documentAttributes: [:]
        ))
        XCTAssertTrue(selection.setData(rtf, forType: .rtf))
        XCTAssertTrue(selection.setString(equation, forType: .string))
        pasteboard.item = selection
        let changeCount = pasteboard.changeCount

        let snapshot = LaTeXPasteboard.snapshot(pasteboard)
        XCTAssertEqual(snapshot, .text(equation))
        XCTAssertEqual(snapshot.payload, ["state": "available", "text": equation])
        XCTAssertEqual(pasteboard.changeCount, changeCount)
        XCTAssertEqual(pasteboard.string(forType: .string), equation)
        XCTAssertEqual(pasteboard.data(forType: .rtf), rtf)
        XCTAssertEqual(pasteboard.string(forType: .html), "<p>\(prose)</p>")
    }

    func testPasteboardFallbackExposesTextFromRTFAndHTML() throws {
        let pasteboard = Pasteboard()
        let equation = #"a+\frac{b}{c}"#
        let attributed = NSAttributedString(string: equation)
        let rtf = try XCTUnwrap(attributed.rtf(from: NSRange(location: 0, length: attributed.length),
                                              documentAttributes: [:]))
        XCTAssertTrue(pasteboard.item.setData(rtf, forType: .rtf))
        XCTAssertEqual(LaTeXPasteboard.snapshot(pasteboard), .text(equation))

        pasteboard.item = NSPasteboardItem()
        let html = "<p>\(equation)</p>"
        XCTAssertTrue(pasteboard.item.setString(html, forType: .html))
        let snapshot = LaTeXPasteboard.snapshot(pasteboard)
        XCTAssertEqual(snapshot, .html(html))
        XCTAssertEqual(snapshot.payload, ["state": "available", "html": html])
    }

    func testChangingClipboardOwnerRejectsAnInconsistentSnapshot() {
        let pasteboard = Pasteboard()
        XCTAssertTrue(pasteboard.item.setString("old copy", forType: .string))
        pasteboard.copyDuringRead = true
        let snapshot = LaTeXPasteboard.snapshot(pasteboard)
        XCTAssertEqual(snapshot, .ownerChanged)
        XCTAssertEqual(snapshot.payload, ["state": "ownerChanged"])
    }

    func testUnreadableClipboardReportsUnavailable() {
        let snapshot = LaTeXPasteboard.snapshot(Pasteboard())
        XCTAssertEqual(snapshot, .unavailable)
        XCTAssertEqual(snapshot.payload, ["state": "unavailable"])
    }
}
