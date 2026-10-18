import XCTest
import CryptoKit
@testable import EquationUpdates

final class UpdateManifestTests: XCTestCase {
    func testBuiltReleaseManifestAndPackage() throws {
        guard let folder=ProcessInfo.processInfo.environment["EQUATIONLAB_UPDATE_RELEASE_DIR"] else { throw XCTSkip("Opt-in packaged release verification") }
        let root=URL(fileURLWithPath:folder,isDirectory:true)
        let update=try UpdateManifest.verified(Data(contentsOf:root.appendingPathComponent("EquationLab-update.json")))
        try update.verifyPackage(at:root.appendingPathComponent(update.filename))
    }
    private func payload(_ changes: [String: Any] = [:]) -> [String: Any] {
        var result: [String: Any] = ["schema":"equationlab.update.v1", "version":"0.5.8", "build":41, "architecture":"arm64", "minimumMacOS":"14.0", "filename":"Equation-Lab-0.5.8.pkg", "size":3, "sha256":SHA256.hash(data: Data("pkg".utf8)).map { String(format:"%02x", $0) }.joined(), "url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg", "notesZH":"更新", "notesEN":"Update"]
        changes.forEach { result[$0.key] = $0.value }; return result
    }
    private func signed(_ changes: [String: Any] = [:], key: Curve25519.Signing.PrivateKey) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: payload(changes))
        return try JSONSerialization.data(withJSONObject: ["schema":"equationlab.signed-update.v1", "payload":data.base64EncodedString(), "signature":try key.signature(for: data).base64EncodedString()])
    }
    private func manifest(_ changes: [String: Any] = [:]) throws -> UpdateManifest {
        let key = Curve25519.Signing.PrivateKey()
        return try UpdateManifest.verified(signed(changes, key:key), publicKey:key.publicKey.rawRepresentation.base64EncodedString())
    }
    func testNumericVersionsAndBuildsNeverDowngrade() throws {
        XCTAssertLessThan(try ReleaseVersion("0.5.9"), try ReleaseVersion("0.5.10"))
        let update = try manifest()
        XCTAssertTrue(try update.isNewer(than:"0.5.7", build:100))
        XCTAssertTrue(try update.isNewer(than:"0.5.8", build:40))
        XCTAssertFalse(try update.isNewer(than:"0.5.8", build:41))
        XCTAssertFalse(try update.isNewer(than:"0.5.8", build:42))
        XCTAssertFalse(try update.isNewer(than:"0.5.9", build:1))
        for value in ["1.2", "1.2.3-beta", "1..3", "-1.2.3", "1.2.3.4", "99999999999999999999.0.0", "１.2.3"] {
            XCTAssertThrowsError(try ReleaseVersion(value), value)
        }
    }
    func testSignatureRejectsWrongKeyAndModifiedPayload() throws {
        let key = Curve25519.Signing.PrivateKey(), other = Curve25519.Signing.PrivateKey()
        let data = try signed(key:key)
        XCTAssertNoThrow(try UpdateManifest.verified(data, publicKey:key.publicKey.rawRepresentation.base64EncodedString()))
        XCTAssertThrowsError(try UpdateManifest.verified(data, publicKey:other.publicKey.rawRepresentation.base64EncodedString()))
        var envelope = try XCTUnwrap(JSONSerialization.jsonObject(with:data) as? [String:String])
        envelope["payload"] = try JSONSerialization.data(withJSONObject:payload(["version":"9.0.0"])).base64EncodedString()
        XCTAssertThrowsError(try UpdateManifest.verified(JSONSerialization.data(withJSONObject:envelope), publicKey:key.publicKey.rawRepresentation.base64EncodedString()))
        XCTAssertThrowsError(try UpdateManifest.verified(Data(repeating:65,count:129*1024)))
    }
    func testEvenSignedManifestMustMatchRepositoryAndPlatform() throws {
        for changes: [String:Any] in [
            ["url":"https://example.com/app.pkg"], ["url":"http://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg"],
            ["filename":"../../app.pkg"], ["architecture":"x86_64"], ["size":0], ["size":501*1024*1024],
            ["sha256":"bad"], ["build":0], ["minimumMacOS":"invalid"], ["schema":"other"]
        ] { XCTAssertThrowsError(try manifest(changes), "\(changes)") }
        let update = try manifest(["minimumMacOS":"15.2"])
        XCTAssertFalse(try update.supports(os:.init(majorVersion:15, minorVersion:1, patchVersion:9)))
        XCTAssertTrue(try update.supports(os:.init(majorVersion:15, minorVersion:2, patchVersion:0)))
    }
    func testPackageSizeAndHashAreBothVerified() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:dir) }
        let file = dir.appendingPathComponent("test.pkg"), update = try manifest()
        try Data("pkg".utf8).write(to:file); XCTAssertNoThrow(try update.verifyPackage(at:file))
        try Data("bad".utf8).write(to:file); XCTAssertThrowsError(try update.verifyPackage(at:file))
        try Data("truncated".utf8).write(to:file); XCTAssertThrowsError(try update.verifyPackage(at:file))
        let link = dir.appendingPathComponent("link.pkg")
        try FileManager.default.createSymbolicLink(at:link,withDestinationURL:file)
        XCTAssertThrowsError(try update.verifyPackage(at:link))
    }
    func testReleaseSelectionRejectsForeignAssetsAndPreviewChannels() throws {
        func release(_ change:[String:Any] = [:]) throws -> GitHubRelease {
            var value:[String:Any] = ["tag_name":"v0.5.8","draft":false,"prerelease":false,"assets":[["name":"EquationLab-update.json","size":800,"browser_download_url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/EquationLab-update.json"]]]
            change.forEach { value[$0.key] = $0.value }
            return try JSONDecoder().decode(GitHubRelease.self,from:JSONSerialization.data(withJSONObject:value))
        }
        XCTAssertNotNil(try release().manifestURL())
        XCTAssertNil(try release(["assets":[]]).manifestURL())
        XCTAssertThrowsError(try release(["draft":true]).manifestURL())
        XCTAssertThrowsError(try release(["prerelease":true]).manifestURL())
        XCTAssertThrowsError(try release(["assets":[["name":"EquationLab-update.json","size":800,"browser_download_url":"https://example.com/update.json"]]]).manifestURL())
    }
    func testRedirectPolicyAndDailySchedule() {
        for url in ["https://api.github.com/repos/Ne1ther/EquationLab/releases/latest", "https://release-assets.githubusercontent.com/file?token=abc"] { XCTAssertTrue(UpdateNetworkPolicy.allows(URL(string:url)!)) }
        for url in ["http://github.com/file", "https://github.com.evil.com/file", "file:///tmp/app.pkg", "https://user:pass@github.com/file", "https://github.com:8443/file"] { XCTAssertFalse(UpdateNetworkPolicy.allows(URL(string:url)!)) }
        let now=Date()
        XCTAssertTrue(UpdateNetworkPolicy.shouldCheck(lastAttempt:nil,now:now))
        XCTAssertFalse(UpdateNetworkPolicy.shouldCheck(lastAttempt:now.addingTimeInterval(-3600),now:now))
        XCTAssertTrue(UpdateNetworkPolicy.shouldCheck(lastAttempt:now.addingTimeInterval(-86400),now:now))
        XCTAssertTrue(UpdateNetworkPolicy.shouldCheck(lastAttempt:now.addingTimeInterval(3600),now:now))
    }
}
