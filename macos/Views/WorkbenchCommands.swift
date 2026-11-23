import SwiftUI
import AppKit

enum WorkbenchUndoTarget: Equatable {
    case nativeText
    case equation
    case none
}

@MainActor
final class NativeTextInputMonitor: ObservableObject {
    static let shared = NativeTextInputMonitor()
    @Published private(set) var isNativeTextFocused = false

    private var keyWindowObservation: NSKeyValueObservation?
    private var firstResponderObservation: NSKeyValueObservation?
    private var notificationTokens: [NSObjectProtocol] = []

    init(observeApplication: Bool = true) {
        guard observeApplication else { return }
        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            NSWindow.didBecomeKeyNotification,
            NSWindow.didResignKeyNotification,
            NSText.didBeginEditingNotification,
            NSText.didEndEditingNotification,
            NSControl.textDidBeginEditingNotification,
            NSControl.textDidEndEditingNotification
        ]
        notificationTokens = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.refresh() }
            }
        }
        if let app = NSApp {
            keyWindowObservation = app.observe(\.keyWindow, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor in self?.attachToKeyWindow() }
            }
        }
        attachToKeyWindow()
    }

    deinit {
        for token in notificationTokens {
            NotificationCenter.default.removeObserver(token)
        }
    }

    static func isNativeTextInput(_ responder: NSResponder?) -> Bool {
        guard let text = responder as? NSText else { return false }
        return text.isFieldEditor || text.isEditable
    }

    static func routeUndoRedo(
        responder: NSResponder?,
        busy: Bool,
        canPerformEquationAction: Bool
    ) -> WorkbenchUndoTarget {
        if isNativeTextInput(responder) {
            return .nativeText
        }
        return (!busy && canPerformEquationAction) ? .equation : .none
    }

    private func attachToKeyWindow() {
        firstResponderObservation = nil
        if let window = NSApp?.keyWindow {
            firstResponderObservation = window.observe(\.firstResponder, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor in self?.refresh() }
            }
        }
        refresh()
    }

    func refresh() {
        let focused = Self.isNativeTextInput(NSApp?.keyWindow?.firstResponder)
        if isNativeTextFocused != focused {
            isNativeTextFocused = focused
        }
    }
}

struct WorkbenchCommands: Commands {
    @ObservedObject var bridge: DesktopBridge
    @ObservedObject var updater: AppUpdater
    @ObservedObject private var textFocus = NativeTextInputMonitor.shared
    private var wordSessionSaveLabel: String {
        bridge.wordSessionIsInsertion ? "完成并插入" : "更新公式"
    }
    var body: some Commands {
        commandsPart1
        commandsPart2
        commandsPart3
        commandsPart4
    }

    @CommandsBuilder private var commandsPart1: some Commands {
        CommandGroup(after: .appInfo) {
            Button(bridge.t("检查更新…")) { updater.check() }
        }
        CommandGroup(replacing: .newItem) {
            WordInsertionMenu(bridge: bridge)
            Button(bridge.t("新建独立草稿")) { bridge.invoke("nativeNew") }.keyboardShortcut("n").disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
            Button(bridge.t("打开文件副本…")) { bridge.invoke("nativeOpen") }.keyboardShortcut("o").disabled(bridge.wordSessionActive || bridge.state.busy)
        }
        CommandGroup(replacing: .saveItem) {
            Button(bridge.t(bridge.wordSessionActive ? wordSessionSaveLabel : "另存 Word 副本…")) {
                if bridge.wordSessionActive { bridge.invoke("nativeCommitWordSession") }
                else if bridge.state.canSaveEdit { bridge.action("click", ["id": "save-edit"]) }
                else { bridge.invoke("nativeExport") }
            }.keyboardShortcut("s").disabled(!bridge.state.canExport || bridge.state.busy || bridge.wordSessionActive && bridge.state.wordOutcomeUnknown)
            Button(bridge.t("导出 MathType Word…")) { bridge.invoke("nativeExport") }
                .keyboardShortcut("s", modifiers: [.command, .shift]).disabled(!bridge.state.canExport || bridge.state.busy || bridge.wordSessionActive)
        }
        CommandGroup(after: .saveItem) {
            Menu(bridge.t("导出公式图像")) {
                ForEach(["svg", "pdf", "png"], id: \.self) { format in Button(format.uppercased() + "…") { bridge.action("exportGraphic", ["format": format]) }.disabled(!bridge.state.canExport || bridge.state.busy) }
            }
            Divider()
            Button(bridge.t("关闭窗口")) { bridge.editorWindow?.performClose(nil) }.keyboardShortcut("w")
        }
    }

