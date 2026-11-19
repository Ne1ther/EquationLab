import SwiftUI

struct NumberingFormatEditor: View {
    @ObservedObject var bridge: DesktopBridge
    let field: EditorField
    @State private var draft = ""
    @State private var preview = ""
    @State private var invalid = false
    @State private var requestID = UUID()

    private let presets = [
        ("(#E1)", "(1)"), ("(#C1.#E1)", "(1.1)"),
        ("(#C1.#S1.#E1)", "(1.1.1)"), ("[#E1]", "[1]"),
        ("(#C1-#E1)", "(1-1)"), ("(#EI)", "(I)")
    ]
    private var english: Bool { bridge.language.usesEnglish }
    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
    private var chapter: Int { counter("layout-chapter", fallback: bridge.state.numbering?.chapter ?? 1) }
    private var section: Int { counter("layout-section", fallback: bridge.state.numbering?.section ?? 1) }
    private var equation: Int { bridge.state.wordNumberingRestarts ? 1 : bridge.state.numbering?.equation ?? bridge.state.wordInsertionEquation ?? 1 }
    private var hasPendingNumberingChange: Bool {
        guard bridge.wordSessionActive, !bridge.wordSessionIsInsertion, !field.disabled, let number = bridge.state.numbering else { return false }
        return draft != (number.format ?? field.value) || bridge.state.wordNumberingRestarts
    }
    private var hasLoadedDocument: Bool { !bridge.state.documentPath.isEmpty }
    private var hasStaleNumbering: Bool {
        bridge.state.objects.contains { $0.numberStatus == "stale" }
    }
    private var canRefreshWorkspace: Bool {
        !bridge.state.busy && !bridge.state.wordDocumentLoading && !bridge.state.wordOutcomeUnknown && !bridge.state.wordDocumentUnavailable
    }
    private var canInspectDocument: Bool {
        hasLoadedDocument && !bridge.state.busy && !bridge.state.wordDocumentLoading && !bridge.state.wordDocumentLoadFailed && !bridge.state.wordDocumentUnavailable && !bridge.state.wordOutcomeUnknown && !hasStaleNumbering
    }
    private var canRunBatchNumbering: Bool { canInspectDocument && !invalid && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var batchUnavailableReason: String? {
        if bridge.state.wordDocumentLoading {
            return label("正在载入完整文档，完成后可预检批量重编。", "Loading the full document. Batch preview unlocks once loaded.")
        }
        if bridge.state.wordDocumentLoadFailed {
            return label("完整文档载入失败。刷新文档后可预检批量重编。", "The document could not be fully loaded. Refresh it before running a batch preview.")
        }
        if bridge.state.wordDocumentUnavailable {
            return label("文档连接已结束，暂不能基于原文档预检。", "Document connection ended. Preflight is unavailable.")
        }
        if bridge.state.wordOutcomeUnknown {
            return label("请先确认上次 Word 保存结果，再进行批量操作。", "Confirm the previous Word save before running batch tools.")
        }
        if hasStaleNumbering {
            return label("Word 中的编号已更新，请先刷新文档快照后再修改编号或预检。", "Word numbers changed. Refresh the document snapshot before applying numbering or running preflight.")
        }
        if invalid {
            return label("请先修正上方编号格式，再进行批量预检。", "Fix the number format above before running a batch preview.")
        }
        return nil
    }
    private var previewKey: String { "\(draft)|\(chapter)|\(section)|\(equation)" }
    private func counter(_ id: String, fallback: Int) -> Int {
        guard let value = bridge.state.layout.first(where: { $0.id == id })?.value, !value.isEmpty else { return fallback }
        return Int(value) ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let format = bridge.state.documentNumberFormat {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(bridge.t("文档默认格式"))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Text(format)
                            .font(.caption.monospaced().weight(.medium))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                            .textSelection(.enabled)
                    }
                    HStack(alignment: .center, spacing: 6) {
                        Text(label("仅用于本篇后续新增的编号公式。", "Used for new numbered equations in this document."))
                            .font(.caption2).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button(bridge.t("使用文档默认格式")) { bridge.invoke("nativeUseDocumentNumberFormat") }
                            .controlSize(.mini)
                            .disabled(field.disabled)
                    }
                }
                .padding(9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                        .allowsHitTesting(false)
                }
            }

            Picker(bridge.t("常用编号"), selection: Binding(get: {
                presets.contains(where: { $0.0 == draft }) ? draft : "custom"
            }, set: { value in if value != "custom" { editFormat(value) } })) {
                ForEach(presets, id: \.0) { Text($0.1).tag($0.0) }
                Text(bridge.t("自定义")).tag("custom")
            }.controlSize(.small).disabled(field.disabled)

