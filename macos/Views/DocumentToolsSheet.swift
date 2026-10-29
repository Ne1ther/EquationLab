import SwiftUI
import AppKit

struct DocumentToolsSheet: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var query = ""
    @State private var section = "targets"
    private var english: Bool { bridge.language.usesEnglish }
    private var audit: Bool { bridge.documentToolKind == "audit" }
    private var saved: Bool { bridge.documentToolKind == "saved" }
    private var result: [String: Any] { bridge.documentToolResult }
    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
    private var summary: String {
        let values = result["summary"] as? [String: Any] ?? result
        if audit { return label("公式 \(values["equations"] ?? 0) · 编号 \(values["numberedTargets"] ?? 0) · 警告 \(values["warnings"] ?? 0)", "Equations \(values["equations"] ?? 0) · Numbered \(values["numberedTargets"] ?? 0) · Warnings \(values["warnings"] ?? 0)") }
        return label("可修改 \(values["ready"] ?? 0) · 无需修改 \(values["unchanged"] ?? 0) · 跳过 \(values["skipped"] ?? 0)", "Ready \(values["ready"] ?? 0) · Unchanged \(values["unchanged"] ?? 0) · Skipped \(values["skipped"] ?? 0)")
    }
    private var rows: [[String: Any]] {
        let values = result[audit ? section : "targets"] as? [[String: Any]] ?? []
        return values.filter { query.isEmpty || String(describing: $0).localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(saved ? label("副本已保存", "Copy saved") : audit ? label("编号与引用检查", "Numbering and references") : label("文档修改预检", "Document change preview")).font(.title2.bold())
            Text(summary).font(.callout)
            Text(saved ? label("原文档保持不变。请在 Word 中打开副本并检查排版、更新编号与引用。", "The original is unchanged. Open the copy in Word, check layout and update numbering and references.") : label("结果来自已载入的文档快照。检查不修改文档；批量应用只生成新的副本。", "Results use the loaded document snapshot. Checks are read-only; batch changes create a new copy."))
                .font(.caption).foregroundStyle(.secondary)
            if !saved {
                if audit {
                    Picker("", selection: $section) {
                        Text(label("公式编号", "Numbers")).tag("targets")
                        Text(label("正文引用", "References")).tag("references")
                        Text(label("检查结果", "Findings")).tag("issues")
                    }.pickerStyle(.segmented)
                }
                TextField(label("搜索编号、引用或检查结果", "Search numbers, references or findings"), text: $query).textFieldStyle(.roundedBorder)
                List(Array(rows.enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(title(row)).fontWeight(.medium).textSelection(.enabled)
                            Spacer()
                            if audit, section == "targets", let indices = row["equationIndices"] as? [Int], indices.count == 1 {
                                Button(label("选择公式", "Select equation")) {
                                    bridge.showDocumentTools = false
                                    bridge.invoke("nativeSelectAuditedEquation", argument: indices[0])
                                }.disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
                            }
                        }
                        if let reason = row["reason"] as? String { Text(reason).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        if let references = row["referenceIds"] as? [String] { Text(label("引用 \(references.count) 处", "\(references.count) references")).font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 3)
                }.frame(minHeight: 260)
            } else if let path = result["path"] as? String { Text(path).textSelection(.enabled).font(.caption) }
            HStack {
                Button(label("复制报告", "Copy report")) {
                    guard let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), let text = String(data: bytes, encoding: .utf8) else { return }
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
                }
                Spacer()
                Button(label("关闭", "Close")) { bridge.showDocumentTools = false }.keyboardShortcut(.cancelAction)
                if !audit && !saved {
                    Button(label("另存应用后的副本…", "Save changed copy…")) { bridge.showDocumentTools = false; bridge.invoke("nativeApplyDocumentTool") }
                        .buttonStyle(.borderedProminent).disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
                }
            }
        }.padding(24).frame(width: 650, height: saved ? 260 : 520)
    }
    private func title(_ row: [String: Any]) -> String {
        if let text = row["cachedText"] as? String, !text.isEmpty { return text + ((row["locked"] as? Bool == true) ? label("（已锁定）", " (locked)") : "") }
        if let index = row["index"] as? Int { return label("公式 \(index + 1)", "Equation \(index + 1)") + " · " + (row["status"] as? String ?? "") }
        let code = row["code"] as? String ?? row["state"] as? String ?? ""
        let labels = ["broken-reference": ("引用目标不存在", "Missing reference target"), "ambiguous-reference": ("引用目标不唯一", "Ambiguous reference target"), "locked-numbering-field": ("编号字段已锁定", "Locked numbering field"), "explicit-sequence-reset": ("显式重新起号", "Explicit sequence restart"), "mixed-number-formats": ("文档中存在不同编号格式", "Multiple numbering formats"), "number-without-reference-target": ("编号缺少引用书签", "Number without a reference bookmark"), "unknown-numbering-semantics": ("编号规则需要 Word 判断", "Numbering requires Word evaluation")]
        if let text = labels[code] { return label(text.0, text.1) }
        return code.isEmpty ? label("未识别的编号", "Unrecognized number") : code
    }
}