    @MainActor
    private func performUndoRedo(redo: Bool) {
        let responder = NSApp?.keyWindow?.firstResponder
        let canPerform = redo ? bridge.state.canRedo : bridge.state.canUndo
        switch NativeTextInputMonitor.routeUndoRedo(
            responder: responder,
            busy: bridge.state.busy,
            canPerformEquationAction: canPerform
        ) {
        case .nativeText:
            let selector = Selector((redo ? "redo:" : "undo:"))
            if NSApp?.sendAction(selector, to: nil, from: nil) != true {
                if redo { responder?.undoManager?.redo() } else { responder?.undoManager?.undo() }
            }
        case .equation:
            bridge.action("editorCommand", ["command": redo ? "redo" : "undo"])
        case .none:
            break
        }
    }

    @CommandsBuilder private var commandsPart2: some Commands {
        CommandGroup(replacing: .undoRedo) {
            Button(bridge.t(textFocus.isNativeTextFocused ? "撤销" : "撤销公式编辑")) {
                performUndoRedo(redo: false)
            }
            .keyboardShortcut("z")
            .disabled(!textFocus.isNativeTextFocused && (bridge.state.busy || !bridge.state.canUndo))
            Button(bridge.t(textFocus.isNativeTextFocused ? "重做" : "重做公式编辑")) {
                performUndoRedo(redo: true)
            }
            .keyboardShortcut("z", modifiers: [.command, .shift])
            .disabled(!textFocus.isNativeTextFocused && (bridge.state.busy || !bridge.state.canRedo))
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button(bridge.t("复制 LaTeX")) { bridge.action("click", ["id": "copy-latex"]) }
                .disabled(bridge.state.busy || bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button(bridge.t("复制公式图片")) { bridge.action("click", ["id": "copy-png"]) }.disabled(bridge.state.busy || !bridge.state.canExport)
        }
        CommandGroup(after: .sidebar) {
            Button(bridge.t(bridge.showRuler ? "隐藏标尺" : "显示标尺")) { bridge.showRuler.toggle() }.keyboardShortcut("r", modifiers: [.command, .option])
            Button(bridge.t(bridge.showInspector ? "隐藏检查器" : "显示检查器")) { bridge.showInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            Button(bridge.t("数学键盘")) { bridge.action("click", ["id": "keyboard"]) }.disabled(bridge.state.busy)
            Menu(bridge.t("画布缩放")) {
                Button(bridge.t("适合窗口")) { bridge.action("zoom", ["value": 0]) }
                ForEach([50, 75, 100, 125, 150, 200, 250, 300], id: \.self) { zoom in
                    Button("\(zoom)%") { bridge.action("zoom", ["value": zoom]) }
                }
            }
        }
        CommandMenu(bridge.t("插入")) {
            ForEach(bridge.state.categories, id: \.self) { category in
                Menu(bridge.t(category)) {
                    if category == "希腊字母" {
                        ForEach(["lower", "upper"], id: \.self) { kind in
                            Menu(bridge.t(kind == "upper" ? "大写" : "小写")) {
                                ForEach(LetterCatalog.all.filter { $0.family == "greek" && $0.kind == kind }) { letter in
                                    Button("\(letter.symbol)  \(letter.name)") { bridge.action("insertLetter", ["latex": letter.latex]) }.disabled(bridge.state.readOnly)
                                }
                            }
                        }
                        Button(bridge.t("全部字母…")) { bridge.showLetterLibrary = true }
                    } else { ForEach(bridge.state.templates.filter { $0.category == category }) { item in
                        Button(item.hint.isEmpty ? item.label : "\(bridge.t(item.hint))  \(item.label)") { bridge.action("template", ["id": item.id]) }
                            .disabled(bridge.state.readOnly)
                    }
                        Divider()
                        Button(bridge.t(FeatureCatalog.title(category)) + "…") { bridge.action("category", ["name": category]); bridge.showFeatureLibrary = true }
                        if category == "矩阵" { Button(bridge.t("自定义矩阵…")) { bridge.openMatrixBuilder() }.disabled(bridge.state.readOnly) }
                    }
                }
            }
            Button(bridge.t("全部字母…")) { bridge.showLetterLibrary = true }
            Divider()
            Button(bridge.t("收藏当前公式")) { bridge.action("click", ["id": "add-favorite"]) }.disabled(bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bridge.state.busy)
        }
    }

    @CommandsBuilder private var commandsPart3: some Commands {
        CommandMenu(bridge.t("格式")) {
            Button(bridge.t("字体与样式…")) { bridge.inspectorTab = .style; bridge.showInspector = true }
            Button(bridge.t("定义字号…")) { bridge.inspectorTab = .style; bridge.showInspector = true }
            Button(bridge.t("定义间距…")) { bridge.inspectorTab = .spacing; bridge.showInspector = true }
            Divider()
            Button(bridge.t("加载 MathType 偏好文件…")) { bridge.action("preferencesImport") }.disabled(bridge.state.busy)
            Button(bridge.t("保存 MathType 偏好文件…")) { bridge.action("preferencesExport") }.disabled(bridge.state.busy || bridge.state.fonts.isEmpty)
            Divider()
            Button(bridge.t("保留原结构，替换字符")) { bridge.action("click", ["id": "mode-characters"]) }.disabled(bridge.state.selected == nil)
            Button(bridge.t("重新编辑公式结构")) { bridge.action("click", ["id": "mode-rebuild"]) }.disabled(bridge.state.selected == nil)
        }
        CommandMenu(bridge.t("预置")) {
            Button(bridge.t("恢复 MathType 默认")) { bridge.action("click", ["id": "desktop-factory-fonts"]) }.disabled(!bridge.state.canFactoryReset || bridge.state.busy)
            Button(bridge.t("恢复此公式原始设置")) { bridge.action("click", ["id": "desktop-reset-fonts"]) }.disabled(bridge.state.busy)
            Button(bridge.t("设为新公式默认")) { bridge.action("click", ["id": "desktop-default-fonts"]) }.disabled(!bridge.state.valid || bridge.state.busy)
        }
        CommandMenu(bridge.t("样式")) {
            ForEach(bridge.state.fonts) { field in
                Button(bridge.t("定义\(field.label)样式…")) {
                    bridge.fontRole = field.id; bridge.inspectorTab = .style; bridge.showInspector = true
                }
            }
        }
        CommandMenu(bridge.t("大小")) {
            Button(bridge.t("定义标准与额外字号…")) { bridge.inspectorTab = .style; bridge.showInspector = true }
        }
    }

    @CommandsBuilder private var commandsPart4: some Commands {
        CommandMenu("Word") {
            Button(bridge.t("安装 / 管理 Office 插件…")) { bridge.showOfficePlugins = true }
            Divider()
            Button(bridge.t("位置与编号…")) { bridge.inspectorTab = .document; bridge.showInspector = true }
            Button(bridge.t("另存编排后的 Word 副本…")) { bridge.action("click", ["id": "arrange"]) }.disabled(!bridge.state.canArrange || bridge.state.busy)
            Divider()
            Button(bridge.t("安装 / 更新 Word 插件…")) { bridge.installWordPlugin() }.disabled(bridge.installationRunning)
            Button(bridge.t("检查 Word 连接")) { bridge.verifyWordPlugin(showResult: true) }.disabled(bridge.installationRunning)
            Button(bridge.t("移除 Word 插件")) { bridge.uninstallWordPlugin() }.disabled(bridge.installationRunning)
            if bridge.wordSessionActive {
                Divider()
                Button(bridge.t(wordSessionSaveLabel)) {
                    bridge.invoke("nativeCommitWordSession")
                }.disabled(!bridge.state.canExport || bridge.state.busy || bridge.state.wordOutcomeUnknown)
                Button(bridge.t("取消当前 Word 编辑")) { bridge.invoke("nativeCancelWordSession") }.disabled(bridge.state.busy)
            }
        }
        CommandGroup(replacing: .help) {
            Button(bridge.t("搜索命令…")) { bridge.showCommands = true }.keyboardShortcut("k")
            Button(bridge.t("Equation Lab 兼容性说明")) { bridge.showCompatibility = true }
        }
    }
}

struct CommandSearchResults {
    typealias Command = (id: String, title: String, icon: String)

    enum Match {
        case command(String)
        case letter(EquationLetter)
        case template(FormulaTemplate)
        case catalog(CatalogItem)
    }

    let commands: [Command]
    let letters: [EquationLetter]
    let templates: [FormulaTemplate]
    let catalog: [CatalogItem]
    private let query: String

    var isEmpty: Bool { commands.isEmpty && letters.isEmpty && templates.isEmpty && catalog.isEmpty }

    init(query: String, commands: [Command], templates: [FormulaTemplate],
         letters: @autoclosure () -> [EquationLetter], catalog: @autoclosure () -> [CatalogItem],
         localize: (String) -> String) {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        self.query = query
        if query.isEmpty {
            self.commands = commands
            self.templates = templates
            self.letters = []
            self.catalog = []
            return
        }
        func matches(_ content: String) -> Bool { content.localizedCaseInsensitiveContains(query) }
        self.commands = commands.filter { matches("\(localize($0.title)) \($0.title)") }
        self.letters = letters().filter { matches("\($0.name) \($0.symbol) \($0.latex) \($0.unicode)") }
        self.templates = templates.filter { item in
            let title = item.hint.isEmpty ? item.label : item.hint
            return matches("\(localize(item.category)) \(localize(title)) \(item.category) \(item.hint) \(item.label) \(item.latex)")
        }
        self.catalog = catalog().filter { item in
            item.available && matches("\(localize(item.label)) \(localize(item.hint)) \(item.label) \(item.hint) \(item.latex) \(item.originalToken ?? "")")
        }
    }

    func firstEnabledMatch(commandAvailable: (String) -> Bool, letterAvailable: (EquationLetter) -> Bool,
                           canInsertTemplates: Bool) -> Match? {
        guard !query.isEmpty else { return nil }
        // Keep the Return key in the same order as the visible sections.
        if let command = commands.first(where: { commandAvailable($0.id) }) { return .command(command.id) }
        if let letter = letters.first(where: letterAvailable) { return .letter(letter) }
        guard canInsertTemplates else { return nil }
        if let template = templates.first { return .template(template) }
        return catalog.first.map { .catalog($0) }
    }
}

struct CommandSearch: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool
    private var saveCommandLabel: String {
        guard bridge.wordSessionActive else { return "另存 Word 副本…" }
        return bridge.wordSessionIsInsertion ? "完成并插入" : "更新公式"
    }
    private var commands: [CommandSearchResults.Command] {
        [
            ("new", "新建公式", "plus.circle"), ("open", "打开 Word 文档", "folder"),
            ("save", saveCommandLabel, "square.and.arrow.down"),
            ("fonts", "字体、样式与字号", "textformat"), ("spacing", "定义 30 项原生间距", "arrow.left.and.right"),
            ("document", "Word 位置与编号", "doc.text"), ("keyboard", "数学键盘", "keyboard"),
            ("letters", "全部字母", "character.book.closed.fill"),
            ("favorite", "收藏当前公式", "star"), ("copyLatex", "复制 LaTeX", "doc.on.doc"),
            ("copyPNG", "复制公式图片", "photo"), ("office-plugins", "安装 / 管理 Office 插件", "puzzlepiece.extension"), ("install", "安装 / 更新 Word 插件", "puzzlepiece.extension"),
            ("compatibility", "兼容性说明", "info.circle")
        ]
    }
    private func letterAvailable(_ item: EquationLetter) -> Bool {
        !bridge.state.readOnly && item.isAvailable(lowercaseGreekFont: bridge.state.fonts.first { $0.id == "font-4" }?.value ?? "Symbol")
    }
    private func commandAvailable(_ id: String) -> Bool {
        if bridge.state.busy && !["fonts", "spacing", "document", "letters", "compatibility", "office-plugins"].contains(id) { return false }
        return switch id {
        case "new", "open": !bridge.wordSessionActive
        case "save", "copyPNG": bridge.state.canExport && !bridge.state.busy
        case "favorite", "copyLatex": !bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case "install": !bridge.installationRunning
        default: true
        }
    }
    private var searchResults: CommandSearchResults {
        CommandSearchResults(query: query, commands: commands, templates: bridge.state.templates,
                             letters: LetterCatalog.all, catalog: FeatureCatalog.all, localize: bridge.t)
    }
    var body: some View {
        let results = searchResults
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(bridge.t("搜索命令、符号或模板"), text: $query).textFieldStyle(.plain).focused($focused)
                    .onSubmit {
                        if let match = searchResults.firstEnabledMatch(commandAvailable: commandAvailable, letterAvailable: letterAvailable,
                                                                      canInsertTemplates: !bridge.state.readOnly) {
                            execute(match)
                        }
                    }
                Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(18)
            Divider()
            List {
                if !results.commands.isEmpty {
                    Section(bridge.t("命令")) {
                        ForEach(results.commands, id: \.id) { item in
                            Button { execute(.command(item.id)) } label: { Label(bridge.t(item.title), systemImage: item.icon).frame(maxWidth: .infinity, alignment: .leading) }
                                .buttonStyle(WorkbenchButtonStyle()).disabled(!commandAvailable(item.id))
                        }
                    }
                }
                if !results.letters.isEmpty {
                    Section(bridge.t("字母")) {
                        ForEach(results.letters) { item in
                            Button { execute(.letter(item)) } label: {
                                HStack(spacing: 10) {
                                    Text(item.symbol).font(.custom("Times New Roman", size: 20)).frame(width: 24)
                                    Text(item.name + " · " + bridge.t(item.caseName))
                                    Spacer(); Text(item.unicode).font(.caption.monospaced()).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(!letterAvailable(item))
                        }
                    }
                }
                if !results.templates.isEmpty {
                    Section(bridge.t("符号与模板")) {
                        ForEach(results.templates) { item in
                            Button { execute(.template(item)) } label: {
                                HStack { Text(bridge.t(item.hint.isEmpty ? item.label : item.hint)); Spacer(); Text(bridge.t(item.category)).font(.caption).foregroundStyle(.secondary) }
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.readOnly)
                        }
                    }
                }
                if !results.catalog.isEmpty {
                    Section(bridge.t("完整集合")) {
                        ForEach(results.catalog) { item in
                            Button { execute(.catalog(item)) } label: {
                                HStack { TemplateGlyph(item: item.template).frame(width: 52, height: 32); Text(bridge.t(item.hint)); Spacer() }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.readOnly)
                        }
                    }
                }
                if results.isEmpty { Text(bridge.t("没有匹配的现有命令")).foregroundStyle(.secondary) }
            }.listStyle(.inset)
        }.frame(width: 560, height: 480).onAppear { focused = true }
    }
    private func execute(_ match: CommandSearchResults.Match) {
        switch match {
        case .command(let id):
            executeCommand(id)
        case .letter(let item):
            guard letterAvailable(item) else { return }
            bridge.action("insertLetter", ["latex": item.latex])
            dismiss()
        case .template(let item):
            guard !bridge.state.readOnly else { return }
            bridge.action("template", ["id": item.id])
            dismiss()
        case .catalog(let item):
            guard !bridge.state.readOnly else { return }
            bridge.insertCatalogItem(item)
            dismiss()
        }
    }

    private func executeCommand(_ id: String) {
        guard commandAvailable(id) else { return }
        dismiss()
        switch id {
        case "new": bridge.invoke("nativeNew")
        case "open": bridge.invoke("nativeOpen")
        case "save": if bridge.wordSessionActive { bridge.invoke("nativeCommitWordSession") } else if bridge.state.canSaveEdit { bridge.action("click", ["id": "save-edit"]) } else { bridge.invoke("nativeExport") }
        case "fonts": bridge.inspectorTab = .style; bridge.showInspector = true
        case "spacing": bridge.inspectorTab = .spacing; bridge.showInspector = true
        case "document": bridge.inspectorTab = .document; bridge.showInspector = true
        case "keyboard": bridge.action("click", ["id": "keyboard"])
        case "letters": DispatchQueue.main.async { bridge.showLetterLibrary = true }
        case "favorite": bridge.action("click", ["id": "add-favorite"])
        case "copyLatex": bridge.action("click", ["id": "copy-latex"])
        case "copyPNG": bridge.action("click", ["id": "copy-png"])
        case "install": bridge.installWordPlugin()
        case "office-plugins": bridge.showOfficePlugins = true
        default: bridge.showCompatibility = true
        }
    }
}

struct CompatibilitySheet: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Equation Lab", systemImage: "function").font(.title2.bold())
            Text(bridge.t("MathType 兼容预览版") + " " + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""))
                .font(.headline)
            Text(bridge.t("可读取原生 MathType 对象、保留结构替换字符，或重新编辑已支持的公式结构，并另存 Word 副本。字体、字号及已识别的原生间距可保存。"))
            Text(bridge.t("尚未达到原版全部功能：部分模板、精细排版及所有跨平台组合仍需验证；不支持的结构会明确阻止导出。重新编辑结构可能改变局部样式。"))
                .foregroundStyle(.secondary)
            Text(bridge.t("原版默认：Times+Symbol 12；标准字号为 12 pt、58%、42%、150%、100%。已有公式沿用自身原生设置。"))
                .font(.callout)
            Divider()
            Text(bridge.t("建议先用副本验证，并在 Word 与 Windows MathType 中保存、重开后确认可继续编辑。")).font(.callout)
            HStack { Spacer(); Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.defaultAction) }
        }.padding(28).frame(width: 560)
    }
}
