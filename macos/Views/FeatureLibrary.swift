import SwiftUI

struct FeatureLibrary: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var query = ""
    @State private var group = ""
    @State private var lastInserted = ""
    @State private var showPending = false
    var body: some View {
        let section = FeatureCatalog.section(bridge.state.activeCategory)
        let groups = section.groups
        let activeGroup = section.activeGroup(group)
        let results = section.results(group: activeGroup, query: query)
        let available = results.available, pending = results.pending
        let gridHeight = min(330, max(170, CGFloat((available.count + 5) / 6) * 92 + (pending.isEmpty ? 0 : 48)))
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(bridge.t(FeatureCatalog.title(bridge.state.activeCategory)), systemImage: "square.grid.3x3.fill").foregroundStyle(.blue).font(.headline)
                Spacer()
                Button { bridge.showFeatureLibrary = false } label: { Image(systemName: "xmark") }.buttonStyle(WorkbenchButtonStyle())
            }
            TextField(bridge.t("搜索名称、符号或命令"), text: $query).textFieldStyle(.roundedBorder)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 6)], spacing: 6) {
                ForEach(groups + ["全部"], id: \.self) { name in
                    Button { group = name; showPending = false } label: {
                        Text(bridge.t(name)).font(.system(size: 11, weight: .medium)).lineLimit(1).frame(maxWidth: .infinity)
                    }.buttonStyle(WorkbenchButtonStyle(selected: activeGroup == name, filledSelection: true, horizontalPadding: 5, cornerRadius: 6))
                        .foregroundStyle(activeGroup == name ? .white : .primary)
                        .accessibilityAddTraits(activeGroup == name ? .isSelected : [])
                }
            }
            HStack {
                Text(bridge.t(query.isEmpty ? activeGroup : "搜索结果")).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(available.count) " + bridge.t("项可用")).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                if !pending.isEmpty {
                    Text("· \(pending.count) " + bridge.t("项待验证")).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            if bridge.state.activeCategory == "矩阵" {
                Button { bridge.openMatrixBuilder() } label: {
                    Label(bridge.t("自定义行数 × 列数…"), systemImage: "square.grid.3x3.topleft.filled")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }.buttonStyle(WorkbenchButtonStyle(tint: .blue, surface: true))
            }
            ScrollViewReader { scroll in
              ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    catalogGrid(available).id("catalog-results-top")
                    if results.isEmpty {
                        ContentUnavailableView.search(text: query).frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    if !pending.isEmpty {
                        DisclosureGroup(isExpanded: $showPending) {
                            Text(bridge.t("这些变体将在完成兼容性验证后开放。")).font(.caption).foregroundStyle(.secondary).padding(.vertical, 5)
                            catalogGrid(pending)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "lock.circle").foregroundStyle(.secondary)
                                Text(bridge.t("特殊伸缩积分"))
                                Text("· \(pending.count) " + bridge.t("项待验证")).foregroundStyle(.secondary)
                            }.font(.caption)
                        }.padding(10).background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                    }
                }.padding(2)
              }.frame(height: gridHeight)
                .onChange(of: activeGroup) { _, _ in scroll.scrollTo("catalog-results-top", anchor: .top) }
                .onChange(of: query) { _, _ in scroll.scrollTo("catalog-results-top", anchor: .top) }
            }
            Divider()
            HStack {
                Image(systemName: lastInserted.isEmpty ? "cursorarrow" : "checkmark.circle.fill").foregroundStyle(lastInserted.isEmpty ? Color.secondary : Color.green)
                Text(lastInserted.isEmpty ? bridge.t("点选插入，可连续使用。") : bridge.t("已插入") + " · " + bridge.t(lastInserted)).font(.caption)
                Spacer()
            }.frame(height: 24)
        }.padding(18).frame(width: 640)
        .onAppear { group = ""; query = ""; showPending = false; lastInserted = "" }
        .onChange(of: bridge.state.activeCategory) { _, _ in query = ""; group = ""; showPending = false; lastInserted = "" }
        .onExitCommand { bridge.showFeatureLibrary = false }
    }
    private func catalogGrid(_ entries: [CatalogItem]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
            ForEach(entries) { item in
                if item.available {
                    Button { bridge.insertCatalogItem(item); lastInserted = item.label } label: { tile(item) }
                        .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 3))
                        .disabled(bridge.state.readOnly).help("\(item.label) · \(item.latex)")
                } else {
                    tile(item).padding(.horizontal, 3)
                        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .topTrailing) { Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(.secondary).padding(5) }
                        .help(bridge.t("此原版变体尚待原生保存验证"))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(item.label + " · " + bridge.t("待验证"))
                }
            }
        }
    }
    private func tile(_ item: CatalogItem) -> some View {
        VStack(spacing: 5) {
            TemplateGlyph(item: item.template).frame(height: 38)
            Text(bridge.t(item.label.replacingOccurrences(of: "伸缩 · ", with: "")))
                .font(.system(size: 10)).lineLimit(2).multilineTextAlignment(.center).frame(height: 28)
        }.frame(maxWidth: .infinity).frame(height: 84)
    }
}

