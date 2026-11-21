import CryptoKit
import Darwin
import Foundation

struct EquationLabSkillInstallation: Sendable {
    enum Existing: Equatable, Sendable {
        case available, current, linked, unverifiedLink, relink, upgrade, conflict
    }

    enum ClientLinkStatus: Equatable, Sendable {
        case linked, unverifiedLink, notLinked, conflict
    }

    enum Client: CaseIterable, Hashable, Sendable {
        case claude, antigravity

        var skillDirectory: String {
            switch self {
            case .claude: ".claude/skills"
            case .antigravity: ".gemini/config/skills"
            }
        }
    }

    struct StatusSnapshot: Equatable, Sendable {
        let shared: Existing
        let clients: [Client: ClientLinkStatus]

        func linkStatus(for client: Client) -> ClientLinkStatus {
            clients[client] ?? .notLinked
        }
    }

    struct Conflict: LocalizedError, Sendable {
        let destination: URL

        var errorDescription: String? {
            "A different Skill already exists at \(destination.path)."
        }
    }

    let resources: URL
    let userHome: URL
    private var files: FileManager { .default }
    private let folderName = "equation-lab"
    private let appPointer = ".equation-lab-resources"
    private let checksumFile = ".equation-lab-skill-checksum"
    // Released 0.7.0 installed this exact payload before copies recorded a checksum.
    private let release070Checksum = "b8ad9c9e8ec8a514da1cf14767fb2ead2c6db068dd050ad2480ab1f534db82db"
    // Bounds protect inspection against huge user directories, unexpected large files,
    // or special files left inside a managed skill folder.
    private static let maxMetadataBytes = 8_192
    private static let maxSkillManifestBytes = 262_144
    private static let maxPayloadEntries = 512
    private static let maxPayloadFileBytes = 8 * 1024 * 1024
    private static let maxPayloadTotalBytes = 32 * 1024 * 1024

