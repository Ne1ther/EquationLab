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
    private var chapter: Int { counter("layout-chapter", fallback: bridge.state.numbering?.chapter ?? 1) }
    private var section: Int { counter("layout-section", fallback: bridge.state.numbering?.section ?? 1) }
    private var equation: Int { bridge.state.numbering?.equation ?? 1 }
    private var previewKey: String { "\(draft)|\(chapter)|\(section)|\(equation)" }
    private func counter(_ id: String, fallback: Int) -> Int {
        guard let value = bridge.state.layout.first(where: { $0.id == id })?.value, !value.isEmpty else { return fallback }
        return Int(value) ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker(bridge.t("常用编号"), selection: Binding(get: {
                presets.contains(where: { $0.0 == draft }) ? draft : "custom"
            }, set: { value in if value != "custom" { draft = value } })) {
                ForEach(presets, id: \.0) { Text($0.1).tag($0.0) }
                Text(bridge.t("自定义")).tag("custom")
            }.controlSize(.small)
            TextField(bridge.t("自定义编号格式"), text: $draft, prompt: Text("(#C1.#E1)"))
                .textFieldStyle(.roundedBorder).font(.system(.body, design: .monospaced))
                .accessibilityLabel(bridge.t("自定义编号格式"))

            VStack(alignment: .leading, spacing: 6) {
                Text(bridge.t("格式预览")).font(.caption).foregroundStyle(.secondary)
                if invalid {
                    Text(bridge.t("格式无效：包含一个 #E 序号，章、节和序号各用一次；数字需在 1–32767 之间。"))
                        .font(.caption).foregroundStyle(.red)
                } else {
                    numberBadge(preview.isEmpty ? "…" : preview)
                        .accessibilityLabel(bridge.t("格式预览")).accessibilityValue(preview)
                    counters(chapter, section, equation)
                    if bridge.state.numbering?.equation == nil {
                        Text(bridge.t("以上为示例计数，实际序号由 Word 更新。")).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))

            if let number = bridge.state.numbering {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(bridge.t("文档中的编号")).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        numberBadge(number.actualNumber ?? bridge.t(number.mode == "unknown" ? "未读取" : "未编号"))
                    }
                    if number.hasDocumentContext {
                        HStack(spacing: 4) {
                            Text(bridge.language.usesEnglish ? "Equation" : "文档中的第").foregroundStyle(.secondary)
                            Text("\(number.position)").foregroundStyle(.blue).fontWeight(.semibold)
                            Text("/ \(number.total)" + (bridge.language.usesEnglish ? "" : " 个公式")).foregroundStyle(.secondary)
                        }.font(.callout).monospacedDigit().accessibilityElement(children: .combine)
                    } else {
                        Text(bridge.t("未读取整篇文档信息")).font(.caption).foregroundStyle(.secondary)
                    }
                    if number.actualNumber != nil {
                        counters(number.chapter, number.section, number.equation)
                        if let references = number.referenceCount {
                            HStack(spacing: 4) {
                                Text(bridge.language.usesEnglish ? "References" : "当前正文引用").foregroundStyle(.secondary)
                                Text("\(references)").foregroundStyle(.blue).fontWeight(.semibold)
                                if !bridge.language.usesEnglish { Text("处").foregroundStyle(.secondary) }
                            }.font(.callout).accessibilityElement(children: .combine)
                        }
                        if let format = number.format {
                            Text(bridge.t("原格式") + "  " + format).font(.caption.monospaced()).foregroundStyle(.primary).textSelection(.enabled)
                        }
                    }
                }
            }
            Text(bridge.t("#C 为章、#S 为节、#E 为公式；1 为数字，A/a 为字母，I/i 为罗马数字。"))
                .font(.caption2).foregroundStyle(.secondary)
            if bridge.wordSessionActive {
                Text(bridge.t("这里可试用格式；保存公式会保留 Word 中现有的编号。"))
                    .font(.caption2).foregroundStyle(.secondary)
            } else if bridge.state.canArrange {
                Text(bridge.t("更改格式后，另存编排后的 Word 副本即可应用。"))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .onAppear { draft = field.value.isEmpty ? "(#E1)" : field.value; refreshPreview() }
        .onChange(of: field.value) { _, value in let next = value.isEmpty ? "(#E1)" : value; if next != draft { draft = next } }
        .onChange(of: draft) { _, value in
            if !field.disabled { bridge.fieldBinding(field.id, fallback: field.value).wrappedValue = value }
        }
        .onChange(of: previewKey) { _, _ in refreshPreview() }
    }

    private func numberBadge(_ value: String) -> some View {
        Text(value).font(.system(size: 21, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(.black).padding(.horizontal, 9).padding(.vertical, 3)
            .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 6)).textSelection(.enabled)
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
