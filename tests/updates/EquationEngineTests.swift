import XCTest
@testable import EquationLab

final class EquationEngineTests: XCTestCase {
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
