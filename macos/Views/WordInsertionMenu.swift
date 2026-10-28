import SwiftUI

/// The same Word-owned insertion session is used by this menu and the Ribbon.
struct WordInsertionMenu: View {
    @ObservedObject var bridge: DesktopBridge
    var body: some View {
        Menu {
            Text(bridge.t(bridge.wordSessionActive ? "在当前公式所在段落后插入" : "在所选文档的 Word 光标处插入"))
            Button(bridge.t("行内公式")) { bridge.invoke("nativeInsertWord", argument: "inline") }
            Button(bridge.t("居中公式")) { bridge.invoke("nativeInsertWord", argument: "display") }
            Button(bridge.t("右侧编号公式")) { bridge.invoke("nativeInsertWord", argument: "numbered-right") }
            Button(bridge.t("左侧编号公式")) { bridge.invoke("nativeInsertWord", argument: "numbered-left") }
        } label: {
            Label(bridge.t("插入到 Word"), systemImage: "plus.circle")
                .frame(maxWidth: .infinity)
        }
        .disabled(!bridge.state.wordAppInsertionSupported || !bridge.state.openWordDocuments.contains(where: { $0.identity == bridge.state.wordDocumentIdentity && !$0.readOnly }) || bridge.state.busy || bridge.state.wordOutcomeUnknown || bridge.wordSessionIsInsertion || bridge.state.wordDocumentUnavailable)
        .help(bridge.t(!bridge.state.wordWorkspaceConnected ? "请先打开 Word 文档，并确认 Word 插件已连接。" : !bridge.state.wordAppInsertionSupported ? "请更新 Word 插件并重新打开 Word，再从 App 插入。" : "先选择目标文档，再选择公式位置；编号沿用该文档的设置。"))
    }
}
