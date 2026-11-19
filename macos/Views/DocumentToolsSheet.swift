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
    @State private var statusFilter = "all"
    @State private var copyActionError: String?

    private var english: Bool { bridge.language.usesEnglish }
    private var audit: Bool { bridge.documentToolKind == "audit" }
    private var saved: Bool { bridge.documentToolKind == "saved" }
    private var isNumberingPlan: Bool { bridge.documentToolKind == "numbering" }
    private var isTypographyPlan: Bool { bridge.documentToolKind == "typography" }
    private var result: [String: Any] { bridge.documentToolResult }
    private var options: [String: Any] { result["options"] as? [String: Any] ?? [:] }
    private var summaryValues: [String: Any] { result["summary"] as? [String: Any] ?? result }
    private var allTargets: [[String: Any]] { result["targets"] as? [[String: Any]] ?? [] }

    private static let chinesePreflightReasons = [
        "Unnumbered or legacy equations require a Word host operation": "此公式没有可批量修改的编号。请在 Word 中新建编号或调整旧编号。",
        "Unsupported native equation": "无法读取此公式的原生数据。",
        "Only main-document equation numbers are supported": "仅可批量修改正文中的公式编号。",
        "Unsupported equation wrapper": "此公式的 Word 对象结构不支持批量编号。",
        "Several equations share this paragraph": "此段落中有多个公式，请在 Word 中分别调整编号。",
        "Tracked or content-controlled numbering requires Word": "编号受修订或内容控件影响，请在 Word 中处理。",
        "Tracked or special paragraph content requires Word": "段落含修订或特殊内容，请在 Word 中处理。",
        "Custom or overlapping bookmarks require Word": "存在自定义或重叠的书签，请在 Word 中处理。",
        "The numbering bookmark is not a complete paragraph-local range": "编号书签未在同一段内完整闭合。",
        "The numbering bookmark is reversed": "编号书签的结束位置在开始位置之前。",
        "Equation and prose or custom content share the paragraph": "公式与正文或自定义内容同段，请在 Word 中调整编号。",
        "Equation and prose share the same run": "公式与正文共用一个文本片段，请在 Word 中调整编号。",
        "Unexpected number content": "编号包含无法识别的内容。",
        "Unsupported number content": "编号包含批量修改不支持的内容。",
        "The numbering field is locked": "编号域已锁定。",
        "Nested number fields require Word": "编号域存在嵌套，请在 Word 中处理。",
        "Malformed number field": "编号域的结构不完整。",
        "Unknown field delimiter": "无法识别编号域的分隔标记。",
        "Unbound number instruction": "编号指令缺少对应的域。",
        "Unclosed number field": "编号域缺少结束标记。",
        "Mixed character formatting inside the number requires Word": "编号内使用了不同的字符格式，请在 Word 中处理。",
        "Ambiguous sequence fields": "无法确定编号所用的序列域。",
        "Removing this counter would change its reset or sequence behaviour": "移除此计数器会改变编号的起始值或递增规则。",
        "Chapter or section context has not been established": "未能确定此公式所属的章或节。",
        "Number cache is unavailable or cannot be interpreted safely": "无法确认文档中保存的编号值。",
        "Number cache does not match its declared numeric format": "文档中保存的编号值与声明的数字格式不符。",
        "The number contains an unknown field": "编号包含无法识别的域。",
        "Ambiguous sequence counter switches": "序列域包含互相冲突的计数选项。",
        "Invalid sequence reset": "序列域的起始值无效。",
        "Hidden counter fields require a Word host operation": "编号使用隐藏计数域，请在 Word 中处理。",
        "Ambiguous numeric format": "同一编号域声明了多种数字格式。",
        "Unknown sequence formatting switch": "无法识别序列域的格式选项。",
        "Unknown sequence switch": "无法识别序列域选项。",
        "Ambiguous legacy MathType numbering requires Word": "无法确定旧版 MathType 的编号结构，请在 Word 中处理。",
        "Legacy number has a custom field or reference boundary": "旧编号包含自定义域或引用边界，请在 Word 中处理。",
        "Legacy number does not have a standalone range": "旧编号没有独立的文本范围。",
        "Legacy number uses an unsupported display counter": "旧编号使用批量修改不支持的显示计数器。",
        "Legacy number has custom display runs": "旧编号包含自定义的显示文本片段。",
        "Legacy number contains a nonstandard display range": "旧编号的显示范围不符合批量修改要求。",
        "Changing the counters of this legacy number requires Word": "请在 Word 中调整此旧编号的计数器。",
        "Changing the literal boundaries of this legacy number requires Word": "请在 Word 中调整此旧编号的固定字符分段。",
        "Duplicate numbering bookmarks require Word": "存在同名的编号书签，请在 Word 中处理。",
        "Duplicate numbering bookmark identities require Word": "编号书签标识重复，请在 Word 中处理。",
        "The object has no supported internal preview layout": "此公式没有可用于批量排版的内嵌预览。",
        "The object has an ambiguous or unsupported wrapper": "此公式的 Word 对象结构不支持批量排版。",
        "The equation shares a text run with other content; its baseline requires a Word host operation": "公式与其他内容共用一个文本片段，请在 Word 中调整基线。",
        "Tracked or content-controlled equations require a Word host operation": "公式受修订或内容控件影响，请在 Word 中处理。",
        "Requested preferences already match": "此公式已使用所选样式。",
        "Invalid regenerated equation preview": "无法生成可用的公式预览。"
    ]

    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }

    private func displayedReason(_ reason: String) -> String {
        guard !english && !audit else { return reason }
        let glyphWarning = "Preview has unresolved glyphs: "
        if reason.hasPrefix(glyphWarning) {
            return "公式预览缺少字形：" + reason.dropFirst(glyphWarning.count)
        }
        return Self.chinesePreflightReasons[reason] ?? reason
    }

    private func intValue(_ key: String, in dict: [String: Any]? = nil) -> Int {
        let source = dict ?? summaryValues
        if let value = source[key] as? Int { return value }
        if let value = source[key] as? NSNumber { return value.intValue }
        return 0
    }

    private var numberingScope: String? { options["scope"] as? String }
    private var numberingFormat: String? { options["numberFormat"] as? String }
    private var numberingUpdatesFuture: Bool { options["updateFuture"] as? Bool ?? (numberingScope == "future") }
    private var documentDefaultChanged: Bool { result["documentDefaultChanged"] as? Bool ?? false }
    private var requiresWordFieldUpdate: Bool { result["requiresWordFieldUpdate"] as? Bool ?? false }
    private var presetChanged: Bool { result["presetChanged"] as? Bool ?? false }
    private var isTypographyPresetOnly: Bool { isTypographyPlan && options["preset"] != nil && allTargets.isEmpty }
    private var isNumberingFutureOnly: Bool { isNumberingPlan && numberingScope == "future" }
    private var isFutureOnlyPreflight: Bool { isNumberingFutureOnly || isTypographyPresetOnly }

    private var sheetTitle: String {
        if saved { return label("副本已保存", "Copy saved") }
        if audit { return label("编号与引用检查", "Numbering and references") }
        if isNumberingPlan { return label("编号修改预检", "Numbering change preview") }
        if isTypographyPlan { return label("样式批量修改预检", "Typography change preview") }
        return label("文档修改预检", "Document change preview")
    }

    private var sheetIcon: String {
        if saved { return "checkmark.circle.fill" }
        if audit { return "checklist" }
        if isNumberingPlan { return "list.number" }
        return "textformat"
    }

    private var sheetIconColor: Color {
        saved ? .green : .accentColor
    }

    private var hasAnyPlannedChange: Bool {
        if isNumberingPlan { return intValue("ready") > 0 || documentDefaultChanged }
        if isTypographyPlan { return intValue("ready") > 0 || presetChanged }
        return intValue("ready") > 0
    }

    private var rows: [[String: Any]] {
        let sourceRows = result[audit ? section : "targets"] as? [[String: Any]] ?? []
        let filteredByStatus: [[String: Any]]
        if !audit && statusFilter != "all" {
            filteredByStatus = sourceRows.filter { ($0["status"] as? String) == statusFilter }
        } else {
            filteredByStatus = sourceRows
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return filteredByStatus }
        return filteredByStatus.filter { row in
            rowSearchText(row).localizedCaseInsensitiveContains(trimmed) ||
            String(describing: row).localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: sheetIcon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(sheetIconColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(sheetTitle).font(.title2.bold())
                    Text(headerSubtitle)
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            if saved {
                savedBody
            } else {
                if audit, let coverage = result["coverage"] as? [String: Any], coverage["scope"] as? String == "main-story" {
                    Text(label("当前检查覆盖正文。页眉、页脚、脚注与尾注请通过已保存副本检查。", "This check covers the main story. Check a saved copy for headers, footers, footnotes and endnotes."))
                        .font(.caption).foregroundStyle(.secondary)
                } else if !audit {
                    preflightScopeCard
                }
                metricsStrip
                if isFutureOnlyPreflight {
                    futureOnlyConfirmationCard
                } else {
                    if audit {
                        Picker("", selection: $section) {
                            Text(label("公式编号 (\(intValue("numberedTargets")))", "Numbers (\(intValue("numberedTargets")))")).tag("targets")
                            Text(label("正文引用 (\(intValue("equationReferences")))", "References (\(intValue("equationReferences")))")).tag("references")
                            Text(label("检查结果 (\(intValue("warnings") + intValue("information")))", "Findings (\(intValue("warnings") + intValue("information")))")).tag("issues")
                        }.pickerStyle(.segmented)
                    } else if !allTargets.isEmpty {
                        Picker("", selection: $statusFilter) {
                            Text(label("全部 (\(allTargets.count))", "All (\(allTargets.count))")).tag("all")
                            Text(label("可修改 (\(intValue("ready")))", "Ready (\(intValue("ready")))")).tag("ready")
                            Text(label("无需修改 (\(intValue("unchanged")))", "Unchanged (\(intValue("unchanged")))")).tag("unchanged")
                            Text(label("已跳过 (\(intValue("skipped")))", "Skipped (\(intValue("skipped")))")).tag("skipped")
                        }.pickerStyle(.segmented)
                    }
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField(
                            audit
                                ? label("搜索编号、书签、引用或检查结果", "Search numbers, bookmarks, references or findings")
                                : label("搜索公式序号、编号或跳过原因", "Search equation number, formatted value or reason"),
                            text: $query
                        ).textFieldStyle(.plain)
                        if !query.isEmpty {
                            Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                                .buttonStyle(.plain)
                                .accessibilityLabel(label("清除搜索", "Clear search"))
                        }
                    }
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 7, style: .continuous))

                    let visibleRows = rows
                    if visibleRows.isEmpty {
                        ContentUnavailableView {
                            Label(
                                query.isEmpty ? label("当前分组暂无项目", "No items in this category") : label("没有匹配的结果", "No matching items"),
                                systemImage: query.isEmpty ? "tray" : "magnifyingglass"
                            )
                        } description: {
                            Text(query.isEmpty ? label("可切换上方分组查看其他结果。", "Switch tabs above to inspect other results.") : label("试试其他编号、公式序号或关键词。", "Try another number, equation index, or keyword."))
                        }
                        .frame(maxWidth: .infinity, minHeight: 220)
                    } else {
                        List(Array(visibleRows.enumerated()), id: \.offset) { _, row in
                            rowView(row)
                                .padding(.vertical, 3)
                        }
                        .listStyle(.inset)
                        .frame(minHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }

            Divider()
            HStack {
                Button(label("复制报告", "Copy report")) {
                    guard let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), let text = String(data: bytes, encoding: .utf8) else { return }
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
                }
                Spacer()
                Button(label("关闭", "Close")) { bridge.showDocumentTools = false }.keyboardShortcut(.cancelAction)
                if !audit && !saved {
                    Button(label("另存应用后的副本…", "Save changed copy…")) {
                        bridge.showDocumentTools = false
                        bridge.invoke("nativeApplyDocumentTool")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
                }
            }
        }
        .padding(24)
        .frame(width: 670, height: saved ? 360 : isFutureOnlyPreflight ? 420 : 580)
        .onChange(of: bridge.documentToolKind) { _, _ in
            query = ""
            section = "targets"
            statusFilter = "all"
            copyActionError = nil
        }
    }

    private var headerSubtitle: String {
        if saved {
            return label(
                "原文档保持不变。请在 Word 中打开副本并检查排版、更新编号与引用。",
                "The original document is unchanged. Open the copy in Word to verify layout and update numbering and references."
            )
        }
        if audit {
            return label(
                "结果来自已载入的文档快照，仅作只读检查；不修改当前 Word 或磁盘文件。",
                "Results come from the loaded document snapshot. This audit is read-only and never modifies Word or files on disk."
            )
        }
        return label(
            "预检基于所选的 .docx 文件。确认后将另存为新副本。",
            "The preview uses the selected .docx file. Confirm to save a new copy."
        )
    }

    private var preflightScopeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                badge(scopeSummaryLabel, tint: .blue)
                if let format = numberingFormat, !format.isEmpty {
                    Text(format)
                        .font(.caption.monospaced().weight(.semibold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                        .textSelection(.enabled)
                }
                if let sourceName = result["sourceName"] as? String {
                    badge(sourceName, tint: .secondary)
                } else {
                    badge(label("另存新副本", "Save a new copy"), tint: .secondary)
                }
                Spacer(minLength: 0)
            }
            if isNumberingPlan {
                Text(numberingConsequenceText)
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if isTypographyPlan {
                Text(typographyConsequenceText)
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !hasAnyPlannedChange {
                Label(
                    label("预检未发现需要改动的项；若继续另存，副本内容将与原文档一致。", "No changes are needed in this preview. Saving will produce an unchanged copy."),
                    systemImage: "info.circle"
                )
                .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }

    private var scopeSummaryLabel: String {
        if isNumberingPlan {
            switch numberingScope {
            case "all": return label("作用范围：全部已有编号", "Scope: All existing numbered equations")
            case "future": return label("作用范围：仅后续新增公式默认", "Scope: Future formulas default only")
            case "current": return label("作用范围：仅当前公式", "Scope: Current equation only")
            default: return label("作用范围：已选公式", "Scope: Selected equations")
            }
        }
        if isTypographyPresetOnly {
            return label("作用范围：仅保存文档样式预设（后续新公式）", "Scope: Document preset for new equations only")
        }
        if allTargets.count == 1 {
            return label("作用范围：当前公式", "Scope: Current equation")
        }
        return label("作用范围：全文公式", "Scope: All equations")
    }

    private var numberingConsequenceText: String {
        switch numberingScope {
        case "future":
            if documentDefaultChanged {
                return label(
                    "不会修改任何已有公式编号；只会在新副本中写入文档默认格式，供后续新增编号公式使用。",
                    "Existing equation numbers remain untouched. Only the document default format for future numbered equations will be updated in the new copy."
                )
            }
            return label(
                "不会修改任何已有公式编号；原文档的默认编号格式已与此格式一致。",
                "Existing equation numbers remain untouched. The document's default format already matches this pattern."
            )
        case "all":
            let defaultNote = numberingUpdatesFuture
                ? label("同时更新副本的后续新公式默认格式。", "Also updates the copy's default for future equations.")
                : label("仅重编已有编号，不更改副本的新公式默认格式。", "Only renumbers existing numbered equations; the future-formula default stays as-is.")
            let wordNote = requiresWordFieldUpdate
                ? label(" 保存后需在 Word 中打开副本并更新编号域与正文交叉引用。", " Open the saved copy in Word afterward to refresh number fields and cross-references.")
                : ""
            return defaultNote + wordNote
        case "current":
            let wordNote = requiresWordFieldUpdate
                ? label(" 保存后需在 Word 中打开副本并更新编号域与正文引用。", " Open the saved copy in Word afterward to refresh number fields and cross-references.")
                : ""
            return label("仅调整当前公式的已有编号，不影响文档中其他公式。", "Updates only the current equation's existing number; other equations are untouched.") + wordNote
        default:
            return label("仅调整预检列表中的目标公式，并输出新的文档副本。", "Applies only to the listed target equations and saves a new copy.")
        }
    }

    private var typographyConsequenceText: String {
        if isTypographyPresetOnly {
            return presetChanged
                ? label("不会改动任何已有公式；仅在副本中写入文档样式预设，供后续新建公式载入。", "Existing equations are untouched. Only the document style preset for future equations is saved in the copy.")
                : label("不会改动任何已有公式；文档中已存有相同的样式预设。", "Existing equations are untouched. The saved document preset already matches.")
        }
        return label("按当前字体与字号更新预检通过的公式，并尽量保留原公式中的局部样式与字号；跳过项保持原样。", "Updates ready equations with the current typography while preserving explicit local styles and sizes; skipped equations remain unchanged.")
    }

    private var metricsStrip: some View {
        HStack(spacing: 8) {
            if audit {
                metricTile(label("公式", "Equations"), value: intValue("equations"), tint: .primary)
                metricTile(label("已编号", "Numbered"), value: intValue("numberedTargets"), tint: .blue)
                metricTile(label("正文引用", "References"), value: intValue("equationReferences"), tint: .primary)
                let warnings = intValue("warnings")
                metricTile(label("警告", "Warnings"), value: warnings, tint: warnings > 0 ? .orange : .secondary)
                metricTile(label("提示", "Info"), value: intValue("information"), tint: .secondary)
            } else {
                let ready = intValue("ready")
                let skipped = intValue("skipped")
                metricTile(label("可修改", "Ready"), value: ready, tint: ready > 0 ? .blue : .secondary)
                metricTile(label("无需修改", "Unchanged"), value: intValue("unchanged"), tint: .secondary)
                metricTile(label("已跳过", "Skipped"), value: skipped, tint: skipped > 0 ? .orange : .secondary)
                if isNumberingPlan {
                    metricTextTile(
                        label("新公式默认", "New default"),
                        value: numberingUpdatesFuture
                            ? (documentDefaultChanged ? label("将更新", "Will update") : label("已一致", "Matches"))
                            : label("不改动", "Unchanged"),
                        tint: numberingUpdatesFuture && documentDefaultChanged ? .blue : .secondary
                    )
                } else if isTypographyPlan && options["preset"] != nil {
                    metricTextTile(
                        label("文档样式预设", "Style preset"),
                        value: presetChanged ? label("将写入", "Will save") : label("已一致", "Matches"),
                        tint: presetChanged ? .blue : .secondary
                    )
                }
            }
        }
    }

    private var futureOnlyConfirmationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "text.badge.plus")
                    .font(.title3)
                    .foregroundStyle(.blue)
                Text(
                    isNumberingFutureOnly
                        ? label("仅更新副本的后续新公式默认编号格式", "Update future-equation numbering default only")
                        : label("仅保存副本的后续新公式样式预设", "Save future-equation style preset only")
                )
                .font(.headline)
            }
            Text(
                isNumberingFutureOnly
                    ? label(
                        "文档中已有公式的编号不会被重编（涉及已有公式 0 个）。另存副本后，在副本中新增的编号公式将默认使用格式 \(numberingFormat ?? "")。",
                        "No existing equation numbers will be changed (0 existing equations touched). New numbered equations added to the saved copy will default to \(numberingFormat ?? "")."
                    )
                    : label(
                        "文档中已有公式的外观不会被修改（涉及已有公式 0 个）。另存副本后，可在副本中直接载入这份文档样式预设。",
                        "No existing equations will be modified (0 existing equations touched). The style preset will be stored inside the saved copy for future equations."
                    )
            )
            .font(.callout).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .background(.quaternary.opacity(0.32), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var savedBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if result["ready"] != nil {
                    badge(label("已修改 \(intValue("ready", in: result))", "Updated \(intValue("ready", in: result))"), tint: intValue("ready", in: result) > 0 ? .green : .secondary)
                    badge(label("未改动 \(intValue("unchanged", in: result))", "Unchanged \(intValue("unchanged", in: result))"), tint: .secondary)
                    let skipped = intValue("skipped", in: result)
                    if skipped > 0 {
                        badge(label("已跳过 \(skipped)", "Skipped \(skipped)"), tint: .orange)
                    }
                }
                if documentDefaultChanged {
                    badge(label("已写入新公式默认格式", "New-formula default saved"), tint: .blue)
                }
                if presetChanged {
                    badge(label("已写入文档样式预设", "Document style preset saved"), tint: .blue)
                }
                Spacer(minLength: 0)
            }

            if let refs = result["references"] as? [String: Any] {
                let marked = intValue("markedForUpdate", in: refs)
                let locked = intValue("locked", in: refs)
                if marked > 0 || locked > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.blue)
                        Text(
                            locked > 0
                                ? label("已标记 \(marked) 处正文引用待 Word 更新（另有 \(locked) 处已锁定未改动）。", "\(marked) cross-references marked for Word update (\(locked) locked and left untouched).")
                                : label("已标记 \(marked) 处正文引用待 Word 打开副本后更新。", "\(marked) cross-references marked for update when opened in Word.")
                        )
                        .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if let path = result["path"] as? String {
                VStack(alignment: .leading, spacing: 6) {
                    Text(label("副本保存位置", "Saved copy location"))
                        .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    Text(path)
                        .textSelection(.enabled)
                        .font(.caption.monospaced())
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                HStack(spacing: 8) {
                    Button(label("在访达中显示", "Show in Finder")) { useSavedCopy(openInWord: false) }
                    Button(label("用 Word 打开", "Open in Word")) { useSavedCopy(openInWord: true) }
                        .buttonStyle(.borderedProminent)
                }
                if let copyActionError {
                    Text(copyActionError).font(.caption).foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func rowView(_ row: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .center, spacing: 8) {
                Text(title(row)).fontWeight(.medium).textSelection(.enabled)
                if !audit, let status = row["status"] as? String {
                    statusBadge(status)
                } else if audit {
                    auditRowBadges(row)
                }
                Spacer(minLength: 8)
                if audit, let index = DocumentAuditEquationResolver.uniqueIndex(for: row, in: result) {
                    Button(label("选择公式", "Select equation")) {
                        bridge.showDocumentTools = false
                        bridge.invoke("nativeSelectAuditedEquation", argument: index)
                    }
                    .controlSize(.small)
                    .disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown)
                }
            }

            if isNumberingPlan {
                let before = row["beforeNumber"] as? String
                let after = row["afterNumber"] as? String
                if before != nil || after != nil {
                    HStack(spacing: 6) {
                        Text(before ?? label("无旧编号", "No prior number"))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Image(systemName: "arrow.right")
                            .font(.caption2).foregroundStyle(.tertiary)
                        Text(after ?? "—")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle((row["status"] as? String) == "ready" ? .blue : .secondary)
                        if let beforeFormat = row["beforeFormat"] as? String, !beforeFormat.isEmpty {
                            Text("· \(beforeFormat)")
                                .font(.caption2.monospaced()).foregroundStyle(.tertiary)
                        }
                    }
                }
            }

            if isTypographyPlan, let preserved = row["preservedLocalFormatting"] as? [String: Any] {
                let styles = intValue("explicitStyles", in: preserved)
                let sizes = intValue("localSizes", in: preserved)
                if styles > 0 || sizes > 0 {
                    Text(label("保留局部样式 \(styles) 处 · 局部字号 \(sizes) 处", "Preserves \(styles) local styles · \(sizes) local sizes"))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }

            if let reason = row["reason"] as? String, !reason.isEmpty {
                Text(displayedReason(reason)).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if let references = row["referenceIds"] as? [String] {
                HStack(spacing: 8) {
                    Text(label("引用 \(references.count) 处", "\(references.count) references"))
                    if let bookmark = row["bookmark"] as? String, !bookmark.isEmpty {
                        Text("· \(bookmark)").font(.caption2.monospaced())
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            } else if audit, let bookmark = row["bookmark"] as? String, !bookmark.isEmpty {
                Text(bookmark).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func auditRowBadges(_ row: [String: Any]) -> some View {
        if let severity = row["severity"] as? String {
            badge(
                severity == "warning" ? label("警告", "Warning") : label("提示", "Info"),
                tint: severity == "warning" ? .orange : .secondary
            )
        }
        if let state = row["state"] as? String {
            switch state {
            case "resolved": badge(label("已解析", "Resolved"), tint: .green)
            case "missing": badge(label("目标缺失", "Missing"), tint: .orange)
            case "ambiguous": badge(label("不唯一", "Ambiguous"), tint: .orange)
            case "review-dependent": badge(label("受修订影响", "Tracked change"), tint: .secondary)
            default: EmptyView()
            }
        }
        if let family = row["family"] as? String, family == "mathtype" || family == "equationlab" {
            badge(family == "mathtype" ? "MathType" : "Equation Lab", tint: .secondary)
        }
    }

    private func statusBadge(_ status: String) -> some View {
        switch status {
        case "ready":
            return badge(label("可修改", "Ready"), tint: .blue)
        case "unchanged":
            return badge(label("无需修改", "Unchanged"), tint: .secondary)
        case "skipped":
            return badge(label("已跳过", "Skipped"), tint: .orange)
        default:
            return badge(status, tint: .secondary)
        }
    }

    private func badge(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private func metricTile(_ title: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text("\(value)")
                .font(.system(.headline, design: .rounded).weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(.quaternary.opacity(0.38), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private func metricTextTile(_ title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(.quaternary.opacity(0.38), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private func rowSearchText(_ row: [String: Any]) -> String {
        var parts = [title(row)]
        if let reason = row["reason"] as? String { parts.append(displayedReason(reason)) }
        if let before = row["beforeNumber"] as? String { parts.append(before) }
        if let after = row["afterNumber"] as? String { parts.append(after) }
        if let bookmark = row["bookmark"] as? String { parts.append(bookmark) }
        return parts.joined(separator: " ")
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
        if let index = row["index"] as? Int { return label("公式 \(index + 1)", "Equation \(index + 1)") }
        let code = row["code"] as? String ?? row["state"] as? String ?? ""
        let labels = [
            "broken-reference": ("引用目标不存在", "Missing reference target"),
            "ambiguous-reference": ("引用目标不唯一", "Ambiguous reference target"),
            "locked-numbering-field": ("编号字段已锁定", "Locked numbering field"),
            "explicit-sequence-reset": ("显式重新起号", "Explicit sequence restart"),
            "mixed-number-formats": ("文档中存在不同编号格式", "Multiple numbering formats"),
            "number-without-reference-target": ("编号缺少引用书签", "Number without a reference bookmark"),
            "unknown-numbering-semantics": ("编号规则需要 Word 判断", "Numbering requires Word evaluation"),
            "tracked-numbering-field": ("含修订痕迹的编号字段", "Tracked numbering field"),
            "tracked-reference": ("受修订影响的引用", "Tracked reference"),
            "locked-equation-reference": ("正文引用已锁定", "Locked equation reference"),
            "duplicate-bookmark-name": ("重复的书签名称", "Duplicate bookmark name"),
            "unreadable-equation": ("无法读取的公式对象", "Unreadable equation object"),
            "number-cache-unavailable": ("缺少缓存编号文本", "Saved number text unavailable")
        ]
        if let text = labels[code] { return label(text.0, text.1) }
        return code.isEmpty ? label("未识别的编号", "Unrecognized number") : code
    }
}
