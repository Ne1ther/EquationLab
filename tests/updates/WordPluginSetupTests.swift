import Foundation
import XCTest
@testable import EquationLab

final class WordPluginSetupTests: XCTestCase {
    private func fixture(_ body: (URL, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory.appendingPathComponent("pending.json"), URL(fileURLWithPath: "/Applications/Equation Lab.app"))
    }

    private func marker(_ app: URL, reason: String = "WORD_SETTINGS_ACCESS_DENIED") throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schema": "equationlab.word-setup-pending.v1", "app": app.path, "reason": reason])
    }

    func testPendingOfficeConsentIsRecognizedOnlyByItsInstalledApp() throws {
        try fixture { file, app in
            try marker(app).write(to: file)
            XCTAssertNotNil(WordPluginSetupRequest.load(from: file, for: app))
            XCTAssertNil(WordPluginSetupRequest.load(from: file, for: URL(fileURLWithPath: "/tmp/Test.app")))
            try marker(app, reason: "COMPONENT_CONFLICT").write(to: file)
            XCTAssertNil(WordPluginSetupRequest.load(from: file, for: app))
        }
    }

    func testMalformedOversizedAndSymlinkMarkersCannotOpenSetup() throws {
        try fixture { file, app in
            try Data("{}".utf8).write(to: file)
            XCTAssertNil(WordPluginSetupRequest.load(from: file, for: app))
            try Data(repeating: 32, count: 4097).write(to: file)
            XCTAssertNil(WordPluginSetupRequest.load(from: file, for: app))
            let target = file.appendingPathExtension("target")
            try marker(app).write(to: target)
            try FileManager.default.removeItem(at: file)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
            XCTAssertNil(WordPluginSetupRequest.load(from: file, for: app))
        }
    }
}
