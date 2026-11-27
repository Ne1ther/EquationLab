import XCTest
@testable import EquationLab

final class WordRevealTests: XCTestCase {
    @MainActor
    func testRevealIsEnabledForLiveDocumentWhileEditing() {
        let bridge = DesktopBridge()
        XCTAssertFalse(bridge.canRevealWordFormula)
        bridge.state.wordDocumentIdentity = "word-process:22"
        XCTAssertTrue(bridge.canRevealWordFormula)
        let ticket = String(repeating: "a", count: 64)
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": ticket])
        XCTAssertTrue(bridge.canRevealWordFormula)
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": ticket, "wordSessionIsInsertion": true])
        XCTAssertFalse(bridge.canRevealWordFormula)
    }

    @MainActor
    func testFileCopyAndPendingWordOperationCannotReveal() {
        let bridge = DesktopBridge()
        bridge.state.wordDocumentIdentity = "word-process:22"
        bridge.state.fileCopyGeneration = 4
        XCTAssertFalse(bridge.canRevealWordFormula)
        bridge.state.fileCopyGeneration = nil
        bridge.wordDocumentRequestPending = true
        XCTAssertFalse(bridge.canRevealWordFormula)
    }

    func testRevealLabelHasBothTranslations() {
        XCTAssertEqual(InterfaceLanguage.simplifiedChinese.text("定位原文位置"), "定位原文位置")
        XCTAssertEqual(InterfaceLanguage.english.text("定位原文位置"), "Reveal in Word")
    }

    @MainActor
    func testStaleMenuFromSameDocumentReportsThatTheEquationMayHaveMoved() throws {
        let bridge = DesktopBridge()
        try bridge.state.apply([
            "wordDocumentIdentity": "word-process:22",
            "objectsDelta": ["generation": "new", "baseRevision": 0, "revision": 1,
                             "reset": [["id": 2, "revealToken": "new-token"]]]
        ])
        XCTAssertEqual(bridge.state.objects.first?.revealToken, "new-token")
        bridge.revealWordFormula(2, documentIdentity: "word-process:22", revealToken: "old-token")
        XCTAssertTrue(bridge.state.messageError)
        XCTAssertTrue(bridge.state.message.hasPrefix("公式位置可能已变化"))
    }
}
