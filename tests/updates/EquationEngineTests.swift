import XCTest
@testable import EquationLab

final class EquationEngineTests: XCTestCase {
    func testPrewarmReusesOneWorkerAndKeepsRequestsWorking() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["EQUATIONLAB_ENGINE_ROOT"], let runtime = environment["EQUATIONLAB_TEST_NODE"] else { throw XCTSkip("Opt-in packaged engine integration test") }
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("equationlab-prewarm-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let launcher = scratch.appendingPathComponent("node-wrapper"), launches = scratch.appendingPathComponent("launches")
        func shellQuote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let script = "#!/bin/sh\nprintf 'start\\n' >> \(shellQuote(launches.path))\nexec \(shellQuote(runtime)) \"$@\"\n"
        try script.write(to: launcher, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: launcher.path)
        let engine = EquationEngine(), root = URL(fileURLWithPath: directory), done = expectation(description: "Worker reply after prewarming")
        defer { engine.stop() }
        engine.prewarm(node: launcher, root: root)
        engine.prewarm(node: launcher, root: root)
        engine.request(id: "prewarm", action: "typography-default", payload: [:], node: launcher, root: root) { result in
            XCTAssertEqual(result["ok"] as? Bool, true, "\(result["error"] ?? "")")
            done.fulfill()
        }
        await fulfillment(of: [done], timeout: 8)
        let attempts = try String(contentsOf: launches, encoding: .utf8).split(separator: "\n")
        XCTAssertEqual(attempts.count, 1, "Prewarm and requests must share one worker")
    }

    func testFailedPrewarmDoesNotPreventLaterRequest() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["EQUATIONLAB_ENGINE_ROOT"], let runtime = environment["EQUATIONLAB_TEST_NODE"] else { throw XCTSkip("Opt-in packaged engine integration test") }
        let engine = EquationEngine(), root = URL(fileURLWithPath: directory), done = expectation(description: "Worker retries after failed prewarm")
        defer { engine.stop() }
        engine.prewarm(node: URL(fileURLWithPath: "/nonexistent-equationlab-prewarm-runtime"), root: root)
        engine.request(id: "retry", action: "typography-default", payload: [:], node: URL(fileURLWithPath: runtime), root: root) { result in
            XCTAssertEqual(result["ok"] as? Bool, true, "\(result["error"] ?? "")")
            done.fulfill()
        }
        await fulfillment(of: [done], timeout: 8)
    }

    func testBundledWorkerRepliesBeforeInputCloses() async throws {
        let environment=ProcessInfo.processInfo.environment
        guard let directory=environment["EQUATIONLAB_ENGINE_ROOT"],let runtime=environment["EQUATIONLAB_TEST_NODE"] else { throw XCTSkip("Opt-in packaged engine integration test") }
        let engine=EquationEngine(),done=expectation(description:"All worker responses")
        done.expectedFulfillmentCount=3
        defer { engine.stop() }
        for (id,action,payload) in [("1","typography-default",[:]),("2","preview",["latex":"x+1"]),("3","validate",["latex":"\\frac{x^2+1}{2}"])] {
            engine.request(id:id,action:action,payload:payload,node:URL(fileURLWithPath:runtime),root:URL(fileURLWithPath:directory)) { result in
                XCTAssertEqual(result["ok"] as? Bool,true,"\(action): \(result["error"] ?? "")")
                done.fulfill()
            }
        }
        await fulfillment(of:[done],timeout:8)
    }
}
