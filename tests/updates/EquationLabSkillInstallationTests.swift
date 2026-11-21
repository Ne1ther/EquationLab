import XCTest
@testable import EquationLab

final class EquationLabSkillInstallationTests: XCTestCase {
    private let fixtureSkill = "---\nname: equation-lab\ndescription: Fixture\n---\n"

    func testInstallsUnderSelectedHomeAndIsIdempotent() throws {
        try withFixture { installer in
            XCTAssertEqual(installer.sharedDestination.path, installer.userHome.path + "/.agents/skills/equation-lab")
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .available)
            let installed = try installer.install(in: installer.sharedDirectory)
            XCTAssertEqual(installed, installer.sharedDestination)
            XCTAssertEqual(installer.existing(at: installed), .current)
            XCTAssertEqual(try String(contentsOf: installed.appendingPathComponent("SKILL.md"), encoding: .utf8), fixtureSkill)
            XCTAssertEqual(try String(contentsOf: installed.appendingPathComponent(".equation-lab-resources"), encoding: .utf8), installer.resources.path + "\n")
            XCTAssertEqual(try installer.install(in: installer.sharedDirectory), installed)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: installer.sharedDirectory.path), ["equation-lab"])

            let pointer = installed.appendingPathComponent(".equation-lab-resources")
            try "/previous/Equation Lab.app/Contents/Resources\n".write(to: pointer, atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .relink)
            XCTAssertEqual(try installer.install(in: installer.sharedDirectory), installed)
            XCTAssertEqual(installer.existing(at: installed), .current)
            XCTAssertEqual(try String(contentsOf: pointer, encoding: .utf8), installer.resources.path + "\n")
        }
    }

    func testProtectsUserEditsAndDanglingLinksAtSameSkillName() throws {
        try withFixture { installer in
            let installed = try installer.install(in: installer.sharedDirectory)
            let readme = installed.appendingPathComponent("SKILL.md")
            try "User changes".write(to: readme, atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                XCTAssertTrue($0 is EquationLabSkillInstallation.Conflict)
            }
            XCTAssertEqual(try String(contentsOf: readme, encoding: .utf8), "User changes")

            let directory = installer.userHome.appendingPathComponent("Export Folder", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let link = directory.appendingPathComponent("equation-lab")
            let target = directory.appendingPathComponent("unavailable")
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
            XCTAssertEqual(installer.existing(at: link), .conflict)
            XCTAssertThrowsError(try installer.install(in: directory))
            XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: link.path), target.path)
        }
    }

    func testSharesOneCopyAcrossClientsAndPreservesExistingFolders() throws {
        try withFixture { installer in
            let files = FileManager.default
            let claude = try installer.link(.claude)
            let antigravity = try installer.link(.antigravity)
            XCTAssertEqual(claude.path, installer.userHome.path + "/.claude/skills/equation-lab")
            XCTAssertEqual(antigravity.path, installer.userHome.path + "/.gemini/config/skills/equation-lab")
            for (link, target) in [(claude, "../../.agents/skills/equation-lab"),
                                   (antigravity, "../../../.agents/skills/equation-lab")] {
                XCTAssertEqual(try files.destinationOfSymbolicLink(atPath: link.path), target)
                XCTAssertEqual(try String(contentsOf: link.appendingPathComponent("SKILL.md"), encoding: .utf8), fixtureSkill)
            }
            XCTAssertEqual(try installer.link(.claude), claude)

            try files.removeItem(at: claude)
            try files.createDirectory(at: claude, withIntermediateDirectories: false)
            let customized = claude.appendingPathComponent("SKILL.md")
            try "Local skill".write(to: customized, atomically: true, encoding: .utf8)
            XCTAssertThrowsError(try installer.link(.claude)) {
                XCTAssertEqual(($0 as? EquationLabSkillInstallation.Conflict)?.destination, claude)
            }
            XCTAssertEqual(try String(contentsOf: customized, encoding: .utf8), "Local skill")
        }
    }

    func testPreservesAnExistingSharedLink() throws {
        try withFixture { installer in
            let files = FileManager.default
            try files.createDirectory(at: installer.sharedDirectory, withIntermediateDirectories: true)
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: installer.source)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .linked)
            XCTAssertEqual(try installer.install(in: installer.sharedDirectory), installer.sharedDestination)
            let claude = try installer.link(.claude)
            XCTAssertEqual(claude.resolvingSymlinksInPath(), installer.source.resolvingSymlinksInPath())
            XCTAssertFalse(files.fileExists(atPath: installer.source.appendingPathComponent(".equation-lab-resources").path))
        }
    }

    func testUpgradesAppManagedCopyWithoutBreakingClientLink() throws {
        try withFixture { installer in
            let claude = try installer.link(.claude)
            let newSkill = fixtureSkill + "\nUpdated\n"
            try newSkill.write(to: installer.source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .upgrade)
            _ = try installer.install(in: installer.sharedDirectory)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .current)
            XCTAssertEqual(claude.resolvingSymlinksInPath(), installer.sharedDestination.resolvingSymlinksInPath())
            XCTAssertEqual(try String(contentsOf: claude.appendingPathComponent("SKILL.md"), encoding: .utf8), newSkill)
        }
    }

    func testClientLinksFollowSharedCopyAfterMovingToAnotherHome() throws {
        try withFixture { installer in
            let files = FileManager.default
            for client in EquationLabSkillInstallation.Client.allCases { try installer.link(client) }
            let movedHome = installer.userHome.deletingLastPathComponent()
                .appendingPathComponent("用户 B", isDirectory: true)
            try files.moveItem(at: installer.userHome, to: movedHome)
            let receiver = EquationLabSkillInstallation(resources: installer.resources, userHome: movedHome)
            for client in EquationLabSkillInstallation.Client.allCases {
                let link = try receiver.link(client)
                XCTAssertEqual(link.resolvingSymlinksInPath(), receiver.sharedDestination.resolvingSymlinksInPath())
                XCTAssertEqual(try String(contentsOf: link.appendingPathComponent("SKILL.md"), encoding: .utf8), fixtureSkill)
            }
        }
    }

    func testIgnoresOnlyRegularDSStoreWhileProtectingHiddenFilesSymlinksAndEdits() throws {
        try withFixture { installer in
            let files = FileManager.default
            let installed = try installer.install(in: installer.sharedDirectory)
            let rootDS = installed.appendingPathComponent(".DS_Store")
            let nestedDS = installed.appendingPathComponent("scripts/.DS_Store")
            try Data([0, 0, 0, 1]).write(to: rootDS)
            try Data([0, 0, 0, 2]).write(to: nestedDS)
            XCTAssertEqual(installer.existing(at: installed), .current)

            // Other hidden files must still be treated as user modifications.
            let hiddenNote = installed.appendingPathComponent(".notes")
            try "keep me".write(to: hiddenNote, atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            try files.removeItem(at: hiddenNote)
            XCTAssertEqual(installer.existing(at: installed), .current)

            // A symlink named .DS_Store must not be ignored.
            try files.removeItem(at: rootDS)
            try files.createSymbolicLink(at: rootDS, withDestinationURL: installed.appendingPathComponent("SKILL.md"))
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            try files.removeItem(at: rootDS)
            XCTAssertEqual(installer.existing(at: installed), .current)

            // A directory named .DS_Store must not be ignored.
            try files.createDirectory(at: rootDS, withIntermediateDirectories: false)
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            try files.removeItem(at: rootDS)
            XCTAssertEqual(installer.existing(at: installed), .current)

            // Regular .DS_Store still permits an upgrade of an unmodified copy.
            try Data([0, 0, 0, 3]).write(to: rootDS)
            let updatedSkill = fixtureSkill + "\nUpgraded\n"
            try updatedSkill.write(to: installer.source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .upgrade)
        }
    }

    func testClientLinkStatusIsReadOnlyAndReflectsLinkedAndConflictStates() throws {
        try withFixture { installer in
            let files = FileManager.default
            XCTAssertEqual(installer.clientLinkStatus(.claude), .notLinked)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .notLinked)
            XCTAssertFalse(files.fileExists(atPath: installer.userHome.path))

            _ = try installer.link(.claude)
            XCTAssertEqual(installer.clientLinkStatus(.claude), .linked)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .notLinked)

            let antigravityDir = installer.userHome.appendingPathComponent(".gemini/config/skills/equation-lab", isDirectory: true)
            try files.createDirectory(at: antigravityDir, withIntermediateDirectories: true)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .conflict)
        }
    }

    private func withFixture(_ work: (EquationLabSkillInstallation) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let resources = directory.appendingPathComponent("Equation Lab.app/Contents/Resources", isDirectory: true)
        let installer = EquationLabSkillInstallation(resources: resources, userHome: directory.appendingPathComponent("Test Home", isDirectory: true))
        defer { try? FileManager.default.removeItem(at: directory) }
        for path in ["skills/equation-lab/scripts", "runtime/bin", "engine/src"] {
            try FileManager.default.createDirectory(at: resources.appendingPathComponent(path), withIntermediateDirectories: true)
        }
        try fixtureSkill.write(to: installer.source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try "#!/bin/sh\n".write(to: installer.source.appendingPathComponent("scripts/run"), atomically: true, encoding: .utf8)
        try Data().write(to: resources.appendingPathComponent("engine/src/cli.mjs"))
        let executable = resources.appendingPathComponent("runtime/bin/node")
        try Data("#!/bin/sh\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try work(installer)
    }
}