            TextField(bridge.t("自定义编号格式"), text: Binding(get: { draft }, set: editFormat), prompt: Text("(#C1.#E1)"))
                .textFieldStyle(.roundedBorder).font(.system(.body, design: .monospaced))
                .accessibilityLabel(bridge.t("自定义编号格式"))
                .disabled(field.disabled)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(bridge.t("格式预览")).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    scopeTag
                }
                if invalid {
                    Text(bridge.t("格式无效：包含一个 #E 序号，章、节和序号各用一次；数字需在 1–32767 之间。"))
                        .font(.caption).foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                } else if field.disabled && bridge.state.wordDocumentLoading {
                    Text(label("正在读取 Word 编号…", "Loading numbers from Word…"))
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    numberBadge(preview.isEmpty ? "…" : preview)
                        .accessibilityLabel(bridge.t("格式预览")).accessibilityValue(preview)
                    counters(chapter, section, equation)
                    if bridge.state.numbering?.equation == nil && bridge.state.wordInsertionEquation == nil {
                        Text(bridge.t("以上为示例计数，实际序号由 Word 更新。")).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(.quaternary.opacity(0.65), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            if hasPendingNumberingChange {
                Label(bridge.t("尚未写入 Word：请点击“更新公式”。"), systemImage: "exclamationmark.circle.fill")
                    .font(.caption).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            scopeConsequenceNote

            if bridge.state.layout.contains(where: { ($0.id == "layout-chapter" || $0.id == "layout-section") && !$0.disabled }) {
                Text(bridge.t("章、节来自当前位置的编号字段；修改后从当前公式重新起号，无需先给 Word 标题分章。"))
                    .font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let number = bridge.state.numbering {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(bridge.t("文档中的编号")).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        Spacer()
                        if number.actualNumber == nil && number.mode == "unknown" && bridge.state.wordDocumentLoading {
                            Text(label("载入中", "Loading")).font(.caption).foregroundStyle(.secondary)
                        } else {
                            numberBadge(number.actualNumber ?? bridge.t(number.mode == "unknown" ? "未读取" : "未编号"))
                        }
                    }
                    if number.hasDocumentContext {
                        HStack(spacing: 4) {
                            Text(english ? "Equation" : "文档中的第").foregroundStyle(.secondary)
                            Text("\(number.position)").foregroundStyle(.blue).fontWeight(.semibold)
                            Text("/ \(number.total)" + (english ? "" : " 个公式")).foregroundStyle(.secondary)
                        }.font(.callout).monospacedDigit().accessibilityElement(children: .combine)
                    } else if !bridge.state.wordDocumentLoading {
                        Text(bridge.t("未读取整篇文档信息")).font(.caption).foregroundStyle(.secondary)
                    }
                    if number.actualNumber != nil {
                        counters(number.chapter, number.section, number.equation)
                        if let references = number.referenceCount {
                            HStack(spacing: 4) {
                                Text(english ? "References" : "当前正文引用").foregroundStyle(.secondary)
                                Text("\(references)").foregroundStyle(.blue).fontWeight(.semibold)
                                if !english { Text("处").foregroundStyle(.secondary) }
                            }.font(.callout).accessibilityElement(children: .combine)
                        }
                        if let format = number.format {
                            Text(bridge.t("原格式") + "  " + format)
                                .font(.caption.monospaced()).foregroundStyle(.primary).textSelection(.enabled)
                        }
                    }
                    if bridge.wordSessionActive && !bridge.wordSessionIsInsertion && number.actualNumber == nil {
                        Button(bridge.t("为当前公式添加编号")) { bridge.invoke("nativeApplyNumberingFormat") }
                            .controlSize(.small)
                            .disabled(field.disabled)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                        .allowsHitTesting(false)
                }
            }

            if hasLoadedDocument {
                batchNumberingCard
            }

            Text(bridge.t("#C 为章、#S 为节、#E 为公式；1 为数字，A/a 为字母，I/i 为罗马数字。"))
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear { draft = field.value.isEmpty ? "(#E1)" : field.value; refreshPreview() }
        .onChange(of: field.value) { _, value in let next = value.isEmpty ? "(#E1)" : value; if next != draft { draft = next } }
        .onChange(of: previewKey) { _, _ in refreshPreview() }
    }

    private func editFormat(_ value: String) {
        guard !field.disabled else { return }
        draft = value
        if value != field.value { bridge.fieldBinding(field.id, fallback: field.value).wrappedValue = value }
    }

    @ViewBuilder
    private var scopeTag: some View {
        if bridge.wordSessionIsInsertion {
            statusPill(label("本次插入", "This insertion"), tint: .blue)
        } else if bridge.wordSessionActive {
            statusPill(label("当前公式 + 后续默认", "This eq. + new default"), tint: .blue)
        } else if bridge.state.canArrange {
            statusPill(label("副本编排", "Copy layout"), tint: .secondary)
        }
    }

    @ViewBuilder
    private var scopeConsequenceNote: some View {
        if bridge.wordSessionIsInsertion {
            Text(label(
                "仅用于本次插入的新公式，不会改写文档中已有编号；章、节和序号由 Word 提供。",
                "Applies to this newly inserted equation only. Existing numbers in Word stay unchanged; Word supplies the counters."
            ))
            .font(.caption2).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        } else if bridge.wordSessionActive {
            if field.disabled && !bridge.state.wordDocumentLoading {
                Text(bridge.t("文档编号信息尚不可用，暂不能更改编号格式。"))
                    .font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !field.disabled {
                Text(label(
                    "点击“更新公式”仅改当前公式，并将此格式设为后续新增公式默认；不会自动重编文档中其他已有编号。",
                    "Update Equation changes only this equation and sets the default for future equations. Other existing numbers in Word are not renumbered."
                ))
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        } else if bridge.state.canArrange {
            Text(bridge.t("更改格式后，另存编排后的 Word 副本即可应用。"))
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var batchNumberingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "doc.badge.gearshape")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tint)
                Text(label("批量重编与新公式默认（另存副本）", "Batch renumber & default (copy)"))
                    .font(.caption.weight(.semibold))
            }
            Text(label(
                "如需统一重编全文已有编号，或只更新文档新公式默认，可先预检受影响公式再另存新副本；原 Word 文档不会被直接改写。",
                "To renumber existing equations across the document or update the future-formula default, preview affected items first and save a new copy. The original Word document stays untouched."
            ))
            .font(.caption2).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 5) {
                Button {
                    bridge.invoke("nativeDocumentNumberingPlan", argument: "all")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "list.number")
                        Text(label("预检重编全部已有编号（副本）…", "Preview renumbering all existing (copy)…"))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(WorkbenchButtonStyle(tint: .accentColor, surface: true, horizontalPadding: 8))
                .disabled(!canRunBatchNumbering)

                Button {
                    bridge.invoke("nativeDocumentNumberingPlan", argument: "future")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "text.badge.plus")
                        Text(label("仅设为后续新公式默认（副本）…", "Set default for future formulas only (copy)…"))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(WorkbenchButtonStyle(tint: .accentColor, surface: true, horizontalPadding: 8))
                .disabled(!canRunBatchNumbering)

                if !bridge.wordSessionActive && bridge.state.selected != nil {
                    Button {
                        bridge.invoke("nativeDocumentNumberingPlan", argument: "current")
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "number.square")
                            Text(label("仅预检当前公式编号（副本）…", "Preview current equation only (copy)…"))
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(WorkbenchButtonStyle(tint: .accentColor, surface: true, horizontalPadding: 8))
                    .disabled(!canRunBatchNumbering)
                }

                Button {
                    bridge.invoke("nativeDocumentAudit")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checklist")
                        Text(label("检查全文编号与正文引用…", "Check numbers & references…"))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(WorkbenchButtonStyle(tint: .secondary, horizontalPadding: 8))
                .disabled(!canInspectDocument)
            }
            .font(.caption)

            if let reason = batchUnavailableReason {
                VStack(alignment: .leading, spacing: 5) {
                    Text(reason)
                        .font(.caption2).foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    if hasStaleNumbering {
                        Button(label("刷新文档快照", "Refresh snapshot")) {
                            bridge.invoke("nativeRefreshWordWorkspace")
                        }
                        .controlSize(.mini)
                        .disabled(!canRefreshWorkspace)
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.42), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }

    private func statusPill(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private func numberBadge(_ value: String) -> some View {
        Text(value).font(.system(size: 21, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(.black).padding(.horizontal, 9).padding(.vertical, 3)
            .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 6, style: .continuous)).textSelection(.enabled)
    }
    private func counters(_ chapter: Int?, _ section: Int?, _ equation: Int?) -> some View {
        HStack(spacing: 10) {
            ForEach(Array([(bridge.t("章"), chapter), (bridge.t("节"), section), (bridge.t("公式序号"), equation)].enumerated()), id: \.offset) { _, item in
                if let value = item.1 {
                    HStack(spacing: 4) { Text(item.0).foregroundStyle(.secondary); Text("\(value)").foregroundStyle(.blue).fontWeight(.semibold) }
                }
            }
        }.font(.caption).monospacedDigit().accessibilityElement(children: .combine)
    }

    private func refreshPreview() {
        let current = UUID(); requestID = current
        preview = ""; invalid = false
        bridge.previewNumbering(draft, chapter: chapter, section: section, equation: equation) { value in
            guard requestID == current else { return }
            preview = value ?? ""; invalid = value == nil
        }
    }
}
