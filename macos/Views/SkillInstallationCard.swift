import AppKit
import SwiftUI

struct SkillInstallationCard: View {
    let english: Bool
    @State private var feedback: String?
    @State private var feedbackIsError = false
    @State private var showingOtherClients = false
    @State private var copied = false
    @State private var statusRevision = 0

    private enum Client: CaseIterable {
        case codex, antigravity, claude, dsh

        var name: String {
            switch self {
            case .codex: "Codex"
            case .antigravity: "Antigravity"
            case .claude: "Claude Code"
            case .dsh: "DeepSeek Harness"
            }
        }

        var icon: NSImage? {
            switch self {
            case .codex: WorkbenchArtwork.codex
            case .antigravity: WorkbenchArtwork.antigravity
            case .claude: WorkbenchArtwork.claudeCode
            case .dsh: WorkbenchArtwork.deepSeekHarness
            }
        }

        var tint: Color {
            switch self {
            case .codex: .indigo
            case .antigravity: .blue
            case .claude: .orange
            case .dsh: .cyan
            }
        }

        var link: EquationLabSkillInstallation.Client? {
            switch self {
            case .codex, .dsh: nil
            case .antigravity: .antigravity
            case .claude: .claude
            }
        }
    }

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                if let installer = EquationLabSkillInstallation.bundled {
                    header(installer)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(Client.allCases, id: \.self) { client in
                            clientButton(client, installer: installer)
                        }
                    }
                    otherClientsButton(installer)
                    if let feedback {
                        Text(feedback)
                            .font(.callout)
                            .foregroundStyle(feedbackIsError ? Color.orange : Color.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                } else {
                    Text("Equation Lab Skill").font(.headline)
                    Text(label("这个构建没有随附 Skill 运行环境。", "The Skill runtime is unavailable in this build."))
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }
        .onAppear {
            statusRevision += 1
            guard feedback == nil, let installer = EquationLabSkillInstallation.bundled else { return }
            switch installer.existing(at: installer.sharedDestination) {
            case .current, .linked:
                feedback = label("共享 Skill 已就绪。", "Shared Skill is ready.")
            case .relink:
                feedback = label("App 位置已变化。重新安装即可更新连接。", "The app moved. Reinstall the Skill to update its connection.")
            case .upgrade:
                feedback = label("共享 Skill 有可用更新。", "A shared Skill update is available.")
            case .conflict:
                feedback = label("共享目录已有同名 Skill。可保留现有版本或导出此版本。", "The shared folder already contains a Skill with this name. Keep it or export this version.")
                feedbackIsError = true
            case .available:
                break
            }
        }
    }

