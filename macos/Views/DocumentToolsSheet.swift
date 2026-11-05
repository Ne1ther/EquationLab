import SwiftUI
import AppKit

// Only explicit audit associations identify an equation. XML locations are
// report coordinates and must never be interpreted as Word Range positions.
enum DocumentAuditEquationResolver {
    static func uniqueIndex(for row: [String: Any], in report: [String: Any]) -> Int? {
        let targets = report["targets"] as? [[String: Any]] ?? []
        let references = report["references"] as? [[String: Any]] ?? []
        let equations = report["equations"] as? [[String: Any]] ?? []
        func targetIndex(_ id: String) -> Int? {
            let matches = targets.filter { $0["id"] as? String == id }
            guard matches.count == 1, let indices = matches[0]["equationIndices"] as? [Int], indices.count == 1 else { return nil }
            return indices[0]
        }
        func referenceIndex(_ id: String) -> Int? {
            let matches = references.filter { $0["id"] as? String == id }
            guard matches.count == 1, matches[0]["state"] as? String == "resolved", let target = matches[0]["targetId"] as? String else { return nil }
            return targetIndex(target)
        }
        var candidates: [Int] = []
        if row["equationIndex"] != nil {
            guard let index = row["equationIndex"] as? Int else { return nil }
            candidates.append(index)
        }
        if row["equationIndices"] != nil {
            guard let indices = row["equationIndices"] as? [Int], indices.count == 1 else { return nil }
            candidates.append(indices[0])
        }
        if let id = row["targetId"] as? String {
            guard let index = targetIndex(id) else { return nil }
            candidates.append(index)
        }
        if let id = row["fieldId"] as? String {
            let matches = targets.filter { ($0["fieldIds"] as? [String] ?? []).contains(id) }
            guard matches.count == 1, let targetID = matches[0]["id"] as? String, let index = targetIndex(targetID) else { return nil }
            candidates.append(index)
        }
        if let id = row["referenceId"] as? String {
            guard let index = referenceIndex(id) else { return nil }
            candidates.append(index)
        }
        if let id = row["id"] as? String {
            if targets.contains(where: { $0["id"] as? String == id }) {
                guard let index = targetIndex(id) else { return nil }; candidates.append(index)
            } else if references.contains(where: { $0["id"] as? String == id }) {
                guard let index = referenceIndex(id) else { return nil }; candidates.append(index)
            }
        }
        guard let index = candidates.first, index >= 0, candidates.allSatisfy({ $0 == index }),
              equations.filter({ $0["index"] as? Int == index }).count == 1 else { return nil }
        return index
    }
}

struct DocumentToolsSheet: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var query = ""
    @State private var section = "targets"
    @State private var copyActionError: String?
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
            if !saved { Text(summary).font(.callout) }
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
                            if audit, let index = DocumentAuditEquationResolver.uniqueIndex(for: row, in: result) {
                                Button(label("选择公式", "Select equation")) {
                                    bridge.showDocumentTools = false
                                    bridge.invoke("nativeSelectAuditedEquation", argument: index)
                                }.disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
                            }
                        }
                        if let reason = row["reason"] as? String { Text(reason).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        if let references = row["referenceIds"] as? [String] { Text(label("引用 \(references.count) 处", "\(references.count) references")).font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 3)
                }.frame(minHeight: 260)
            } else if let path = result["path"] as? String {
                Text(path).textSelection(.enabled).font(.caption)
                HStack {
                    Button(label("在访达中显示", "Show in Finder")) { useSavedCopy(openInWord: false) }
                    Button(label("用 Word 打开", "Open in Word")) { useSavedCopy(openInWord: true) }
                }
                if let copyActionError { Text(copyActionError).font(.caption).foregroundStyle(.secondary) }
            }
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
        }.padding(24).frame(width: 650, height: saved ? 300 : 520)
    }
    private func useSavedCopy(openInWord: Bool) {
        copyActionError = nil
        guard let path = result["path"] as? String, (path as NSString).isAbsolutePath,
              FileManager.default.fileExists(atPath: path) else {
            copyActionError = label("副本已移动或不存在，请检查保存位置。", "The copy has moved or is missing. Check its saved location.")
            return
        }
        let url = URL(fileURLWithPath: path)
        guard openInWord else { NSWorkspace.shared.activateFileViewerSelecting([url]); return }
        let preferred = UserDefaults.standard.string(forKey: "EquationLab.WordApplicationPath").map { URL(fileURLWithPath: $0) }
        guard let host = WordHostInstallation.detect(preferredURL: preferred) else {
            copyActionError = label("没有找到 Microsoft Word，可先在访达中显示副本。", "Microsoft Word was not found. Show the copy in Finder to continue.")
            return
        }
        NSWorkspace.shared.open([url], withApplicationAt: host.applicationURL, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if error != nil { DispatchQueue.main.async { copyActionError = label("未能用 Word 打开副本，请在访达中检查。", "Could not open the copy in Word. Check it in Finder.") } }
        }
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
