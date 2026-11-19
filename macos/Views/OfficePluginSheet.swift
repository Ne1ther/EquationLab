import AppKit
import SwiftUI

struct OfficePluginSheet: View {
    @ObservedObject var bridge: DesktopBridge
    let showsSkillFirst: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var skillFeedback = ""
    @State private var skillFeedbackIsError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                OfficeProductLabel(bridge: bridge).font(.title2.bold())
                Spacer()
                Button(bridge.t("完成")) { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ViewThatFits(in: .vertical) {
                pluginContent.fixedSize(horizontal: false, vertical: true)
                ScrollView { pluginContent.padding(.trailing, 6) }
            }
            .frame(maxHeight: 520)
            if bridge.installationRunning { ProgressView(bridge.t("正在处理插件…")).controlSize(.small) }
        }
        .padding(26).frame(width: 620)
        .disabled(bridge.installationRunning)
        .onAppear {
            bridge.verifyWordPlugin()
            if let installer = EquationLabSkillInstallation.bundled {
                switch installer.existing(at: installer.codexDestination) {
                case .current:
                    skillFeedback = skillText("已安装到 Codex。", "Installed in Codex.")
                case .relink:
                    skillFeedback = skillText("App 位置已变化，点击安装即可更新连接。", "The App location changed. Click Install to update the connection.")
                case .conflict:
                    skillFeedback = skillText("Codex 已有同名 Skill。可使用现有版本，或导出此版本。", "Codex already has a Skill with this name. Use that version or export this one.")
                case .available:
                    break
                }
            }
        }
        .alert(bridge.t("Office 插件"), isPresented: Binding(get: { !bridge.installationMessage.isEmpty }, set: { if !$0 { bridge.installationMessage = "" } })) {
            Button(bridge.t("好"), role: .cancel) { bridge.installationMessage = "" }
        } message: { Text(bridge.t(bridge.installationMessage)) }
    }

    private var pluginContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showsSkillFirst { skillInstallation }
            wordInstallation
            if !showsSkillFirst { skillInstallation }
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

    private var skillInstallation: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Label("Equation Lab Skill", systemImage: "sparkles").font(.headline)
                Text(skillText("在 Codex 里用 $equation-lab 处理 Word 公式。也可以导出文件夹，导入其他支持 Skill 的本地客户端。",
                               "Use $equation-lab in Codex to work with Word equations. Export the folder to use it in another local client that supports Skills."))
                    .foregroundStyle(.secondary)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                if let installer = EquationLabSkillInstallation.bundled {
                    HStack {
                        Button(skillText("安装到 Codex", "Install for Codex")) {
                            copySkill(installer, into: installer.codexDirectory, forCodex: true)
                        }
                        .buttonStyle(.borderedProminent)
                        Button(skillText("导出 Skill 文件夹…", "Export Skill Folder…")) {
                            chooseSkillExportFolder(installer)
                        }
                    }
                    if !skillFeedback.isEmpty {
                        Text(skillFeedback).font(.callout)
                            .foregroundStyle(skillFeedbackIsError ? Color.orange : Color.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                } else {
                    Text(skillText("这个构建没有随附 Skill 运行环境。", "The Skill runtime is unavailable in this build."))
                        .font(.callout).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
        }
    }

    private func skillText(_ chinese: String, _ english: String) -> String {
        bridge.language.usesEnglish ? english : chinese
    }

    private func chooseSkillExportFolder(_ installer: EquationLabSkillInstallation) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = skillText("导出", "Export")
        panel.message = skillText("选择存放 equation-lab Skill 文件夹的位置。", "Choose a destination for the equation-lab Skill folder.")
        panel.begin { result in
            guard result == .OK, let directory = panel.url else { return }
            copySkill(installer, into: directory, forCodex: false)
        }
    }

    private func copySkill(_ installer: EquationLabSkillInstallation, into directory: URL, forCodex: Bool) {
        let destination = directory.appendingPathComponent("equation-lab", isDirectory: true)
        let alreadyInstalled = installer.existing(at: destination) == .current
        do {
            try installer.install(in: directory)
            skillFeedbackIsError = false
            if forCodex {
                skillFeedback = alreadyInstalled
                    ? skillText("此版本已经安装。可在 Codex 中调用 $equation-lab。", "This version is already installed. Use $equation-lab in Codex.")
                    : skillText("安装完成。可在 Codex 中调用 $equation-lab。", "Installed. Use $equation-lab in Codex.")
            } else {
                skillFeedback = skillText("Skill 文件夹已准备好。", "The Skill folder is ready.")
                NSWorkspace.shared.activateFileViewerSelecting([destination])
            }
        } catch is EquationLabSkillInstallation.Conflict {
            skillFeedbackIsError = true
            skillFeedback = forCodex
                ? skillText("Codex 已有同名 Skill。可保留现有版本，或导出此版本。", "Codex already has a Skill with this name. You can keep it or export this version.")
                : skillText("这个位置已有同名 Skill。请选择其他导出位置。", "This location already has a Skill with this name. Choose a different export location.")
        } catch {
            skillFeedbackIsError = true
            skillFeedback = skillText("无法复制 Skill。请检查目标目录的写入权限。", "Could not copy the Skill. Check write access to the destination.")
        }
    }
}