    private func header(_ installer: EquationLabSkillInstallation) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Equation Lab Skill", systemImage: "sparkles").font(.headline)
                Text(verbatim: "~/.agents/skills/equation-lab")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)
            Button(label("安装共享 Skill", "Install Shared Skill")) {
                prepare(installer)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .fixedSize()
        }
    }

    private func clientButton(_ client: Client, installer: EquationLabSkillInstallation) -> some View {
        let _ = statusRevision
        let linkStatus = client.link.map { installer.clientLinkStatus($0) }
        let action: String = switch linkStatus {
        case nil: label("使用共享 Skill", "Use shared Skill")
        case .linked: label("已链接", "Linked")
        case .conflict: label("已有同名项", "Name conflict")
        case .notLinked: label("链接共享 Skill", "Link shared Skill")
        }
        let symbol: String = switch linkStatus {
        case nil: "chevron.right"
        case .linked: "checkmark.circle.fill"
        case .conflict: "exclamationmark.triangle.fill"
        case .notLinked: "link"
        }
        let symbolColor: Color = switch linkStatus {
        case .linked: .green
        case .conflict: .orange
        case nil, .notLinked: .secondary
        }
        return Button {
            prepare(installer, for: client)
        } label: {
            HStack(spacing: 8) {
                Color.clear
                    .frame(width: 30, height: 30)
                    .background(client.tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 7))
                    .overlay {
                        if let icon = client.icon {
                            Image(nsImage: icon).resizable().renderingMode(.original).scaledToFit()
                                .frame(width: 24, height: 24)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(client.name).font(.callout.weight(.semibold))
                    Text(action).font(.caption).foregroundStyle(linkStatus == .conflict ? Color.orange : Color.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: symbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(symbolColor)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 5)
        }
        .buttonStyle(WorkbenchButtonStyle(tint: client.tint, surface: true, horizontalPadding: 8))
        .accessibilityLabel(client.name + ", " + action)
    }

    private func otherClientsButton(_ installer: EquationLabSkillInstallation) -> some View {
        Button {
            copied = false
            showingOtherClients.toggle()
        } label: {
            HStack(spacing: 8) {
                Text("🧠").font(.system(size: 17))
                    .frame(width: 30, height: 30)
                    .background(Color.pink.opacity(0.09), in: RoundedRectangle(cornerRadius: 7))
                    .accessibilityHidden(true)
                Text(label("其他客户端", "Other clients")).font(.callout.weight(.semibold))
                Spacer(minLength: 6)
                Text(label("连接说明", "Setup instructions")).font(.caption).foregroundStyle(.secondary)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(WorkbenchButtonStyle(tint: .pink, surface: true, horizontalPadding: 8))
        .popover(isPresented: $showingOtherClients, arrowEdge: .bottom) {
            otherClientsGuide(installer)
        }
    }

    private var connectionPrompt: String {
        label(
            "请读取 ~/.agents/skills/equation-lab/SKILL.md，并在当前客户端加载 equation-lab。若客户端已有共享目录扫描，重新加载 Skill 即可。若它使用独立的 Skill 目录，请查明实际路径，在其中创建名为 equation-lab 的符号链接，指向 ~/.agents/skills/equation-lab。保留已有同名内容并告知我。完成后确认客户端能发现该 Skill。",
            "Read ~/.agents/skills/equation-lab/SKILL.md and load equation-lab in this client. If this client scans the shared Skills folder, reload its Skills list. If it uses a separate directory, find its configured Skills folder and create a symlink named equation-lab there pointing to ~/.agents/skills/equation-lab. Keep any existing item with the same name and report it. Then verify the client discovers the Skill."
        )
    }

    private func otherClientsGuide(_ installer: EquationLabSkillInstallation) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(label("其他客户端", "Other clients")).font(.headline)
            Text(label("先安装共享 Skill，再把下面的说明发给同一台 Mac 上的智能体。", "Install the shared Skill, then send these instructions to an agent on the same Mac."))
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: connectionPrompt)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            HStack {
                Button(label("导出文件夹…", "Export Folder…")) {
                    showingOtherClients = false
                    exportSkill(installer)
                }
                Spacer(minLength: 8)
                Button(copied ? label("已复制", "Copied") : label("复制给智能体", "Copy for Agent")) {
                    NSPasteboard.general.clearContents()
                    copied = NSPasteboard.general.setString(connectionPrompt, forType: .string)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
        .frame(width: 418)
    }

    private func prepare(_ installer: EquationLabSkillInstallation, for client: Client? = nil) {
        do {
            if let link = client?.link {
                try installer.link(link)
            } else {
                try installer.install(in: installer.sharedDirectory)
            }
            switch client {
            case .codex:
                show(label("Codex 已就绪。请在会话中使用 $equation-lab。", "Ready for Codex. Use $equation-lab in a session."))
            case .antigravity:
                show(label("已链接 Antigravity。打开新会话，或在 agy 中运行 /skills reload。", "Linked for Antigravity. Start a new session or run /skills reload in agy."))
            case .claude:
                show(label("已链接 Claude Code。请在新会话中使用 /equation-lab。", "Linked for Claude Code. Use /equation-lab in a new session."))
            case .dsh:
                show(label("DSH 默认读取共享目录。使用自定义配置时，请将共享目录加入 customSkillDirs。", "DSH reads shared Skills by default. For a custom profile, add the shared Skills folder to customSkillDirs."))
            case nil:
                show(label("共享 Skill 已就绪。", "Shared Skill is ready."))
            }
        } catch let conflict as EquationLabSkillInstallation.Conflict {
            show(label("这个位置已有同名 Skill。\n\(conflict.destination.path)",
                       "A Skill with this name already exists at:\n\(conflict.destination.path)"), error: true)
        } catch {
            show(label("无法设置 Skill。请检查目标目录的写入权限。", "Could not set up the Skill. Check write access to the destination."), error: true)
        }
    }

    private func exportSkill(_ installer: EquationLabSkillInstallation) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = label("导出", "Export")
        panel.message = label("选择存放 equation-lab Skill 文件夹的位置。", "Choose a destination for the equation-lab Skill folder.")
        panel.begin { result in
            guard result == .OK, let directory = panel.url else { return }
            do {
                let destination = try installer.install(in: directory)
                show(label("Skill 文件夹已准备好。", "The Skill folder is ready."))
                NSWorkspace.shared.activateFileViewerSelecting([destination])
            } catch is EquationLabSkillInstallation.Conflict {
                show(label("这个位置已有同名 Skill。请选择其他导出位置。", "This location already contains a Skill with this name. Choose another export location."), error: true)
            } catch {
                show(label("无法导出 Skill。请检查目标目录的写入权限。", "Could not export the Skill. Check write access to the destination."), error: true)
            }
        }
    }

    private func show(_ message: String, error: Bool = false) {
        statusRevision += 1
        feedback = message
        feedbackIsError = error
    }

    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
}
