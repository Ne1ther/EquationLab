import SwiftUI

struct WorkbenchView: View {
    @ObservedObject var bridge: DesktopBridge
    @ObservedObject var updater: AppUpdater
    @State private var columns: NavigationSplitViewVisibility = .all
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            FormulaSidebar(bridge: bridge)
                .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 290)
        } detail: {
            HStack(spacing: 0) {
                editorPane
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Rectangle().fill(.separator).frame(width: bridge.showInspector ? 1 : 0)
                // Keep both panes mounted. Only the inspector's clipping width
                // changes, so WebKit gets one final layout, not a presentation
                // animation or a replacement editor view.
                FormatInspector(bridge: bridge)
                    .frame(width: 300)
                    .frame(width: bridge.showInspector ? 300 : 0, alignment: .leading)
                    .clipped()
                    .allowsHitTesting(bridge.showInspector)
                    .accessibilityHidden(!bridge.showInspector)
            }
            .animation(nil, value: bridge.showInspector)
        }
        .navigationTitle("")
        .frame(minWidth: 1120, minHeight: 730)
        .background(EditorWindowLifecycle(bridge: bridge).frame(width: 0, height: 0))
        .toolbar {
            ToolbarItem(placement: .navigation) { WorkbenchIdentity() }
            ToolbarItemGroup(placement: .primaryAction) {
                if updater.hasUpdate {
                    Button { updater.showPanel = true } label: {
                        Label(bridge.t("有可用更新"), systemImage: "arrow.down.circle.fill").foregroundStyle(.blue)
                    }.help(bridge.t("查看更新与下载进度"))
                }
                Button { bridge.showCommands = true } label: {
                    Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium)).foregroundStyle(.purple)
                        .frame(width: 28, height: 26)
                }
                .buttonStyle(WorkbenchButtonStyle(tint: .purple, horizontalPadding: 2))
                .help(bridge.t("搜索现有命令、符号与模板 (⌘K)"))
                .accessibilityLabel(bridge.t("搜索命令"))
                Button { bridge.showOfficePlugins = true } label: { OfficeProductLabel(bridge: bridge, showsTitle: false).frame(width: 28, height: 26) }
                    .buttonStyle(WorkbenchButtonStyle(horizontalPadding: 2))
                    .help(bridge.t("安装或管理 Microsoft Word 插件"))
                    .accessibilityLabel(bridge.t(bridge.wordSessionActive ? "Word 插件" : "Office 插件"))
                InterfaceLanguageMenu(bridge: bridge)
                if bridge.wordSessionActive {
                    Button(bridge.t("取消")) { bridge.invoke("nativeCancelWordSession") }.disabled(bridge.state.busy)
                    Button { bridge.invoke("nativeCommitWordSession") } label: {
                        Label(bridge.t("保存并返回 Word"), systemImage: "checkmark.circle.fill")
                    }.labelStyle(.titleAndIcon)
                        .buttonStyle(.borderedProminent).tint(.blue).disabled(!bridge.state.canExport || bridge.state.busy)
                } else {
                    Button {
                        if bridge.state.canSaveEdit { bridge.action("click", ["id": "save-edit"]) }
                        else { bridge.invoke("nativeExport") }
                    } label: {
                        Label(bridge.t(bridge.state.canSaveEdit ? "另存副本" : "导出 Word"), systemImage: "square.and.arrow.up")
                    }.labelStyle(.titleAndIcon)
                        .buttonStyle(.borderedProminent).tint(.blue).disabled(!bridge.state.canExport || bridge.state.busy)
                }
                Button { bridge.showInspector.toggle() } label: {
                    Image(systemName: "sidebar.right")
                        .symbolRenderingMode(.hierarchical).font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.blue).frame(width: 30, height: 28)
                        .symbolEffect(.bounce, options: .speed(1.5), value: reduceMotion ? false : bridge.showInspector)
                        .symbolEffectsRemoved(reduceMotion)
                }
                .buttonStyle(WorkbenchButtonStyle(selected: bridge.showInspector, horizontalPadding: 0))
                .help(bridge.t(bridge.showInspector ? "隐藏检查器" : "显示检查器"))
                .accessibilityLabel(bridge.t(bridge.showInspector ? "隐藏检查器" : "显示检查器"))
                .accessibilityValue(bridge.language.usesEnglish ? (bridge.showInspector ? "Expanded" : "Collapsed") : (bridge.showInspector ? "已展开" : "已收起"))
            }
        }
        .sheet(isPresented: $bridge.showCommands, onDismiss: {
            if bridge.matrixBuilderPending { bridge.matrixBuilderPending = false; bridge.showMatrixBuilder = true }
        }) { CommandSearch(bridge: bridge) }
        .sheet(isPresented: $bridge.showCompatibility) { CompatibilitySheet(bridge: bridge) }
        .sheet(isPresented: $updater.showPanel) { AppUpdateSheet(updater: updater, bridge: bridge) }
        .sheet(isPresented: $bridge.showOfficePlugins) { OfficePluginSheet(bridge: bridge) }
        .sheet(isPresented: $bridge.showMatrixBuilder) { MatrixBuilder(bridge: bridge) }
        .alert(bridge.t("Word 插件安装"), isPresented: Binding(get: { !bridge.showOfficePlugins && !bridge.installationMessage.isEmpty }, set: { if !$0 { bridge.installationMessage = "" } })) {
            Button(bridge.t("好"), role: .cancel) { bridge.installationMessage = "" }
        } message: { Text(bridge.t(bridge.installationMessage)) }
    }

    private var editorPane: some View {
            VStack(spacing: 0) {
                TemplateShelf(bridge: bridge)
                HStack(spacing: 8) {
                    Label(bridge.t("编辑公式"), systemImage: "pencil.line").font(.system(size: 12, weight: .semibold))
                    Spacer()
                    Button { bridge.showRuler.toggle() } label: { Image(systemName: "ruler").foregroundStyle(bridge.showRuler ? .blue : .secondary) }.help(bridge.t("显示或隐藏标尺"))
                    Button { bridge.showEditorMenu() } label: { Image(systemName: "ellipsis.circle") }.help(bridge.t("公式菜单"))
                    Button { bridge.action("click", ["id": "undo"]) } label: { Image(systemName: "arrow.uturn.backward").frame(width: 18) }.help(bridge.t("撤销")).disabled(bridge.state.busy || bridge.state.readOnly)
                    Button { bridge.action("click", ["id": "redo"]) } label: { Image(systemName: "arrow.uturn.forward").frame(width: 18) }.help(bridge.t("重做")).disabled(bridge.state.busy || bridge.state.readOnly)
                    Divider().frame(height: 15)
                    Picker(bridge.t("缩放"), selection: Binding(get: { bridge.state.zoom }, set: { bridge.action("zoom", ["value": $0]) })) {
                        Text(bridge.t("适合窗口")).tag(0)
                        ForEach([50, 75, 100, 125, 150, 200, 250, 300], id: \.self) { Text("\($0)%").tag($0) }
                    }.labelsHidden().frame(width: 100).controlSize(.small)
                }
                .buttonStyle(WorkbenchButtonStyle())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 18).frame(height: 42)
                if bridge.showRuler { EquationRuler(bridge: bridge).frame(height: 39).padding(.horizontal, 18) }
                EquationWebView(bridge: bridge)
                    .frame(minHeight: 280)
                WorkbenchStatusBar(bridge: bridge)
            }
    }
}

