import XCTest
@testable import EquationLab

@MainActor
final class WordSessionLifecycleTests: XCTestCase {
    private let first = String(repeating: "a", count: 64)
    private let second = String(repeating: "b", count: 64)
    private func ended(_ ticket: String?) -> [String: Any] {
        var payload: [String: Any] = ["wordSession": false, "wordSessionEnded": true]
        if let ticket { payload["endedWordTicket"] = ticket }
        return payload
    }
    func testLateEndOfPreviousFormulaKeepsNewFormulaAndWindow() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": second])
        let generation = bridge.wordPresentationGeneration
        XCTAssertFalse(bridge.updateWordSessionState(ended(first)))
        XCTAssertTrue(bridge.wordSessionActive)
        XCTAssertEqual(bridge.wordTicket, second)
        XCTAssertEqual(bridge.wordPresentationGeneration, generation)
    }
    func testEndingCurrentFormulaDoesNotHideAnAlreadyRequestedReplacement() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        bridge.openWordURL(URL(string: "equationlab://word-edit/" + second)!)
        XCTAssertFalse(bridge.updateWordSessionState(ended(first)))
        XCTAssertFalse(bridge.wordSessionActive)
        XCTAssertNil(bridge.wordTicket)
        XCTAssertTrue(bridge.hasWordSessionOrRequest)
    }
    func testDuplicateOrAnonymousEndCannotInvalidateNewRequest() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        XCTAssertTrue(bridge.updateWordSessionState(ended(first)))
        bridge.openWordURL(URL(string: "equationlab://word-edit/" + second)!)
        let generation = bridge.wordPresentationGeneration
        XCTAssertFalse(bridge.updateWordSessionState(ended(first)))
        XCTAssertFalse(bridge.updateWordSessionState(ended(nil)))
        XCTAssertEqual(bridge.wordPresentationGeneration, generation)
        XCTAssertTrue(bridge.hasWordSessionOrRequest)
    }
    func testCurrentFormulaStillEndsAndReturnsToWord() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        XCTAssertTrue(bridge.updateWordSessionState(ended(first)))
        XCTAssertFalse(bridge.wordSessionActive)
        XCTAssertNil(bridge.wordTicket)
        XCTAssertFalse(bridge.hasWordSessionOrRequest)
    }
}
