import SwiftUI

struct CommonLetters: View {
    @ObservedObject var bridge: DesktopBridge
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(LetterCatalog.common.enumerated()), id: \.offset) { _, pair in
                VStack(spacing: 3) {
                    ForEach(pair) { item in
                        LetterButton(item: item, bridge: bridge).frame(maxWidth: .infinity)
                    }
                }.frame(maxWidth: .infinity)
            }
        }
        .frame(height: 79)
    }
}

struct LetterButton: View {
    let item: EquationLetter
    @ObservedObject var bridge: DesktopBridge
    var selected = false
    var onInsert: (() -> Void)? = nil
    var keepPanelOpen = false
    private var missingGlyph: Bool {
        !item.isAvailable(lowercaseGreekFont: bridge.state.fonts.first { $0.id == "font-4" }?.value ?? "Symbol")
    }
    var body: some View {
        Button {
            bridge.action("insertLetter", ["latex": item.latex, "focus": !keepPanelOpen])
            onInsert?()
        } label: {
            Text(item.symbol)
                .font(.custom(item.requiresUnicodeFont == true ? "STIX Two Math" : item.family == "latin" ? "Times New Roman" : "Symbol", size: 23))
                .frame(maxWidth: .infinity, minHeight: 35)
        }
        .buttonStyle(WorkbenchButtonStyle(selected: selected, surface: true, horizontalPadding: 0, cornerRadius: 6))
        .disabled(bridge.state.readOnly || missingGlyph)
        .help(missingGlyph ? bridge.t("Symbol 字体缺少此变体，请先更改小写希腊字母字体。") : "\(item.symbol) · \(item.name) · \(bridge.t(item.caseName)) · \(item.unicode)")
        .accessibilityLabel("\(bridge.t("插入")) \(item.symbol)，\(item.name)，\(bridge.t(item.caseName))")
    }
}

struct LetterLibrary: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var query = ""
    @State private var family = "greek"
    @State private var letterCase = "all"
    @State private var selected: EquationLetter?
    @FocusState private var searchFocused: Bool
    private var filtered: [EquationLetter] {
        LetterCatalog.all.filter {
            $0.family == family && (letterCase == "all" || $0.kind == letterCase || family == "variants") &&
            (query.isEmpty || "\($0.symbol) \($0.name) \($0.latex) \($0.unicode)".localizedCaseInsensitiveContains(query))
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Label(bridge.t("全部字母"), systemImage: "character.book.closed.fill").foregroundStyle(.purple)
                Spacer()
                Button { bridge.showLetterLibrary = false } label: { Image(systemName: "xmark").frame(width: 18) }.buttonStyle(WorkbenchButtonStyle()).help(bridge.t("关闭"))
            }.font(.headline)
            TextField(bridge.t("搜索字母名称、符号或 Unicode"), text: $query).textFieldStyle(.roundedBorder).focused($searchFocused)
            Picker(bridge.t("字母分类"), selection: $family) {
                Text(bridge.t("希腊字母")).tag("greek")
                Text(bridge.t("拉丁字母")).tag("latin")
                Text(bridge.t("字形变体")).tag("variants")
            }.pickerStyle(.segmented).labelsHidden()
            HStack {
                Text("\(filtered.count) \(bridge.t("个字母"))").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if family != "variants" {
                    Picker(bridge.t("大小写"), selection: $letterCase) {
                        Text(bridge.t("全部")).tag("all"); Text(bridge.t("小写")).tag("lower"); Text(bridge.t("大写")).tag("upper")
                    }.pickerStyle(.segmented).frame(width: 185).labelsHidden().controlSize(.small)
                }
            }.frame(height: 24)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 12), spacing: 6) {
                    ForEach(filtered) { item in
                        LetterButton(item: item, bridge: bridge, selected: selected?.id == item.id, onInsert: { selected = item }, keepPanelOpen: true)
                    }
                }.padding(2)
                if filtered.isEmpty { Text(bridge.t("没有匹配的字母")).foregroundStyle(.secondary).padding(30) }
            }.frame(minHeight: 220, maxHeight: 220)
            Divider()
            if let selected {
                HStack(spacing: 8) {
                    Text(selected.symbol).font(.custom(selected.requiresUnicodeFont == true ? "STIX Two Math" : selected.family == "latin" ? "Times New Roman" : "Symbol", size: 24))
                    Text("\(selected.name) · \(bridge.t(selected.caseName))").font(.caption)
                    Text(selected.unicode).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer(); Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                }.frame(height: 28)
            } else { Text(bridge.t("点选字母插入到当前公式，面板可连续使用。")).font(.caption).foregroundStyle(.secondary).frame(height: 28) }
        }
        .padding(18).frame(width: 590)
        .onAppear { searchFocused = true }
        .onExitCommand { bridge.showLetterLibrary = false }
    }
}
