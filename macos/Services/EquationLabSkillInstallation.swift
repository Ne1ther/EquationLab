import CryptoKit
import Darwin
import Foundation

struct EquationLabSkillInstallation {
    enum Existing: Equatable {
        case available, current, linked, relink, upgrade, conflict
    }

    enum ClientLinkStatus: Equatable {
        case linked, notLinked, conflict
    }

    enum Client: CaseIterable {
        case claude, antigravity

        var skillDirectory: String {
            switch self {
            case .claude: ".claude/skills"
            case .antigravity: ".gemini/config/skills"
            }
        }
    }

    struct Conflict: LocalizedError {
        let destination: URL

        var errorDescription: String? {
            "A different Skill already exists at \(destination.path)."
        }
    }

    let resources: URL
    let userHome: URL
    private let files = FileManager.default
    private let folderName = "equation-lab"
    private let appPointer = ".equation-lab-resources"
    private let checksumFile = ".equation-lab-skill-checksum"
    // Released 0.7.0 installed this exact payload before copies recorded a checksum.
    private let release070Checksum = "b8ad9c9e8ec8a514da1cf14767fb2ead2c6db068dd050ad2480ab1f534db82db"

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

    func existing(at destination: URL) -> Existing {
        if let target = linkTarget(at: destination) {
            return destination.standardizedFileURL.path == sharedDestination.standardizedFileURL.path
                && isEquationLabSkill(at: target.resolvingSymlinksInPath()) ? .linked : .conflict
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
              regularFile(pointer),
              let location = try? String(contentsOf: pointer, encoding: .utf8),
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
        let previousChecksum = regularFile(checksum)
            ? try? String(contentsOf: checksum, encoding: .utf8) : nil
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
        case .conflict:
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
            case .relink, .upgrade, .conflict:
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
        let directory = userHome.appendingPathComponent(client.skillDirectory, isDirectory: true)
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        if directory.resolvingSymlinksInPath().path == sharedDirectory.resolvingSymlinksInPath().path {
            switch existing(at: sharedDestination) {
            case .current, .linked, .relink, .upgrade:
                return .linked
            case .available:
                return .notLinked
            case .conflict:
                return .conflict
            }
        }
        if let target = linkTarget(at: destination) {
            guard target.resolvingSymlinksInPath().path == sharedDestination.resolvingSymlinksInPath().path else {
                return .conflict
            }
            return files.fileExists(atPath: sharedDestination.path) ? .linked : .notLinked
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

    private func linkTarget(at url: URL) -> URL? {
        guard let path = try? files.destinationOfSymbolicLink(atPath: url.path) else { return nil }
        return URL(fileURLWithPath: path, relativeTo: url.deletingLastPathComponent()).standardizedFileURL
    }

    private func isEquationLabSkill(at url: URL) -> Bool {
        guard let manifest = try? String(contentsOf: url.appendingPathComponent("SKILL.md"), encoding: .utf8),
              manifest.hasPrefix("---\n"),
              let end = manifest.range(of: "\n---", range: manifest.index(after: manifest.startIndex)..<manifest.endIndex) else {
            return false
        }
        return manifest[..<end.lowerBound].split(whereSeparator: \.isNewline).contains("name: equation-lab")
            && files.isReadableFile(atPath: url.appendingPathComponent("scripts/run").path)
    }

    private func payloadChecksum(at directory: URL) -> String? {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey]
        var readError = false
        guard let entries = files.enumerator(at: directory, includingPropertiesForKeys: keys, errorHandler: { _, _ in
            readError = true
            return false
        }) else { return nil }
        var manifest = [String]()
        let prefix = directory.standardizedFileURL.path + "/"
        for case let entry as URL in entries {
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
                  !relative.contains("\t"), let data = try? Data(contentsOf: entry) else { return nil }
            manifest.append(relative + "\t" + sha256(data) + "\n")
        }
        return readError ? nil : sha256(Data(manifest.sorted().joined().utf8))
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func writeAppPointer(in directory: URL) throws {
        try (resources.path + "\n").write(to: directory.appendingPathComponent(appPointer), atomically: true, encoding: .utf8)
    }

    private func regularFile(_ url: URL) -> Bool {
        (try? files.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeRegular
    }
}