    static var bundled: Self? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let process = ProcessInfo.processInfo
        // The test bundle can exercise the actual installer in an isolated home.
        let testHome = Bundle.main.object(forInfoDictionaryKey: "EquationLabDevelopmentBuild") != nil
            ? process.environment["EQUATIONLAB_DEV_SKILL_HOME"] : nil
        let userHome = testHome.flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0, isDirectory: true) : nil }
            ?? FileManager.default.homeDirectoryForCurrentUser
        let installer = Self(resources: resources, userHome: userHome)
        return installer.canInstall ? installer : nil
    }

    var source: URL {
        resources.appendingPathComponent("skills", isDirectory: true)
            .appendingPathComponent(folderName, isDirectory: true)
    }

    var sharedDirectory: URL {
        userHome.appendingPathComponent(".agents/skills", isDirectory: true)
    }

    var sharedDestination: URL {
        sharedDirectory.appendingPathComponent(folderName, isDirectory: true)
    }

    private var canInstall: Bool {
        !resources.path.contains(where: \.isNewline)
            && files.isReadableFile(atPath: source.appendingPathComponent("SKILL.md").path)
            && files.isReadableFile(atPath: source.appendingPathComponent("scripts/run").path)
            && files.isExecutableFile(atPath: resources.appendingPathComponent("runtime/bin/node").path)
            && files.isReadableFile(atPath: resources.appendingPathComponent("engine/src/cli.mjs").path)
    }

    func statusSnapshot() -> StatusSnapshot {
        let shared = existing(at: sharedDestination, verifySymlinkTarget: false)
        var clients: [Client: ClientLinkStatus] = [:]
        for client in Client.allCases {
            clients[client] = clientLinkStatus(client, sharedExisting: shared)
        }
        return StatusSnapshot(shared: shared, clients: clients)
    }

    func existing(at destination: URL) -> Existing {
        existing(at: destination, verifySymlinkTarget: true)
    }

    private func existing(at destination: URL, verifySymlinkTarget: Bool) -> Existing {
        if let rawTarget = try? files.destinationOfSymbolicLink(atPath: destination.path) {
            guard isSharedDestinationPath(destination) else {
                return .conflict
            }
            if pointsToSharedDestination(rawTarget, relativeTo: destination.deletingLastPathComponent()) {
                return .conflict
            }
            guard verifySymlinkTarget else {
                return .unverifiedLink
            }
            let target = resolveRawLinkTarget(rawTarget, relativeTo: destination.deletingLastPathComponent())
            return isEquationLabSkill(at: target.resolvingSymlinksInPath()) ? .linked : .conflict
        }
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try files.attributesOfItem(atPath: destination.path)
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            return .available
        } catch {
            return .conflict
        }
        let pointer = destination.appendingPathComponent(appPointer)
        guard attributes[.type] as? FileAttributeType == .typeDirectory,
              let location = readUTF8File(at: pointer, maxBytes: Self.maxMetadataBytes, followSymlinks: false),
              location.hasPrefix("/"), location.hasSuffix("\n"),
              !location.dropLast().contains(where: \.isNewline),
              let installed = payloadChecksum(at: destination),
              let bundled = payloadChecksum(at: source) else {
            return .conflict
        }
        if installed == bundled {
            return location == resources.path + "\n" ? .current : .relink
        }
        let checksum = destination.appendingPathComponent(checksumFile)
        let previousChecksum = readUTF8File(at: checksum, maxBytes: Self.maxMetadataBytes, followSymlinks: false)
        return installed == release070Checksum || previousChecksum == installed + "\n" ? .upgrade : .conflict
    }

    @discardableResult
    func install(in directory: URL) throws -> URL {
        guard canInstall else { throw CocoaError(.fileReadNoSuchFile) }
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        let initial = existing(at: destination)
        switch initial {
        case .current, .linked:
            return destination
        case .relink:
            try writeAppPointer(in: destination)
            return destination
        case .unverifiedLink, .conflict:
            throw Conflict(destination: destination)
        case .available, .upgrade:
            break
        }
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appendingPathComponent(".equation-lab-install-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: temporary) }
        try files.copyItem(at: source, to: temporary)
        try writeAppPointer(in: temporary)
        guard let checksum = payloadChecksum(at: temporary) else { throw CocoaError(.fileReadCorruptFile) }
        try (checksum + "\n").write(to: temporary.appendingPathComponent(checksumFile), atomically: true, encoding: .utf8)
        if initial == .upgrade {
            guard existing(at: destination) == .upgrade else { throw Conflict(destination: destination) }
            // Swap in the same directory so client links always have a live target.
            guard renameatx_np(AT_FDCWD, temporary.path, AT_FDCWD, destination.path, UInt32(RENAME_SWAP)) == 0 else {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
            return destination
        }
        do {
            try files.moveItem(at: temporary, to: destination)
        } catch {
            switch existing(at: destination) {
            case .current, .linked:
                return destination
            case .relink, .upgrade, .unverifiedLink, .conflict:
                throw Conflict(destination: destination)
            case .available:
                throw error
            }
        }
        return destination
    }

    @discardableResult
    func link(_ client: Client) throws -> URL {
        let shared = try install(in: sharedDirectory)
        let directory = userHome.appendingPathComponent(client.skillDirectory, isDirectory: true)
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        // Some machines already link an entire client skill root to the shared root.
        if directory.resolvingSymlinksInPath().path == sharedDirectory.resolvingSymlinksInPath().path {
            return destination
        }
        do {
            let parent = directory.resolvingSymlinksInPath().pathComponents
            // Keep the final component as the shared entry so upgrades and shared links keep working.
            let target = sharedDirectory.resolvingSymlinksInPath().pathComponents + [folderName]
            let common = zip(parent, target).prefix(while: { $0.0 == $0.1 }).count
            let relativeTarget = Array(repeating: "..", count: parent.count - common) + target.dropFirst(common)
            try files.createSymbolicLink(atPath: destination.path, withDestinationPath: relativeTarget.joined(separator: "/"))
        } catch let error as CocoaError where error.code == .fileWriteFileExists {
            guard linkTarget(at: destination)?.resolvingSymlinksInPath().path == shared.resolvingSymlinksInPath().path else {
                throw Conflict(destination: destination)
            }
        }
        return destination
    }

    func clientLinkStatus(_ client: Client) -> ClientLinkStatus {
        clientLinkStatus(client, sharedExisting: nil)
    }

    private func clientLinkStatus(_ client: Client, sharedExisting: Existing?) -> ClientLinkStatus {
        let directory = userHome.appendingPathComponent(client.skillDirectory, isDirectory: true)
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        let resolvedShared = { sharedExisting ?? existing(at: sharedDestination, verifySymlinkTarget: false) }
        if directory.resolvingSymlinksInPath().path == sharedDirectory.resolvingSymlinksInPath().path {
            return clientLinkStatus(forShared: resolvedShared())
        }
        if let rawTarget = try? files.destinationOfSymbolicLink(atPath: destination.path) {
            guard pointsToSharedDestination(rawTarget, relativeTo: directory) else {
                return .conflict
            }
            return clientLinkStatus(forShared: resolvedShared())
        }
        do {
            _ = try files.attributesOfItem(atPath: destination.path)
            return .conflict
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            return .notLinked
        } catch {
            return .conflict
        }
    }

    private func clientLinkStatus(forShared shared: Existing) -> ClientLinkStatus {
        switch shared {
        case .current, .linked, .relink, .upgrade:
            .linked
        case .unverifiedLink:
            .unverifiedLink
        case .available:
            .notLinked
        case .conflict:
            .conflict
        }
    }

    private func isSharedDestinationPath(_ destination: URL) -> Bool {
        if destination.standardizedFileURL.path == sharedDestination.standardizedFileURL.path {
            return true
        }
        return destination.lastPathComponent == folderName
            && destination.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path
                == sharedDirectory.resolvingSymlinksInPath().standardizedFileURL.path
    }

    private func pointsToSharedDestination(_ rawTarget: String, relativeTo parentDirectory: URL) -> Bool {
        let candidates = sharedDestinationPaths()
        if candidates.contains(resolveRawLinkTarget(rawTarget, relativeTo: parentDirectory).path) {
            return true
        }
        let resolvedParent = parentDirectory.resolvingSymlinksInPath().standardizedFileURL
        return candidates.contains(resolveRawLinkTarget(rawTarget, relativeTo: resolvedParent).path)
    }

    private func sharedDestinationPaths() -> Set<String> {
        var paths: Set<String> = [
            sharedDestination.standardizedFileURL.path,
            userHome.resolvingSymlinksInPath().standardizedFileURL
                .appendingPathComponent(".agents/skills", isDirectory: true)
                .appendingPathComponent(folderName, isDirectory: true).standardizedFileURL.path,
            sharedDirectory.resolvingSymlinksInPath().standardizedFileURL
                .appendingPathComponent(folderName, isDirectory: true).standardizedFileURL.path,
        ]
        if let sharedRootTarget = linkTarget(at: sharedDirectory) {
            paths.insert(
                sharedRootTarget.appendingPathComponent(folderName, isDirectory: true).standardizedFileURL.path
            )
        }
        return paths
    }

    private func resolveRawLinkTarget(_ rawTarget: String, relativeTo parentDirectory: URL) -> URL {
        let base = URL(fileURLWithPath: parentDirectory.path, isDirectory: true)
        return URL(fileURLWithPath: rawTarget, relativeTo: base).standardizedFileURL
    }

    private func linkTarget(at url: URL) -> URL? {
        guard let path = try? files.destinationOfSymbolicLink(atPath: url.path) else { return nil }
        return resolveRawLinkTarget(path, relativeTo: url.deletingLastPathComponent())
    }

    private func isEquationLabSkill(at url: URL) -> Bool {
        let manifestURL = url.appendingPathComponent("SKILL.md")
        guard let manifest = readUTF8File(at: manifestURL, maxBytes: Self.maxSkillManifestBytes, followSymlinks: true),
              manifest.hasPrefix("---\n"),
              let end = manifest.range(of: "\n---", range: manifest.index(after: manifest.startIndex)..<manifest.endIndex) else {
            return false
        }
        let runURL = url.appendingPathComponent("scripts/run")
        let runFD = Darwin.open(runURL.path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
        guard runFD >= 0 else { return false }
        defer { Darwin.close(runFD) }
        var info = stat()
        guard Darwin.fstat(runFD, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else {
            return false
        }
        return manifest[..<end.lowerBound].split(whereSeparator: \.isNewline).contains("name: equation-lab")
    }

    private func payloadChecksum(at directory: URL) -> String? {
        guard (try? files.attributesOfItem(atPath: directory.path)[.type] as? FileAttributeType) == .typeDirectory else {
            return nil
        }
        // Resolve ancestor symlinks (for example when ~/.agents/skills itself is a symlink)
        // so the prefix matches the canonical URLs emitted by FileManager.enumerator.
        let root = directory.resolvingSymlinksInPath().standardizedFileURL
        let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey]
        var readError = false
        guard let entries = files.enumerator(at: root, includingPropertiesForKeys: keys, errorHandler: { _, _ in
            readError = true
            return false
        }) else { return nil }
        var manifest = [String]()
        var entryCount = 0
        var totalBytes = 0
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        for case let entry as URL in entries {
            entryCount += 1
            guard entryCount <= Self.maxPayloadEntries else { return nil }
            let path = entry.standardizedFileURL.path
            guard path.hasPrefix(prefix), let attributes = try? entry.resourceValues(forKeys: Set(keys)),
                  attributes.isSymbolicLink == false else { return nil }
            let relative = String(path.dropFirst(prefix.count))
            if relative == appPointer || relative == checksumFile || entry.lastPathComponent == ".DS_Store" {
                guard attributes.isRegularFile == true else { return nil }
                continue
            }
            if attributes.isDirectory == true { continue }
            guard attributes.isRegularFile == true, !relative.contains(where: \.isNewline),
                  !relative.contains("\t") else { return nil }
            if let fileSize = attributes.fileSize, fileSize > Self.maxPayloadFileBytes { return nil }
            guard let data = readRegularFile(at: entry, maxBytes: Self.maxPayloadFileBytes, followSymlinks: false) else {
                return nil
            }
            totalBytes += data.count
            guard totalBytes <= Self.maxPayloadTotalBytes else { return nil }
            manifest.append(relative + "\t" + sha256(data) + "\n")
        }
        return readError ? nil : sha256(Data(manifest.sorted().joined().utf8))
    }

    private func readUTF8File(at url: URL, maxBytes: Int, followSymlinks: Bool) -> String? {
        guard let data = readRegularFile(at: url, maxBytes: maxBytes, followSymlinks: followSymlinks) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func readRegularFile(at url: URL, maxBytes: Int, followSymlinks: Bool) -> Data? {
        var flags = O_RDONLY | O_NONBLOCK | O_CLOEXEC
        if !followSymlinks { flags |= O_NOFOLLOW }
        let fd = Darwin.open(url.path, flags)
        guard fd >= 0 else { return nil }
        defer { Darwin.close(fd) }
        var info = stat()
        guard Darwin.fstat(fd, &info) == 0,
              (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size >= 0,
              info.st_size <= Int64(maxBytes) else {
            return nil
        }
        let expectedSize = Int(info.st_size)
        if expectedSize == 0 { return Data() }
        var data = Data()
        data.reserveCapacity(expectedSize)
        var buffer = [UInt8](repeating: 0, count: min(expectedSize, 65_536))
        while true {
            let count = buffer.withUnsafeMutableBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return Darwin.read(fd, base, raw.count)
            }
            if count > 0 {
                if data.count + count > maxBytes { return nil }
                data.append(buffer, count: count)
            } else if count == 0 {
                break
            } else if errno == EINTR {
                continue
            } else {
                return nil
            }
        }
        return data
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func writeAppPointer(in directory: URL) throws {
        try (resources.path + "\n").write(to: directory.appendingPathComponent(appPointer), atomically: true, encoding: .utf8)
    }
}
