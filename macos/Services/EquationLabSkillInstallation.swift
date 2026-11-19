import Foundation

struct EquationLabSkillInstallation {
    enum Existing: Equatable {
        case available, current, relink, conflict
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

    var codexDirectory: URL {
        userHome.appendingPathComponent(".agents/skills", isDirectory: true)
    }

    var codexDestination: URL {
        codexDirectory.appendingPathComponent(folderName, isDirectory: true)
    }

    private var canInstall: Bool {
        !resources.path.contains(where: \.isNewline)
            && files.isReadableFile(atPath: source.appendingPathComponent("SKILL.md").path)
            && files.isReadableFile(atPath: source.appendingPathComponent("scripts/run").path)
            && files.isExecutableFile(atPath: resources.appendingPathComponent("runtime/bin/node").path)
            && files.isReadableFile(atPath: resources.appendingPathComponent("engine/src/cli.mjs").path)
    }

    func existing(at destination: URL) -> Existing {
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try files.attributesOfItem(atPath: destination.path)
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            // FileManager can report a missing target for a dangling symlink.
            return (try? files.destinationOfSymbolicLink(atPath: destination.path)) == nil ? .available : .conflict
        } catch {
            return .conflict
        }
        let pointer = destination.appendingPathComponent(appPointer)
        guard attributes[.type] as? FileAttributeType == .typeDirectory,
              regularFile(pointer),
              let location = try? String(contentsOf: pointer, encoding: .utf8),
              location.hasPrefix("/"), location.hasSuffix("\n"),
              !location.dropLast().contains(where: \.isNewline),
              let entries = files.enumerator(atPath: source.path) else {
            return .conflict
        }
        for case let relativePath as String in entries {
            let entry = source.appendingPathComponent(relativePath)
            guard regularFile(entry) else { continue }
            let installed = destination.appendingPathComponent(relativePath)
            guard regularFile(installed), files.contentsEqual(atPath: entry.path, andPath: installed.path) else {
                return .conflict
            }
        }
        return location == resources.path + "\n" ? .current : .relink
    }

    @discardableResult
    func install(in directory: URL) throws -> URL {
        guard canInstall else { throw CocoaError(.fileReadNoSuchFile) }
        let destination = directory.appendingPathComponent(folderName, isDirectory: true)
        switch existing(at: destination) {
        case .current:
            return destination
        case .relink:
            try writeAppPointer(in: destination)
            return destination
        case .conflict:
            throw Conflict(destination: destination)
        case .available:
            break
        }
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appendingPathComponent(".equation-lab-install-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: temporary) }
        try files.copyItem(at: source, to: temporary)
        try writeAppPointer(in: temporary)
        do {
            try files.moveItem(at: temporary, to: destination)
        } catch {
            switch existing(at: destination) {
            case .current:
                return destination
            case .relink, .conflict:
                throw Conflict(destination: destination)
            case .available:
                throw error
            }
        }
        return destination
    }

    private func writeAppPointer(in directory: URL) throws {
        try (resources.path + "\n").write(to: directory.appendingPathComponent(appPointer), atomically: true, encoding: .utf8)
    }

    private func regularFile(_ url: URL) -> Bool {
        (try? files.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeRegular
    }
}
