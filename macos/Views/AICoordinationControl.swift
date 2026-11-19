import SwiftUI
import AppKit

struct AICoordinationControl: View {
    let english: Bool
    let openSkillSetup: () -> Void
    @StateObject private var monitor = AICoordinationMonitor()
    @State private var showingPanel = false
    @State private var copied = false

    var body: some View {
        Button {
            copied = false
            showingPanel.toggle()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sparkles").font(.system(size: 13, weight: .medium))
                Text("AI").font(.system(size: 11, weight: .semibold))
                if monitor.isEnabled {
                    Circle().fill(statusColor).frame(width: 5, height: 5)
                }
            }
            .foregroundStyle(monitor.isEnabled ? .primary : .secondary)
            .frame(height: 26)
            .fixedSize()
        }
        .buttonStyle(WorkbenchButtonStyle(tint: .purple, selected: showingPanel, horizontalPadding: 5))
        .help(status)
        .accessibilityLabel(label("AI 协作", "AI collaboration"))
        .accessibilityValue(status)
        .popover(isPresented: $showingPanel, arrowEdge: .bottom) { panel }
        .task(id: monitor.isEnabled) { await monitor.observe() }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: Binding(get: { monitor.isEnabled }, set: { monitor.setEnabled($0) })) {
                Text(label("AI 协作", "AI collaboration")).font(.headline)
            }
            .toggleStyle(.switch)

            HStack(spacing: 7) {
                if monitor.activity?.phase == .running {
                    ProgressView().controlSize(.small)
                } else {
                    Circle().fill(statusColor).frame(width: 7, height: 7)
                }
                Text(status).font(.callout.weight(.medium))
            }
            .accessibilityElement(children: .combine)

            if monitor.hasStorageError {
                Text(label("无法更新协作开关，请重试。", "Couldn’t update the switch. Try again."))
                    .font(.caption).foregroundStyle(.orange)
            }

            Text(label("在 AI 会话中使用 $equation-lab。App 在这里显示本机任务的状态。批量编辑输出新副本。",
                       "Use $equation-lab in your AI session. This panel shows local task status. Batch edits write a new copy."))
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if monitor.isEnabled {
                Text(label("关闭协作后，已启动的命令仍会继续。", "Commands already started continue after you switch this off."))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Button {
                    NSPasteboard.general.clearContents()
                    copied = NSPasteboard.general.setString(label(
                        "使用 $equation-lab 查看我指定的 Word 文件。先列出公式和编号，按我的要求一次批量处理，写入新副本并核对原有引用。",
                        "Use $equation-lab with the Word file I specify. List its equations and numbers, apply the changes I request in one batch, write a new copy, and verify its existing references."), forType: .string)
                } label: {
                    Label(copied ? label("已复制", "Copied") : label("复制给 AI", "Copy for AI"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                Spacer(minLength: 4)
                Button(label("安装或导出 Skill…", "Install or Export Skill…")) {
                    showingPanel = false
                    openSkillSetup()
                }
            }
        }
        .padding(16)
        .frame(width: 306, alignment: .leading)
    }

    private var statusColor: Color {
        guard monitor.isEnabled else { return .secondary }
        switch monitor.activity?.phase {
        case .completed: return .green
        case .failed, .unconfirmed: return .orange
        case .running, nil: return .blue
        }
    }

    private var status: String {
        guard monitor.isEnabled else { return label("协作关闭", "Collaboration off") }
        guard let activity = monitor.activity else { return label("就绪 · 等待本机任务", "Ready for local work") }
        let operation = operationName(activity.operation)
        switch activity.phase {
        case .running:
            return activity.activeCount > 1
                ? label("正在运行 \(activity.activeCount) 个任务", "\(activity.activeCount) tasks running")
                : label("正在\(operation)", "Working · \(operation)")
        case .completed: return label("\(operation)完成", "Completed · \(operation)")
        case .failed: return label("\(operation)失败", "Failed · \(operation)")
        case .unconfirmed: return label("\(operation)结果待核对", "Result unconfirmed · \(operation)")
        }
    }

    private func operationName(_ operation: AIActivity.Operation) -> String {
        switch operation {
        case .inspect: return label("读取公式", "Read equations")
        case .audit: return label("检查编号与引用", "Check numbers and references")
        case .create: return label("生成公式文档", "Create a formula document")
        case .edit: return label("编辑公式副本", "Edit an equation copy")
        case .arrange: return label("调整公式编排", "Arrange equations")
        case .planNumbering: return label("预检编号", "Plan numbering")
        case .applyNumbering: return label("写入编号副本", "Save a numbered copy")
        case .planTypography: return label("预检样式", "Plan typography")
        case .applyTypography: return label("写入样式副本", "Save a styled copy")
        }
    }

    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
}
