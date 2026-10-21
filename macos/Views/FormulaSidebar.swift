import SwiftUI

struct FormulaSidebar: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var showingFavorites = false
    @State private var query = ""
    private var allItems: [SidebarFormula] { showingFavorites ? bridge.state.favorites : bridge.state.objects }
    private var items: [SidebarFormula] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return search.isEmpty ? allItems : allItems.filter { "\($0.id + 1) \($0.latex) \($0.label) \($0.detail)".localizedCaseInsensitiveContains(search) }
    }
    private var selectionUnavailable: Bool { bridge.state.busy || bridge.wordSessionIsInsertion || showingFavorites && bridge.wordSessionActive }

    var body: some View {
        VStack(spacing: 0) {
            Picker(bridge.t("公式来源"), selection: $showingFavorites) {
                Text(bridge.t("文档")).tag(false)
                Text(bridge.t("收藏")).tag(true)
            }.pickerStyle(.segmented).labelsHidden().padding(14)
            HStack {
                Text(bridge.t(showingFavorites ? "模板收藏" : "当前文档的公式")).font(.headline)
                Spacer()
                Text(query.isEmpty ? "\(allItems.count)" : "\(items.count) / \(allItems.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }.padding(.horizontal, 18).padding(.vertical, 8)
            if !allItems.isEmpty || !query.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease").foregroundStyle(.secondary)
                    TextField(bridge.t("搜索公式或 LaTeX"), text: $query).textFieldStyle(.plain)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                            .buttonStyle(.plain).accessibilityLabel(bridge.t("清除搜索"))
                    }
                }.font(.callout).padding(8)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 7))
                    .padding(.horizontal, 14).padding(.bottom, 8)
            }
            if items.isEmpty {
                ContentUnavailableView {
                    Label(bridge.t(!query.isEmpty ? "没有匹配的公式" : showingFavorites ? "暂无收藏" : "打开 Word 文档"), systemImage: !query.isEmpty ? "magnifyingglass" : showingFavorites ? "star" : "doc.text")
                } description: {
                    Text(bridge.t(!query.isEmpty ? "试试公式中的字母、LaTeX 命令或序号。" : showingFavorites ? "将常用公式加入收藏。" : "文档中的 MathType 公式会显示在这里。"))
                }
                .font(.callout)
                Spacer(minLength: 0)
            } else {
                List {
                    ForEach(items) { item in
                        Button {
                            bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                        } label: {
                            HStack(spacing: 12) {
                                Text("\(item.id + 1)")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary).frame(width: 17)
                                if let thumbnail = item.thumbnail {
                                    Image(nsImage: thumbnail).resizable().interpolation(.high)
                                        .scaledToFit().frame(maxWidth: .infinity, minHeight: 43, maxHeight: 74)
                                        .padding(6).background(.white, in: RoundedRectangle(cornerRadius: 5))
                                        .accessibilityLabel(item.latex)
                                } else {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Image(systemName: "function").font(.title2)
                                        Text(bridge.t(item.readOnly ? "未能预览" : "正在生成预览")).font(.caption2)
                                    }.frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(.secondary)
                                }
                                if item.readOnly { Image(systemName: "lock").font(.caption2).foregroundStyle(.secondary) }
                            }.frame(minHeight: 70).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(selectionUnavailable)
                        .listRowBackground(!showingFavorites && bridge.state.selected == item.id ? Color.accentColor.opacity(0.16) : Color.clear)
                        .contextMenu {
                            Button(bridge.t(showingFavorites ? "使用此收藏" : "编辑公式")) {
                                bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                            }.disabled(selectionUnavailable)
                            Button(bridge.t("复制 LaTeX")) {
                                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(item.latex, forType: .string)
                            }.disabled(item.latex.isEmpty)
                            if !showingFavorites {
                                Button(bridge.t("查看原生设置")) { bridge.invoke("nativeSelectObject", argument: item.id); bridge.inspectorTab = .style; bridge.showInspector = true }.disabled(selectionUnavailable)
                            }
                        }
                        .help(bridge.t(item.detail))
                    }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
            }
            HStack(spacing: 6) {
                Button { bridge.invoke("nativeNew") } label: {
                    Label(bridge.language.usesEnglish ? "New" : bridge.t("新建公式"), systemImage: "plus.circle")
                        .lineLimit(1).frame(maxWidth: .infinity)
                }.accessibilityLabel(bridge.t("新建公式")).help(bridge.t("新建公式"))
                Button { bridge.invoke("nativeOpen") } label: {
                    Label(bridge.language.usesEnglish ? "Open" : bridge.t("打开文档"), systemImage: "folder")
                        .lineLimit(1).frame(maxWidth: .infinity)
                }.accessibilityLabel(bridge.t("打开文档")).help(bridge.t("打开文档"))
            }
            .buttonStyle(WorkbenchButtonStyle()).font(.system(size: 11))
            .disabled(bridge.wordSessionActive || bridge.state.busy).padding(.horizontal, 12)
            .modifier(WorkbenchFooter())
        }
    }
}
