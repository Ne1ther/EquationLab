import SwiftUI
import CoreText

struct FormatInspector: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var showAllFonts = false
    @State private var showExtraSizes = false
    @State private var showSpaces = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(bridge.t("检查器")).font(.headline)
                Spacer()
            }.padding(.horizontal, 18).padding(.top, 15).padding(.bottom, 12)
            Picker(bridge.t("检查器"), selection: $bridge.inspectorTab) {
                ForEach(InspectorTab.allCases) { Text(bridge.t($0.rawValue)).tag($0) }
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 16).padding(.bottom, 10)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch bridge.inspectorTab {
                    case .style: styleSections
                    case .spacing: spacingSections
                    case .document: documentSections
                    }
                }.padding(18)
            }
            Menu {
                Button(bridge.t("恢复 MathType 默认")) { bridge.action("click", ["id": "desktop-factory-fonts"]) }.disabled(!bridge.state.canFactoryReset)
                Button(bridge.t("恢复此公式原始设置")) { bridge.action("click", ["id": "desktop-reset-fonts"]) }
                Button(bridge.t("设为新公式默认")) { bridge.action("click", ["id": "desktop-default-fonts"]) }.disabled(!bridge.state.valid)
            } label: { Label(bridge.t("原版默认与预设"), systemImage: "slider.horizontal.3").frame(maxWidth: .infinity) }
                .menuStyle(.borderlessButton).controlSize(.small)
                .disabled(bridge.state.busy)
                .modifier(WorkbenchMenuSurface()).padding(.horizontal, 16)
                .modifier(WorkbenchFooter())
        }
        .background(.regularMaterial)
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
            Divider()
            Button { bridge.inspectorTab = .spacing; showSpaces = true } label: { Label(bridge.t("定义间距…"), systemImage: "arrow.left.and.right") }
                .buttonStyle(WorkbenchButtonStyle()).font(.caption)
            Button { bridge.action("category", ["name": "矩阵"]) } label: { Label(bridge.t("矩阵与多行模板"), systemImage: "square.grid.2x2") }
                .buttonStyle(WorkbenchButtonStyle()).font(.caption)
            Button { bridge.inspectorTab = .document } label: { Label(bridge.t("Word 位置与编号"), systemImage: "doc.text") }
                .buttonStyle(WorkbenchButtonStyle()).font(.caption)
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
        Group {
            InspectorSection("Word 编排") {
                ForEach(bridge.state.layout.filter { $0.id != "layout-format" }) { field in
                    if !field.options.isEmpty {
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
                    NumberingFormatEditor(bridge: bridge, field: format).id(bridge.state.selected)
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
    @ViewBuilder var content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label { Text(bridge.t(title)) } icon: {
                Image(systemName: title.contains("字体") ? "textformat" : title.contains("字号") ? "textformat.size" : title.contains("Word") ? "doc.text" : title.contains("复制") ? "square.and.arrow.up" : title.contains("矩阵") ? "square.grid.2x2" : "arrow.left.and.right")
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
                .textFieldStyle(.roundedBorder).frame(width: 62).multilineTextAlignment(.trailing)
                .accessibilityLabel(bridge.t("\(field.label)数值"))
            Picker(bridge.t("单位"), selection: Binding(get: { field.unit }, set: { bridge.action("unit", ["id": field.id, "value": $0]) })) {
                ForEach(field.units, id: \.self) { Text($0).tag($0) }
            }.labelsHidden().frame(width: 57).controlSize(.small)
                .accessibilityLabel(bridge.t("\(field.label)单位"))
        }.disabled(field.disabled)
    }
}
