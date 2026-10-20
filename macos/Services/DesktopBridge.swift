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
    @Published var installationMessage = ""
    @Published var installationRunning = false
    @Published var nativeWordStatus = "尚未安装 Word 插件"
    @Published var wordApplicationPath = ""
    @Published var wordApplicationVersion = ""
    @Published var wordOfficeAccessRequired = false
    var wordOfficeAccessURL: URL?
    @Published var wordSessionActive = false
    var lastWordPluginVerification: (date: Date, wordPID: pid_t?)?
    var wordTicket: String?
    private var editorReady = false
    private var wordSessionDelivered = false
    private var wordOpenStarted: CFAbsoluteTime?
    private var pendingWordTickets: [String] = []
    private var deliveringWordTicket: String?
    private var revealEditorWhenAttached = false
    private var wordPresentationGeneration = 0
    private var focusEventSequence = 0
    private func recordWindowEvent(_ event: String, reason: String) {
        focusEventSequence += 1
        EditorLifecycleLog.logger.info("window_event sequence=\(self.focusEventSequence) event=\(event, privacy: .public) reason=\(reason, privacy: .public)")
    }
    private var nativeService: Process?
    private var installedServiceKickstartRequested = false
    var hasWordSessionOrRequest: Bool { wordSessionActive || deliveringWordTicket != nil || !pendingWordTickets.isEmpty }
    func bundledNodeURL() -> URL? {
        guard let path = Bundle.main.object(forInfoDictionaryKey: "EquationLabNode") as? String else { return nil }
        return path.hasPrefix("/") ? URL(fileURLWithPath: path) : Bundle.main.resourceURL?.appendingPathComponent(path)
    }
    func ensureNativeService() {
        let record = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Equation Lab/word-service-install.json")
        if let data = try? Data(contentsOf: record), let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           state["schema"] as? String == "equationlab.word-service-install.v1", state["app"] as? String == Bundle.main.bundlePath {
            // The installed launchd agent owns the native transport. Avoid a
            // redundant kickstart when the app returns to the foreground.
            guard !installedServiceKickstartRequested else { return }
            installedServiceKickstartRequested = true
            DispatchQueue.global(qos: .utility).async {
                let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                process.arguments = ["kickstart", "gui/\(getuid())/app.equationlab.word-service"]
                process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
                do { try process.run(); process.waitUntilExit() } catch {}
            }
            return
        }
        guard nativeService?.isRunning != true else { return }
        nativeService = nil
        // The helper validates and reuses a compatible external native service.
        // It never evicts an occupied port.
        startNativeService()
    }
    private func startNativeService() {
        guard nativeService == nil, let root = Bundle.main.resourceURL?.appendingPathComponent("engine"), let node = bundledNodeURL() else { return }
        let process = Process(); process.executableURL = node; process.arguments = [root.appendingPathComponent("src/app-services.mjs").path]; process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "EQUATIONLAB_HOST_TRACE")
        environment["EQUATIONLAB_NATIVE_PORT"] = "37952"
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        do { try process.run(); nativeService = process }
        catch { nativeWordStatus = "本机服务未能启动：\(error.localizedDescription)" }
    }
    func stopOwnedNativeService() { if nativeService?.isRunning == true { nativeService?.terminate() }; nativeService = nil }
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
        guard deliveringWordTicket != ticket, !pendingWordTickets.contains(ticket) else { return }
        // Only the most recent not-yet-opened selection matters. Release
        // superseded requests instead of replaying every click through Word.
        for obsolete in pendingWordTickets { cancelUndeliveredWordTicket(obsolete) }
        pendingWordTickets = [ticket]
        if editorReady { deliverWordSession() }
    }
    func showEditorWindow(reason: String = "user") {
        revealEditorWhenAttached = true
        guard let editorWindow else { recordWindowEvent("reveal_pending", reason: reason); return }
        revealEditorWhenAttached = false
        guard !editorWindow.isVisible || !editorWindow.isKeyWindow || !NSApp.isActive else { recordWindowEvent("reveal_unchanged", reason: reason); return }
        recordWindowEvent("reveal", reason: reason)
        if editorWindow.isMiniaturized { editorWindow.deminiaturize(nil) }
        editorWindow.makeKeyAndOrderFront(nil)
        if !NSApp.isActive { NSApp.activate() }
    }
    func editorWindowDidAttach() { if revealEditorWhenAttached { showEditorWindow(reason: "window-attached") } }
    private func deliverWordSession() {
        guard editorReady, deliveringWordTicket == nil, !pendingWordTickets.isEmpty, let web = webView else { return }
        let ticket = pendingWordTickets.removeFirst()
        let presentationGeneration = wordPresentationGeneration
        deliveringWordTicket = ticket
        wordOpenStarted = CFAbsoluteTimeGetCurrent()
        recordWindowEvent("word_delivery_begin", reason: "word-activation")
        web.callAsyncJavaScript("return await window.nativeOpenWordSession(ticket)", arguments: ["ticket": ticket], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            self.deliveringWordTicket = nil
            guard presentationGeneration == self.wordPresentationGeneration else {
                self.recordWindowEvent("word_delivery_ignored", reason: "editor-ended")
                self.cancelUndeliveredWordTicket(ticket); self.deliverWordSession(); return
            }
            var reveal = false
            if case .success(let ready) = result, ready as? Bool == true {
                self.wordTicket = ticket; self.wordSessionActive = true; self.wordSessionDelivered = true
                reveal = true
                if let started = self.wordOpenStarted {
                    let elapsed = (CFAbsoluteTimeGetCurrent() - started) * 1000
                    EditorLifecycleLog.logger.info("word_editor_ready ms=\(elapsed, format: .fixed(precision: 1))")
                }
            } else if case .failure(let error) = result {
                // A WebKit failure must release the newly-created Word request.
                // Never cancel the older ticket whose unsaved edits remain open.
                self.cancelUndeliveredWordTicket(ticket)
                self.state.message = "未能打开 Word 公式：\(error.localizedDescription)"; self.state.messageError = true
            }
            self.recordWindowEvent("word_delivery_end", reason: reveal ? "accepted" : "rejected")
            if self.pendingWordTickets.isEmpty && (reveal || self.wordSessionActive) { self.showEditorWindow(reason: "word-delivered") }
            self.deliverWordSession()
        }
    }
    private func cancelUndeliveredWordTicket(_ ticket: String) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:37952/api/native-cancel")!)
        request.httpMethod = "POST"; request.timeoutInterval = 3
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["ticket": ticket])
        URLSession.shared.dataTask(with: request).resume()
    }
    func returnToWord(hideEditor: Bool = true) {
        recordWindowEvent("word_return", reason: hideEditor ? "session-ended" : "handoff")
        let word = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word").first
        if let word, !word.isActive, NSApp.isActive { NSApp.yieldActivation(to: word) }
        if hideEditor { editorWindow?.orderOut(nil) }
        // Retain the window and engine so the next OLE activation is warm.
        if let word {
            if !word.isActive { word.activate(options: []) }
        }
        if hideEditor { EditorLifecycleLog.logger.info("word_editor_hidden") }
        else { EditorLifecycleLog.logger.info("word_navigation_handoff") }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { editorReady = true; (webView as? EquationWKWebView)?.recordLifecycle("loaded"); (webView as? EquationWKWebView)?.syncAppearance(); syncInterfaceLanguage(); deliverWordSession() }
    func invoke(_ function: String, argument: Int? = nil) { webView?.evaluateJavaScript("window.\(function)?.(\(argument.map(String.init) ?? ""))", completionHandler: nil) }
    func prepareToClose(_ completion: @escaping (Bool) -> Void) {
        recordWindowEvent("close_requested", reason: wordSessionActive ? "word-session" : "standalone")
        guard hasWordSessionOrRequest else { completion(true); return }
        guard let webView, editorReady else {
            if !wordSessionActive {
                // No draft was delivered yet. A loading request can be ended
                // without trapping an unresponsive or not-yet-created editor.
                wordPresentationGeneration += 1
                if let ticket = deliveringWordTicket { cancelUndeliveredWordTicket(ticket) }
                for ticket in pendingWordTickets { cancelUndeliveredWordTicket(ticket) }
                pendingWordTickets.removeAll()
                completion(true); return
            }
            state.message = "公式仍在载入，请稍后关闭窗口。"; state.messageError = true; completion(false); return
        }
        webView.callAsyncJavaScript("return await window.nativePrepareToClose()", arguments: [:], in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value):
                let accepted = value as? Bool == true
                self?.recordWindowEvent("close_result", reason: accepted ? "accepted" : "kept-draft")
                completion(accepted)
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
                if active {
                    wordSessionActive = true; wordSessionDelivered = true
                    if let ticket = payload["wordTicket"] as? String { wordTicket = ticket }
                }
                else if payload["wordSessionEnded"] as? Bool == true {
                    let wasActive = wordSessionActive
                    wordPresentationGeneration += 1
                    wordSessionActive = false; wordTicket = nil; wordSessionDelivered = false
                    if wasActive && payload["wordSessionSwitching"] as? Bool != true { returnToWord(hideEditor: payload["wordSessionNavigating"] as? Bool != true) }
                }
            }
            reply(id, ["ok": true, "data": [:]]); return
        }
        if action == "wordSessionWillSave" {
            // The native owner completes in the background. Keep the editor
            // visible until acknowledgement, then return to Word once.
            reply(id, ["ok": true, "data": [:]]); return
        }
        if action == "confirmWordSessionSwitch" {
            showEditorWindow()
            let alert = NSAlert()
            let closing = payload["closing"] as? Bool == true
            alert.messageText = t(closing ? "当前公式尚不能保存" : "当前公式还有未保存的修改")
            alert.informativeText = t(closing ? "可以继续保留当前编辑，或结束本次编辑并返回 Word。保存失败时，请检查 Word 中的公式。" : "继续编辑当前公式，或放弃这些修改并打开刚才双击的公式。")
            alert.addButton(withTitle: t("继续编辑当前公式"))
            alert.addButton(withTitle: t(closing ? "放弃修改并返回 Word" : "放弃修改并打开"))
            let answer: NSApplication.ModalResponse
            answer = alert.runModal()
            reply(id, ["ok": true, "data": ["discard": answer == .alertSecondButtonReturn]]); return
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
}

