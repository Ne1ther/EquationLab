import XCTest
import CryptoKit
import EquationUpdates
@testable import EquationLab

private final class UpdateRequestCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = 0
    func increment() { lock.lock(); storage += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return storage }
}

@MainActor
final class AppUpdaterTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name="EquationLab-UpdateTests-" + UUID().uuidString
        let result=UserDefaults(suiteName:name)!
        addTeardownBlock { result.removePersistentDomain(forName:name) }
        return result
    }
    private func signedManifest(version: String, build: Int, using key: Curve25519.Signing.PrivateKey = Curve25519.Signing.PrivateKey()) throws -> (data: Data, publicKey: String) {
        let filename = "Equation-Lab-\(version).pkg"
        let payload = try JSONSerialization.data(withJSONObject:[
            "schema":"equationlab.update.v1", "version":version, "build":build,
            "architecture":"arm64", "minimumMacOS":"14.0", "filename":filename,
            "size":3, "sha256":String(repeating:"0",count:64),
            "url":"https://github.com/Ne1ther/EquationLab/releases/download/v\(version)/\(filename)",
            "notesZH":"更新", "notesEN":"Update"
        ])
        let signed = try JSONSerialization.data(withJSONObject:[
            "schema":"equationlab.signed-update.v1", "payload":payload.base64EncodedString(),
            "signature":try key.signature(for:payload).base64EncodedString()
        ])
        return (signed,key.publicKey.rawRepresentation.base64EncodedString())
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
        let invalid=Data("{}".utf8)
        let updater=AppUpdater(defaults:defaults(),fetcher:{ url,_,_ in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try invalid.write(to:file); return file
        })
        updater.check(); await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed); XCTAssertNil(updater.manifest); XCTAssertNil(updater.packageURL)
    }
    func testVerifiedReleaseBecomesAvailableAndRespectsDownloadPreference() async throws {
        let key=Curve25519.Signing.PrivateKey(),preferences=defaults()
        preferences.set(false,forKey:"updates.automaticDownloads")
        let payload=try JSONSerialization.data(withJSONObject:["schema":"equationlab.update.v1","version":"0.5.8","build":41,"architecture":"arm64","minimumMacOS":"14.0","filename":"Equation-Lab-0.5.8.pkg","size":3,"sha256":String(repeating:"0",count:64),"url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg","notesZH":"更新","notesEN":"Update"])
        let signed=try JSONSerialization.data(withJSONObject:["schema":"equationlab.signed-update.v1","payload":payload.base64EncodedString(),"signature":try key.signature(for:payload).base64EncodedString()])
        let updater=AppUpdater(defaults:preferences,installed:("0.5.7",40),fetcher:{ url,_,_ in
            XCTAssertEqual(url.host,"github.com")
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try (url.path.hasSuffix(".pkg") ? Data("bad".utf8) : signed).write(to:file); return file
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
    func testStartupAutomaticallyChecksSignedReleaseAndMakesUpdateAvailableWithoutOpeningPanel() async throws {
        let preferences=defaults(), counter=UpdateRequestCounter()
        let release=try signedManifest(version:"0.6.2",build:67)
        let updater=AppUpdater(defaults:preferences,installed:("0.6.1",63),fetcher:{ url,_,_ in
            counter.increment()
            guard url.lastPathComponent == "EquationLab-update.json" else { throw URLError(.badURL) }
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try release.data.write(to:file); return file
        },verificationKey:release.publicKey)

        XCTAssertTrue(updater.automaticChecks)
        XCTAssertFalse(updater.automaticDownloads)
        updater.start()
        await updater.operation?.value

        XCTAssertEqual(updater.phase,.available)
        XCTAssertTrue(updater.hasUpdate)
        XCTAssertEqual(updater.manifest?.version,"0.6.2")
        XCTAssertFalse(updater.showPanel)
        XCTAssertNotNil(updater.lastChecked)
        XCTAssertEqual(counter.count,1)

        // The hourly timer and app-activation path share the daily throttle.
        updater.checkAutomaticallyIfDue()
        XCTAssertEqual(counter.count,1)
    }
    func testCurrentSignedReleaseClearsCachedUpdateAndBadgeState() async throws {
        let preferences=defaults(), key=Curve25519.Signing.PrivateKey()
        let current=try signedManifest(version:"0.6.2",build:67,using:key)
        let cachedNewer=try signedManifest(version:"0.6.3",build:68,using:key)
        preferences.set(cachedNewer.data,forKey:"updates.signedManifest")
        let updater=AppUpdater(defaults:preferences,installed:("0.6.2",67),fetcher:{ _,_,_ in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try current.data.write(to:file); return file
        },verificationKey:current.publicKey)

        XCTAssertTrue(updater.hasUpdate)
        updater.check(manually:false)
        await updater.operation?.value

        XCTAssertEqual(updater.phase,.current)
        XCTAssertNil(updater.manifest)
        XCTAssertFalse(updater.hasUpdate)
        XCTAssertNil(preferences.data(forKey:"updates.signedManifest"))
        XCTAssertNotNil(updater.lastChecked)
    }
    func testAutomaticCheckThrottleAppliesAfterFailureButManualRetryBypassesIt() async {
        let preferences=defaults(), counter=UpdateRequestCounter()
        let updater=AppUpdater(defaults:preferences,installed:("0.6.2",67),fetcher:{ _,_,_ in
            counter.increment(); throw URLError(.notConnectedToInternet)
        })
        XCTAssertTrue(updater.automaticChecks)

        preferences.set(Date().addingTimeInterval(-60*60),forKey:"updates.lastAttempt")
        updater.checkAutomaticallyIfDue()
        XCTAssertEqual(updater.phase,.idle)
        XCTAssertEqual(counter.count,0)

        preferences.set(Date().addingTimeInterval(-25*60*60),forKey:"updates.lastAttempt")
        updater.checkAutomaticallyIfDue()
        await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed)
        XCTAssertFalse(updater.showPanel)
        XCTAssertNil(updater.lastChecked)
        XCTAssertEqual(counter.count,1)

        updater.checkAutomaticallyIfDue()
        XCTAssertEqual(counter.count,1)
        updater.check()
        await updater.operation?.value
        XCTAssertEqual(updater.phase,.failed)
        XCTAssertTrue(updater.showPanel)
        XCTAssertEqual(counter.count,2)
    }
    func testAutomaticDownloadVerifiesPackageAndDefersInstallationDuringWordEdit() async throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let key=Curve25519.Signing.PrivateKey(),preferences=defaults(),bytes=Data("pkg".utf8)
        preferences.set(true,forKey:"updates.automaticDownloads")
        let hash=SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined()
        let payload=try JSONSerialization.data(withJSONObject:["schema":"equationlab.update.v1","version":"0.5.8","build":41,"architecture":"arm64","minimumMacOS":"14.0","filename":"Equation-Lab-0.5.8.pkg","size":3,"sha256":hash,"url":"https://github.com/Ne1ther/EquationLab/releases/download/v0.5.8/Equation-Lab-0.5.8.pkg","notesZH":"更新","notesEN":"Update"])
        let signed=try JSONSerialization.data(withJSONObject:["schema":"equationlab.signed-update.v1","payload":payload.base64EncodedString(),"signature":try key.signature(for:payload).base64EncodedString()])
        let updater=AppUpdater(defaults:preferences,installed:("0.5.7",40),fetcher:{ url,_,progress in
            let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try (url.path.hasSuffix(".pkg") ? bytes : signed).write(to:file)
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
        XCTAssertTrue(updater.automaticChecks)
        updater.checkAutomaticallyIfDue();await updater.operation?.value
        XCTAssertEqual(updater.phase,.available,updater.errorMessage)
        XCTAssertEqual(updater.manifest?.version,expected);XCTAssertNil(updater.packageURL)
        XCTAssertFalse(updater.showPanel)
        if let rawBuild=ProcessInfo.processInfo.environment["EQUATIONLAB_LIVE_RELEASE_BUILD"],let build=Int(rawBuild) {
            XCTAssertEqual(updater.manifest?.build,build)
        }
        let installedBuild=Int(ProcessInfo.processInfo.environment["EQUATIONLAB_LIVE_CURRENT_BUILD"] ?? "") ?? Int.max
        let current=AppUpdater(defaults:defaults(),installed:(expected,installedBuild))
        current.checkAutomaticallyIfDue();await current.operation?.value
        XCTAssertEqual(current.phase,.current,current.errorMessage)
        XCTAssertFalse(current.hasUpdate)
        do {
            _ = try await AppUpdater.fetch(URL(string:"https://github.com/Ne1ther/EquationLab/releases/latest/download/EquationLab-update.json")!,limit:32)
            XCTFail("Oversized downloads must be rejected")
        } catch { XCTAssertEqual(error as? UpdateError,.downloadTooLarge) }
    }
}
