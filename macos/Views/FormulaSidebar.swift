import SwiftUI

struct FormulaSidebar: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var showingFavorites = false
    private var items: [SidebarFormula] { showingFavorites ? bridge.state.favorites : bridge.state.objects }

    var body: some View {
        VStack(spacing: 0) {
            Picker(bridge.t("公式来源"), selection: $showingFavorites) {
                Text(bridge.t("文档")).tag(false)
                Text(bridge.t("收藏")).tag(true)
            }.pickerStyle(.segmented).labelsHidden().padding(14)
            HStack {
                Text(bridge.t(showingFavorites ? "模板收藏" : "当前文档的公式")).font(.headline)
                Spacer()
                Text("\(items.count)").font(.caption).foregroundStyle(.secondary)
            }.padding(.horizontal, 18).padding(.vertical, 8)
            if items.isEmpty {
                ContentUnavailableView {
                    Label(bridge.t(showingFavorites ? "暂无收藏" : "打开 Word 文档"), systemImage: showingFavorites ? "star" : "doc.text")
                } description: {
                    Text(bridge.t(showingFavorites ? "将常用公式加入收藏。" : "文档中的 MathType 公式会显示在这里。"))
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
                        .disabled(bridge.state.busy || showingFavorites && bridge.wordSessionActive)
                        .listRowBackground(!showingFavorites && bridge.state.selected == item.id ? Color.accentColor.opacity(0.16) : Color.clear)
                        .contextMenu {
                            Button(bridge.t(showingFavorites ? "使用此收藏" : "编辑公式")) {
                                bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                            }
                            if !showingFavorites {
                                Button(bridge.t("查看原生设置")) { bridge.invoke("nativeSelectObject", argument: item.id); bridge.inspectorTab = .style; bridge.showInspector = true }
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
