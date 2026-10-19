import SwiftUI
import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class DesktopBridge: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var webView: WKWebView?
    weak var editorWindow: NSWindow?
    @Published var state = WorkbenchState() {
        didSet {
            if oldValue.categories != state.categories { scheduleMenuLocalization() }
            if oldValue.valid != state.valid || oldValue.canExport != state.canExport {
                EditorLifecycleLog.logger.info("validation valid=\(self.state.valid, privacy: .public) export_available=\(self.state.canExport, privacy: .public)")
            }
        }
    }
    private let engine = EquationEngine()
    @Published var showLetterLibrary = false
    @Published var showFeatureLibrary = false
    @Published var showMatrixBuilder = false
    var matrixInitialRows = 3
    var matrixInitialColumns = 3
    var matrixBuilderPending = false
    @Published var showRuler = UserDefaults.standard.object(forKey: "showEquationRuler") as? Bool ?? true {
        didSet { UserDefaults.standard.set(showRuler, forKey: "showEquationRuler") }
    }
    @Published var language = InterfaceLanguage(rawValue: UserDefaults.standard.string(forKey: "interfaceLanguage") ?? "system") ?? .system {
        didSet {
            UserDefaults.standard.set(language.rawValue, forKey: "interfaceLanguage")
            syncInterfaceLanguage()
        }
    }
    func t(_ source: String) -> String { language.text(source) }
    private var menuLocalizationPending = false
    private func scheduleMenuLocalization() {
        guard !menuLocalizationPending else { return }
        menuLocalizationPending = true
        // SwiftUI installs standard menu titles after its Commands update.
        // Coalesce those updates, then localize the existing native menu.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
            guard let self else { return }
            self.menuLocalizationPending = false
            if let menu = NSApp.mainMenu { self.language.localizeStandardMenu(menu) }
        }
    }
    private func syncInterfaceLanguage() {
        scheduleMenuLocalization()
        guard editorReady else { return }
        // Update chrome in place. Recreating the web view would discard the
        // current selection, undo history and native Word edit session.
        action("language", ["value": language.usesEnglish ? "en" : "zh-Hans"])
    }
    @Published var showInspector = true {
        didSet {
            if oldValue != showInspector {
                EditorLifecycleLog.logger.info("inspector visible=\(self.showInspector, privacy: .public)")
                DispatchQueue.main.async { [weak self] in
                    // Finish the native pane layout in the same drawing pass;
                    // don't leave stale control regions behind the resized web view.
                    guard let content = self?.editorWindow?.contentView else { return }
                    content.layoutSubtreeIfNeeded()
                    content.displayIfNeeded()
                }
            }
        }
    }
    @Published var inspectorTab = InspectorTab.style
    @Published var fontRole = "font-3"
    @Published var showCommands = false
    @Published var showCompatibility = false
    @Published var showOfficePlugins = false
    @Published var wordTaskPaneInstalled = false
    @Published var wordBackgroundInstalled = false
    @Published var installationMessage = ""
    @Published var installationRunning = false
    @Published var officeServiceStatus = "尚未连接 Word 服务"
    @Published var nativeWordStatus = "尚未安装 Word 插件"
    @Published var wordApplicationPath = ""
    @Published var wordApplicationVersion = ""
    @Published var wordOfficeAccessRequired = false
    var wordOfficeAccessURL: URL?
    @Published var wordSessionActive = false
    var wordTicket: String?
    private var editorReady = false
    private var wordSessionDelivered = false
    private var wordOpenStarted: CFAbsoluteTime?
    private var nativeService: Process?
    private var serviceOutput = Data()
    func bundledNodeURL() -> URL? {
        guard let path = Bundle.main.object(forInfoDictionaryKey: "EquationLabNode") as? String else { return nil }
        return path.hasPrefix("/") ? URL(fileURLWithPath: path) : Bundle.main.resourceURL?.appendingPathComponent(path)
    }
    func ensureNativeService() {
        let record = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Equation Lab/word-service-install.json")
        if let data = try? Data(contentsOf: record), let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           state["schema"] as? String == "equationlab.word-service-install.v1", state["app"] as? String == Bundle.main.bundlePath {
            // The installed launchd agent owns both listeners. Starting another
            // app-owned child here can race bootstrap and break exit behavior.
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                process.arguments = ["kickstart", "gui/\(getuid())/app.equationlab.word-service"]
                process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
                do { try process.run(); process.waitUntilExit() } catch {}
                DispatchQueue.main.async { self?.refreshOfficePluginStatus() }
            }
            return
        }
        guard nativeService?.isRunning != true else { return }
        nativeService = nil
        // The helper validates and reuses a compatible external native service,
        // then independently starts HTTPS. It never evicts an occupied port.
        startNativeService()
    }
    private func startNativeService() {
        guard nativeService == nil, let root = Bundle.main.resourceURL?.appendingPathComponent("engine"), let node = bundledNodeURL() else { return }
        let process = Process(); process.executableURL = node; process.arguments = [root.appendingPathComponent("src/app-services.mjs").path]; process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "MATHTYPE_BRIDGE_PORT")
        for key in ["EQUATIONLAB_TLS_CERT", "EQUATIONLAB_TLS_KEY", "EQUATIONLAB_HOST_TRACE"] { environment.removeValue(forKey: key) }; process.environment = environment
        let output = Pipe(), errors = Pipe()
        process.standardOutput = output; process.standardError = errors
        serviceOutput.removeAll(keepingCapacity: true)
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.receiveServiceStatus(data) }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                if let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                    self?.officeServiceStatus = String(message.prefix(240))
                }
            }
        }
        do { try process.run(); nativeService = process }
        catch { officeServiceStatus = "本机服务未能启动：\(error.localizedDescription)" }
    }
    private func receiveServiceStatus(_ data: Data) {
        serviceOutput.append(data)
        // This protocol contains service readiness only, never Word session data.
        if serviceOutput.count > 65536 { serviceOutput.removeAll(); return }
        while let lineEnd = serviceOutput.firstIndex(of: 10) {
            let line = serviceOutput[..<lineEnd]
            serviceOutput.removeSubrange(...lineEnd)
            guard let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any], value["app"] as? String == "Equation Lab" else { continue }
            switch value["office"] as? String {
            case "ready": officeServiceStatus = "Word 插件服务已就绪"
            case "not-installed": officeServiceStatus = "尚未安装 Word 插件"
            case "certificate-invalid": officeServiceStatus = "本机证书无效，请重新安装插件"
            case "port-occupied": officeServiceStatus = "Word 服务端口被占用，请关闭旧版后重试"
            case "unavailable": officeServiceStatus = "Word 服务暂不可用"
            default: break
            }
        }
    }
    func stopOwnedNativeService() { if nativeService?.isRunning == true { nativeService?.terminate() }; nativeService = nil }
    func refreshOfficePluginStatus() {
        let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Equation Lab")
        wordTaskPaneInstalled = FileManager.default.fileExists(atPath: support.appendingPathComponent("word-plugin-install.json").path)
        wordBackgroundInstalled = FileManager.default.fileExists(atPath: support.appendingPathComponent("word-service-install.json").path)
        guard wordTaskPaneInstalled else { officeServiceStatus = "尚未安装 Word 顶栏与侧栏"; return }
        var request = URLRequest(url: URL(string: "https://localhost:37951/api/health")!)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let health = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let ready = (response as? HTTPURLResponse)?.statusCode == 200 && health?["app"] as? String == "Equation Lab" && health?["tls"] as? Bool == true && health?["version"] as? String == Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            DispatchQueue.main.async {
                guard let self else { return }
                self.officeServiceStatus = ready ? (self.wordBackgroundInstalled ? "Word 顶栏后台服务已就绪" : "顶栏服务已就绪；更新插件后可关闭 App 使用") : "Word 顶栏服务未连接，请安装或修复"
            }
        }.resume()
    }
    func restartOwnedNativeService() {
        guard let process = nativeService else { ensureNativeService(); return }
        nativeService = nil
        if process.isRunning { process.terminate() }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            process.waitUntilExit()
            DispatchQueue.main.async { self?.startNativeService() }
        }
    }
    func openWordURL(_ url: URL) {
        if url.scheme == "equationlab", url.host == "word-tool", url.query == nil, url.fragment == nil {
            switch String(url.path.dropFirst()) {
            case "editor": break
            case "typography": inspectorTab = .style; showInspector = true
            case "spacing": inspectorTab = .spacing; showInspector = true
            case "export": showInspector = true; inspectorTab = .document
            case "help", "capabilities": showCompatibility = true
            default: return
            }
            ensureNativeService(); showEditorWindow(); return
        }
        if url.scheme == "equationlab", url.host == "wake", url.path.isEmpty, url.query == nil, url.fragment == nil { ensureNativeService(); return }
        guard url.scheme == "equationlab", url.host == "word-edit", url.query == nil, url.fragment == nil else { return }
        let ticket = String(url.path.dropFirst())
        guard ticket.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return }
        guard wordTicket == nil || wordTicket == ticket else { return }
        if wordTicket == ticket { return }
        wordOpenStarted = CFAbsoluteTimeGetCurrent()
        wordTicket = ticket; wordSessionActive = true; wordSessionDelivered = false
        if editorReady { deliverWordSession() }
    }
    private func showEditorWindow() { editorWindow?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    private func deliverWordSession() {
        guard !wordSessionDelivered, let ticket = wordTicket, let web = webView else { return }
        wordSessionDelivered = true
        web.callAsyncJavaScript("return await window.nativeOpenWordSession(ticket)", arguments: ["ticket": ticket], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let ready) = result, ready as? Bool == true {
                if let started = self.wordOpenStarted {
                    let elapsed = (CFAbsoluteTimeGetCurrent() - started) * 1000
                    EditorLifecycleLog.logger.info("word_editor_ready ms=\(elapsed, format: .fixed(precision: 1))")
                }
            } else { self.wordSessionDelivered = false }
            self.showEditorWindow()
        }
    }
    func returnToWord(hideEditor: Bool = true) {
        if hideEditor { editorWindow?.orderOut(nil) }
        // Retain the window and engine so the next OLE activation is warm.
        if let word = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").first {
            word.activate(options: [])
        }
        if hideEditor { EditorLifecycleLog.logger.info("word_editor_hidden") }
        else { EditorLifecycleLog.logger.info("word_navigation_handoff") }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { editorReady = true; (webView as? EquationWKWebView)?.recordLifecycle("loaded"); (webView as? EquationWKWebView)?.syncAppearance(); syncInterfaceLanguage(); deliverWordSession() }
    func invoke(_ function: String, argument: Int? = nil) { webView?.evaluateJavaScript("window.\(function)?.(\(argument.map(String.init) ?? ""))", completionHandler: nil) }
    func prepareToClose(_ completion: @escaping (Bool) -> Void) {
        guard let webView, editorReady, wordSessionDelivered else {
            state.message = "公式仍在载入，请稍后关闭窗口。"; state.messageError = true; completion(false); return
        }
        webView.callAsyncJavaScript("return await window.nativePrepareToClose()", arguments: [:], in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value): completion(value as? Bool == true)
            case .failure(let error):
                self?.state.message = "保存未完成：\(error.localizedDescription)"; self?.state.messageError = true; completion(false)
            }
        }
    }
    func action(_ action: String, _ payload: [String: Any] = [:]) {
        if action == "category", let name = payload["name"] as? String, state.categories.contains(name) { state.activeCategory = name }
        let start = DispatchTime.now().uptimeNanoseconds
        webView?.callAsyncJavaScript("return await window.workbenchAction(action, payload)", arguments: ["action": action, "payload": payload], in: nil, in: .page) { [weak self] result in
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
            EditorLifecycleLog.logger.info("interaction action=\(action, privacy: .public) editor_ms=\(elapsed, format: .fixed(precision: 2))")
            if case .failure(let error) = result { self?.state.message = error.localizedDescription; self?.state.messageError = true }
        }
    }
    func previewNumbering(_ pattern: String, chapter: Int, section: Int, equation: Int, completion: @escaping (String?) -> Void) {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("engine"), let node = bundledNodeURL() else { completion(nil); return }
        engine.request(id: UUID().uuidString, action: "numberingPreview", payload: ["pattern": pattern, "values": ["chapter": chapter, "section": section, "equation": equation]], node: node, root: root) { result in
            DispatchQueue.main.async { completion((result["data"] as? [String: Any])?["text"] as? String) }
        }
    }
    func fieldBinding(_ id: String, fallback: String) -> Binding<String> {
        Binding(get: { [weak self] in
            guard let self else { return fallback }
            return (self.state.fonts + self.state.sizes + self.state.extraSizes + self.state.spaces + self.state.layout).first { $0.id == id }?.value ?? fallback
        }, set: { [weak self] value in
            guard let self else { return }
            if let i = self.state.fonts.firstIndex(where: { $0.id == id }) { self.state.fonts[i].value = value }
            if let i = self.state.sizes.firstIndex(where: { $0.id == id }) { self.state.sizes[i].value = value }
            if let i = self.state.extraSizes.firstIndex(where: { $0.id == id }) { self.state.extraSizes[i].value = value }
            if let i = self.state.spaces.firstIndex(where: { $0.id == id }) { self.state.spaces[i].value = value }
            if let i = self.state.layout.firstIndex(where: { $0.id == id }) { self.state.layout[i].value = value }
            self.action("field", ["id": id, "value": value])
        })
    }
    func reply(_ id: String, _ result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["id": id, "result": result]), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.nativeReply(\(json))") { _, error in
            if let error { EditorLifecycleLog.logger.error("reply failed \(error.localizedDescription, privacy: .public)") }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        if action == "editorMenu" {
            if let payload = body["payload"] as? [String: Any], let matrix = payload["matrix"] as? [String: Int], let rows = matrix["rows"], let columns = matrix["columns"] { state.matrix = MatrixContext(rows: rows, columns: columns) }
            else { state.matrix = nil }
            let payload = body["payload"] as? [String: Any]
            let point: NSPoint? = (payload?["x"] as? Double).flatMap { x in (payload?["y"] as? Double).map { NSPoint(x: x, y: $0) } }
            showEditorMenu(atWebPoint: point); return
        }
        if action == "workbenchError" {
            state.message = "工作台状态读取失败：" + ((body["payload"] as? [String: Any])?["error"] as? String ?? "未知错误")
            state.messageError = true
            return
        }
        if action == "workbenchState" {
            guard let payload = body["payload"] as? [String: Any] else { return }
            do { var next = state; try next.apply(payload); state = next }
            catch { state.message = "工作台状态读取失败：\(error.localizedDescription)"; state.messageError = true }
            return
        }
        guard let id = body["id"] as? String else { return }
        var payload = body["payload"] as? [String: Any] ?? [:]
        if action == "state" {
            if let active = payload["wordSession"] as? Bool {
                if active { wordSessionActive = true }
                else if payload["wordSessionEnded"] as? Bool == true {
                    let wasActive = wordSessionActive
                    wordSessionActive = false; wordTicket = nil; wordSessionDelivered = false
                    if wasActive { returnToWord(hideEditor: payload["wordSessionNavigating"] as? Bool != true) }
                }
            }
            reply(id, ["ok": true, "data": [:]]); return
        }
        if action == "open" {
            let panel = NSOpenPanel(); panel.allowedContentTypes = [UTType(filenameExtension: "docx")!]; panel.allowsMultipleSelection = false
            panel.message = t("打开含旧 MathType 公式的 .docx 文档，原文件会保留。")
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, ["ok": false, "cancelled": true]); return }
            payload["path"] = url.path
            run(id, action: "inspect", payload: payload); return
        }
        if action == "preferencesImport" {
            let panel = NSOpenPanel(); panel.allowedContentTypes = [UTType(filenameExtension: "eqp") ?? .plainText]; panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, ["ok": false, "cancelled": true]); return }
            payload["path"] = url.path
        }
        if action == "preferencesExport" || action == "exportGraphic" {
            let ext = action == "preferencesExport" ? "eqp" : payload["format"] as? String ?? "svg"
            guard ["eqp", "svg", "png", "pdf"].contains(ext) else { reply(id, ["ok": false, "error": "未知格式"]); return }
            let panel = NSSavePanel(); panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]; panel.nameFieldStringValue = "Equation Lab.\(ext)"
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, ["ok": false, "cancelled": true]); return }
            payload["output"] = url.path
        }
        if action == "export" || action == "edit" || action == "arrange" {
            let panel = NSSavePanel(); panel.allowedContentTypes = [UTType(filenameExtension: "docx")!]
            panel.nameFieldStringValue = language.usesEnglish ? (action == "export" ? "MathType equation.docx" : action == "arrange" ? "Equations arranged-copy.docx" : "Equations edited-copy.docx") : (action == "export" ? "MathType原生公式.docx" : action == "arrange" ? "公式已编排-副本.docx" : "公式已编辑-副本.docx")
            panel.message = t("保存含原生 MathType 对象的 Word 文档")
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, ["ok": false, "cancelled": true]); return }
            payload["output"] = url.path
        }
        if action == "copyLatex" {
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(payload["latex"] as? String ?? "", forType: .string)
            reply(id, ["ok": true, "data": ["copied": true]]); return
        }
        if action == "copyPNG" {
            run(id, action: "preview", payload: payload, copyPNG: true); return
        }
        run(id, action: action, payload: payload)
    }
    private func run(_ id: String, action: String, payload: [String: Any], copyPNG: Bool = false) {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("engine"),
              let node = bundledNodeURL() else { reply(id, ["ok": false, "error": "找不到本地公式引擎"]); return }
        engine.request(id: id, action: action, payload: payload, node: node, root: root) { [weak self] result in
            DispatchQueue.main.async {
                if copyPNG, let data = result["data"] as? [String: Any], let png = data["png"] as? String, let bytes = Data(base64Encoded: png) {
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setData(bytes, forType: .png)
                    self?.reply(id, ["ok": true, "data": ["copied": true]])
                } else { self?.reply(id, result) }
            }
        }
    }
    func stopEngine() { engine.stop() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.request.url?.isFileURL == true { decisionHandler(.allow) } else { decisionHandler(.cancel) }
    }
    func installWordTaskPane() {
        guard !installationRunning else { return }
        guard let node = bundledNodeURL(), let root = Bundle.main.resourceURL else { installationMessage = "找不到安装器所需的本地运行环境。"; return }
        let installer = root.appendingPathComponent("installer/install-word-plugin.mjs")
        guard FileManager.default.fileExists(atPath: installer.path) else { installationMessage = "此构建未包含 Word 插件安装器。请使用完整安装包。"; return }
        let alert = NSAlert()
        alert.messageText = "安装 Word 顶栏与侧栏"
        alert.informativeText = "会安装 Word 功能区、侧栏和本机后台服务。关闭 Equation Lab 后仍可使用 Word 按钮；服务会在登录时启动。首次安装会请求信任仅用于 localhost 的证书。完成后请重开 Word，并从“开始 → 加载项”选择 Equation Lab。"
        alert.addButton(withTitle: "安装"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let panel = NSOpenPanel()
        panel.title = "Word 顶栏与侧栏"
        panel.message = "选择 Word 的 Documents 文件夹。若位置未打开，按 ⌘⇧G 并粘贴下方路径。"
        panel.prompt = "安装到此文件夹"
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = false
        let wordDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.microsoft.Word/Data/Documents", isDirectory: true)
        panel.directoryURL = wordDirectory
        let pathLabel = NSTextField(wrappingLabelWithString: wordDirectory.path)
        pathLabel.isSelectable = true
        pathLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        pathLabel.textColor = .secondaryLabelColor
        pathLabel.frame = NSRect(x: 0, y: 0, width: 620, height: 36)
        panel.accessoryView = pathLabel
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        installationRunning = true
        let previousService = nativeService
        stopOwnedNativeService()
        let appPath = Bundle.main.bundlePath
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            previousService?.waitUntilExit()
            let process = Process(); process.executableURL = node
            process.arguments = [installer.path, "--app", appPath, "--wef-directory", directory.path]
            let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
            var success = false, message = ""
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
                let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                success = result?["ok"] as? Bool == true
                message = success ? "Word 顶栏、侧栏和后台服务已安装。请完全退出并重新打开 Word，从“开始 → 加载项”选择 Equation Lab。以后关闭 App 也可使用按钮。" : result?["error"] as? String ?? "安装器未返回有效结果。"
            } catch { message = error.localizedDescription }
            DispatchQueue.main.async {
                self?.installationRunning = false; self?.installationMessage = message
                self?.ensureNativeService()
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self?.refreshOfficePluginStatus() }
            }
        }
    }

    func uninstallWordTaskPane() {
        guard !installationRunning, let node = bundledNodeURL(), let resources = Bundle.main.resourceURL else { return }
        let panel = NSOpenPanel(); panel.title = "移除 Word 顶栏与侧栏"
        panel.message = "确认 Word 的 Documents 文件夹，以移除 Equation Lab 加载项和后台服务。"
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Containers/com.microsoft.Word/Data/Documents")
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        installationRunning = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let process = Process(); process.executableURL = node
            process.arguments = [resources.appendingPathComponent("installer/install-word-plugin.mjs").path, "--remove", "--wef-directory", directory.path]
            let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
            let message: String
            do {
                try process.run(); let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
                let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                message = result?["ok"] as? Bool == true ? "Word 顶栏、侧栏和后台服务已移除。重开 Word 后生效。" : result?["error"] as? String ?? "移除未完成。"
            } catch { message = error.localizedDescription }
            DispatchQueue.main.async {
                self?.installationRunning = false; self?.installationMessage = message
                self?.ensureNativeService(); self?.refreshOfficePluginStatus()
            }
        }
    }
}

