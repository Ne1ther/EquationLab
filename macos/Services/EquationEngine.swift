import Foundation
import OSLog

/// A private stdio worker owned by this app. No port, daemon or extra runtime.
/// All process I/O and response framing stay off the main thread.
final class EquationEngine: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.equationlab.engine", qos: .userInitiated)
    private let logger = Logger(subsystem: "app.equationlab.mac", category: "EnginePerformance")
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var generation = UUID()
    private var pending: [String: (completion: ([String: Any]) -> Void, timeout: DispatchWorkItem, start: UInt64, action: String)] = [:]

    func request(id: String, action: String, payload: [String: Any], node: URL, root: URL,
                 completion: @escaping ([String: Any]) -> Void) {
        queue.async { [self] in
            do {
                try start(node: node, root: root)
                var bytes = try JSONSerialization.data(withJSONObject: ["id": id, "action": action, "payload": payload])
                guard bytes.count <= 5_000_000 else { throw failure("请求过大") }
                bytes.append(10)
                let timeout = DispatchWorkItem { [weak self] in self?.failAll("公式引擎处理超时，请重试") }
                pending[id] = (completion, timeout, DispatchTime.now().uptimeNanoseconds, action)
                queue.asyncAfter(deadline: .now() + 60, execute: timeout)
                try input?.write(contentsOf: bytes)
                logger.info("request sent action=\(action, privacy: .public) bytes=\(bytes.count)")
            } catch {
                let registered = pending[id] != nil
                failAll(error.localizedDescription)
                if !registered { completion(["ok": false, "error": error.localizedDescription]) }
            }
        }
    }

    private func start(node: URL, root: URL) throws {
        if process?.isRunning == true { return }
        guard pending.isEmpty else { throw failure("公式引擎已退出，请重试") }
        let child = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        let token = UUID(); generation = token; buffer.removeAll(keepingCapacity: true)
        child.executableURL = node
        child.arguments = [root.appendingPathComponent("src/desktop-rpc.mjs").path, "--stdio-worker"]
        child.currentDirectoryURL = root
        child.standardInput = stdin; child.standardOutput = stdout; child.standardError = stderr
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            self?.queue.async { [weak self] in self?.receive(data, generation: token) }
        }
        // Drain stderr so an unexpected library warning cannot fill a pipe.
        stderr.fileHandleForReading.readabilityHandler = { handle in
            if handle.availableData.isEmpty { handle.readabilityHandler = nil }
        }
        child.terminationHandler = { [weak self] _ in
            self?.queue.async { [weak self] in
                guard let self, self.generation == token else { return }
                self.failAll("公式引擎已退出，请重试")
            }
        }
        try child.run(); process = child; input = stdin.fileHandleForWriting
        logger.info("worker started pid=\(child.processIdentifier)")
    }

    private func receive(_ data: Data, generation token: UUID) {
        guard token == generation else { return }
        buffer.append(data)
        guard buffer.count <= 48_000_000 else { failAll("公式引擎返回的数据过大"); return }
        while let end = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<end]); buffer.removeSubrange(...end)
            guard let result = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let id = result["id"] as? String, let request = pending.removeValue(forKey: id) else { continue }
            request.timeout.cancel()
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - request.start) / 1_000_000
            logger.info("request action=\(request.action, privacy: .public) wall_ms=\(elapsed, format: .fixed(precision: 2)) worker_ms=\(result["elapsedMs"] as? Double ?? 0, format: .fixed(precision: 2))")
            request.completion(result)
        }
    }

    private func failure(_ text: String) -> NSError { NSError(domain: "EquationEngine", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func failAll(_ message: String) {
        logger.error("worker reset: \(message, privacy: .private)")
        generation = UUID()
        let child = process; process = nil
        try? input?.close(); input = nil
        if child?.isRunning == true { child?.terminate() }
        buffer.removeAll(keepingCapacity: false)
        let failed = pending; pending.removeAll()
        for item in failed.values { item.timeout.cancel(); item.completion(["ok": false, "error": message]) }
    }
    func stop() { queue.async { [weak self] in self?.failAll("公式引擎已关闭") } }
}
