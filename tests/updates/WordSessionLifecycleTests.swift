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
    func testDockClickDuringWordEditDoesNotReopenAnEquationAfterSaveOrCancel() {
        let bridge = DesktopBridge()
        bridge.reopenEditorFromDock()
        XCTAssertTrue(bridge.refreshWordDocumentAfterLoad)
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        XCTAssertFalse(bridge.refreshWordDocumentAfterLoad)
        bridge.reopenEditorFromDock()
        XCTAssertFalse(bridge.refreshWordDocumentAfterLoad)
        XCTAssertTrue(bridge.updateWordSessionState(ended(first)))
        XCTAssertFalse(bridge.refreshWordDocumentAfterLoad)
    }
    func testReturnRequestsWordBeforeHidingActiveEditor() {
        var events: [String] = []
        WordFocusHandoff.finish(editorIsActive: true, wordIsActive: false,
            yield: { events.append("yield") }, activate: { events.append("request-word") }, hide: { events.append("hide") })
        XCTAssertEqual(events, ["yield", "request-word", "hide"])
    }
    func testBackgroundCompletionDoesNotStealFocusFromAnotherApp() {
        var events: [String] = []
        WordFocusHandoff.finish(editorIsActive: false, wordIsActive: false,
            yield: { events.append("yield") }, activate: { events.append("request-word") }, hide: { events.append("hide") })
        XCTAssertEqual(events, ["hide"])
    }
    func testAlreadyActiveWordDoesNotReceiveAnotherActivationRequest() {
        var requests = 0
        WordFocusHandoff.finish(editorIsActive: false, wordIsActive: true,
            yield: { requests += 1 }, activate: { requests += 1 }, hide: {})
        XCTAssertEqual(requests, 0)
    }
    func testWordForegroundRequestsEditorActivationEvenIfItsWindowWasAlreadyKey() {
        var events: [String] = []
        WordFocusHandoff.begin(editorIsFrontmost: false, wordIsFrontmost: true, fromWord: true,
            activateFromWord: { events.append("activate-from-word") }, activate: { events.append("activate") })
        XCTAssertEqual(events, ["activate-from-word"])
    }
    func testWordDeliveryDoesNotActivateOverAnAppTheUserSwitchedTo() {
        var requests = 0
        WordFocusHandoff.begin(editorIsFrontmost: false, wordIsFrontmost: false, fromWord: true,
            activateFromWord: { requests += 1 }, activate: { requests += 1 })
        XCTAssertEqual(requests, 0)
    }
    func testForegroundEditorDoesNotRepeatTheActivationRequest() {
        var requests = 0
        WordFocusHandoff.begin(editorIsFrontmost: true, wordIsFrontmost: false, fromWord: true,
            activateFromWord: { requests += 1 }, activate: { requests += 1 })
        XCTAssertEqual(requests, 0)
    }
    func testExplicitDockReopenRequestsActivationFromAnotherApp() {
        var events: [String] = []
        WordFocusHandoff.begin(editorIsFrontmost: false, wordIsFrontmost: false, fromWord: false,
            activateFromWord: { events.append("activate-from-word") }, activate: { events.append("activate") })
        XCTAssertEqual(events, ["activate"])
    }
    func testRejectedTicketCannotRevealPreviousFormulaWindow() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        XCTAssertFalse(bridge.shouldRevealWordDelivery(second, accepted: false))
        XCTAssertFalse(bridge.shouldRevealWordDelivery(second, accepted: true))
        XCTAssertTrue(bridge.shouldRevealWordDelivery(first, accepted: true))
        bridge.openWordURL(URL(string: "equationlab://word-edit/" + second)!)
        XCTAssertFalse(bridge.shouldRevealWordDelivery(first, accepted: true))
    }
    func testRibbonToolIsAppliedOnlyToItsAcceptedFormulaTicket() {
        let bridge = DesktopBridge()
        bridge.openWordURL(URL(string: "equationlab://word-edit/" + second + "?tool=spacing")!)
        XCTAssertEqual(bridge.inspectorTab, .style)
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        bridge.applyReadyWordTool(first)
        XCTAssertEqual(bridge.inspectorTab, .style)
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": second])
        bridge.applyReadyWordTool(second)
        XCTAssertEqual(bridge.inspectorTab, .spacing)
    }
    func testEndingBeforeWindowAttachInvalidatesDeferredWordReveal() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        bridge.showEditorWindow(reason: "word-delivered")
        XCTAssertEqual(bridge.pendingEditorReveal?.ticket, first)
        XCTAssertTrue(bridge.updateWordSessionState(ended(first)))
        XCTAssertNil(bridge.pendingEditorReveal)
        bridge.editorWindowDidAttach()
        XCTAssertNil(bridge.pendingEditorReveal)
    }
    func testDockRevealRemainsIndependentOfEndedWordTicket() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": true, "wordTicket": first])
        bridge.showEditorWindow(reason: "dock-reopen")
        XCTAssertTrue(bridge.updateWordSessionState(ended(first)))
        XCTAssertEqual(bridge.pendingEditorReveal?.reason, "dock-reopen")
        XCTAssertNil(bridge.pendingEditorReveal?.ticket)
    }
    func testDocumentRefreshIsAClosablePendingOperation() {
        let bridge = DesktopBridge()
        _ = bridge.updateWordSessionState(["wordSession": false, "wordDocumentRequestPending": true])
        XCTAssertTrue(bridge.hasWordSessionOrRequest)
        _ = bridge.updateWordSessionState(["wordSession": false, "wordDocumentRequestPending": false])
        XCTAssertFalse(bridge.hasWordSessionOrRequest)
    }
}
