import AppKit
import SwiftUI
import EquationUpdates

private final class UpdateTransferDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let limit: Int64
    let progress: @Sendable (Double) -> Void
    private let lock = NSLock()
    private var limitExceeded = false
    var exceededLimit: Bool { lock.withLock { limitExceeded } }
    init(limit: Int64, progress: @escaping @Sendable (Double) -> Void) { self.limit = limit; self.progress = progress }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(UpdateNetworkPolicy.allows) == true ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > limit || totalBytesExpectedToWrite > limit {
            lock.withLock { limitExceeded = true }; downloadTask.cancel(); return
        }
        progress(min(1, Double(totalBytesWritten) / Double(limit)))
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}

@MainActor
final class AppUpdater: ObservableObject {
    typealias Fetcher = @Sendable (URL, Int64, @escaping @Sendable (Double) -> Void) async throws -> URL
    enum Phase: Equatable { case idle, checking, current, available, downloading, verifying, ready, failed }
    enum InstallBlocker: String {
        case editing = "请先保存或结束当前的 Word 公式编辑，再安装更新。"
        case wordRunning = "请先保存文档并完全退出 Word（⌘Q），再安装更新。"
        case busy = "Equation Lab 正在处理，请完成当前操作后再安装更新。"
        case installingPlugin = "请等 Word 插件安装完成，再安装更新。"
    }
    @Published var phase: Phase = .idle
    @Published var showPanel = false
    @Published var manifest: UpdateManifest?
    @Published var progress = 0.0
    @Published var errorMessage = ""
    @Published var lastChecked: Date?
    @Published var automaticChecks: Bool { didSet { defaults.set(automaticChecks, forKey: "updates.automaticChecks") } }
    @Published var automaticDownloads: Bool { didSet { defaults.set(automaticDownloads, forKey: "updates.automaticDownloads") } }
    let currentVersion: String
    let currentBuild: Int
    private let defaults: UserDefaults
    private(set) var operation: Task<Void, Never>?
    private let fetcher: Fetcher
    private let verificationKey: String
    private let downloadDirectory: URL?
    private var timer: Timer?
    private var started = false
    private var installedUpdate: UpdateManifest?
    private(set) var packageURL: URL?
    var working: Bool { [.checking, .downloading, .verifying].contains(phase) }
    var hasUpdate: Bool { manifest != nil }
    var releaseURL: URL { manifest?.releaseURL ?? URL(string: "https://github.com/Ne1ther/EquationLab/releases/latest")! }

