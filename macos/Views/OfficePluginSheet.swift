import SwiftUI

struct OfficePluginSheet: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                OfficeProductLabel(bridge: bridge).font(.title2.bold())
                Spacer()
                Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text(bridge.t("将 Equation Lab 接入 Microsoft Word。安装完成后，Word 会自动显示 Equation Lab 顶栏。"))
                .foregroundStyle(.secondary)
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
                    Text(bridge.t("固定顶栏、公式插入与双击编辑、编号和引用。系统安装器会自动放置所有组件，无需选择文件夹。"))
                    Text(bridge.t(bridge.nativeWordStatus)).font(.callout).foregroundStyle(.secondary)
                    HStack {
                        Button(bridge.t("安装 / 更新 Word 插件…")) { bridge.installWordPlugin() }
                            .buttonStyle(.borderedProminent)
                        Button(bridge.t("检查连接")) { bridge.verifyWordPlugin(showResult: true) }
                        Button(bridge.t("移除…")) { bridge.uninstallWordPlugin() }
                    }
                    Button(bridge.t("选择 Word 应用…")) { bridge.chooseWordApplication() }
                        .controlSize(.small)
                    if bridge.wordOfficeAccessRequired {
                        Button(bridge.t("允许访问 Word 文件夹…")) { bridge.chooseWordOfficeDirectory() }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(bridge.t("安装后怎样打开？")).font(.headline)
                Text(bridge.t("安装前保存文档并完全退出 Word。完成安装后重新打开 Word，新建或打开文档，直接使用 Equation Lab 顶栏。"))
                Text(bridge.t("当前支持 Word for Mac；Excel 和 PowerPoint 接入尚未提供。"))
                    .foregroundStyle(.secondary)
            }.font(.callout)
            if bridge.installationRunning { ProgressView(bridge.t("正在处理插件…")).controlSize(.small) }
        }
        .padding(26).frame(width: 620)
        .disabled(bridge.installationRunning)
        .onAppear { bridge.refreshOfficePluginStatus(); bridge.verifyWordPlugin() }
        .alert(bridge.t("Office 插件"), isPresented: Binding(get: { !bridge.installationMessage.isEmpty }, set: { if !$0 { bridge.installationMessage = "" } })) {
            Button(bridge.t("好"), role: .cancel) { bridge.installationMessage = "" }
        } message: { Text(bridge.t(bridge.installationMessage)) }
    }
}
