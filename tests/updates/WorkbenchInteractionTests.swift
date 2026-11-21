import AppKit
import XCTest
@testable import EquationLab

@MainActor
final class WorkbenchInteractionTests: XCTestCase {
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
            width: 300,
            scale: scale
        )
        XCTAssertNil(collision)

        // Dropping onto its own position is a no-op.
        let samePosition = EquationRuler.tabsAfterDrag(
            current,
            dragging: first,
            location: CGPoint(x: 20 * scale, y: 20), // 20 pt * 32 = 640
            width: 300,
            scale: scale
        )
        XCTAssertNil(samePosition)

        // Dropping to a free position inside bounds moves the tab and keeps its type.
        let moved = EquationRuler.tabsAfterDrag(
            current,
            dragging: first,
            location: CGPoint(x: 30 * scale, y: 25), // 30 pt * 32 = 960
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
                width: 300,
                scale: scale
            )
            XCTAssertEqual(deleted, [second])
        }
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
