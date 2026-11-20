import AppKit
import SwiftUI

struct OfficePluginSheet: View {
    @ObservedObject var bridge: DesktopBridge
    let showsSkillFirst: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                OfficeProductLabel(bridge: bridge).font(.title2.bold())
                Spacer()
                Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ScrollView { pluginContent.padding(.trailing, 6) }
                .frame(maxHeight: 520)
            if bridge.installationRunning { ProgressView(bridge.t("正在处理插件…")).controlSize(.small) }
        }
        .padding(26).frame(width: 620)
        .disabled(bridge.installationRunning)
        .onAppear { bridge.verifyWordPlugin() }
        .alert(bridge.t("Office 插件"), isPresented: Binding(get: { !bridge.installationMessage.isEmpty }, set: { if !$0 { bridge.installationMessage = "" } })) {
            Button(bridge.t("好"), role: .cancel) { bridge.installationMessage = "" }
        } message: { Text(bridge.t(bridge.installationMessage)) }
    }

    private var pluginContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showsSkillFirst { SkillInstallationCard(english: bridge.language.usesEnglish) }
            wordInstallation
            if !showsSkillFirst { SkillInstallationCard(english: bridge.language.usesEnglish) }
        }
    }

    private var wordInstallation: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                OfficeProductLabel(bridge: bridge, wordOnly: true).font(.headline)
                if bridge.wordApplicationPath.isEmpty {
                    Text(bridge.t("没有找到桌面版 Microsoft Word。请安装 Word，或选择它的实际位置。"))
                        .foregroundStyle(.secondary)
                } else {
                    Text("Microsoft Word \(bridge.wordApplicationVersion)")
                    Text(bridge.wordApplicationPath).font(.caption).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                Text(bridge.t("固定顶栏、公式插入与双击编辑、编号和引用。按照窗口提示完成安装即可。"))
                    .fixedSize(horizontal: false, vertical: true)
                if bridge.wordPluginSetupPending {
                    Text(bridge.t("App 已安装，Word 插件尚未配置。按提示允许访问 Word 文件夹后，点击安装插件。"))
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(bridge.t(bridge.nativeWordStatus)).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button(bridge.wordPluginInstallationPending ? (bridge.language.usesEnglish ? "Continue Word plugin setup…" : "继续安装 / 更新 Word 插件…") : bridge.t("安装 / 更新 Word 插件…")) { bridge.installWordPlugin() }
                        .buttonStyle(.borderedProminent)
                    Button(bridge.t("检查连接")) { bridge.verifyWordPlugin(showResult: true) }
                    Button(bridge.t("移除…")) { bridge.uninstallWordPlugin() }
                }
                if bridge.wordOfficeAccessRequired {
                    Button(bridge.t("允许访问 Word 文件夹…")) { bridge.chooseWordOfficeDirectory() }
                }
                HStack {
                    Button(skillText("复制连接诊断", "Copy connection diagnostics")) { bridge.copyWordConnectionDiagnostics() }
                        .disabled(bridge.copyingWordDiagnostics)
                        .help(skillText("仅复制版本与连接状态。", "Copies only versions and connection status."))
                    Button(bridge.t("选择 Word 应用…")) { bridge.chooseWordApplication() }
                }.controlSize(.small)
                Text(skillText("保存文档并退出 Word 后安装。重新打开 Word，即可使用 Equation Lab 顶栏。",
                               "Save your documents and quit Word before installing. Reopen Word to use the Equation Lab ribbon."))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
        }
    }

    private func skillText(_ chinese: String, _ english: String) -> String {
        bridge.language.usesEnglish ? english : chinese
    }
}