struct WorkbenchStatusBar: View {
    @ObservedObject var bridge: DesktopBridge
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: bridge.state.statusError ? "exclamationmark.triangle" : bridge.state.valid ? "checkmark.circle" : "clock")
                .foregroundStyle(bridge.state.statusError ? .orange : bridge.state.valid ? .green : .secondary)
                Text(bridge.t(bridge.state.message.isEmpty ? bridge.state.statusTitle : bridge.state.message))
                .font(.caption).lineLimit(1)
                .foregroundStyle(bridge.state.messageError || bridge.state.statusError ? .orange : .secondary)
                .help(bridge.t(bridge.state.statusDetail))
            Spacer(minLength: 8)
            Button { bridge.action("click", ["id": "copy-latex"]) } label: {
                Label("LaTeX", systemImage: "doc.on.doc").font(.system(size: 11))
            }
            .buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bridge.state.busy)
            .help(bridge.t("复制 LaTeX")).accessibilityLabel(bridge.t("复制 LaTeX"))
            Button { bridge.action("click", ["id": "copy-png"]) } label: { Image(systemName: "photo").frame(width: 18) }
                .buttonStyle(WorkbenchButtonStyle()).disabled(bridge.state.busy || !bridge.state.canExport)
                .help(bridge.t("复制公式图片")).accessibilityLabel(bridge.t("复制公式图片"))
            Button { bridge.action("click", ["id": "keyboard"]) } label: { Image(systemName: "keyboard").frame(width: 18) }
                .buttonStyle(WorkbenchButtonStyle(selected: bridge.state.keyboardVisible))
                .disabled(bridge.state.busy)
                .help(bridge.t("数学键盘")).accessibilityLabel(bridge.t("数学键盘"))
                .accessibilityValue(bridge.t(bridge.state.keyboardVisible ? "已展开" : "已收起"))
        }
        .padding(.horizontal, 16)
        .modifier(WorkbenchFooter())
    }
}
