import XCTest
import Darwin
@testable import EquationLab

@MainActor
final class AICoordinationMonitorTests: XCTestCase {
    func testConcurrentSkillJobsAndSwitchGenerations() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let monitor = AICoordinationMonitor(directory: directory)
        let marker = directory.appendingPathComponent("enabled")
        XCTAssertFalse(monitor.isEnabled)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))

        monitor.setEnabled(true)
        let session = try String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let inspection = UUID().uuidString.lowercased(), edit = UUID().uuidString.lowercased()
        try report(directory, session: session, run: inspection, operation: "inspect", phase: "running")
        try report(directory, session: session, run: edit, operation: "edit", phase: "running")
        let observation = Task { await monitor.observe() }
        defer { observation.cancel() }
        await waitForActivity(monitor) { $0?.activeCount == 2 && $0?.phase == .running }

        try report(directory, session: session, run: inspection, operation: "inspect", phase: "completed")
        try report(directory, session: session, run: edit, operation: "edit", phase: "running", pid: -1)
        await waitForActivity(monitor) { $0?.operation == .edit && $0?.phase == .unconfirmed && $0?.activeCount == 0 }
        try report(directory, session: session, run: edit, operation: "edit", phase: "failed")
        await waitForActivity(monitor) { $0?.operation == .edit && $0?.phase == .failed }

        monitor.setEnabled(false)
        XCTAssertNil(monitor.activity)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
        monitor.setEnabled(true)
        let reactivated = Task { await monitor.observe() }
        defer { reactivated.cancel() }
        XCTAssertNotEqual(try String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), session)
        // Both reports still exist, but a new enable session ignores them.
        try await Task.sleep(for: .milliseconds(800))
        XCTAssertNil(monitor.activity)
        XCTAssertTrue(monitor.isEnabled)
        XCTAssertFalse(monitor.hasStorageError)
    }

    private func waitForActivity(_ monitor: AICoordinationMonitor, matches: (AIActivity?) -> Bool) async {
        for _ in 0..<40 {
            if matches(monitor.activity) { return }
            try? await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("Unexpected AI activity: \(String(describing: monitor.activity))")
    }

    private func report(_ directory: URL, session: String, run: String, operation: String, phase: String, pid: pid_t = getpid()) throws {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let timestamp = operation == "edit" ? now + 1 : now
        let payload: [String: Any] = ["schema": 1, "sessionId": session, "runId": run, "operation": operation,
                                      "phase": phase, "startedAt": now, "updatedAt": timestamp, "pid": pid]
        try JSONSerialization.data(withJSONObject: payload).write(to: directory.appendingPathComponent(run + ".json"), options: .atomic)
    }
}
