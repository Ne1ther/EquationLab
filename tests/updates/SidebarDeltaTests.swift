import XCTest
@testable import EquationLab

final class SidebarDeltaTests: XCTestCase {
    private func row(_ id: Int, _ latex: String) -> [String: Any] {
        ["id": id, "label": "Equation", "detail": "", "latex": latex, "readOnly": false]
    }
    func testRowsUpdateWithoutReplacingOtherFormulasAndRejectStaleSource() throws {
        var state = WorkbenchState()
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 0, "revision": 1, "reset": [row(0, "x"), row(1, "y")]]])
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 1, "revision": 2, "upserts": [row(1, "z")]]])
        XCTAssertEqual(state.objects.map(\.latex), ["x", "z"])
        try state.apply(["objectsDelta": ["generation": "b", "baseRevision": 0, "revision": 1, "reset": [row(0, "b")]]])
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 2, "revision": 3, "upserts": [row(0, "stale")]]])
        XCTAssertEqual(state.objects.map(\.latex), ["b"])
        XCTAssertThrowsError(try state.apply(["objectsDelta": ["generation": "b", "baseRevision": 3, "revision": 4, "upserts": [row(0, "gap")]]]))
        XCTAssertEqual(state.objects.map(\.latex), ["b"])
    }
}
