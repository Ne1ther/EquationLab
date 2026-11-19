import Foundation
import Combine
import Darwin

struct AIActivity: Equatable {
    enum Operation: String, Decodable {
        case inspect, audit, create, edit, arrange, planNumbering, applyNumbering, planTypography, applyTypography
    }

    enum Phase: String, Decodable {
        case running, completed, failed, unconfirmed
    }

    let operation: Operation
    let phase: Phase
    let activeCount: Int
}

@MainActor
final class AICoordinationMonitor: ObservableObject {
    @Published private(set) var isEnabled: Bool
    @Published private(set) var activity: AIActivity?
    @Published private(set) var hasStorageError = false

    private let store: AICoordinationStore
    private var session: UUID?

    init(directory: URL? = nil) {
        let store = AICoordinationStore(directory: directory ?? AICoordinationStore.defaultDirectory)
        self.store = store
        session = store.readSession()
        isEnabled = session != nil
    }

    func setEnabled(_ enabled: Bool) {
        guard enabled != isEnabled else { return }
        let next = enabled ? UUID() : nil
        do {
            try store.writeSession(next)
            session = next
            activity = nil
            hasStorageError = false
            isEnabled = enabled
        } catch {
            hasStorageError = true
        }
    }

    func observe() async {
        guard let session else { return }
        let store = self.store
        while !Task.isCancelled && self.session == session {
            let result = await Task.detached(priority: .utility) { store.latest(in: session) }.value
            guard !Task.isCancelled, self.session == session else { return }
            if activity != result { activity = result }
            try? await Task.sleep(for: .milliseconds(750))
        }
    }
}

private struct AICoordinationStore: Sendable {
    static var defaultDirectory: URL {
        if let override = ProcessInfo.processInfo.environment["EQUATIONLAB_AI_COORDINATION_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Equation Lab/ai-coordination", isDirectory: true)
    }

    let directory: URL
    private var marker: URL { directory.appendingPathComponent("enabled") }

    func readSession() -> UUID? {
        guard (try? directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])).map({
            $0.isDirectory == true && $0.isSymbolicLink != true
        }) == true, let bytes = readSmallFile(marker, limit: 64) else { return nil }
        return UUID(uuidString: String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func writeSession(_ session: UUID?) throws {
        let manager = FileManager.default
        if session != nil {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw CocoaError(.fileWriteInvalidFileName) }
        if let session {
            try Data((session.uuidString.lowercased() + "\n").utf8).write(to: marker, options: .atomic)
        } else if manager.fileExists(atPath: marker.path) {
            try manager.removeItem(at: marker)
        }
    }

    private struct Record: Decodable {
        let schema: Int
        let sessionId: UUID
        let runId: UUID
        let operation: AIActivity.Operation
        let phase: AIActivity.Phase
        let startedAt: Int64
        let updatedAt: Int64
        let pid: pid_t

        var isActive: Bool {
            phase == .running && pid > 0 && (kill(pid, 0) == 0 || errno == EPERM)
        }
    }

    func latest(in session: UUID) -> AIActivity? {
        guard readSession() == session,
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey], options: [.skipsHiddenFiles]) else { return nil }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let decoder = JSONDecoder()
        var active: Record?, latest: Record?, count = 0
        for file in files where file.pathExtension == "json" {
            guard let runId = UUID(uuidString: file.deletingPathExtension().lastPathComponent),
                  let data = readSmallFile(file, limit: 4096), let record = try? decoder.decode(Record.self, from: data),
                  record.schema == 1, record.sessionId == session, record.runId == runId,
                  record.startedAt <= record.updatedAt, record.updatedAt > now - 86_400_000, record.updatedAt <= now + 60_000 else { continue }
            if latest.map({ record.updatedAt > $0.updatedAt }) ?? true { latest = record }
            if record.isActive {
                count += 1
                if active.map({ record.updatedAt > $0.updatedAt }) ?? true { active = record }
            }
        }
        guard let chosen = active ?? latest else { return nil }
        let phase: AIActivity.Phase = active == nil && chosen.phase == .running ? .unconfirmed : chosen.phase
        return AIActivity(operation: chosen.operation, phase: phase, activeCount: count)
    }

    private func readSmallFile(_ url: URL, limit: Int) -> Data? {
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
              values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= limit,
              let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: limit + 1), data.count <= limit else { return nil }
        return data
    }
}