    init(bundle: Bundle = .main, defaults: UserDefaults = .standard, installed: (version: String, build: Int)? = nil, fetcher: Fetcher? = nil, verificationKey: String = UpdateTrust.publicKey, downloadDirectory: URL? = nil) {
        self.defaults = defaults
        self.fetcher = fetcher ?? { url, limit, progress in try await Self.fetch(url, limit: limit, progress: progress) }
        self.verificationKey = verificationKey
        self.downloadDirectory = downloadDirectory
        currentVersion = installed?.version ?? bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        currentBuild = installed?.build ?? Int(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
        automaticChecks = defaults.object(forKey: "updates.automaticChecks") as? Bool ?? true
        automaticDownloads = defaults.bool(forKey: "updates.automaticDownloads")
        lastChecked = defaults.object(forKey: "updates.lastSuccess") as? Date
        if let cached = defaults.data(forKey: "updates.signedManifest") {
            if let update = try? UpdateManifest.verified(cached, publicKey: verificationKey) {
                if (try? update.isNewer(than: currentVersion, build: currentBuild)) == false {
                    installedUpdate = update
                } else if (try? update.supports(os: ProcessInfo.processInfo.operatingSystemVersion)) == true {
                    manifest = update; phase = .available
                }
            }
            if manifest == nil {
                defaults.removeObject(forKey: "updates.signedManifest")
            }
        }
    }
    deinit { timer?.invalidate(); operation?.cancel() }
    func start() {
        guard !started else { return }; started = true
        pruneInstalledDownloads(installedUpdate)
        installedUpdate = nil
        restorePendingDownload()
        checkAutomaticallyIfDue()
        timer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkAutomaticallyIfDue() }
        }
        timer?.tolerance = 60
    }
    private func restorePendingDownload() {
        guard let update = manifest else { return }
        if let cache = try? downloadDirectory ?? Self.cacheDirectory() {
            let file = cache.appendingPathComponent(update.sha256 + "-" + update.filename)
            if FileManager.default.fileExists(atPath: file.path) {
                phase = .verifying
                operation = Task {
                    do { try await Self.verify(update, file: file); packageURL = file; progress = 1; phase = .ready }
                    catch {
                        if Task.isCancelled { handle(error); return }
                        try? FileManager.default.removeItem(at: file)
                        phase = .available
                        if automaticDownloads { beginDownload(update) }
                    }
                    checkAutomaticallyIfDue()
                }
                return
            }
        }
        if automaticDownloads { beginDownload(update) }
    }
    func checkAutomaticallyIfDue() {
        guard automaticChecks, !working,
              UpdateNetworkPolicy.shouldCheck(lastAttempt: defaults.object(forKey: "updates.lastAttempt") as? Date) else { return }
        check(manually: false)
    }
    func check(manually: Bool = true) {
        if manually { showPanel = true }
        guard !working else { return }
        defaults.set(Date(), forKey: "updates.lastAttempt")
        phase = .checking; errorMessage = ""
        operation = Task {
            do {
                // GitHub's documented latest-asset URL avoids shared-IP REST
                // quotas. Trust comes from the pinned signature, not API data.
                let signedFile = try await fetcher(URL(string: "https://github.com/Ne1ther/EquationLab/releases/latest/download/EquationLab-update.json")!, 128 * 1024, { _ in })
                defer { try? FileManager.default.removeItem(at: signedFile) }
                let signedData = try Data(contentsOf: signedFile)
                let update = try UpdateManifest.verified(signedData, publicKey: verificationKey)
                try Task.checkCancellation()
                guard try update.isNewer(than: currentVersion, build: currentBuild) else {
                    pruneInstalledDownloads(update)
                    manifest = nil; packageURL = nil; defaults.removeObject(forKey: "updates.signedManifest"); phase = .current; recordSuccess(); return
                }
                manifest = update
                defaults.set(signedData, forKey: "updates.signedManifest")
                guard try update.supports(os: ProcessInfo.processInfo.operatingSystemVersion) else { throw UpdateError.incompatibleSystem }
                packageURL = nil; phase = .available; recordSuccess()
                if automaticDownloads { beginDownload(update) }
            } catch { handle(error) }
        }
    }
    private func recordSuccess() { lastChecked = Date(); defaults.set(lastChecked, forKey: "updates.lastSuccess") }
    func download() { guard let manifest, !working else { return }; beginDownload(manifest) }
    private func beginDownload(_ update: UpdateManifest) {
        phase = .downloading; progress = 0; errorMessage = ""
        operation = Task { [self] in
            var temporary: URL?
            do {
                guard try update.supports(os: ProcessInfo.processInfo.operatingSystemVersion) else { throw UpdateError.incompatibleSystem }
                let cache = try downloadDirectory ?? Self.cacheDirectory()
                try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let destination = cache.appendingPathComponent(update.sha256 + "-" + update.filename)
                if FileManager.default.fileExists(atPath: destination.path) {
                    do { try await Self.verify(update, file: destination); packageURL = destination; phase = .ready; return }
                    catch { try? FileManager.default.removeItem(at: destination) }
                }
                let file = try await fetcher(update.url, update.size, { [weak owner = self] value in
                    Task { @MainActor in if owner?.phase == .downloading { owner?.progress = value } }
                })
                temporary = file; phase = .verifying
                try await Self.verify(update, file: file)
                try Task.checkCancellation()
                try FileManager.default.moveItem(at: file, to: destination)
                temporary = nil
                Self.pruneDownloads(in: cache, olderThan: update.version)
                packageURL = destination; progress = 1; phase = .ready
            } catch { if let temporary { try? FileManager.default.removeItem(at: temporary) }; handle(error) }
        }
    }
    func cancel() { operation?.cancel() }
    private func handle(_ error: Error) {
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            phase = manifest == nil ? .idle : .available; errorMessage = ""; return
        }
        phase = .failed
        switch error {
        case UpdateError.invalidSignature: errorMessage = "更新签名验证未通过，请到 GitHub 查看发布。"
        case UpdateError.checksumMismatch: errorMessage = "安装包校验未通过，请重新下载。"
        case UpdateError.downloadTooLarge: errorMessage = "下载文件超出发布记录的大小，请重新检查更新。"
        case UpdateError.incompatibleSystem: errorMessage = "新版需要更高版本的 macOS，请查看发布说明。"
        case UpdateError.http(403), UpdateError.http(429): errorMessage = "GitHub 暂时限制了请求，请稍后再试。"
        case UpdateError.invalidManifest, UpdateError.invalidVersion, UpdateError.http(404): errorMessage = "发布信息不完整，请到 GitHub 查看更新。"
        default: errorMessage = "无法完成更新检查或下载，请检查网络后重试。"
        }
    }
    static var isWordRunning: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").isEmpty
    }
    func installBlocker(bridge: DesktopBridge, wordRunning: Bool) -> InstallBlocker? {
        if bridge.installationRunning { return .installingPlugin }
        if bridge.hasWordSessionOrRequest { return .editing }
        if wordRunning { return .wordRunning }
        if bridge.state.busy { return .busy }
        return nil
    }
    func install(bridge: DesktopBridge) {
        guard phase == .ready, let manifest, let packageURL else { return }
        if let blocker = installBlocker(bridge: bridge, wordRunning: Self.isWordRunning) {
            errorMessage = blocker.rawValue
            return
        }
        errorMessage = ""
        let alert = NSAlert()
        alert.messageText = bridge.t("安装 Equation Lab 更新")
        alert.informativeText = bridge.t("请先保存当前公式。继续后会打开 macOS 安装器并退出 Equation Lab；安装器可能需要管理员验证。安装完成后重新打开应用。")
        alert.addButton(withTitle: bridge.t("打开安装器并退出")); alert.addButton(withTitle: bridge.t("取消"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        phase = .verifying
        operation = Task {
            do {
                // Recheck immediately before handing the local file to Installer.
                try await Self.verify(manifest, file: packageURL)
                if let blocker = installBlocker(bridge: bridge, wordRunning: Self.isWordRunning) {
                    phase = .ready
                    errorMessage = blocker.rawValue
                    return
                }
                phase = .ready
                let configuration = NSWorkspace.OpenConfiguration()
                NSWorkspace.shared.open([packageURL], withApplicationAt: URL(fileURLWithPath: "/System/Library/CoreServices/Installer.app"), configuration: configuration) { _, error in
                    Task { @MainActor in
                        if error == nil { NSApp.terminate(nil) }
                        else { self.errorMessage = "无法打开 macOS 安装器，请重试或从 GitHub 下载安装包。" }
                    }
                }
            } catch { handle(error) }
        }
    }
    nonisolated private static func verify(_ update: UpdateManifest, file: URL) async throws {
        try await Task.detached(priority: .utility) { try update.verifyPackage(at: file) }.value
        try Task.checkCancellation()
    }
    nonisolated private static func cacheDirectory() throws -> URL {
        try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
            .appendingPathComponent("app.equationlab.updates", isDirectory: true)
    }
    private func pruneInstalledDownloads(_ update: UpdateManifest?) {
        guard let cache = try? downloadDirectory ?? Self.cacheDirectory() else { return }
        // The cache filename has no build number. To remove a package at the
        // current version, require its verified manifest to identify the file.
        let exactPackage = update.map { $0.sha256 + "-" + $0.filename }
        Self.pruneDownloads(in: cache, olderThan: currentVersion, including: exactPackage)
    }
    nonisolated private static func pruneDownloads(in cache: URL, olderThan version: String, including installedPackage: String? = nil) {
        let fileManager = FileManager.default
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey]
        guard let version = try? ReleaseVersion(version),
              let root = try? cache.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
              root.isDirectory == true, root.isSymbolicLink == false,
              let entries = try? fileManager.contentsOfDirectory(at: cache, includingPropertiesForKeys: Array(keys)) else { return }
        let prefixLength = 64 + "-Equation-Lab-".count
        for file in entries {
            let name = file.lastPathComponent
            guard name.range(of: #"^[a-f0-9]{64}-Equation-Lab-[0-9]+\.[0-9]+\.[0-9]+\.pkg$"#, options: .regularExpression) != nil,
                  let release = try? ReleaseVersion(String(name.dropFirst(prefixLength).dropLast(".pkg".count))),
                  release < version || name == installedPackage,
                  let attributes = try? file.resourceValues(forKeys: keys),
                  attributes.isRegularFile == true, attributes.isSymbolicLink == false else { continue }
            try? fileManager.removeItem(at: file)
        }
    }
    nonisolated static func fetch(_ url: URL, limit: Int64, progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws -> URL {
        guard UpdateNetworkPolicy.allows(url) else { throw UpdateError.invalidManifest }
        let delegate = UpdateTransferDelegate(limit: limit, progress: progress)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 10 * 60
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("EquationLab-Updater", forHTTPHeaderField: "User-Agent")
        let file: URL, response: URLResponse
        do { (file, response) = try await session.download(for: request, delegate: delegate) }
        catch { if delegate.exceededLimit { throw UpdateError.downloadTooLarge }; throw error }
        do {
            guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw UpdateError.http((response as? HTTPURLResponse)?.statusCode ?? 0) }
            let bytes = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
            guard bytes > 0, bytes <= limit else { throw UpdateError.downloadTooLarge }
            try Task.checkCancellation()
            return file
        } catch { try? FileManager.default.removeItem(at: file); throw error }
    }
}
