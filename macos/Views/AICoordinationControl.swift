import SwiftUI
import AppKit

/// Defers a follow-up presentation (sheet or open panel) until after a popover
/// closes so macOS AppKit does not start `beginSheet` or modal panel setup in
/// the same transaction as `NSPopover` dismissal.
@MainActor
final class PopoverActionHandoff: ObservableObject {
    typealias Scheduler = @MainActor (_ delayNanoseconds: UInt64, _ work: @escaping @MainActor () -> Void) -> () -> Void

    private let postDismissDelayNanoseconds: UInt64
    private let fallbackDelayNanoseconds: UInt64
    private let schedule: Scheduler
    private var pendingAction: (() -> Void)?
    private var cancelFallback: (() -> Void)?
    private var cancelDelivery: (() -> Void)?

    init(
        postDismissDelayNanoseconds: UInt64 = 50_000_000,
        fallbackDelayNanoseconds: UInt64 = 350_000_000,
        schedule: @escaping Scheduler = PopoverActionHandoff.defaultSchedule
    ) {
        self.postDismissDelayNanoseconds = postDismissDelayNanoseconds
        self.fallbackDelayNanoseconds = fallbackDelayNanoseconds
        self.schedule = schedule
    }

    var hasPendingAction: Bool { pendingAction != nil }

    func trigger(dismissPopover: () -> Void, action: @escaping () -> Void) {
        guard pendingAction == nil else {
            dismissPopover()
            return
        }
        pendingAction = action
        cancelDelivery?()
        cancelDelivery = nil
        cancelFallback?()
        cancelFallback = schedule(fallbackDelayNanoseconds) { [weak self] in
            self?.deliverIfPending()
        }
        dismissPopover()
    }

    func popoverDidAppear() {
        cancel()
    }

    func popoverDidDisappear() {
        guard pendingAction != nil else { return }
        cancelFallback?()
        cancelFallback = nil
        cancelDelivery?()
        cancelDelivery = schedule(postDismissDelayNanoseconds) { [weak self] in
            self?.deliverIfPending()
        }
    }

    func cancel() {
        pendingAction = nil
        cancelFallback?()
        cancelFallback = nil
        cancelDelivery?()
        cancelDelivery = nil
    }

    private func deliverIfPending() {
        cancelFallback?()
        cancelFallback = nil
        cancelDelivery?()
        cancelDelivery = nil
        guard let action = pendingAction else { return }
        pendingAction = nil
        action()
    }

    static func defaultSchedule(delayNanoseconds: UInt64, work: @escaping @MainActor () -> Void) -> () -> Void {
        let task = Task { @MainActor in
            if delayNanoseconds > 0 {
                try? await Task.sleep(nanoseconds: delayNanoseconds)
            } else {
                await Task.yield()
            }
            guard !Task.isCancelled else { return }
            work()
        }
        return { task.cancel() }
    }
}

struct AICoordinationControl: View {
    let english: Bool
    let openSkillSetup: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingPanel = false
    @State private var copied = false
    @State private var sweep = 0
    @StateObject private var handoff = PopoverActionHandoff()

    private var spectrum: [Color] { [.cyan, .blue, .purple, .pink, .orange] }

    var body: some View {
        Button {
            copied = false
            if !showingPanel { handoff.cancel() }
            showingPanel.toggle()
            if showingPanel && !reduceMotion { sweep += 1 }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LinearGradient(colors: spectrum, startPoint: .bottomLeading, endPoint: .topTrailing))
                aiTitle
            }
            .frame(height: 26)
            .fixedSize()
        }
        .buttonStyle(WorkbenchButtonStyle(tint: .purple, selected: showingPanel, horizontalPadding: 5))
        .help(label("使用 Equation Lab Skill", "Use Equation Lab Skill"))
        .accessibilityLabel(label("AI 技能", "AI Skills"))
        .popover(isPresented: $showingPanel, arrowEdge: .bottom) { panel }
        .onDisappear { handoff.cancel() }
        .task {
            if !reduceMotion && sweep == 0 { sweep += 1 }
        }
    }

    private var aiTitle: some View {
        let title = Text("AI").font(.system(size: 11, weight: .semibold))
        let sweepColors = [.clear] + spectrum + [.clear]
        return title.foregroundStyle(Color.primary)
            .overlay {
                if !reduceMotion {
                    Color.clear.keyframeAnimator(initialValue: -0.5, trigger: sweep) { _, position in
                        LinearGradient(colors: sweepColors,
                                       startPoint: UnitPoint(x: position - 0.5, y: 0.5),
                                       endPoint: UnitPoint(x: position + 0.5, y: 0.5))
                    } keyframes: { _ in
                        MoveKeyframe(-0.5)
                        LinearKeyframe(1.5, duration: 0.85)
                    }
                    .mask { title }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Equation Lab Skill").font(.headline)
            Text(label("让 AI 检查 Word 公式、编号和交叉引用，或把批量修改另存为副本。",
                       "Ask your AI to check Word equations, numbering, and references, or save batch edits to a copy."))
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Button {
                    NSPasteboard.general.clearContents()
                    copied = NSPasteboard.general.setString(label(
                        "请用 equation-lab 技能检查这份 Word 文档的公式、编号和交叉引用。",
                        "Use the equation-lab skill to check this Word document’s equations, numbering, and cross-references."), forType: .string)
                } label: {
                    Label(copied ? label("已复制", "Copied") : label("复制示例", "Copy example"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                Spacer(minLength: 4)
                Button(label("安装或导出 Skill…", "Install or Export Skill…")) {
                    handoff.trigger(dismissPopover: { showingPanel = false }) {
                        openSkillSetup()
                    }
                }
            }
        }
        .padding(16)
        .frame(width: 330, alignment: .leading)
        .onAppear { handoff.popoverDidAppear() }
        .onDisappear { handoff.popoverDidDisappear() }
    }

    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
}
