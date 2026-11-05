import XCTest
@testable import EquationLab

final class SidebarSearchTests: XCTestCase {
    private func formula(number: String?) throws -> SidebarFormula {
        var object: [String: Any] = [
            "id": 29, "position": 30, "label": "公式 30", "detail": "可编辑",
            "latex": #"q=\frac{x}{y}+\tau"#, "readOnly": false,
            "numberStatus": number == nil ? "pending" : "current"
        ]
        if let number { object["numberText"] = number }
        return try JSONDecoder().decode(SidebarFormula.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testDocumentNumberAndPositionRemainSeparateSearchTerms() throws {
        let item = try formula(number: "(2.14)")
        XCTAssertTrue(item.matchesSearch("2.14"))
        XCTAssertTrue(item.matchesSearch(#"(2.14) \tau"#))
        XCTAssertTrue(item.matchesSearch(#"30 \frac"#))
        XCTAssertFalse(item.matchesSearch(#"2.13 \tau"#))
        XCTAssertFalse(item.matchesSearch(#"2.14 \sqrt"#))
    }

    func testPendingNumberStillAllowsPositionAndLatexSearch() throws {
        let item = try formula(number: nil)
        XCTAssertTrue(item.matchesSearch(#"30 \tau"#))
        XCTAssertFalse(item.matchesSearch("2.14"))
        XCTAssertTrue(item.matchesSearch("  \t "))
    }
}
