import SwiftUI

struct AppUpdateSheet: View {
    @ObservedObject var updater: AppUpdater
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss
    private var title: String {
        switch updater.phase {
        case .checking: "正在检查更新…"
        case .current: "已经是最新版本"
        case .available: "有新版本可以用了"
        case .downloading: "正在下载更新…"
        case .verifying: "正在校验安装包…"
        case .ready: "更新已准备好"
        case .failed: "更新暂未完成"
        case .idle: "Equation Lab 更新"
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 16) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 64, height: 64)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(bridge.t(title)).font(.title2.bold())
                    HStack(spacing: 8) {
                        Text("\(updater.currentVersion) (\(updater.currentBuild))").foregroundStyle(.secondary)
                        if let update = updater.manifest {
                            Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                            Text("\(update.version) (\(update.build))").foregroundStyle(.blue)
                        }
                    }.font(.system(.callout, design: .rounded)).monospacedDigit()
                }
                Spacer()
            }
            if let update = updater.manifest {
                ScrollView {
                    Text(bridge.language.usesEnglish ? update.notesEN : update.notesZH)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 140)
                if updater.phase == .downloading {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: updater.progress)
                        Text("\(Int(updater.progress * 100))% · \(ByteCountFormatter.string(fromByteCount: update.size, countStyle: .file))")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                } else if updater.phase == .checking || updater.phase == .verifying { ProgressView().controlSize(.small) }
                Text(bridge.t("安装前请保存公式并完全退出 Word。更新会同时维护 Word 插件，已有文档和收藏会保留。"))
                    .font(.callout).foregroundStyle(.secondary)
            } else if updater.phase == .checking { ProgressView().controlSize(.small) }
            if !updater.errorMessage.isEmpty {
                Label(bridge.t(updater.errorMessage), systemImage: "exclamationmark.circle")
                    .font(.callout).foregroundStyle(.orange).textSelection(.enabled)
            }
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                Toggle(bridge.t("自动检查更新（每天一次）"), isOn: $updater.automaticChecks)
                    .onChange(of: updater.automaticChecks) { _, enabled in if enabled { updater.checkAutomaticallyIfDue() } }
                Toggle(bridge.t("发现新版时自动下载安装包"), isOn: $updater.automaticDownloads)
                    .onChange(of: updater.automaticDownloads) { _, enabled in if enabled && updater.phase == .available { updater.download() } }
                Text(bridge.t("只向 GitHub 请求版本和安装包，不发送公式或文档。下载后仍由你决定何时安装。"))
                    .font(.caption).foregroundStyle(.secondary)
                if let date = updater.lastChecked {
                    Text(bridge.t("上次检查：") + date.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.toggleStyle(.checkbox)
            HStack {
                Link(bridge.t("GitHub 发布说明"), destination: updater.releaseURL)
                Spacer()
                Button(bridge.t("关闭")) { dismiss() }.keyboardShortcut(.cancelAction)
                if updater.working {
                    Button(bridge.t("取消")) { updater.cancel() }
                } else if updater.phase == .ready {
                    Button(bridge.t("安装更新…")) { updater.install(bridge: bridge) }
                        .buttonStyle(.borderedProminent)
                        .disabled(bridge.wordSessionActive || bridge.state.busy || bridge.installationRunning)
                } else if updater.manifest != nil && updater.phase != .failed {
                    Button(bridge.t("下载更新")) { updater.download() }.buttonStyle(.borderedProminent)
                } else {
                    Button(bridge.t("检查更新")) { updater.check() }.buttonStyle(.borderedProminent)
                }
            }
        }.padding(26).frame(width: 510)
    }
}
