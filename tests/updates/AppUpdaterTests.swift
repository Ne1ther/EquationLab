import XCTest
import CryptoKit
import EquationUpdates
@testable import EquationLab

@MainActor
final class AppUpdaterTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name="EquationLab-UpdateTests-" + UUID().uuidString
        let result=UserDefaults(suiteName:name)!
        addTeardownBlock { result.removePersistentDomain(forName:name) }
        return result
    }
    private func release() throws -> Data {
        try JSONSerialization.data(withJSONObject:["tag_name":"v0.5.8","draft":false,"prerelease":false,"assets":[["name":"EquationLab-update.json","size":1000,"browser_download_url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/EquationLab-update.json"]]])
    }
    func testOfflineAndRateLimitAreRetryableWithoutInterruptingEditor() async {
        for error: Error in [URLError(.notConnectedToInternet),UpdateError.http(429),UpdateError.downloadTooLarge] {
            let updater=AppUpdater(defaults:defaults(),fetcher:{ _,_,_ in throw error })
            updater.check(manually:false); await updater.operation?.value
            XCTAssertEqual(updater.phase,.failed); XCTAssertFalse(updater.showPanel); XCTAssertNil(updater.lastChecked)
            XCTAssertFalse(updater.errorMessage.isEmpty)
            updater.check(); await updater.operation?.value
            XCTAssertTrue(updater.showPanel)
        }
    }
    func testCancelledCheckDoesNotReportFailure() async {
        let updater=AppUpdater(defaults:defaults(),fetcher:{ _,_,_ in
            try await Task.sleep(nanoseconds:10_000_000_000); throw CancellationError()
        })
        updater.check(); updater.cancel(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.idle); XCTAssertTrue(updater.errorMessage.isEmpty)
    }
    func testInvalidSignatureNeverEnablesDownload() async throws {
        let release=try release(), invalid=Data("{}".utf8)
        let updater=AppUpdater(defaults:defaults(),fetcher:{ url,_,_ in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try (url.host == "api.github.com" ? release : invalid).write(to:file); return file
        })
        updater.check(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed); XCTAssertNil(updater.manifest); XCTAssertNil(updater.packageURL)
    }
    func testVerifiedReleaseBecomesAvailableAndRespectsDownloadPreference() async throws {
        let key=Curve25519.Signing.PrivateKey(),release=try release(),preferences=defaults()
        preferences.set(false,forKey:"updates.automaticDownloads")
        let payload=try JSONSerialization.data(withJSONObject:["schema":"equationlab.update.v1","version":"0.5.8","build":41,"architecture":"arm64","minimumMacOS":"14.0","filename":"Equation-Lab-0.5.8.pkg","size":3,"sha256":String(repeating:"0",count:64),"url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg","notesZH":"更新","notesEN":"Update"])
        let signed=try JSONSerialization.data(withJSONObject:["schema":"equationlab.signed-update.v1","payload":payload.base64EncodedString(),"signature":try key.signature(for:payload).base64EncodedString()])
        let updater=AppUpdater(defaults:preferences,installed:("0.5.7",40),fetcher:{ url,_,_ in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try (url.path.hasSuffix(".pkg") ? Data("bad".utf8) : url.host == "api.github.com" ? release : signed).write(to:file); return file
        },verificationKey:key.publicKey.rawRepresentation.base64EncodedString())
        updater.check(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.available); XCTAssertEqual(updater.manifest?.version,"0.5.8")
        XCTAssertNotNil(updater.lastChecked); XCTAssertNil(updater.packageURL)
        XCTAssertTrue(updater.automaticChecks); XCTAssertFalse(updater.automaticDownloads)
        updater.download(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed); XCTAssertNil(updater.packageURL)
        XCTAssertTrue(updater.errorMessage.contains("校验"))
    }
    func testAutomaticChecksCanBeDisabledWithoutDisablingManualCheck() async {
        let preferences=defaults(); preferences.set(false,forKey:"updates.automaticChecks")
        let updater=AppUpdater(defaults:preferences,fetcher:{ _,_,_ in throw URLError(.notConnectedToInternet) })
        updater.start(); XCTAssertEqual(updater.phase,.idle)
        updater.check(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed); XCTAssertTrue(updater.showPanel)
    }
    func testAutomaticDownloadVerifiesPackageAndDefersInstallationDuringWordEdit() async throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let key=Curve25519.Signing.PrivateKey(),release=try release(),preferences=defaults(),bytes=Data("pkg".utf8)
        preferences.set(true,forKey:"updates.automaticDownloads")
        let hash=SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined()
        let payload=try JSONSerialization.data(withJSONObject:["schema":"equationlab.update.v1","version":"0.5.8","build":41,"architecture":"arm64","minimumMacOS":"14.0","filename":"Equation-Lab-0.5.8.pkg","size":3,"sha256":hash,"url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg","notesZH":"更新","notesEN":"Update"])
        let signed=try JSONSerialization.data(withJSONObject:["schema":"equationlab.signed-update.v1","payload":payload.base64EncodedString(),"signature":try key.signature(for:payload).base64EncodedString()])
        let updater=AppUpdater(defaults:preferences,installed:("0.5.7",40),fetcher:{ url,_,progress in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try (url.path.hasSuffix(".pkg") ? bytes : url.host == "api.github.com" ? release : signed).write(to:file)
            progress(1);return file
        },verificationKey:key.publicKey.rawRepresentation.base64EncodedString(),downloadDirectory:directory)
        updater.check(manually:false); await updater.operation?.value; await updater.operation?.value
        XCTAssertEqual(updater.phase,.ready); XCTAssertFalse(updater.showPanel)
        let package=try XCTUnwrap(updater.packageURL)
        XCTAssertEqual(try Data(contentsOf:package),bytes)
        let bridge=DesktopBridge();bridge.wordSessionActive=true
        updater.install(bridge:bridge)
        XCTAssertTrue(updater.errorMessage.contains("编辑"));XCTAssertEqual(updater.phase,.ready)
        // A changed cached file must be discarded and downloaded again.
        try Data("bad".utf8).write(to:package)
        updater.download();await updater.operation?.value
        XCTAssertEqual(updater.phase,.ready);XCTAssertEqual(try Data(contentsOf:package),bytes)
        preferences.set(false,forKey:"updates.automaticDownloads")
        let restored=AppUpdater(defaults:preferences,installed:("0.5.7",40),fetcher:{ _,_,_ in
            XCTFail("A verified cached installer should survive restart without another download")
            throw URLError(.notConnectedToInternet)
        },verificationKey:key.publicKey.rawRepresentation.base64EncodedString(),downloadDirectory:directory)
        XCTAssertEqual(restored.phase,.available)
        restored.start();await restored.operation?.value
        XCTAssertEqual(restored.phase,.ready);XCTAssertEqual(restored.packageURL?.lastPathComponent,package.lastPathComponent)
    }
    func testLiveGitHubDownloadAndRedirects() async throws {
        guard ProcessInfo.processInfo.environment["EQUATIONLAB_LIVE_UPDATE_TEST"] == "1" else { throw XCTSkip("Opt-in live network test") }
        let release=try await AppUpdater.fetch(URL(string:"https://api.github.com/repos/Ne1ther/EquationLab/releases/tags/v0.5.7")!,limit:512*1024)
        defer { try? FileManager.default.removeItem(at:release) }
        let json=try JSONDecoder().decode(GitHubRelease.self,from:Data(contentsOf:release))
        XCTAssertEqual(json.tag_name,"v0.5.7")
        let package=try await AppUpdater.fetch(URL(string:"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.7/Equation-Lab-0.5.7.pkg")!,limit:80_025_826)
        defer { try? FileManager.default.removeItem(at:package) }
        let handle=try FileHandle(forReadingFrom:package); defer { try? handle.close() }
        var hash=SHA256()
        while let data=try handle.read(upToCount:1024*1024),!data.isEmpty { hash.update(data:data) }
        XCTAssertEqual(hash.finalize().map { String(format:"%02x",$0) }.joined(),"124b8219fab9160315c0d23412b1cb3adbc6175d218729b015802a0e08139f4f")
    }
    func testLivePublishedUpdateCheck() async throws {
        guard let expected=ProcessInfo.processInfo.environment["EQUATIONLAB_LIVE_RELEASE_VERSION"] else { throw XCTSkip("Opt-in published update check") }
        let updater=AppUpdater(defaults:defaults(),installed:("0.5.7",40))
        updater.check(manually:false);await updater.operation?.value
        XCTAssertEqual(updater.phase,.available,updater.errorMessage)
        XCTAssertEqual(updater.manifest?.version,expected);XCTAssertNil(updater.packageURL)
        let current=AppUpdater(defaults:defaults(),installed:(expected,Int.max))
        current.check(manually:false);await current.operation?.value
        XCTAssertEqual(current.phase,.current,current.errorMessage)
        do {
            _ = try await AppUpdater.fetch(URL(string:"https://api.github.com/repos/Ne1ther/EquationLab/releases/latest")!,limit:32)
            XCTFail("Oversized downloads must be rejected")
        } catch { XCTAssertEqual(error as? UpdateError,.downloadTooLarge) }
    }
}
