import XCTest
@testable import EquationLab

final class EquationLabSkillInstallationTests: XCTestCase {
    func testInstallsUnderSelectedHomeAndIsIdempotent() throws {
        try withFixture { installer in
            XCTAssertEqual(installer.codexDestination.path, installer.userHome.path + "/.agents/skills/equation-lab")
            XCTAssertEqual(installer.existing(at: installer.codexDestination), .available)
            let installed = try installer.install(in: installer.codexDirectory)
            XCTAssertEqual(installed, installer.codexDestination)
            XCTAssertEqual(installer.existing(at: installed), .current)
            XCTAssertEqual(try String(contentsOf: installed.appendingPathComponent("SKILL.md"), encoding: .utf8), "# Equation Lab\n")
            XCTAssertEqual(try String(contentsOf: installed.appendingPathComponent(".equation-lab-resources"), encoding: .utf8), installer.resources.path + "\n")
            XCTAssertEqual(try installer.install(in: installer.codexDirectory), installed)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: installer.codexDirectory.path), ["equation-lab"])

            let pointer = installed.appendingPathComponent(".equation-lab-resources")
            try "/previous/Equation Lab.app/Contents/Resources\n".write(to: pointer, atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .relink)
            XCTAssertEqual(try installer.install(in: installer.codexDirectory), installed)
            XCTAssertEqual(installer.existing(at: installed), .current)
            XCTAssertEqual(try String(contentsOf: pointer, encoding: .utf8), installer.resources.path + "\n")
        }
    }

    func testProtectsUserEditsAndDanglingLinksAtSameSkillName() throws {
        try withFixture { installer in
            let installed = try installer.install(in: installer.codexDirectory)
            let readme = installed.appendingPathComponent("SKILL.md")
            try "User changes".write(to: readme, atomically: true, encoding: .utf8)
            XCTAssertEqual(installer.existing(at: installed), .conflict)
            XCTAssertThrowsError(try installer.install(in: installer.codexDirectory)) {
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

    private func withFixture(_ work: (EquationLabSkillInstallation) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let resources = directory.appendingPathComponent("Equation Lab.app/Contents/Resources", isDirectory: true)
        let installer = EquationLabSkillInstallation(resources: resources, userHome: directory.appendingPathComponent("Test Home", isDirectory: true))
        defer { try? FileManager.default.removeItem(at: directory) }
        for path in ["skills/equation-lab/scripts", "runtime/bin", "engine/src"] {
            try FileManager.default.createDirectory(at: resources.appendingPathComponent(path), withIntermediateDirectories: true)
        }
        try "# Equation Lab\n".write(to: installer.source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try "#!/bin/sh\n".write(to: installer.source.appendingPathComponent("scripts/run"), atomically: true, encoding: .utf8)
        try Data().write(to: resources.appendingPathComponent("engine/src/cli.mjs"))
        let executable = resources.appendingPathComponent("runtime/bin/node")
        try Data("#!/bin/sh\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try work(installer)
    }
}
