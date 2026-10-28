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
    private var selectionUnavailable: Bool {
        bridge.state.busy || showingFavorites && bridge.wordSessionActive || !showingFavorites && bridge.state.wordDocumentUnavailable
    }
    private var documentSwitchUnavailable: Bool { bridge.state.busy || bridge.state.wordOutcomeUnknown }
    private var documentOrdinals: [String: Int] {
        var counts: [String: Int] = [:]
        var ordinals: [String: Int] = [:]
        for document in bridge.state.openWordDocuments {
            counts[document.name, default: 0] += 1
            ordinals[document.identity] = counts[document.name]
        }
        return ordinals
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker(bridge.t("公式来源"), selection: $showingFavorites) {
                Text(bridge.t("文档")).tag(false)
                Text(bridge.t("收藏")).tag(true)
            }.pickerStyle(.segmented).labelsHidden().padding(14)
            if !showingFavorites {
                HStack(alignment: .top, spacing: 10) {
                    OfficeProductLabel(bridge: bridge, wordOnly: true, showsTitle: false)
                        .frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 5) {
                        Menu {
                            if bridge.state.openWordDocuments.isEmpty {
                                Text(bridge.t(bridge.state.wordWorkspaceConnected ? "没有打开的 Word 文档" : "尚未连接 Word"))
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(bridge.state.openWordDocuments) { document in
                                    let selected = document.identity == bridge.state.wordDocumentIdentity
                                    let duplicate = bridge.state.openWordDocuments.filter { $0.name == document.name }.count > 1
                                    let title = duplicate ? "\(document.name) (\(documentOrdinals[document.identity] ?? 1))" : document.name
                                    Button {
                                        bridge.invoke("nativeChooseWordDocument", argument: document.identity)
                                    } label: {
                                        HStack {
                                            Text(title)
                                            if document.readOnly { Text("· " + bridge.t("只读")) }
                                            Spacer()
                                            if selected { Image(systemName: "checkmark") }
                                        }
                                    }
                                    .disabled(documentSwitchUnavailable || document.readOnly || selected)
                                }
                            }
                            Divider()
                            Button(bridge.t("刷新 Word 文档列表")) {
                                bridge.invoke("nativeRefreshWordDocumentList")
                            }
                        } label: {
                            Text(bridge.state.documentName)
                                .font(.headline.weight(.semibold))
                                .lineLimit(2)
                                .truncationMode(.middle)
                                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .menuStyle(.borderlessButton)
                        .help(bridge.state.documentName)
                        .accessibilityLabel(bridge.t("切换 Word 文档"))
                        .accessibilityValue(bridge.state.documentName)
                        if bridge.state.wordDocumentUnavailable {
                            Label(bridge.t("文档连接已结束，草稿已保留。"), systemImage: "exclamationmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .labelStyle(.titleAndIcon)
                                .accessibilityLabel(bridge.t("文档连接已结束，草稿已保留。"))
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.42), in: RoundedRectangle(cornerRadius: 10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(.primary.opacity(0.05), lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 5)
            }
            HStack(spacing: 8) {
                Text(bridge.t(showingFavorites ? "模板收藏" : "当前文档的公式"))
                    .font(showingFavorites ? .headline : .subheadline.weight(.medium))
                Spacer()
                Text(query.isEmpty ? "\(showingFavorites ? allItems.count : max(allItems.count, bridge.state.wordDocumentTotal))" : "\(items.count) / \(allItems.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                if !showingFavorites {
                    Button { bridge.invoke("nativeRefreshWordWorkspace") } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.plain).disabled(bridge.state.busy)
                        .accessibilityLabel(bridge.t("刷新当前 Word 文档")).help(bridge.t("刷新当前 Word 文档"))
                }
            }.padding(.horizontal, 18).padding(.vertical, 8)
            if !showingFavorites && (bridge.state.wordDocumentLoading || bridge.state.wordDocumentLoadFailed) {
                HStack(spacing: 7) {
                    if bridge.state.wordDocumentLoading { ProgressView().controlSize(.small) }
                    Text(bridge.t(bridge.state.wordDocumentLoading ? "当前公式可编辑，正在加载其余公式…" : "列表未能载入，当前公式仍可编辑。"))
                        .font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
            }
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
                ScrollViewReader { scroll in
                List {
                    ForEach(items) { item in
                        Button {
                            bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                        } label: {
                            HStack(spacing: 12) {
                                Text("\(item.position ?? item.id + 1)")
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
                        .background {
                            FormulaThumbnailVisibility(key: "\(bridge.state.documentPath):\(item.id)", enabled: !showingFavorites && bridge.wordSessionActive && item.image == nil && !item.readOnly) {
                                bridge.invoke("nativeRequestWordThumbnail", argument: item.id)
                            }
                        }
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
                        .id(item.id)
                    }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
                .onAppear {
                    if !showingFavorites, let selected = bridge.state.selected, items.contains(where: { $0.id == selected }) {
                        DispatchQueue.main.async { scroll.scrollTo(selected, anchor: .center) }
                    }
                }
                .onChange(of: bridge.state.selected) { _, selected in
                    if !showingFavorites, let selected, items.contains(where: { $0.id == selected }) {
                        DispatchQueue.main.async { scroll.scrollTo(selected, anchor: .center) }
                    }
                }
                .onChange(of: items.map(\.id)) { _, newIDs in
                    if !showingFavorites, let selected = bridge.state.selected, newIDs.contains(selected) {
                        DispatchQueue.main.async { scroll.scrollTo(selected, anchor: .center) }
                    }
                }
                .onChange(of: bridge.wordPresentationRevision) { _, revision in
                    // A retained window can be hidden while its list is being
                    // populated. Retry after it has had a layout pass, even if
                    // the selected id is the same as in the previous session.
                    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150)) {
                        guard revision == bridge.wordPresentationRevision, !showingFavorites,
                              let selected = bridge.state.selected,
                              items.contains(where: { $0.id == selected }) else { return }
                        scroll.scrollTo(selected, anchor: .center)
                    }
                }
                }
            }
            HStack(spacing: 6) {
                WordInsertionMenu(bridge: bridge)
                    .menuStyle(.borderlessButton)
                    .modifier(WorkbenchMenuSurface())
            }
            .font(.system(size: 11))
            .disabled(bridge.state.busy || bridge.state.wordOutcomeUnknown).padding(.horizontal, 12)
            .modifier(WorkbenchFooter())
        }
    }
}
