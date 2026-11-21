import Darwin
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

    func testInstallsAndUpgradesWhenSharedDirectoryIsASymlink() throws {
        try withFixture { installer in
            let files = FileManager.default
            let realShared = installer.userHome.deletingLastPathComponent()
                .appendingPathComponent("Real Shared Skills", isDirectory: true)
            try files.createDirectory(at: realShared, withIntermediateDirectories: true)
            try files.createDirectory(at: installer.sharedDirectory.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.createSymbolicLink(at: installer.sharedDirectory, withDestinationURL: realShared)

            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .available)
            let installed = try installer.install(in: installer.sharedDirectory)
            XCTAssertEqual(installed, installer.sharedDestination)
            XCTAssertEqual(installer.existing(at: installed), .current)
            XCTAssertEqual(installer.existing(at: realShared.appendingPathComponent("equation-lab", isDirectory: true)), .current)

            let claude = try installer.link(.claude)
            let snapshot = installer.statusSnapshot()
            XCTAssertEqual(snapshot.shared, .current)
            XCTAssertEqual(snapshot.linkStatus(for: .claude), .linked)
            XCTAssertEqual(snapshot.linkStatus(for: .antigravity), .notLinked)
            XCTAssertEqual(try String(contentsOf: claude.appendingPathComponent("SKILL.md"), encoding: .utf8), fixtureSkill)

            let updatedSkill = fixtureSkill + "\nUpgraded via symlinked shared root\n"
            try updatedSkill.write(to: installer.source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .upgrade)
            _ = try installer.install(in: installer.sharedDirectory)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .current)
            XCTAssertEqual(try String(contentsOf: claude.appendingPathComponent("SKILL.md"), encoding: .utf8), updatedSkill)
        }
    }

    func testStatusSnapshotHandlesSymlinkedClientRootAndPreservesConflicts() throws {
        try withFixture { installer in
            let files = FileManager.default
            try files.createDirectory(at: installer.sharedDirectory, withIntermediateDirectories: true)
            let claudeRoot = installer.userHome.appendingPathComponent(".claude/skills", isDirectory: true)
            try files.createDirectory(at: claudeRoot.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.createSymbolicLink(at: claudeRoot, withDestinationURL: installer.sharedDirectory)

            let initial = installer.statusSnapshot()
            XCTAssertEqual(initial.shared, .available)
            XCTAssertEqual(initial.linkStatus(for: .claude), .notLinked)
            XCTAssertEqual(initial.linkStatus(for: .antigravity), .notLinked)

            _ = try installer.install(in: installer.sharedDirectory)
            let installed = installer.statusSnapshot()
            XCTAssertEqual(installed.shared, .current)
            XCTAssertEqual(installed.linkStatus(for: .claude), .linked)
            XCTAssertEqual(installed.linkStatus(for: .antigravity), .notLinked)

            try "User override".write(to: installer.sharedDestination.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            let conflicted = installer.statusSnapshot()
            XCTAssertEqual(conflicted.shared, .conflict)
            XCTAssertEqual(conflicted.linkStatus(for: .claude), .conflict)
        }
    }

    func testRejectsCircularSymlinksAndFIFOsWithoutBlocking() throws {
        try withFixture { installer in
            let files = FileManager.default
            try files.createDirectory(at: installer.sharedDirectory, withIntermediateDirectories: true)

            // 1. Circular symlink at shared destination must return .conflict immediately.
            try files.createSymbolicLink(atPath: installer.sharedDestination.path, withDestinationPath: "equation-lab")
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .conflict)
            XCTAssertEqual(installer.statusSnapshot().shared, .conflict)
            try files.removeItem(at: installer.sharedDestination)

            // 2. Linked target whose SKILL.md is a FIFO must not hang open()/read().
            let fifoTarget = installer.userHome.appendingPathComponent("fifo-skill", isDirectory: true)
            try files.createDirectory(at: fifoTarget.appendingPathComponent("scripts", isDirectory: true), withIntermediateDirectories: true)
            XCTAssertEqual(Darwin.mkfifo(fifoTarget.appendingPathComponent("SKILL.md").path, 0o600), 0)
            try "#!/bin/sh\n".write(to: fifoTarget.appendingPathComponent("scripts/run"), atomically: true, encoding: .utf8)
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: fifoTarget)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .conflict)
            try files.removeItem(at: installer.sharedDestination)

            // 3. Managed directory with a FIFO inside must return .conflict without blocking.
            let installed = try installer.install(in: installer.sharedDirectory)
            XCTAssertEqual(Darwin.mkfifo(installed.appendingPathComponent("pipe").path, 0o600), 0)
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                XCTAssertTrue($0 is EquationLabSkillInstallation.Conflict)
            }
        }
    }

    func testProtectsManagedDirectoryWithOversizedFileOrExcessiveEntries() throws {
        try withFixture { installer in
            let files = FileManager.default
            let installed = try installer.install(in: installer.sharedDirectory)

            // Oversized sparse file (> 8 MiB single-file bound) is treated as user modification without reading it all.
            let hugeFile = installed.appendingPathComponent("large.bin")
            XCTAssertTrue(files.createFile(atPath: hugeFile.path, contents: nil))
            let handle = try FileHandle(forWritingTo: hugeFile)
            try handle.truncate(atOffset: 9 * 1024 * 1024)
            try handle.close()

            XCTAssertEqual(installer.existing(at: installed), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                XCTAssertTrue($0 is EquationLabSkillInstallation.Conflict)
            }
            XCTAssertTrue(files.fileExists(atPath: hugeFile.path))
            try files.removeItem(at: hugeFile)
            XCTAssertEqual(installer.existing(at: installed), .current)

            // Excessive entry count (> 512 entries) stops early and protects the directory as .conflict.
            let bulkDir = installed.appendingPathComponent("bulk", isDirectory: true)
            try files.createDirectory(at: bulkDir, withIntermediateDirectories: true)
            for index in 0..<520 {
                XCTAssertTrue(files.createFile(atPath: bulkDir.appendingPathComponent("f\(index).txt").path, contents: Data()))
            }
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                XCTAssertTrue($0 is EquationLabSkillInstallation.Conflict)
            }
        }
    }

    func testPassiveStatusDoesNotProbeManualSharedSymlinkAndExplicitActionsStillProtect() throws {
        try withFixture { installer in
            let files = FileManager.default
            try files.createDirectory(at: installer.sharedDirectory, withIntermediateDirectories: true)

            // 1. Valid external skill linked at ~/.agents/skills/equation-lab must stay unverified in passive status.
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: installer.source)
            let claudeDir = installer.userHome.appendingPathComponent(".claude/skills", isDirectory: true)
            let claudeDest = claudeDir.appendingPathComponent("equation-lab")
            try files.createDirectory(at: claudeDir, withIntermediateDirectories: true)
            try files.createSymbolicLink(atPath: claudeDest.path, withDestinationPath: "../../.agents/skills/equation-lab")

            let validSnapshot = installer.statusSnapshot()
            XCTAssertEqual(validSnapshot.shared, .unverifiedLink)
            XCTAssertEqual(validSnapshot.linkStatus(for: .claude), .unverifiedLink)
            XCTAssertEqual(validSnapshot.linkStatus(for: .antigravity), .notLinked)
            XCTAssertEqual(installer.clientLinkStatus(.claude), .unverifiedLink)

            // Explicit checks and operations still verify and preserve the valid manual symlink.
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .linked)
            XCTAssertEqual(try installer.install(in: installer.sharedDirectory), installer.sharedDestination)
            XCTAssertEqual(try installer.link(.claude).path, claudeDest.path)
            XCTAssertEqual(try files.destinationOfSymbolicLink(atPath: installer.sharedDestination.path), installer.source.path)

            // 2. Unreadable target (0o000 parent) must not block or fail passive status, client status, or export.
            let lockedParent = installer.userHome.deletingLastPathComponent().appendingPathComponent("Locked Docs", isDirectory: true)
            let lockedTarget = lockedParent.appendingPathComponent("skills/equation-lab", isDirectory: true)
            try files.createDirectory(at: lockedTarget.appendingPathComponent("scripts", isDirectory: true), withIntermediateDirectories: true)
            try fixtureSkill.write(to: lockedTarget.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            try "#!/bin/sh\n".write(to: lockedTarget.appendingPathComponent("scripts/run"), atomically: true, encoding: .utf8)
            try files.setAttributes([.posixPermissions: 0o000], ofItemAtPath: lockedParent.path)
            defer { try? files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: lockedParent.path) }

            try files.removeItem(at: installer.sharedDestination)
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: lockedTarget)
            let antigravityDir = installer.userHome.appendingPathComponent(".gemini/config/skills", isDirectory: true)
            let antigravityDest = antigravityDir.appendingPathComponent("equation-lab")
            try files.createDirectory(at: antigravityDir, withIntermediateDirectories: true)
            try files.createSymbolicLink(at: antigravityDest, withDestinationURL: lockedTarget)

            let lockedSnapshot = installer.statusSnapshot()
            XCTAssertEqual(lockedSnapshot.shared, .unverifiedLink)
            XCTAssertEqual(lockedSnapshot.linkStatus(for: .claude), .unverifiedLink)
            XCTAssertEqual(lockedSnapshot.linkStatus(for: .antigravity), .conflict)
            XCTAssertEqual(installer.clientLinkStatus(.claude), .unverifiedLink)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .conflict)
            XCTAssertEqual(try files.destinationOfSymbolicLink(atPath: installer.sharedDestination.path), lockedTarget.path)

            // Export copies the app's bundled Skill to the chosen folder without touching the shared link target.
            let exportDir = installer.userHome.appendingPathComponent("Exported Skills", isDirectory: true)
            let exported = try installer.install(in: exportDir)
            XCTAssertEqual(exported, exportDir.appendingPathComponent("equation-lab", isDirectory: true))
            XCTAssertEqual(installer.existing(at: exported), .current)
            XCTAssertEqual(try String(contentsOf: exported.appendingPathComponent("SKILL.md"), encoding: .utf8), fixtureSkill)
            XCTAssertEqual(try files.destinationOfSymbolicLink(atPath: installer.sharedDestination.path), lockedTarget.path)

            // Explicit install/link against the unreadable target still protects the existing symlink as conflict.
            if geteuid() != 0 {
                XCTAssertEqual(installer.existing(at: installer.sharedDestination), .conflict)
                XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                    XCTAssertEqual(($0 as? EquationLabSkillInstallation.Conflict)?.destination, installer.sharedDestination)
                }
                XCTAssertThrowsError(try installer.link(.claude)) {
                    XCTAssertEqual(($0 as? EquationLabSkillInstallation.Conflict)?.destination, installer.sharedDestination)
                }
            }

            // 3. Dangling target and multi-hop external cycle stay unverified in passive status, conflict in explicit checks.
            let missingTarget = installer.userHome.deletingLastPathComponent().appendingPathComponent("nonexistent/equation-lab")
            try files.removeItem(at: installer.sharedDestination)
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: missingTarget)
            XCTAssertEqual(installer.statusSnapshot().shared, .unverifiedLink)
            XCTAssertEqual(installer.statusSnapshot().linkStatus(for: .claude), .unverifiedLink)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.sharedDirectory)) {
                XCTAssertEqual(($0 as? EquationLabSkillInstallation.Conflict)?.destination, installer.sharedDestination)
            }

            let loopRoot = installer.userHome.deletingLastPathComponent().appendingPathComponent("Loop", isDirectory: true)
            try files.createDirectory(at: loopRoot, withIntermediateDirectories: true)
            let loopA = loopRoot.appendingPathComponent("a")
            let loopB = loopRoot.appendingPathComponent("b")
            try files.createSymbolicLink(at: loopA, withDestinationURL: loopB)
            try files.createSymbolicLink(at: loopB, withDestinationURL: loopA)
            try files.removeItem(at: installer.sharedDestination)
            try files.createSymbolicLink(at: installer.sharedDestination, withDestinationURL: loopA)
            XCTAssertEqual(installer.statusSnapshot().shared, .unverifiedLink)
            XCTAssertEqual(installer.existing(at: installer.sharedDestination), .conflict)
        }
    }

    func testPassiveStatusSupportsSymlinkedSharedRootAndClientLinksWithManualSkillLink() throws {
        try withFixture { installer in
            let files = FileManager.default
            let realShared = installer.userHome.deletingLastPathComponent()
                .appendingPathComponent("Real Shared Skills", isDirectory: true)
            try files.createDirectory(at: realShared, withIntermediateDirectories: true)
            try files.createDirectory(at: installer.sharedDirectory.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.createSymbolicLink(at: installer.sharedDirectory, withDestinationURL: realShared)

            // Client root linked to shared root + independent client entry pointing to canonical parent + folder name.
            let claudeRoot = installer.userHome.appendingPathComponent(".claude/skills", isDirectory: true)
            try files.createDirectory(at: claudeRoot.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.createSymbolicLink(at: claudeRoot, withDestinationURL: installer.sharedDirectory)

            _ = try installer.install(in: installer.sharedDirectory)
            let antigravityDest = try installer.link(.antigravity)
            let managedSnapshot = installer.statusSnapshot()
            XCTAssertEqual(managedSnapshot.shared, .current)
            XCTAssertEqual(managedSnapshot.linkStatus(for: .claude), .linked)
            XCTAssertEqual(managedSnapshot.linkStatus(for: .antigravity), .linked)

            // Replace the final item under the symlinked shared root with a manual external symlink.
            try files.removeItem(at: realShared.appendingPathComponent("equation-lab", isDirectory: true))
            try files.createSymbolicLink(at: realShared.appendingPathComponent("equation-lab"), withDestinationURL: installer.source)

            let manualSnapshot = installer.statusSnapshot()
            XCTAssertEqual(manualSnapshot.shared, .unverifiedLink)
            XCTAssertEqual(manualSnapshot.linkStatus(for: .claude), .unverifiedLink)
            XCTAssertEqual(manualSnapshot.linkStatus(for: .antigravity), .unverifiedLink)
            XCTAssertEqual(installer.clientLinkStatus(.claude), .unverifiedLink)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .unverifiedLink)

            // Also verify lexical ~/.agents/skills/equation-lab client link and conflicting external client link.
            try files.removeItem(at: antigravityDest)
            try files.createSymbolicLink(atPath: antigravityDest.path, withDestinationPath: "../../../.agents/skills/equation-lab")
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .unverifiedLink)

            try files.removeItem(at: antigravityDest)
            try files.createSymbolicLink(at: antigravityDest, withDestinationURL: installer.source)
            XCTAssertEqual(installer.clientLinkStatus(.antigravity), .conflict)
        }
    }

    @MainActor
    func testPopoverActionHandoffDefersUntilDismissalAndFiresOnce() {
        var scheduled: [(id: Int, delay: UInt64, cancelled: Bool, work: @MainActor () -> Void)] = []
        var nextID = 0
        let handoff = PopoverActionHandoff(postDismissDelayNanoseconds: 50, fallbackDelayNanoseconds: 350) { delay, work in
            let id = nextID
            nextID += 1
            scheduled.append((id: id, delay: delay, cancelled: false, work: work))
            return {
                if let index = scheduled.firstIndex(where: { $0.id == id }) {
                    scheduled[index].cancelled = true
                }
            }
        }

        var dismissed = 0
        var opened = 0
        handoff.trigger(dismissPopover: { dismissed += 1 }) { opened += 1 }
        // Must dismiss popover first and never invoke the follow-up presentation synchronously.
        XCTAssertEqual(dismissed, 1)
        XCTAssertEqual(opened, 0)
        XCTAssertTrue(handoff.hasPendingAction)
        XCTAssertEqual(scheduled.map(\.delay), [350])

        // Second click while closing must not duplicate the pending action.
        handoff.trigger(dismissPopover: { dismissed += 1 }) { opened += 10 }
        XCTAssertEqual(dismissed, 2)
        XCTAssertEqual(opened, 0)
        XCTAssertEqual(scheduled.count, 1)

        // Popover dismissal cancels the fallback and schedules short post-dismiss delivery.
        handoff.popoverDidDisappear()
        XCTAssertTrue(scheduled[0].cancelled)
        XCTAssertEqual(scheduled.map(\.delay), [350, 50])
        XCTAssertEqual(opened, 0)

        scheduled[1].work()
        XCTAssertEqual(opened, 1)
        XCTAssertFalse(handoff.hasPendingAction)

        // Duplicate disappear or late fallback must not fire again.
        handoff.popoverDidDisappear()
        scheduled[0].work()
        XCTAssertEqual(opened, 1)

        // Re-opening the popover before delivery cancels the pending handoff.
        handoff.trigger(dismissPopover: { dismissed += 1 }) { opened += 1 }
        handoff.popoverDidAppear()
        XCTAssertFalse(handoff.hasPendingAction)
        for item in scheduled where !item.cancelled { item.work() }
        XCTAssertEqual(opened, 1)

        // If onDisappear never fires, the fallback delivers the action once.
        let fallbackStart = scheduled.count
        handoff.trigger(dismissPopover: { dismissed += 1 }) { opened += 1 }
        XCTAssertEqual(opened, 1)
        scheduled[fallbackStart].work()
        XCTAssertEqual(opened, 2)
        XCTAssertFalse(handoff.hasPendingAction)
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
