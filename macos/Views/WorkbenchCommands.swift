import SwiftUI

struct WorkbenchCommands: Commands {
    @ObservedObject var bridge: DesktopBridge
    @ObservedObject var updater: AppUpdater
    private var wordSessionSaveLabel: String {
        bridge.wordSessionIsInsertion ? "完成并插入" : "更新公式"
    }
    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button(bridge.t("检查更新…")) { updater.check() }
        }
        CommandGroup(replacing: .newItem) {
            Button(bridge.t("新建公式")) { bridge.invoke("nativeNew") }.keyboardShortcut("n").disabled(bridge.wordSessionActive || bridge.state.busy)
            Button(bridge.t("打开 Word 文档…")) { bridge.invoke("nativeOpen") }.keyboardShortcut("o").disabled(bridge.wordSessionActive || bridge.state.busy)
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
        CommandGroup(replacing: .undoRedo) {
            Button(bridge.t("撤销公式编辑")) { bridge.action("click", ["id": "undo"]) }.keyboardShortcut("z").disabled(bridge.state.busy || bridge.state.readOnly)
            Button(bridge.t("重做公式编辑")) { bridge.action("click", ["id": "redo"]) }.keyboardShortcut("z", modifiers: [.command, .shift]).disabled(bridge.state.busy || bridge.state.readOnly)
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

struct CommandSearch: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool
    private var saveCommandLabel: String {
        guard bridge.wordSessionActive else { return "另存 Word 副本…" }
        return bridge.wordSessionIsInsertion ? "完成并插入" : "更新公式"
    }
    private var commands: [(String, String, String)] {
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
    private var matchingCommands: [(String, String, String)] { commands.filter { query.isEmpty || ("\(bridge.t($0.1)) \($0.1)").localizedCaseInsensitiveContains(query) } }
    private var matchingTemplates: [FormulaTemplate] {
        bridge.state.templates.filter { query.isEmpty || "\(bridge.t($0.category)) \(bridge.t($0.hint)) \($0.label) \($0.latex)".localizedCaseInsensitiveContains(query) }
    }
    private var matchingLetters: [EquationLetter] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return LetterCatalog.all.filter { "\($0.name) \($0.symbol) \($0.latex) \($0.unicode)".localizedCaseInsensitiveContains(query) }
    }
    private var matchingCatalog: [CatalogItem] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return FeatureCatalog.all.filter { $0.available && "\($0.label) \($0.hint) \($0.latex) \($0.originalToken ?? "")".localizedCaseInsensitiveContains(query) }
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
    private func insert(_ item: EquationLetter) {
        guard letterAvailable(item) else { return }
        bridge.action("insertLetter", ["latex": item.latex]); dismiss()
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(bridge.t("搜索命令、符号或模板"), text: $query).textFieldStyle(.plain).focused($focused)
                    .onSubmit {
                        if let first = matchingCommands.first(where: { commandAvailable($0.0) }) { execute(first.0) }
                        else if let first = matchingLetters.first(where: letterAvailable) { insert(first) }
                        else if let first = matchingCatalog.first, !bridge.state.readOnly { bridge.insertCatalogItem(first); dismiss() }
                        else if let first = matchingTemplates.first, !bridge.state.readOnly { bridge.action("template", ["id": first.id]); dismiss() }
                    }
                Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(18)
            Divider()
            List {
                if !matchingCommands.isEmpty {
                    Section(bridge.t("命令")) {
                        ForEach(matchingCommands, id: \.0) { item in
                            Button { execute(item.0) } label: { Label(bridge.t(item.1), systemImage: item.2).frame(maxWidth: .infinity, alignment: .leading) }
                                .buttonStyle(WorkbenchButtonStyle()).disabled(!commandAvailable(item.0))
                        }
                    }
                }
                if !matchingLetters.isEmpty {
                    Section(bridge.t("字母")) {
                        ForEach(matchingLetters) { item in
                            Button { insert(item) } label: {
                                HStack(spacing: 10) {
                                    Text(item.symbol).font(.custom("Times New Roman", size: 20)).frame(width: 24)
                                    Text(item.name + " · " + bridge.t(item.caseName))
                                    Spacer(); Text(item.unicode).font(.caption.monospaced()).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(!letterAvailable(item))
                        }
                    }
                }
                if !matchingTemplates.isEmpty {
                    Section(bridge.t("符号与模板")) {
                        ForEach(matchingTemplates) { item in
                            Button { bridge.action("template", ["id": item.id]); dismiss() } label: {
                                HStack { Text(bridge.t(item.hint.isEmpty ? item.label : item.hint)); Spacer(); Text(bridge.t(item.category)).font(.caption).foregroundStyle(.secondary) }
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.readOnly)
                        }
                    }
                }
                if !matchingCatalog.isEmpty {
                    Section(bridge.t("完整集合")) {
                        ForEach(matchingCatalog) { item in
                            Button { bridge.insertCatalogItem(item); dismiss() } label: {
                                HStack { TemplateGlyph(item: item.template).frame(width: 52, height: 32); Text(bridge.t(item.hint)); Spacer() }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.readOnly)
                        }
                    }
                }
                if matchingCommands.isEmpty && matchingTemplates.isEmpty && matchingLetters.isEmpty && matchingCatalog.isEmpty { Text(bridge.t("没有匹配的现有命令")).foregroundStyle(.secondary) }
            }.listStyle(.inset)
        }.frame(width: 560, height: 480).onAppear { focused = true }
    }
    private func execute(_ id: String) {
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
