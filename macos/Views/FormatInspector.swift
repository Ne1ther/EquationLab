import SwiftUI
import CoreText

enum DocumentToolAvailability: Equatable {
    case ready, noDocument, loading, loadFailed, disconnected, unconfirmedSave, staleNumbers, busy

    init(state: WorkbenchState) {
        if state.wordOutcomeUnknown { self = .unconfirmedSave }
        else if state.wordDocumentUnavailable { self = .disconnected }
        else if state.wordDocumentLoading || (state.documentPath.isEmpty && state.wordDocumentReadState == .loading) { self = .loading }
        else if state.busy { self = .busy }
        else if state.wordDocumentLoadFailed || (state.documentPath.isEmpty && state.wordDocumentReadState == .failed) { self = .loadFailed }
        else if state.documentPath.isEmpty { self = .noDocument }
        else if state.objects.contains(where: { $0.numberStatus == "stale" }) { self = .staleNumbers }
        else { self = .ready }
    }

    var refreshAction: String? {
        switch self {
        case .loadFailed: "nativeRetryWordDocumentRead"
        case .staleNumbers: "nativeRefreshWordWorkspace"
        default: nil
        }
    }

    func message(english: Bool) -> String? {
        let text: (zh: String, en: String)
        switch self {
        case .ready: return nil
        case .noDocument: text = ("在 Word 中打开文档或打开 DOCX 副本后可用。", "Open a Word document or a DOCX copy to use these tools.")
        case .loading: text = ("正在载入完整文档…", "Loading the full document…")
        case .loadFailed: text = ("完整文档载入失败，可重试。", "The document did not finish loading. Try again.")
        case .disconnected: text = ("Word 文档连接已结束，请重新打开文档。", "The Word connection ended. Reopen the document.")
        case .unconfirmedSave: text = ("请先确认上次 Word 保存结果。", "Confirm the previous Word save in Word first.")
        case .staleNumbers: text = ("Word 中的编号已更新，请先刷新文档快照。", "Numbers changed in Word. Refresh the document snapshot first.")
        case .busy: text = ("正在处理当前操作…", "Finishing the current operation…")
        }
        return english ? text.en : text.zh
    }
}