struct MatrixBuilder: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.dismiss) private var dismiss
    @State private var rows = 3
    @State private var columns = 3
    @State private var environment = "bmatrix"
    @State private var alignment = "c"
    @State private var divider = false
    @State private var equalColumns = false
    @State private var equalRows = false
    init(bridge: DesktopBridge) {
        self.bridge = bridge
        _rows = State(initialValue: bridge.matrixInitialRows)
        _columns = State(initialValue: bridge.matrixInitialColumns)
    }
    private let borders = [("无括号", "matrix"), ("圆括号 ( )", "pmatrix"), ("方括号 [ ]", "bmatrix"), ("花括号 { }", "Bmatrix"), ("行列式 | |", "vmatrix"), ("双竖线 ‖ ‖", "Vmatrix")]
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(bridge.t("自定义矩阵"), systemImage: "square.grid.3x3.fill").font(.title3.bold()).foregroundStyle(.blue)
            HStack(spacing: 24) {
                dimensionField("行", value: $rows)
                Text("×").foregroundStyle(.secondary)
                dimensionField("列", value: $columns)
            }
            Picker(bridge.t("括号"), selection: $environment) { ForEach(borders, id: \.1) { Text(bridge.t($0.0)).tag($0.1) } }
            Picker(bridge.t("列对齐"), selection: $alignment) {
                Text(bridge.t("左对齐")).tag("l"); Text(bridge.t("居中")).tag("c"); Text(bridge.t("右对齐")).tag("r")
            }.pickerStyle(.segmented)
            Toggle(bridge.t("末列前加分隔线（增广矩阵）"), isOn: $divider).disabled(columns < 2)
            HStack { Toggle(bridge.t("等列宽"), isOn: $equalColumns); Toggle(bridge.t("等行高"), isOn: $equalRows) }
            HStack(spacing: 3) {
                Text(previewBorder(left: true)).font(.system(size: 56, weight: .ultraLight))
                VStack(spacing: 5) { ForEach(0..<min(rows, 5), id: \.self) { _ in HStack(spacing: 10) { ForEach(0..<min(columns, 8), id: \.self) { _ in RoundedRectangle(cornerRadius: 2).stroke(.secondary.opacity(0.5)).frame(width: 11, height: 11) } } } }
                Text(previewBorder(left: false)).font(.system(size: 56, weight: .ultraLight))
                Spacer()
                Text("\(rows) × \(columns)").font(.title3.monospacedDigit()).foregroundStyle(.secondary)
            }.frame(height: 100).padding(12).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            HStack {
                Text(bridge.t("可逐格输入；用矩阵菜单增删行列。")).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(bridge.t("取消")) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(bridge.t("插入矩阵")) {
                    bridge.action("matrixInsert", ["rows": rows, "columns": columns, "environment": environment, "alignment": alignment, "divider": divider && columns > 1, "equalColumns": equalColumns, "equalRows": equalRows]); dismiss()
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(bridge.state.readOnly || !(1...31).contains(rows) || !(1...31).contains(columns))
            }
        }.padding(24).frame(width: 480)
    }
    private func dimensionField(_ title: String, value: Binding<Int>) -> some View {
        HStack(spacing: 8) {
            Text(bridge.t(title))
            TextField(bridge.t(title), value: value, format: .number.grouping(.never))
                .textFieldStyle(.roundedBorder).frame(width: 52).monospacedDigit()
                .accessibilityLabel(bridge.t(title))
            Stepper(bridge.t(title), value: value, in: 1...31).labelsHidden()
        }
    }
    private func previewBorder(left: Bool) -> String {
        switch environment {
        case "matrix": return ""
        case "bmatrix": return left ? "[" : "]"
        case "pmatrix": return left ? "(" : ")"
        case "Bmatrix": return left ? "{" : "}"
        case "Vmatrix": return "‖"
        default: return "│"
        }
    }
}

extension DesktopBridge {
    func openMatrixBuilder(rows: Int = 3, columns: Int = 3) {
        matrixInitialRows = rows; matrixInitialColumns = columns
        showFeatureLibrary = false
        if showCommands { matrixBuilderPending = true; showCommands = false }
        else { showMatrixBuilder = true }
    }
    func insertCatalogItem(_ item: CatalogItem) {
        if let (rows, columns) = item.matrixDimensions { openMatrixBuilder(rows: rows, columns: columns) }
        else { action("insertCatalog", ["id": item.id, "latex": item.latex]) }
    }
}
