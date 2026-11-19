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

    func testNumberFreshnessPreservesThumbnailsAndComposesWithRowUpdates() throws {
        var state = WorkbenchState()
        let image = "data:image/png;base64,unchanged"
        var numbered = row(0, "x")
        numbered["image"] = image
        numbered["numberText"] = "(1)"
        let unnumbered = row(1, "y")
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 0, "revision": 1, "reset": [numbered, unnumbered]]])
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 1, "revision": 2, "numberFreshness": "stale"]])
        XCTAssertEqual(state.objects.map(\.numberStatus), ["stale", "stale"])
        XCTAssertEqual(state.objects[0].image, image)

        let newRow = row(1, "z")
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 2, "revision": 3, "numberFreshness": "loading", "upserts": [newRow]]])
        XCTAssertEqual(state.objects.map(\.numberStatus), ["snapshot", "pending"])
        XCTAssertEqual(state.objects.map(\.latex), ["x", "z"])
        XCTAssertEqual(state.objects[0].image, image)

        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 1, "revision": 2, "numberFreshness": "stale"]])
        try state.apply(["objectsDelta": ["generation": "retired", "baseRevision": 3, "revision": 4, "numberFreshness": "stale"]])
        XCTAssertEqual(state.objects.map(\.numberStatus), ["snapshot", "pending"])
        try state.apply(["objectsDelta": ["generation": "a", "baseRevision": 3, "revision": 4, "numberFreshness": "snapshot"]])
        XCTAssertEqual(state.objects.map(\.numberStatus), ["snapshot", "snapshot"])
    }

    func testDocumentCatalogKeepsSelectionWhenFullMetadataArrives() throws {
        var state = WorkbenchState()
        let ids = Array(0..<112)
        let partial = ids.map { row($0, $0 == 79 ? "q^2" : "") }
        try state.apply([
            "wordDocumentLoading": true, "wordCatalogAvailable": true, "wordDocumentTotal": 112, "selected": 79,
            "objectsDelta": ["generation": "catalog", "baseRevision": 0, "revision": 1, "reset": partial]
        ])
        XCTAssertTrue(state.wordCatalogAvailable)
        XCTAssertTrue(state.wordDocumentLoading)
        XCTAssertEqual(state.objects.map(\.id), ids)
        XCTAssertEqual(state.objects[79].latex, "q^2")
        XCTAssertTrue(state.objects[111].matchesSearch("112"))

        let hydrated = ids.map { row($0, $0 == 79 ? "q^2" : "x_\($0)") }
        try state.apply([
            "wordDocumentLoading": false, "wordCatalogAvailable": false,
            "objectsDelta": ["generation": "full", "baseRevision": 0, "revision": 1, "reset": hydrated]
        ])
        XCTAssertFalse(state.wordCatalogAvailable)
        XCTAssertFalse(state.wordDocumentLoading)
        XCTAssertEqual(state.selected, 79)
        XCTAssertEqual(state.objects.map(\.id), ids)
        XCTAssertEqual(state.objects[111].latex, "x_111")
    }
}