struct FormatInspector: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var showAllFonts = false
    @State private var showExtraSizes = false
    private let documentToolsAnchor = "document-tools"
    private var english: Bool { bridge.language.usesEnglish }
    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }

    var body: some View {
        VStack(spacing: 0) {
            Picker(bridge.t("检查器"), selection: $bridge.inspectorTab) {
                ForEach(InspectorTab.allCases) { Text(bridge.t($0.rawValue)).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 10)
            Divider()
            ScrollViewReader { scroll in
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            switch bridge.inspectorTab {
                            case .style: styleSections
                            case .spacing: spacingSections
                            case .document: documentSections
                            }
                        }.padding(18)
                    }
                    .id(bridge.inspectorTab)

                    HStack(spacing: 8) {
                        Button {
                            if bridge.inspectorTab == .document {
                                scroll.scrollTo(documentToolsAnchor, anchor: .top)
                            } else {
                                bridge.inspectorTab = .document
                            }
                        } label: {
                            Label(label("文档工具", "Document tools"), systemImage: "doc.text.magnifyingglass")
                        }
                        .buttonStyle(WorkbenchButtonStyle(surface: true))
                        .fixedSize()
                        .help(bridge.t("文档检查与批量处理"))

                        presetMenu
                    }
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .modifier(WorkbenchFooter())
                }
            }
        }
        .background(.regularMaterial)
    }

    private var presetMenu: some View {
        Menu {
            Button(bridge.t("恢复 MathType 默认")) { bridge.action("click", ["id": "desktop-factory-fonts"]) }.disabled(!bridge.state.canFactoryReset)
            Button(bridge.t("恢复此公式原始设置")) { bridge.action("click", ["id": "desktop-reset-fonts"]) }
            Button(bridge.t("设为新公式默认")) { bridge.action("click", ["id": "desktop-default-fonts"]) }.disabled(!bridge.state.valid)
        } label: {
            Label(bridge.t("原版默认与预设"), systemImage: "slider.horizontal.3").frame(maxWidth: .infinity)
        }
        .menuStyle(.borderlessButton).controlSize(.small)
        .disabled(bridge.state.busy)
        .modifier(WorkbenchMenuSurface())
    }

    private var styleSections: some View {
        Group {
            InspectorSection("字体与样式") {
                Picker(bridge.t("样式"), selection: $bridge.fontRole) {
                    ForEach(bridge.state.fonts) { Text(bridge.t($0.label)).tag($0.id) }
                }.controlSize(.small)
                if let field = bridge.state.fonts.first(where: { $0.id == bridge.fontRole }) ?? bridge.state.fonts.first {
                    FontEditorRow(bridge: bridge, field: field, showLabel: false)
                }
                InspectorDisclosure("全部 \(bridge.state.fonts.count) 类字体", isExpanded: $showAllFonts) {
                    VStack(spacing: 14) {
                        ForEach(bridge.state.fonts) { FontEditorRow(bridge: bridge, field: $0, showLabel: true) }
                    }.padding(.top, 10)
                }.font(.caption)
                Text(bridge.t("每类字体与字形写入原生公式设置。")).font(.caption2).foregroundStyle(.secondary)
            }
            Divider()
            InspectorSection("标准字号") {
                ForEach(bridge.state.sizes) { DimensionEditorRow(bridge: bridge, field: $0) }
                InspectorDisclosure("额外字号", isExpanded: $showExtraSizes) {
                    VStack(spacing: 8) {
                        ForEach(bridge.state.extraSizes) { DimensionEditorRow(bridge: bridge, field: $0) }
                    }.padding(.top, 8)
                }.font(.caption)
            }
        }
    }

    private var spacingSections: some View {
        Group {
            InspectorSection("原生间距") {
                Text(bridge.t("30 项原版间距可分别定义；预览尚未完全复现所有间距。")).font(.caption).foregroundStyle(.secondary)
                ForEach(bridge.state.spaces) { DimensionEditorRow(bridge: bridge, field: $0) }
            }
            Divider()
            InspectorSection("矩阵与多行") {
                Button(bridge.t("浏览矩阵与对齐模板")) { bridge.action("category", ["name": "矩阵"]) }
                    .controlSize(.small)
                Text(bridge.t("选择模板后，在画布中逐格编辑；Tab 前往下一个位置。")).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var documentSections: some View {
        let availability = DocumentToolAvailability(state: bridge.state)
        return Group {
            documentTools(availability).id(documentToolsAnchor)
            Divider()
            InspectorSection("Word 编排") {
                ForEach(bridge.state.layout.filter { $0.id != "layout-format" }) { field in
                    if field.disabled && bridge.wordSessionActive {
                        LabeledContent(bridge.t(field.label)) {
                            Text(bridge.t(field.options.first(where: { $0.value == field.value })?.label ?? field.value))
                                .font(.system(.body, design: .rounded).weight(.semibold)).monospacedDigit()
                                .foregroundStyle(.primary).padding(.horizontal, 9).padding(.vertical, 4)
                                .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 5))
                        }
                    } else if !field.options.isEmpty {
                        Picker(bridge.t(field.label), selection: bridge.fieldBinding(field.id, fallback: field.value)) {
                            ForEach(field.options) { Text(bridge.t($0.label)).tag($0.value) }
                        }.controlSize(.small).disabled(field.disabled)
                    } else {
                        LabeledContent(bridge.t(field.label)) {
                            TextField(bridge.t(field.label), text: bridge.fieldBinding(field.id, fallback: field.value))
                                .textFieldStyle(.roundedBorder).frame(maxWidth: 160).disabled(field.disabled)
                        }
                    }
                }
                if let format = bridge.state.layout.first(where: { $0.id == "layout-format" }) {
                    NumberingFormatEditor(bridge: bridge, field: format, documentTools: availability).id(bridge.state.selected)
                }
                if bridge.state.canArrange {
                    Toggle(bridge.t("应用到文档全部独立公式"), isOn: Binding(get: { bridge.state.arrangeAll }, set: { bridge.action("arrangeAll", ["value": $0]) }))
                        .font(.caption).toggleStyle(.checkbox)
                    Button(bridge.t("另存编排后的 Word 副本…")) { bridge.action("click", ["id": "arrange"]) }
                        .controlSize(.small).disabled(bridge.state.busy)
                }
            }
            Divider()
            InspectorSection("复制与导出") {
                Button { bridge.action("click", ["id": "copy-latex"]) } label: { Label(bridge.t("复制 LaTeX"), systemImage: "doc.on.doc") }
                    .disabled(bridge.state.busy || bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button { bridge.action("click", ["id": "copy-png"]) } label: { Label(bridge.t("复制公式图片"), systemImage: "photo") }
                    .disabled(bridge.state.busy || !bridge.state.canExport)
                Button { bridge.invoke("nativeExport") } label: { Label(bridge.t("导出 MathType Word…"), systemImage: "square.and.arrow.up") }
                    .disabled(!bridge.state.canExport || bridge.state.busy || bridge.wordSessionActive)
            }.buttonStyle(WorkbenchButtonStyle()).font(.caption)
            Divider()
            InspectorSection("Word 插件") {
                Label(bridge.t(bridge.nativeWordStatus), systemImage: "puzzlepiece.extension")
                    .font(.caption2).foregroundStyle(.secondary)
                Button(bridge.t(bridge.installationRunning ? "正在安装…" : "安装 Word 插件…")) { bridge.installWordPlugin() }
                    .controlSize(.small).disabled(bridge.installationRunning)
                Button(bridge.t("检查连接")) { bridge.verifyWordPlugin(showResult: true) }
                    .controlSize(.small).disabled(bridge.installationRunning)
            }
            Button(bridge.t("查看兼容性说明…")) { bridge.showCompatibility = true }.buttonStyle(.borderless).font(.caption)
        }
    }

    private func documentTools(_ availability: DocumentToolAvailability) -> some View {
        InspectorSection("文档检查与批量处理", icon: "doc.text.magnifyingglass") {
            if let message = availability.message(english: english) {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(label("检查读取文档快照。批量修改先预检，再另存副本。", "Checks read the document snapshot. Preview batch changes before saving a copy."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 6) {
                Button { bridge.invoke("nativeDocumentAudit") } label: {
                    toolLabel(label("检查编号与引用…", "Check numbering and references…"), icon: "checklist")
                }
                .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 8))

                Menu {
                    Button(label("当前公式", "Current equation")) { bridge.invoke("nativeDocumentTypographyPlan", argument: "current") }
                        .disabled(bridge.state.selected == nil)
                    Button(label("全文公式（另存副本）", "All equations in a copy")) { bridge.invoke("nativeDocumentTypographyPlan", argument: "all") }
                    Button(label("保存文档预设（另存副本）", "Store document preset in a copy")) { bridge.invoke("nativeDocumentTypographyPlan", argument: "future") }
                    Divider()
                    Button(label("将文档预设载入当前草稿", "Load document preset into draft")) { bridge.invoke("nativeUseDocumentTypography") }
                } label: {
                    toolLabel(label("应用当前公式样式…", "Apply current formula style…"), icon: "textformat")
                }
                .menuStyle(.borderlessButton)
                .modifier(WorkbenchMenuSurface())

                Menu {
                    Button(label("当前公式", "Current equation")) { bridge.invoke("nativeDocumentNumberingPlan", argument: "current") }
                        .disabled(bridge.state.selected == nil)
                    Button(label("全部已有编号", "Existing numbered equations")) { bridge.invoke("nativeDocumentNumberingPlan", argument: "all") }
                    Button(label("仅后续新增公式", "Future equations only")) { bridge.invoke("nativeDocumentNumberingPlan", argument: "future") }
                } label: {
                    toolLabel(label("将编号格式应用到副本…", "Apply numbering format to a copy…"), icon: "list.number")
                }
                .menuStyle(.borderlessButton)
                .modifier(WorkbenchMenuSurface())
                .help(label("编号格式在下方 Word 编排中设置。", "Set the number format under Word layout below."))
            }
            .font(.caption)
            .disabled(availability != .ready)

            if let action = availability.refreshAction {
                Button(availability == .loadFailed ? label("重试载入", "Retry loading") : label("刷新文档快照", "Refresh snapshot")) {
                    bridge.invoke(action)
                }
                .controlSize(.small)
            } else if availability == .noDocument && !bridge.wordSessionActive {
                Button(bridge.t("打开文件副本…")) { bridge.invoke("nativeOpen") }
                    .controlSize(.small)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.38), in: RoundedRectangle(cornerRadius: WorkbenchMetrics.cornerRadius))
    }

    private func toolLabel(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct InspectorDisclosure<Content: View>: View {
    @EnvironmentObject private var bridge: DesktopBridge
    let title: String
    @Binding var isExpanded: Bool
    let content: Content
    init(_ title: String, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) {
        self.title = title; _isExpanded = isExpanded; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { isExpanded.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right").font(.system(size: 9, weight: .semibold)).frame(width: 12)
                    Text(bridge.t(title))
                    Spacer(minLength: 0)
                }.frame(maxWidth: .infinity, minHeight: 28, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(WorkbenchButtonStyle(horizontalPadding: 4))
            .accessibilityLabel(bridge.t(title))
            .accessibilityValue(bridge.language.usesEnglish ? (isExpanded ? "Expanded" : "Collapsed") : (isExpanded ? "已展开" : "已折叠"))
            .accessibilityHint(bridge.t("展开或折叠设置"))
            if isExpanded { content }
        }
    }
}

private struct InspectorSection<Content: View>: View {
    @EnvironmentObject private var bridge: DesktopBridge
    let title: String
    let icon: String?
    @ViewBuilder var content: Content
    init(_ title: String, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label { Text(bridge.t(title)) } icon: {
                Image(systemName: icon ?? (title.contains("字体") ? "textformat" : title.contains("字号") ? "textformat.size" : title.contains("Word") ? "doc.text" : title.contains("复制") ? "square.and.arrow.up" : title.contains("矩阵") ? "square.grid.2x2" : "arrow.left.and.right"))
                    .symbolRenderingMode(.hierarchical).foregroundStyle(.tint)
            }.font(.system(size: 12, weight: .semibold))
            content
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FontEditorRow: View {
    private static let samples = NSCache<NSString, NSFont>()
    @ObservedObject var bridge: DesktopBridge
    let field: EditorField
    var showLabel: Bool
    private var sampleFont: Font {
        let key = "\(field.value)\u{0}\(field.style)" as NSString
        if let font = Self.samples.object(forKey: key) { return Font(font) }
        let base = CTFontCreateWithName(field.value as CFString, 18, nil)
        let style = Int(field.style) ?? 0
        let traits = CTFontSymbolicTraits(rawValue: (style & 1 != 0 ? CTFontSymbolicTraits.traitBold.rawValue : 0)
            | (style & 2 != 0 ? CTFontSymbolicTraits.traitItalic.rawValue : 0))
        let chosen = CTFontCreateCopyWithSymbolicTraits(base, 18, nil, traits, [.traitBold, .traitItalic]) ?? base
        Self.samples.countLimit = 128
        Self.samples.setObject(chosen as NSFont, forKey: key)
        return Font(chosen as NSFont)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if showLabel { Text(bridge.t(field.label)).font(.caption).foregroundStyle(.secondary) }
            FontFamilyPicker(value: bridge.fieldBinding(field.id, fallback: field.value), placeholder: bridge.t("选择字体或输入名称搜索"), accessibilityLabel: bridge.t(field.label) + " · " + bridge.t("字体名称"))
                .frame(height: 28)
            Picker(bridge.t("样式"), selection: Binding(get: { field.style }, set: { bridge.action("fontStyle", ["id": field.id, "value": $0]) })) {
                ForEach([("0", "正体"), ("1", "粗体"), ("2", "斜体"), ("3", "粗斜体")], id: \.0) { value, title in
                    Text(bridge.t(title)).tag(value)
                }
            }.pickerStyle(.segmented).labelsHidden().controlSize(.small)
            Text("Aa Bb  αβ  123").font(sampleFont).frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .padding(.horizontal, 9).background(.background, in: RoundedRectangle(cornerRadius: 6))
                .accessibilityLabel(bridge.t("字体预览"))
                .accessibilityValue(field.value + " · " + bridge.t(["正体", "粗体", "斜体", "粗斜体"][(Int(field.style) ?? 0) & 3]))
        }.disabled(field.disabled)
    }
}

private struct DimensionEditorRow: View {
    @ObservedObject var bridge: DesktopBridge
    let field: EditorField
    var body: some View {
        HStack(spacing: 7) {
            Text(bridge.t(field.label)).font(.system(size: 11)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            TextField(bridge.t("数值"), text: bridge.fieldBinding(field.id, fallback: field.value))
                .textFieldStyle(.roundedBorder).frame(width: 64).multilineTextAlignment(.trailing)
                .font(.system(size: 11.5, design: .rounded)).monospacedDigit()
                .accessibilityLabel(bridge.t("\(field.label)数值"))
            Picker(bridge.t("单位"), selection: Binding(get: { field.unit }, set: { bridge.action("unit", ["id": field.id, "value": $0]) })) {
                ForEach(field.units, id: \.self) { Text($0).tag($0) }
            }.labelsHidden().frame(width: 57).controlSize(.small)
                .accessibilityLabel(bridge.t("\(field.label)单位"))
        }.disabled(field.disabled)
    }
}
