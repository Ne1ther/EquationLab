import SwiftUI

struct FormulaSidebar: View {
    @ObservedObject var bridge: DesktopBridge
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingFavorites = false
    @State private var query = ""

    private var english: Bool { bridge.language.usesEnglish }
    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
    private var allItems: [SidebarFormula] { showingFavorites ? bridge.state.favorites : bridge.state.objects }
    private var items: [SidebarFormula] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return search.isEmpty ? allItems : allItems.filter { $0.matchesSearch(search) }
    }
    private var totalCount: Int { max(allItems.count, bridge.state.wordDocumentTotal) }
    private var isPartiallyLoaded: Bool {
        !showingFavorites && bridge.state.wordDocumentLoading && !allItems.isEmpty && allItems.count < totalCount
    }
    private var staleCount: Int { allItems.filter { $0.numberStatus == "stale" }.count }
    private var pendingCount: Int { allItems.filter { $0.numberStatus == "pending" }.count }
    private var hasStaleNumbers: Bool { !showingFavorites && staleCount > 0 }
    private var hasPendingNumbers: Bool { !showingFavorites && pendingCount > 0 }
    private var canRefreshWorkspace: Bool {
        !bridge.state.busy && !bridge.state.wordDocumentLoading && !bridge.state.wordOutcomeUnknown && !bridge.state.wordDocumentUnavailable
    }
    private var countLabel: String {
        if !query.isEmpty { return "\(items.count) / \(allItems.count)" }
        if isPartiallyLoaded { return "\(allItems.count) / \(totalCount)" }
        return "\(showingFavorites ? allItems.count : totalCount)"
    }
    private var selectionUnavailable: Bool {
        bridge.state.busy || showingFavorites && bridge.wordSessionActive && (bridge.state.readOnly || bridge.state.wordOutcomeUnknown || bridge.state.wordDocumentUnavailable) ||
            !showingFavorites && (bridge.state.wordDocumentUnavailable || bridge.state.wordOutcomeUnknown ||
                !bridge.state.wordCatalogAvailable && (bridge.state.wordDocumentLoading || bridge.state.wordDocumentLoadFailed))
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
                Text(bridge.t("收藏夹")).tag(true)
            }.pickerStyle(.segmented).labelsHidden().padding(14)
            if !showingFavorites {
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
                            HStack(alignment: .center, spacing: 8) {
                                OfficeProductLabel(bridge: bridge, wordOnly: true, showsTitle: false)
                                    .frame(width: 24, height: 24)
                                    .fixedSize()
                                Text(bridge.state.documentName)
                                    .font(.headline.weight(.semibold))
                                    .lineLimit(2)
                                    .truncationMode(.middle)
                                    .multilineTextAlignment(.leading)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                    .frame(width: 12)
                                    .fixedSize()
                                    .accessibilityHidden(true)
                            }
                            .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .menuStyle(.button)
                        .buttonStyle(.plain)
                        .menuIndicator(.hidden)
                        .help(bridge.state.documentName)
                        .accessibilityLabel(bridge.t("切换 Word 文档"))
                        .accessibilityValue(bridge.state.documentName)
                        if bridge.state.wordDocumentUnavailable {
                            Label(bridge.t("文档连接已结束，草稿已保留。"), systemImage: "exclamationmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .labelStyle(.titleAndIcon)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel(bridge.t("文档连接已结束，草稿已保留。"))
                        }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.42), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(.primary.opacity(0.05), lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 5)
            }
            HStack(spacing: 6) {
                Text(bridge.t(showingFavorites ? "模板收藏" : "当前文档的公式"))
                    .font(showingFavorites ? .headline : .subheadline.weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                Text(countLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .fixedSize()
                if !showingFavorites {
                    Button { bridge.invoke("nativeRefreshWordWorkspace") } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(hasStaleNumbers && !bridge.state.wordDocumentLoading ? .orange : .secondary)
                            .frame(width: 20, height: 20)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .disabled(!canRefreshWorkspace)
                    .accessibilityLabel(bridge.t("刷新当前 Word 文档"))
                    .help(hasStaleNumbers
                        ? label("Word 中的编号已更新；点击重新读取文档快照。", "Numbers changed in Word. Click to reload the document snapshot.")
                        : bridge.t(allItems.isEmpty ? "刷新当前 Word 文档" : "编号来自文档快照；在 Word 更新后请刷新。"))
                }
            }.padding(.horizontal, 14).padding(.vertical, 8)
            if !showingFavorites && !allItems.isEmpty {
                freshnessBanner
            }
            if !allItems.isEmpty || !query.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease").foregroundStyle(.secondary)
                    TextField(bridge.t("搜索编号、公式或 LaTeX"), text: $query).textFieldStyle(.plain)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                            .buttonStyle(.plain).accessibilityLabel(bridge.t("清除搜索"))
                    }
                }.font(.callout).padding(8)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .padding(.horizontal, 14).padding(.bottom, 8)
            }
            if items.isEmpty {
                if !showingFavorites && allItems.isEmpty && (bridge.state.wordDocumentLoading || bridge.state.wordDocumentReadState == .loading) {
                    VStack(spacing: 10) {
                        ProgressView().controlSize(.regular)
                        Text(label("正在载入文档中的公式…", "Loading equations from Word…"))
                            .font(.callout.weight(.medium))
                        if totalCount > 0 {
                            Text(label("共 \(totalCount) 个公式，当前可继续编辑。", "\(totalCount) equations in this document. You can keep editing."))
                                .font(.caption).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.horizontal, 18)
                } else if !showingFavorites && allItems.isEmpty && !bridge.state.wordDocumentUnavailable &&
                            (bridge.state.wordDocumentReadState == .failed || bridge.state.wordDocumentLoadFailed) {
                    ContentUnavailableView {
                        Label(label("未能读取当前文档", "Couldn't Read This Document"), systemImage: "exclamationmark.triangle")
                    } actions: {
                        Button(label("重试载入", "Retry")) {
                            bridge.invoke("nativeRetryWordDocumentRead")
                        }
                        .disabled(!canRefreshWorkspace)
                    }
                    .font(.callout)
                } else if !showingFavorites && allItems.isEmpty && bridge.state.wordDocumentReadState == .empty {
                    ContentUnavailableView(label("当前文档暂无公式", "No Equations in This Document"), systemImage: "function")
                        .font(.callout)
                } else {
                    ContentUnavailableView {
                        Label(!query.isEmpty && !showingFavorites && bridge.state.wordCatalogAvailable
                            ? label("已读取内容中没有匹配", "No matches in loaded content")
                            : bridge.t(!query.isEmpty ? "没有匹配的公式" : showingFavorites ? "暂无收藏" : "打开 Word 文档"),
                            systemImage: !query.isEmpty ? "magnifyingglass" : showingFavorites ? "star" : "doc.text")
                    } description: {
                        Text(bridge.t(!query.isEmpty ? "试试正文编号、LaTeX 或位置序号；空格可组合搜索。" : showingFavorites ? "将常用公式加入收藏。" : "文档中的 MathType 公式会显示在这里。"))
                    }
                    .font(.callout)
                    Spacer(minLength: 0)
                }
            } else {
                ScrollViewReader { scroll in
                List {
                    ForEach(items) { item in
                        let catalogPlaceholder = !showingFavorites && bridge.state.wordCatalogAvailable &&
                            item.latex.isEmpty && item.image == nil && item.numberStatus == "pending" && !item.readOnly
                        Button {
                            bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                        } label: {
                            HStack(spacing: 12) {
                                Text("\(item.position ?? item.id + 1)")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary).frame(minWidth: 17)
                                    .fixedSize()
                                    .help(bridge.t("文档位置序号"))
                                if catalogPlaceholder {
                                    Text(label("打开公式", "Open equation"))
                                        .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Image(systemName: "chevron.right")
                                        .font(.caption2.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
                                } else {
                                    VStack(alignment: .leading, spacing: 4) {
                                        if !showingFavorites {
                                            HStack(spacing: 5) {
                                                let isStale = item.numberStatus == "stale"
                                                let isPending = item.numberStatus == "pending"
                                                Text(item.numberText ?? bridge.t(isPending ? "编号待载入" : "无已读编号"))
                                                    .font(.caption.weight(item.numberText == nil ? .regular : isStale ? .medium : .semibold))
                                                    .monospacedDigit()
                                                    .foregroundStyle(item.numberText == nil || isStale ? .secondary : .primary)
                                                    .lineLimit(1)
                                                if isStale {
                                                    Text(bridge.t("待刷新"))
                                                        .font(.system(size: 9.5, weight: .medium))
                                                        .foregroundStyle(.orange)
                                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                                        .background(Color.orange.opacity(0.14), in: Capsule())
                                                        .fixedSize()
                                                }
                                            }
                                        }
                                        if let thumbnail = item.thumbnail {
                                            let cardFill = colorScheme == .dark ? Color(red: 0.925, green: 0.922, blue: 0.906) : Color.white
                                            Image(nsImage: thumbnail).resizable().interpolation(.high)
                                                .scaledToFit().frame(maxWidth: .infinity).frame(height: 41)
                                                .padding(.horizontal, 8).padding(.vertical, 3)
                                                .background(cardFill, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                                .overlay {
                                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                                        .strokeBorder(Color.primary.opacity(colorScheme == .dark ? 0.14 : 0.07), lineWidth: 0.5)
                                                }
                                                .accessibilityLabel(item.latex)
                                        } else {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Image(systemName: "function").font(.title2)
                                                if item.latex.isEmpty {
                                                    Text(bridge.state.wordCatalogAvailable && !showingFavorites
                                                        ? label("打开公式", "Open equation")
                                                        : bridge.t(item.readOnly || !bridge.wordSessionActive ? "未能预览" : "正在生成预览")).font(.caption2)
                                                } else {
                                                    Text(item.latex).font(.system(.caption2, design: .monospaced)).lineLimit(2)
                                                }
                                            }.frame(maxWidth: .infinity, alignment: .leading).frame(height: 47).foregroundStyle(.secondary)
                                        }
                                    }
                                    if item.readOnly { Image(systemName: "lock").font(.caption2).foregroundStyle(.secondary) }
                                }
                            }.frame(height: 66).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(selectionUnavailable)
                        .background {
                            let thumbnailDocument = bridge.state.documentPath
                            FormulaThumbnailVisibility(key: "\(bridge.state.documentPath):\(item.id)", enabled: !showingFavorites && !bridge.state.wordCatalogAvailable && bridge.wordSessionActive && item.image == nil && !item.readOnly) {
                                thumbnailVisibility(item.id, document: thumbnailDocument, visible: true)
                            } onHidden: {
                                thumbnailVisibility(item.id, document: thumbnailDocument, visible: false)
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
                    revealSelection(using: scroll)
                }
                .onChange(of: bridge.state.selected) { _, _ in
                    revealSelection(using: scroll)
                }
                .onChange(of: items.map(\.id)) { _, _ in
                    revealSelection(using: scroll)
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

    @ViewBuilder
    private var freshnessBanner: some View {
        if bridge.state.wordDocumentLoading {
            HStack(alignment: .top, spacing: 7) {
                ProgressView().controlSize(.small).padding(.top, 1)
                Text(
                    bridge.state.wordCatalogAvailable
                        ? label("目录可点选，编号和公式内容正在加载。", "Open any row while equation text and numbers load.")
                        : isPartiallyLoaded
                        ? label("当前公式可编辑，后台载入其余公式（\(allItems.count)/\(totalCount)）…", "Current equation ready; loading others (\(allItems.count)/\(totalCount))…")
                        : !allItems.isEmpty
                            ? label("正在后台同步列表快照，已有公式仍可查看与编辑…", "Syncing list snapshot in background; loaded equations stay visible…")
                            : bridge.t("当前公式可编辑，正在加载其余公式…")
                )
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(.quaternary.opacity(0.42), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .padding(.horizontal, 14).padding(.bottom, 8)
        } else if bridge.state.wordDocumentLoadFailed {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.orange).padding(.top, 1)
                    Text(bridge.state.wordCatalogAvailable
                        ? label("全文数据未能载入，仍可按位置打开公式。", "Full document data could not load. Open equations by position.")
                        : bridge.t("列表未能载入，当前公式仍可编辑。"))
                        .font(.caption).foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Spacer()
                    Button(label("重试载入", "Retry")) {
                        bridge.invoke("nativeRefreshWordWorkspace")
                    }
                    .controlSize(.mini)
                    .disabled(!canRefreshWorkspace)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(Color.orange.opacity(0.22), lineWidth: 0.5)
                    .allowsHitTesting(false)
            }
            .padding(.horizontal, 14).padding(.bottom, 8)
        } else if hasStaleNumbers {
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .center, spacing: 6) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                    Text(label("编号快照待刷新", "Number snapshot outdated"))
                        .font(.caption.weight(.semibold))
                    Spacer(minLength: 4)
                    Button(label("刷新", "Refresh")) {
                        bridge.invoke("nativeRefreshWordWorkspace")
                    }
                    .controlSize(.mini)
                    .disabled(!canRefreshWorkspace)
                }
                Text(
                    bridge.wordSessionActive
                        ? label("Word 中已有编号更新；列表暂留旧快照。保存或取消当前编辑后会自动同步，草稿无改动时可直接刷新。", "Numbers changed in Word; previous rows stay visible. Syncs after this edit, or refresh when clean.")
                        : label("Word 中已有编号更新；列表暂留旧快照，点击刷新可重新同步。", "Numbers changed in Word; previous rows stay visible until refreshed.")
                )
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(Color.orange.opacity(0.22), lineWidth: 0.5)
                    .allowsHitTesting(false)
            }
            .padding(.horizontal, 14).padding(.bottom, 8)
        } else if hasPendingNumbers {
            Text(label("部分编号待载入（\(pendingCount) 项）；当前可继续编辑。", "\(pendingCount) equation numbers pending; editing stays available."))
                .font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.bottom, 6)
        }
    }

    private func revealSelection(using scroll: ScrollViewProxy) {
        guard !showingFavorites, let selected = bridge.state.selected, items.contains(where: { $0.id == selected }) else { return }
        let path = bridge.state.documentPath, identity = bridge.state.wordDocumentIdentity
        DispatchQueue.main.async {
            guard !showingFavorites, bridge.state.documentPath == path, bridge.state.wordDocumentIdentity == identity,
                  bridge.state.selected == selected, items.contains(where: { $0.id == selected }) else { return }
            scroll.scrollTo(selected, anchor: .center)
        }
    }
    private func thumbnailVisibility(_ index: Int, document: String, visible: Bool) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["index": index, "path": document, "visible": visible]),
              let argument = String(data: data, encoding: .utf8) else { return }
        bridge.invoke("nativeWordThumbnailVisibility", argument: argument)
    }
}
