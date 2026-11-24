import AppKit
import SwiftUI
import XCTest
@testable import EquationLab

@MainActor
final class WorkbenchInteractionTests: XCTestCase {
    func testDocumentToolsWaitForCompleteFreshSourceAndOfferAppropriateRecovery() throws {
        var state = WorkbenchState()
        XCTAssertEqual(DocumentToolAvailability(state: state), .noDocument)
        state.wordDocumentReadState = .loading
        XCTAssertEqual(DocumentToolAvailability(state: state), .loading)
        state.wordDocumentReadState = .failed
        let failed = DocumentToolAvailability(state: state)
        XCTAssertEqual(failed, .loadFailed)
        XCTAssertEqual(failed.refreshAction, "nativeRetryWordDocumentRead")

        state.documentPath = "/tmp/document-copy.docx"
        XCTAssertEqual(DocumentToolAvailability(state: state), .ready, "A prior Word open failure does not block an active DOCX copy")
        state.objects = [try JSONDecoder().decode(SidebarFormula.self, from: Data(#"{"id":0,"numberStatus":"stale"}"#.utf8))]
        let stale = DocumentToolAvailability(state: state)
        XCTAssertEqual(stale, .staleNumbers)
        XCTAssertEqual(stale.refreshAction, "nativeRefreshWordWorkspace")

        state.busy = true
        XCTAssertEqual(DocumentToolAvailability(state: state), .busy)
        XCTAssertNil(DocumentToolAvailability(state: state).refreshAction)
        state.wordOutcomeUnknown = true
        XCTAssertEqual(DocumentToolAvailability(state: state), .unconfirmedSave)
        XCTAssertNil(DocumentToolAvailability(state: state).refreshAction)
    }

    func testCommandSearchReturnUsesVisibleTemplateBeforeMatchingCatalogEntry() {
        let template = FormulaTemplate(id: "basic-fraction", label: "分式", hint: "普通分式", category: "分式", latex: #"\frac{#0}{#1}"#)
        let catalog = CatalogItem(id: "compact-fraction", category: "分式", group: "small", label: "紧凑分式",
                                  latex: #"\tfrac{a}{b}"#, sample: "", hint: "紧凑分式", originalToken: nil, sourceStatus: "verified-local")
        let letter = EquationLetter(id: "fraction-letter", family: "test", pair: 0, name: "Fraction letter",
                                    symbol: "x", latex: "x", kind: "lower", requiresUnicodeFont: false)
        let results = CommandSearchResults(query: " \tFRACTION\n", commands: [("fraction-settings", "Fraction settings", "gear")],
                                           templates: [template], letters: [letter], catalog: [catalog], localize: {
            $0.contains("分式") ? "Fraction" : $0
        })
        XCTAssertEqual(results.commands.map(\.id), ["fraction-settings"])
        XCTAssertEqual(results.letters.map(\.id), [letter.id])
        XCTAssertEqual(results.templates.map(\.id), [template.id])
        XCTAssertEqual(results.catalog.map(\.id), [catalog.id])

        // Disabled command and letter rows must not block the first enabled section below them.
        let match = results.firstEnabledMatch(commandAvailable: { _ in false }, letterAvailable: { _ in false }, canInsertTemplates: true)
        guard case .template(let matched)? = match else { return XCTFail("Expected the visible template before the catalog result") }
        XCTAssertEqual(matched.id, template.id)
        XCTAssertNil(results.firstEnabledMatch(commandAvailable: { _ in false }, letterAvailable: { _ in false }, canInsertTemplates: false))
    }

    func testCommandSearchReturnDoesNothingOnBlankQueryAndKeepsBrowseRows() {
        let results = CommandSearchResults(query: " \n\u{3000}", commands: [("new", "New equation", "plus")],
                                           templates: [], letters: [], catalog: [], localize: { $0 })
        XCTAssertEqual(results.commands.first?.id, "new")
        XCTAssertNil(results.firstEnabledMatch(commandAvailable: { _ in true }, letterAvailable: { _ in true }, canInsertTemplates: true))
    }

    func testFontFamilyFieldRestoresBlankAndCommitsCanonicalFamilyOnce() throws {
        let family = try XCTUnwrap(NSFontManager.shared.availableFontFamilies.first { $0 != $0.lowercased() })
        var value = "Existing Word Font"
        var writes: [String] = []
        let picker = FontFamilyPicker(value: Binding(get: { value }, set: { value = $0; writes.append($0) }),
                                     placeholder: "Font family", accessibilityLabel: "Font family")
        let coordinator = picker.makeCoordinator()
        let comboBox = NSComboBox()
        let endEditing = Notification(name: NSControl.textDidEndEditingNotification, object: comboBox)

        comboBox.stringValue = " \t "
        coordinator.controlTextDidEndEditing(endEditing)
        XCTAssertEqual(comboBox.stringValue, "Existing Word Font")
        XCTAssertTrue(writes.isEmpty)

        comboBox.stringValue = "  \(family.lowercased())  "
        coordinator.controlTextDidEndEditing(endEditing)
        XCTAssertEqual(comboBox.stringValue, family)
        XCTAssertEqual(value, family)

        coordinator.controlTextDidEndEditing(endEditing)
        XCTAssertEqual(writes, [family])

        // A family authored in Word may need to round trip without being installed here.
        comboBox.stringValue = "  Document Font From Another Workstation  "
        coordinator.controlTextDidEndEditing(endEditing)
        XCTAssertEqual(comboBox.stringValue, "Document Font From Another Workstation")
        XCTAssertEqual(value, "Document Font From Another Workstation")
    }

    func testRulerDragPreservesOriginalPositionOnCollisionAndDeletesOutOfBounds() {
        let first = RulerTab(position: 640, type: 0)
        let second = RulerTab(position: 1280, type: 2)
        let current = [first, second]
        let scale: CGFloat = 2.0

        // Dropping onto an existing tab stop's position preserves the original tab stops.
        let collision = EquationRuler.tabsAfterDrag(
            current,
            dragging: first,
            location: CGPoint(x: 40 * scale, y: 20), // 40 pt * 32 = 1280
            horizontalTranslation: 20 * scale,
            width: 300,
            scale: scale
        )
        XCTAssertNil(collision)

        // Dropping onto its own position is a no-op.
        let samePosition = EquationRuler.tabsAfterDrag(
            current,
            dragging: first,
            location: CGPoint(x: 20 * scale, y: 20), // 20 pt * 32 = 640
            horizontalTranslation: 0,
            width: 300,
            scale: scale
        )
        XCTAssertNil(samePosition)

        // Dropping to a free position inside bounds moves the tab and keeps its type.
        let moved = EquationRuler.tabsAfterDrag(
            current,
            dragging: first,
            location: CGPoint(x: 30 * scale, y: 25), // 30 pt * 32 = 960
            horizontalTranslation: 10 * scale,
            width: 300,
            scale: scale
        )
        XCTAssertEqual(moved, [second, RulerTab(position: 960, type: 0)])

        // Dragging out of bounds explicitly deletes the tab stop.
        for point in [
            CGPoint(x: 30 * scale, y: -20),
            CGPoint(x: 30 * scale, y: 60),
            CGPoint(x: -5, y: 20),
            CGPoint(x: 305, y: 20)
        ] {
            let deleted = EquationRuler.tabsAfterDrag(
                current,
                dragging: first,
                location: point,
                horizontalTranslation: point.x - 20 * scale,
                width: 300,
                scale: scale
            )
            XCTAssertEqual(deleted, [second])
        }
    }

    func testRulerDragPreservesPointerGrabOffset() {
        let tab = RulerTab(position: 40 * 32, type: 2)
        let scale: CGFloat = 50 * 0.29 / 12
        let pointerAfterDrag = CGPoint(x: 40 * scale + 8 + 4, y: 25)
        let updated = EquationRuler.tabsAfterDrag([tab], dragging: tab, location: pointerAfterDrag,
                                                 horizontalTranslation: 4, width: 300, scale: scale)
        XCTAssertEqual(updated, [RulerTab(position: 43 * 32, type: 2)])
    }

    func testRulerTapAndDragRejectUnrepresentablePositions() {
        XCTAssertEqual(EquationRuler.tabPosition(at: 1023, scale: 1), 1023 * 32)
        XCTAssertNil(EquationRuler.tabPosition(at: 1024, scale: 1))
        XCTAssertNil(EquationRuler.tabPosition(at: 100, scale: 0))
        XCTAssertNil(EquationRuler.tabPosition(at: .infinity, scale: 1))
        let tab = RulerTab(position: 32, type: 0)
        XCTAssertNil(EquationRuler.tabsAfterDrag([tab], dragging: tab, location: CGPoint(x: 1024, y: 25),
                                                horizontalTranslation: 1023, width: 1200, scale: 1))
    }

    func testUndoRedoRoutingPrefersNativeFieldEditorWithoutInterceptingTextInput() {
        let fieldEditor = NSTextView()
        fieldEditor.isFieldEditor = true
        fieldEditor.isEditable = true

        let textEditor = NSTextView()
        textEditor.isFieldEditor = false
        textEditor.isEditable = true

        let readOnlyText = NSTextView()
        readOnlyText.isFieldEditor = false
        readOnlyText.isEditable = false

        let nonTextView = NSView()

        XCTAssertTrue(NativeTextInputMonitor.isNativeTextInput(fieldEditor))
        XCTAssertTrue(NativeTextInputMonitor.isNativeTextInput(textEditor))
        XCTAssertFalse(NativeTextInputMonitor.isNativeTextInput(readOnlyText))
        XCTAssertFalse(NativeTextInputMonitor.isNativeTextInput(nonTextView))
        XCTAssertFalse(NativeTextInputMonitor.isNativeTextInput(nil))

        // Native field editor always gets Cmd+Z / Shift+Cmd+Z even when equation cannot undo or is busy.
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: fieldEditor, busy: true, canPerformEquationAction: false),
            .nativeText
        )
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: textEditor, busy: false, canPerformEquationAction: true),
            .nativeText
        )

        // Non-text focus (WebView, toolbar, ruler, read-only text) routes to equation history when enabled.
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: nonTextView, busy: false, canPerformEquationAction: true),
            .equation
        )
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: readOnlyText, busy: false, canPerformEquationAction: true),
            .equation
        )
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: nonTextView, busy: true, canPerformEquationAction: true),
            .none
        )
        XCTAssertEqual(
            NativeTextInputMonitor.routeUndoRedo(responder: nonTextView, busy: false, canPerformEquationAction: false),
            .none
        )
    }
}
