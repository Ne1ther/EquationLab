import AppKit
import Foundation

extension DesktopBridge {
    private var nativeInstallerURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("installer/word-native-installer.mjs")
    }
    private var nativeArtifactURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("native-word-artifacts")
    }

    func installWordPlugin() {
        restoreWordOfficeAccess()
        guard refreshWordApplication() else {
            installationMessage = "没有找到桌面版 Microsoft Word。请先安装 Word，或在插件窗口中选择 Word 应用。"
            return
        }
        let record = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Equation Lab/word-native/current.json")
        if let bytes = try? Data(contentsOf: record),
           let state = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
           state["schema"] as? String == "equationlab.word-native-installation.v1",
           state["scope"] as? String == "user", state["installed"] as? Bool == true {
            updateExistingWordPlugin()
            return
        }
        openWordPackage(removing: false)
    }

    private func updateExistingWordPlugin() {
        guard !installationRunning else { return }
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").isEmpty else {
            installationMessage = "请先保存文档并完全退出 Word，再更新插件。"
            return
        }
        guard let node = bundledNodeURL(), let script = Bundle.main.resourceURL?
            .appendingPathComponent("installer/word-native-installer/automatic-install.mjs") else { return }
        installationRunning = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var message: String
            var succeeded = false
            do {
                let process = Process(), output = Pipe(), errors = Pipe()
                process.executableURL = node
                process.arguments = [script.path, "--update-existing"]
                process.standardOutput = output
                process.standardError = errors
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let errorData = errors.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                succeeded = process.terminationStatus == 0 && result?["ok"] as? Bool == true
                message = succeeded ? "Word 插件已更新。重新打开 Word 即可使用固定顶栏。"
                    : String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Word 插件自动更新未完成。"
            } catch { message = error.localizedDescription }
            let accessDenied = !succeeded && (message.contains("operation not permitted") || message.contains("permission denied"))
            let completedMessage = accessDenied
                ? "macOS 尚未允许访问 Word 文件夹。请点击“允许访问 Word 文件夹”，在系统文件窗口中确认已定位的 Office 文件夹，然后重试。" : message
            let completedSuccess = succeeded
            DispatchQueue.main.async {
                guard let self else { return }
                self.installationRunning = false
                if accessDenied {
                    self.wordOfficeAccessRequired = true
                }
                self.nativeWordStatus = completedSuccess || accessDenied ? completedMessage : "Word 插件自动更新未完成。"
                self.installationMessage = completedMessage
            }
        }
    }

    func uninstallWordPlugin() {
        openWordPackage(removing: true)
    }

    private func openWordPackage(removing: Bool) {
        guard !installationRunning else { return }
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").isEmpty else {
            installationMessage = "请先保存文档并完全退出 Word，再\(removing ? "移除" : "安装或更新")插件。"
            return
        }
        let name = removing ? "EquationLab-Word-Uninstall.pkg" : "EquationLab-Word-Plugin.pkg"
        guard let resources = Bundle.main.resourceURL, let node = bundledNodeURL(), let artifacts = nativeArtifactURL else {
            installationMessage = "此构建未包含 Word 插件安装器。"
            return
        }
        let builder = resources.appendingPathComponent("installer/word-native-installer/build-automatic-pkg.mjs")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.4.8"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "dev"
        let app = Bundle.main.bundleURL
        let output = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EquationLab/word-packages/\(version)-\(build)/\(removing ? "remove" : "install")")
        installationRunning = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var failure: String?
            let package = output.appendingPathComponent(name)
            do {
                if !FileManager.default.fileExists(atPath: package.path) {
                    let staging = output.appendingPathComponent("preparing-\(UUID().uuidString)")
                    defer { try? FileManager.default.removeItem(at: staging) }
                    let process = Process(), input = Pipe(), stdout = Pipe()
                    process.executableURL = node; process.arguments = [builder.path]
                    process.standardInput = input; process.standardOutput = stdout; process.standardError = FileHandle.nullDevice
                    let request: [String: Any] = ["app": app.path, "artifacts": artifacts.path, "output": staging.path,
                        "version": version, "kind": removing ? "remove" : "word"]
                    try process.run()
                    try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: request))
                    try input.fileHandleForWriting.close()
                    let data = stdout.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
                    let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    guard process.terminationStatus == 0, result?["ok"] as? Bool == true else {
                        throw NSError(domain: "EquationLab.WordPackage", code: 1, userInfo: [NSLocalizedDescriptionKey:
                            result?["error"] as? String ?? "未能准备 Word 插件安装器。"])
                    }
                    try FileManager.default.moveItem(at: staging.appendingPathComponent(name), to: package)
                }
            } catch { failure = error.localizedDescription }
            let completedFailure = failure
            DispatchQueue.main.async {
                guard let self else { return }
                self.installationRunning = false
                if let completedFailure { self.installationMessage = completedFailure }
                else if !NSWorkspace.shared.open(package) { self.installationMessage = "未能打开 macOS 安装器。" }
            }
        }
    }

    func installWordPluginManually() {
        guard !installationRunning else { return }
        guard refreshWordApplication() else {
            installationMessage = "没有找到桌面版 Microsoft Word。请先安装 Word，或在插件窗口中选择 Word 应用。"
            return
        }
        guard let artifacts = nativeArtifactURL,
              FileManager.default.fileExists(atPath: artifacts.appendingPathComponent("artifact-manifest.json").path) else {
            installationMessage = "此构建未包含已验收的 Word 自动启动组件。请使用完整安装包。"
            return
        }
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").isEmpty else {
            installationMessage = "请先保存文档并完全退出 Word，再安装插件。"
            return
        }
        let panel = NSOpenPanel()
        panel.title = "Word 插件"
        panel.message = "选择 Word 使用的 Startup 文件夹。"
        panel.prompt = "安装到此文件夹"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.showsHiddenFiles = true
        let stateURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Equation Lab/word-native/current.json")
        let state = (try? Data(contentsOf: stateURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if let previous = state?["startupDirectory"] as? String {
            panel.directoryURL = URL(fileURLWithPath: previous, isDirectory: true)
        } else {
            panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Group Containers/UBF8T346G9.Office/User Content.localized/Startup.localized/Word", isDirectory: true)
        }
        guard panel.runModal() == .OK, let startup = panel.url else { return }
        // The user chooses the destination once. The installer binds its plan
        // to the exact artifacts and target before committing the transaction.
        let request: [String: Any] = [
            "schema": "equationlab.word-plugin-request.v1", "action": "plan",
            "installationScope": "user", "artifactManifestDirectory": artifacts.path,
            "startupDirectory": startup.path, "startupDirectoryConfirmed": true
        ]
        performNativeInstallation(request, installAfterPlan: true)
    }

    func verifyWordPlugin(showResult: Bool = false) {
        guard !installationRunning else { return }
        restoreWordOfficeAccess()
        guard refreshWordApplication() else {
            nativeWordStatus = "没有找到桌面版 Microsoft Word。请安装 Word，或选择它的实际位置。"
            if showResult { installationMessage = nativeWordStatus }
            return
        }
        performNativeInstallation([
            "schema": "equationlab.word-plugin-request.v1", "action": "verify", "installationScope": "user"
        ], showResult: showResult)
    }

    func uninstallWordPluginManually() {
        guard !installationRunning else { return }
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").isEmpty else {
            installationMessage = "请先保存文档并完全退出 Word，再移除插件。"
            return
        }
        performNativeInstallation([
            "schema": "equationlab.word-plugin-request.v1", "action": "uninstall", "installationScope": "user"
        ], showResult: true)
    }

    private func performNativeInstallation(_ request: [String: Any], installAfterPlan: Bool = false, showResult: Bool = true) {
        guard let node = bundledNodeURL(), let installer = nativeInstallerURL,
              FileManager.default.fileExists(atPath: installer.path) else {
            if showResult { installationMessage = "此构建未包含 Word 插件安装器。" }
            return
        }
        installationRunning = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var result: [String: Any]
            do {
                result = try Self.runNativeInstaller(node: node, installer: installer, request: request)
                if installAfterPlan, result["ok"] as? Bool == true {
                    if let conflicts = result["conflicts"] as? [[String: Any]], !conflicts.isEmpty {
                        throw NSError(domain: "EquationLab.WordPlugin", code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Startup 中存在同名组件冲突，现有文件未修改。"])
                    }
                    guard let digest = result["planDigest"] as? String else {
                        throw NSError(domain: "EquationLab.WordPlugin", code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "安装计划未返回有效校验值。"])
                    }
                    var commit = request
                    commit["action"] = "install"
                    commit["approvedPlanDigest"] = digest
                    result = try Self.runNativeInstaller(node: node, installer: installer, request: commit)
                }
            } catch { result = ["ok": false, "error": error.localizedDescription] }
            let completed = result
            DispatchQueue.main.async {
                guard let self else { return }
                self.installationRunning = false
                let success = completed["ok"] as? Bool == true
                let phase = completed["phase"] as? String ?? "failed"
                let errorCode = (completed["error"] as? [String: Any])?["code"] as? String
                self.wordOfficeAccessRequired = ["WORD_SETTINGS_ACCESS_DENIED", "WORD_STARTUP_ACCESS_DENIED"].contains(errorCode ?? "")
                let expectedVersion = self.nativeArtifactURL?
                    .appendingPathComponent("artifact-manifest.json")
                let expected = expectedVersion.flatMap { try? Data(contentsOf: $0) }
                    .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["nativeVersion"] as? String
                let installedVersion = (completed["installedFiles"] as? [[String: Any]])?.first?["version"] as? String
                let message: String
                if !success {
                    message = self.wordOfficeAccessRequired
                        ? "macOS 尚未允许访问 Word 文件夹。请点击“允许访问 Word 文件夹”，在系统文件窗口中确认已定位的 Office 文件夹，然后重试。"
                        : (completed["error"] as? [String: Any])?["message"] as? String
                        ?? completed["error"] as? String ?? "Word 插件操作未完成。"
                } else if let expected, let installedVersion, expected != installedVersion {
                    message = "当前 Word 插件需要更新。点击“安装 / 更新 Word 插件”即可自动完成。"
                } else {
                    switch phase {
                    case "native-registered": message = "Word 插件已连接，可双击公式继续编辑。"
                    case "startup-path-mismatch": message = "Word 的启动目录已更改。请完全退出 Word，再点击“安装 / 更新 Word 插件”，会自动修复安装位置。"
                    case "awaiting-word-restart": message = "插件已安装。重新打开 Word 后会自动连接。"
                    case "removed": message = "Word 插件已移除。"
                    case "rolled-back": message = "已恢复安装前的 Word 组件。"
                    case "not-installed": message = "尚未安装 Word 插件。"
                    default: message = "Word 插件操作已完成。"
                    }
                }
                self.nativeWordStatus = success || self.wordOfficeAccessRequired ? message : "未能确认 Word 插件连接。"
                if showResult { self.installationMessage = message }
            }
        }
    }

    nonisolated private static func runNativeInstaller(node: URL, installer: URL, request: [String: Any]) throws -> [String: Any] {
        let process = Process()
        process.executableURL = node
        process.arguments = [installer.path]
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: request))
        try input.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "EquationLab.WordPlugin", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Word 插件安装器未返回有效结果。"])
        }
        return result
    }
}
