import AppKit
import SwiftUI

struct SkillInstallationCard: View {
    let english: Bool
    @Environment(\.colorScheme) private var colorScheme

    private enum LoadState {
        case loading
        case unavailable
        case ready(EquationLabSkillInstallation, EquationLabSkillInstallation.StatusSnapshot)
    }

    @State private var loadState: LoadState = .loading
    @State private var feedback: String?
    @State private var feedbackIsError = false
    @State private var showingOtherClients = false
    @State private var copied = false
    @State private var guidedClient: Client?
    @State private var copiedInvocation = false
    @State private var checking = false
    @State private var operationInFlight = false
    @State private var stateGeneration = 0
    @State private var activeOperation: Task<Void, Never>?
    @StateObject private var exportHandoff = PopoverActionHandoff()

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

        func icon(dark: Bool) -> NSImage? {
            switch self {
            case .codex: WorkbenchArtwork.codex
            case .antigravity: WorkbenchArtwork.antigravity
            case .claude: WorkbenchArtwork.claudeCode
            case .dsh: dark ? WorkbenchArtwork.deepSeekHarnessDark : WorkbenchArtwork.deepSeekHarness
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

    private enum ClientStatus: Equatable {
        case checking, ready, notInstalled, notLinked, unverified, needsUpdate, conflict
    }

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                switch loadState {
                case .loading:
                    header(nil, shared: nil)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(Client.allCases, id: \.self) { client in
                            clientButton(client, installer: nil, snapshot: nil)
                        }
                    }
                    otherClientsButton(nil)
                case .ready(let installer, let snapshot):
                    header(installer, shared: snapshot.shared)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(Client.allCases, id: \.self) { client in
                            clientButton(client, installer: installer, snapshot: snapshot)
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
                    if let guidedClient {
                        clientGuide(guidedClient)
                    }
                case .unavailable:
                    Text("Equation Lab Skill").font(.headline)
                    Text(label("这个构建没有随附 Skill 运行环境。", "The Skill runtime is unavailable in this build."))
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }
        .task {
            await loadInitialStatus()
        }
        .onDisappear {
            exportHandoff.cancel()
            activeOperation?.cancel()
            activeOperation = nil
        }
    }

    private func header(
        _ installer: EquationLabSkillInstallation?,
        shared: EquationLabSkillInstallation.Existing?
    ) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Equation Lab Skill", systemImage: "sparkles").font(.headline)
                Text(verbatim: "~/.agents/skills/equation-lab")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)
            Button {
                if let installer { checkStatus(installer) }
            } label: {
                HStack(spacing: 5) {
                    if checking {
                        ProgressView().controlSize(.small)
                    }
                    Text(checking ? label("检测中…", "Checking…") : label("检测 Skill", "Check Skill"))
                }
                .fixedSize()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(installer == nil || operationInFlight)
            .help(label("重新检查本机共享 Skill 与客户端链接", "Recheck the shared Skill and client links on this Mac"))

            if shared == .current || shared == .linked {
                Label(label("已安装", "Installed"), systemImage: "checkmark.circle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.green)
                    .fixedSize()
            } else {
                Button(
                    shared == .upgrade || shared == .relink
                        ? label("更新共享 Skill", "Update Shared Skill")
                        : label("安装共享 Skill", "Install Shared Skill")
                ) {
                    if let installer { prepare(installer) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .fixedSize()
                .disabled(installer == nil || operationInFlight || shared == .conflict)
            }
        }
    }

    private func clientButton(
        _ client: Client,
        installer: EquationLabSkillInstallation?,
        snapshot: EquationLabSkillInstallation.StatusSnapshot?
    ) -> some View {
        let status = clientStatus(client, snapshot: snapshot)
        let action: String = switch status {
        case .checking: label("正在检测…", "Checking…")
        case .ready: client.link == nil ? label("共享 Skill 已安装", "Shared Skill installed") : label("共享 Skill 已链接", "Shared Skill linked")
        case .notInstalled: label("安装共享 Skill", "Install shared Skill")
        case .notLinked: label("链接共享 Skill", "Link shared Skill")
        case .unverified: label("已有链接 · 待核验", "Link unverified")
        case .needsUpdate: label("共享 Skill 待更新", "Shared Skill needs update")
        case .conflict: label("已有同名项", "Name conflict")
        }
        let symbol: String = switch status {
        case .checking: "ellipsis"
        case .ready: "checkmark.circle.fill"
        case .notInstalled: "arrow.down"
        case .notLinked: "link"
        case .unverified: "questionmark.circle"
        case .needsUpdate: "arrow.clockwise"
        case .conflict: "exclamationmark.triangle.fill"
        }
        let symbolColor: Color = switch status {
        case .ready: .green
        case .conflict: .orange
        default: .secondary
        }
        return Button {
            if status == .ready {
                showClientGuide(client)
            } else if let installer {
                prepare(installer, for: client)
            }
        } label: {
            HStack(spacing: 8) {
                Group {
                    if let icon = client.icon(dark: colorScheme == .dark) {
                        Image(nsImage: icon)
                            .resizable()
                            .renderingMode(client == .codex ? .template : .original)
                            .scaledToFit()
                            .frame(width: 20, height: 20)
                    }
                }
                .frame(width: 28, height: 28)
                .foregroundStyle(.primary)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(client.name).font(.callout.weight(.semibold))
                    Text(action).font(.caption).foregroundStyle(status == .conflict ? Color.orange : Color.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(symbolColor)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 5)
        }
        .buttonStyle(WorkbenchButtonStyle(tint: .accentColor, surface: true, horizontalPadding: 8))
        .disabled(installer == nil || operationInFlight)
        .accessibilityLabel(client.name + ", " + action)
        .accessibilityHint(status == .ready ? label("显示用法并提供可复制的指令", "Show usage and a command to copy") : action)
    }

    private func clientStatus(_ client: Client, snapshot: EquationLabSkillInstallation.StatusSnapshot?) -> ClientStatus {
        guard let snapshot else { return .checking }
        if snapshot.shared == .conflict { return .conflict }
        if let target = client.link {
            switch snapshot.linkStatus(for: target) {
            case .conflict: return .conflict
            case .unverifiedLink: return .unverified
            case .notLinked:
                return snapshot.shared == .available ? .notInstalled : .notLinked
            case .linked: break
            }
        }
        switch snapshot.shared {
        case .current, .linked: return .ready
        case .available: return .notInstalled
        case .relink, .upgrade: return .needsUpdate
        case .unverifiedLink: return .unverified
        case .conflict: return .conflict
        }
    }

    private func clientGuide(_ client: Client) -> some View {
        let instruction: String = switch client {
        case .codex: label("在 Codex 新会话里粘贴指令。", "Paste the command in a new Codex session.")
        case .antigravity: label("打开新会话，或先在 agy 里运行 /skills reload。", "Start a new session or run /skills reload in agy first.")
        case .claude: label("在 Claude Code 新会话里粘贴指令。", "Paste the command in a new Claude Code session.")
        case .dsh: label("在 Harness 新会话里粘贴。使用自定义配置时，在 customSkillDirs 中加入共享目录。", "Paste in a new Harness session. For a custom profile, add the shared folder to customSkillDirs.")
        }
        let invocation: String = switch client {
        case .codex: "$equation-lab"
        case .claude: "/equation-lab"
        case .antigravity, .dsh: label("请使用 equation-lab Skill，先说明你能做哪些 Word 公式操作。", "Use the equation-lab Skill and list the Word equation actions you can perform.")
        }
        return HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(client.name).font(.callout.weight(.semibold))
                Text(instruction).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            Button(copiedInvocation ? label("已复制", "Copied") : label("复制指令", "Copy command")) {
                NSPasteboard.general.clearContents()
                copiedInvocation = NSPasteboard.general.setString(invocation, forType: .string)
            }
            .controlSize(.small)
            .fixedSize()
        }
    }

    private func otherClientsButton(_ installer: EquationLabSkillInstallation?) -> some View {
        Button {
            copied = false
            if !showingOtherClients { exportHandoff.cancel() }
            showingOtherClients.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 28, height: 28)
                    .foregroundStyle(.secondary)
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
        .disabled(installer == nil || operationInFlight)
        .popover(isPresented: $showingOtherClients, arrowEdge: .bottom) {
            if let installer {
                otherClientsGuide(installer)
            }
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
                    exportHandoff.trigger(dismissPopover: { showingOtherClients = false }) {
                        exportSkill(installer)
                    }
                }
                .disabled(operationInFlight)
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
        .onAppear { exportHandoff.popoverDidAppear() }
        .onDisappear { exportHandoff.popoverDidDisappear() }
    }

    @MainActor
    private func loadInitialStatus() async {
        let generation = stateGeneration
        let loaded: (EquationLabSkillInstallation, EquationLabSkillInstallation.StatusSnapshot)? =
            await Task.detached(priority: .userInitiated) {
                guard let installer = EquationLabSkillInstallation.bundled else { return nil }
                return (installer, installer.statusSnapshot())
            }.value
        guard !Task.isCancelled, generation == stateGeneration else { return }
        guard let (installer, snapshot) = loaded else {
            loadState = .unavailable
            return
        }
        loadState = .ready(installer, snapshot)
        guard feedback == nil else { return }
        showStatus(snapshot, checked: false)
    }

    @MainActor
    private func checkStatus(_ installer: EquationLabSkillInstallation) {
        guard !operationInFlight else { return }
        operationInFlight = true
        checking = true
        stateGeneration += 1
        let generation = stateGeneration
        activeOperation = Task { @MainActor in
            let snapshot = await Task.detached(priority: .userInitiated) {
                installer.statusSnapshot()
            }.value
            operationInFlight = false
            checking = false
            activeOperation = nil
            guard !Task.isCancelled, generation == stateGeneration else { return }
            loadState = .ready(installer, snapshot)
            if let guidedClient, clientStatus(guidedClient, snapshot: snapshot) != .ready {
                self.guidedClient = nil
            }
            showStatus(snapshot, checked: true)
        }
    }

    private func showStatus(_ snapshot: EquationLabSkillInstallation.StatusSnapshot, checked: Bool) {
        switch snapshot.shared {
        case .current, .linked:
            if checked {
                show(label("绿勾表示本机 Skill 已安装或已链接。选择客户端查看用法。",
                           "A green check confirms a local Skill or link. Select a client to see how to use it."))
            }
        case .unverifiedLink:
            show(label("共享目录使用手工链接。目标内容待核验。",
                       "The shared folder uses a manual link. Its target is unverified."))
        case .relink:
            show(label("App 位置已变化。更新共享 Skill 即可恢复连接。", "The app moved. Update the shared Skill to restore its connection."))
        case .upgrade:
            show(label("共享 Skill 有可用更新。", "A shared Skill update is available."))
        case .conflict:
            show(label("共享目录已有同名 Skill。可从「其他客户端」导出此版本。",
                       "The shared folder already contains a Skill with this name. Export this version from Other clients."), error: true)
        case .available:
            if checked {
                show(label("本机还没有安装共享 Skill。", "The shared Skill is not installed on this Mac."))
            }
        }
    }

    private func showClientGuide(_ client: Client) {
        feedback = nil
        guidedClient = client
        copiedInvocation = false
    }

    @MainActor
    private func prepare(_ installer: EquationLabSkillInstallation, for client: Client? = nil) {
        guard !operationInFlight else { return }
        operationInFlight = true
        guidedClient = nil
        stateGeneration += 1
        let generation = stateGeneration
        let linkTarget = client?.link
        activeOperation = Task { @MainActor in
            let outcome: (Result<Void, Error>, EquationLabSkillInstallation.StatusSnapshot) =
                await Task.detached(priority: .userInitiated) {
                    let result: Result<Void, Error>
                    do {
                        if let linkTarget {
                            try installer.link(linkTarget)
                        } else {
                            try installer.install(in: installer.sharedDirectory)
                        }
                        result = .success(())
                    } catch {
                        result = .failure(error)
                    }
                    return (result, installer.statusSnapshot())
                }.value
            operationInFlight = false
            activeOperation = nil
            guard !Task.isCancelled, generation == stateGeneration else { return }
            loadState = .ready(installer, outcome.1)
            switch outcome.0 {
            case .success:
                if let client {
                    showClientGuide(client)
                } else if outcome.1.shared != .unverifiedLink {
                    show(label("共享 Skill 已安装。选择客户端查看用法。", "Shared Skill installed. Select a client to see how to use it."))
                }
                if outcome.1.shared == .unverifiedLink {
                    showStatus(outcome.1, checked: false)
                }
            case .failure(let conflict as EquationLabSkillInstallation.Conflict):
                show(label("这个位置已有同名 Skill。\n\(conflict.destination.path)",
                           "A Skill with this name already exists at:\n\(conflict.destination.path)"), error: true)
            case .failure:
                show(label("无法设置 Skill。请检查目标目录的写入权限。", "Could not set up the Skill. Check write access to the destination."), error: true)
            }
        }
    }

    @MainActor
    private func exportSkill(_ installer: EquationLabSkillInstallation) {
        guard !operationInFlight else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = label("导出", "Export")
        panel.message = label("选择存放 equation-lab Skill 文件夹的位置。", "Choose a destination for the equation-lab Skill folder.")
        panel.begin { result in
            guard result == .OK, let directory = panel.url else { return }
            Task { @MainActor in
                guard !operationInFlight else { return }
                operationInFlight = true
                stateGeneration += 1
                let generation = stateGeneration
                activeOperation = Task { @MainActor in
                    let outcome: (Result<URL, Error>, EquationLabSkillInstallation.StatusSnapshot) =
                        await Task.detached(priority: .userInitiated) {
                            let result: Result<URL, Error>
                            do {
                                result = .success(try installer.install(in: directory))
                            } catch {
                                result = .failure(error)
                            }
                            return (result, installer.statusSnapshot())
                        }.value
                    operationInFlight = false
                    activeOperation = nil
                    guard !Task.isCancelled, generation == stateGeneration else { return }
                    loadState = .ready(installer, outcome.1)
                    switch outcome.0 {
                    case .success(let destination):
                        show(label("Skill 文件夹已准备好。", "The Skill folder is ready."))
                        NSWorkspace.shared.activateFileViewerSelecting([destination])
                    case .failure(is EquationLabSkillInstallation.Conflict):
                        show(label("这个位置已有同名 Skill。请选择其他导出位置。", "This location already contains a Skill with this name. Choose another export location."), error: true)
                    case .failure:
                        show(label("无法导出 Skill。请检查目标目录的写入权限。", "Could not export the Skill. Check write access to the destination."), error: true)
                    }
                }
            }
        }
    }

    private func show(_ message: String, error: Bool = false) {
        feedback = message
        feedbackIsError = error
    }

    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
}
