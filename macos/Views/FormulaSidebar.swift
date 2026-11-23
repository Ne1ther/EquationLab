import SwiftUI

struct FormulaSidebar: View {
    private enum SelectionDocumentKey: Equatable {
        case word(String)
        case standalone(String)
    }

    private struct PendingRowSelection: Equatable {
        let id: Int
        let document: SelectionDocumentKey
    }

    private struct SelectionMarkFrame {
        var scaleY: CGFloat = 1
        var opacity: Double = 1
        var fillBoost: Double = 0
    }

    private struct ActiveSelectionRowBackground: View {
        let pulseToken: Int
        @Binding var consumedPulseToken: Int
        @State private var trigger = 0

        var body: some View {
            Color.clear
                .keyframeAnimator(initialValue: SelectionMarkFrame(), trigger: trigger) { _, frame in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 7)
                            .fill(Color.accentColor.opacity(0.15 + frame.fillBoost))
                        Capsule(style: .continuous)
                            .fill(Color.accentColor)
                            .frame(width: 3, height: 18)
                            .padding(.leading, 4)
                            .scaleEffect(y: frame.scaleY, anchor: .center)
                            .opacity(frame.opacity)
                    }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                } keyframes: { _ in
                    KeyframeTrack(\.scaleY) {
                        MoveKeyframe(0.38)
                        SpringKeyframe(1.06, duration: 0.13, spring: .snappy(duration: 0.13))
                        SpringKeyframe(1.0, duration: 0.13, spring: .smooth(duration: 0.13))
                    }
                    KeyframeTrack(\.opacity) {
                        MoveKeyframe(0.25)
                        LinearKeyframe(1.0, duration: 0.10)
                    }
                    KeyframeTrack(\.fillBoost) {
                        MoveKeyframe(0.08)
                        CubicKeyframe(0.0, duration: 0.24)
                    }
                }
                .onAppear {
                    consumePulseIfNeeded(pulseToken)
                }
                .onChange(of: pulseToken) { _, newValue in
                    consumePulseIfNeeded(newValue)
                }
        }

        private func consumePulseIfNeeded(_ token: Int) {
            guard token > 0, token > consumedPulseToken else { return }
            consumedPulseToken = token
            trigger = token
        }
    }

    @ObservedObject var bridge: DesktopBridge
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingFavorites = false
    @State private var documentQuery = ""
    @State private var favoritesQuery = ""
    @FocusState private var searchFocused: Bool
    @State private var pendingSelection: PendingRowSelection?
    @State private var activeSelectionPulseID: Int?
    @State private var activeSelectionPulseCount = 0
    @State private var consumedSelectionPulseCount = 0

    private var currentSelectionDocumentKey: SelectionDocumentKey? {
        if let identity = bridge.state.wordDocumentIdentity, !identity.isEmpty {
            return .word(identity)
        }
        if !bridge.state.documentPath.isEmpty {
            return .standalone(bridge.state.documentPath)
        }
        return nil
    }

    private var english: Bool { bridge.language.usesEnglish }
    private func label(_ zh: String, _ en: String) -> String { english ? en : zh }
    private var allItems: [SidebarFormula] { showingFavorites ? bridge.state.favorites : bridge.state.objects }
    private var searchQuery: Binding<String> { showingFavorites ? $favoritesQuery : $documentQuery }
    private var canRefreshWorkspace: Bool {
        !bridge.state.busy && !bridge.state.wordDocumentLoading && !bridge.state.wordOutcomeUnknown && !bridge.state.wordDocumentUnavailable
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
        let allItems = self.allItems
        let terms = SidebarFormula.searchTerms(in: searchQuery.wrappedValue)
        let isFiltering = !terms.isEmpty
        let items = isFiltering ? allItems.filter { $0.matchesSearch(terms: terms) } : allItems
        let totalCount = showingFavorites ? allItems.count : max(allItems.count, bridge.state.wordDocumentTotal)
        let isPartiallyLoaded = !showingFavorites && bridge.state.wordDocumentLoading && !allItems.isEmpty && allItems.count < totalCount
        let countLabel = isFiltering ? "\(items.count) / \(allItems.count)" : isPartiallyLoaded ? "\(allItems.count) / \(totalCount)" : "\(totalCount)"
        let hasStaleNumbers = !showingFavorites && allItems.contains { $0.numberStatus == "stale" }
        let selectedID = showingFavorites ? nil : bridge.state.selected
        let selectionIsLoaded = selectedID.map { id in allItems.contains { $0.id == id } } ?? false
        let selectionIsInResults = isFiltering ? (selectedID.map { id in items.contains { $0.id == id } } ?? false) : selectionIsLoaded

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
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                Text(countLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .fixedSize()
                    .accessibilityLabel(isFiltering
                        ? label("\(items.count) 项匹配，共 \(allItems.count) 项", "\(items.count) \(items.count == 1 ? "match" : "matches") out of \(allItems.count)")
                        : countLabel)
                if !showingFavorites && bridge.state.fileCopyGeneration == nil {
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
                freshnessBanner(allItems: allItems, totalCount: totalCount, isPartiallyLoaded: isPartiallyLoaded, hasStaleNumbers: hasStaleNumbers)
            }
            if !allItems.isEmpty || isFiltering {
                searchField(isFiltering: isFiltering)
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
                } else if isFiltering {
                    ContentUnavailableView {
                        Label(!showingFavorites && bridge.state.wordCatalogAvailable
                            ? label("已读取内容中没有匹配", "No matches in loaded content")
                            : bridge.t("没有匹配的公式"), systemImage: "magnifyingglass")
                    } description: {
                        Text(showingFavorites
                            ? label("试试公式中的 LaTeX，可用空格组合搜索。", "Search within the LaTeX. Use spaces to combine terms.")
                            : bridge.t("试试正文编号、LaTeX 或位置序号；空格可组合搜索。"))
                    } actions: {
                        Button(bridge.t("清除搜索"), action: clearSearch)
                    }
                    .font(.callout)
                    Spacer(minLength: 0)
                } else {
                    ContentUnavailableView {
                        Label(bridge.t(showingFavorites ? "暂无收藏" : "打开 Word 文档"), systemImage: showingFavorites ? "star" : "doc.text")
                    } description: {
                        Text(bridge.t(showingFavorites ? "将常用公式加入收藏。" : "文档中的 MathType 公式会显示在这里。"))
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
                            if !showingFavorites,
                               bridge.state.selected != item.id,
                               let document = currentSelectionDocumentKey {
                                pendingSelection = PendingRowSelection(id: item.id, document: document)
                            }
                            bridge.invoke(showingFavorites ? "nativeFavorite" : "nativeSelectObject", argument: item.id)
                        } label: {
                            formulaRow(item, catalogPlaceholder: catalogPlaceholder, selected: selectedID == item.id)
                        }
                        .buttonStyle(.plain)
                        .disabled(selectionUnavailable)
                        .accessibilityLabel(rowAccessibilityLabel(item, selected: selectedID == item.id))
                        .accessibilityValue(item.latex)
                        .accessibilityAddTraits(selectedID == item.id ? .isSelected : [])
                        .background {
                            let thumbnailDocument = bridge.state.documentPath
                            let fileCopyGeneration = bridge.state.fileCopyGeneration
                            let canRequest = fileCopyGeneration != nil || bridge.wordSessionActive
                            FormulaThumbnailVisibility(key: "\(thumbnailDocument):\(fileCopyGeneration ?? 0):\(item.id)", enabled: canRequest && !showingFavorites && !bridge.state.wordCatalogAvailable && item.image == nil && !item.readOnly) {
                                thumbnailVisibility(item.id, document: thumbnailDocument, fileCopyGeneration: fileCopyGeneration, visible: true)
                            } onHidden: {
                                thumbnailVisibility(item.id, document: thumbnailDocument, fileCopyGeneration: fileCopyGeneration, visible: false)
                            }
                        }
                        .listRowBackground(rowSelectionBackground(for: item.id))
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
                    if !isFiltering { revealSelection(using: scroll, selectionIsInResults: selectionIsInResults) }
                }
                .onChange(of: bridge.state.selected) { _, selected in
                    if !showingFavorites,
                       let selected,
                       let pending = pendingSelection,
                       pending.id == selected,
                       pending.document == currentSelectionDocumentKey {
                        pendingSelection = nil
                        if !reduceMotion {
                            activeSelectionPulseID = selected
                            activeSelectionPulseCount += 1
                        }
                    } else if let selected, selected != pendingSelection?.id {
                        pendingSelection = nil
                        if selected != activeSelectionPulseID {
                            activeSelectionPulseID = nil
                        }
                    }
                    revealSelection(using: scroll, selectionIsInResults: selectionIsInResults)
                }
                .onChange(of: selectionIsLoaded) { _, isLoaded in
                    if isLoaded { revealSelection(using: scroll, selectionIsInResults: selectionIsInResults) }
                }
                .onChange(of: currentSelectionDocumentKey) { _, _ in
                    revealSelection(using: scroll, selectionIsInResults: selectionIsInResults)
                }
                .onChange(of: showingFavorites) { _, favorites in
                    if !favorites && !isFiltering { revealSelection(using: scroll, selectionIsInResults: selectionIsInResults) }
                }
                .onChange(of: bridge.wordPresentationRevision) { _, _ in
                    // A retained window can be hidden while its list is being
                    // populated. Retry after it has had a layout pass, even if
                    // the selected id is the same as in the previous session.
                    revealSelection(using: scroll, selectionIsInResults: selectionIsInResults, after: .milliseconds(150))
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
        .onChange(of: showingFavorites) { _, _ in
            pendingSelection = nil
        }
        .onChange(of: currentSelectionDocumentKey) { _, _ in
            pendingSelection = nil
            activeSelectionPulseID = nil
        }
        .onChange(of: bridge.state.messageError) { _, isError in
            if isError { pendingSelection = nil }
        }
        .onChange(of: bridge.state.wordDocumentUnavailable) { _, unavailable in
            if unavailable { pendingSelection = nil }
        }
        .onChange(of: bridge.state.wordOutcomeUnknown) { _, unknown in
            if unknown { pendingSelection = nil }
        }
        .onChange(of: bridge.wordSessionIsInsertion) { _, isInsertion in
            if isInsertion { pendingSelection = nil }
        }
    }

    private func searchField(isFiltering: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField(showingFavorites ? label("搜索收藏", "Find favorites") : label("搜索公式", "Find equations"), text: searchQuery)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .accessibilityLabel(showingFavorites ? label("搜索收藏", "Search favorites") : bridge.t("搜索编号、公式或 LaTeX"))
            if isFiltering {
                Button(action: clearSearch) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(bridge.t("清除搜索"))
                .accessibilityLabel(bridge.t("清除搜索"))
            }
        }
        .font(.callout)
        .frame(height: 28)
        .padding(.horizontal, 8)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 7))
        .overlay {
            RoundedRectangle(cornerRadius: 7)
                .strokeBorder(searchFocused ? Color.accentColor : Color.primary.opacity(0.08))
                .allowsHitTesting(false)
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private func clearSearch() {
        searchQuery.wrappedValue = ""
        searchFocused = !allItems.isEmpty
    }

    private func numberText(for item: SidebarFormula) -> String {
        item.numberText ?? bridge.t(item.numberStatus == "pending" ? "编号待载入" : "无已读编号")
    }

    private func rowAccessibilityLabel(_ item: SidebarFormula, selected: Bool) -> String {
        let position = item.position ?? item.id + 1
        if showingFavorites { return label("收藏公式 \(position)", "Favorite equation \(position)") }

        var parts = [label("文档位置 \(position)", "Equation at position \(position)")]
        if let number = item.numberText {
            parts.append(label("编号 \(number)", "Number \(number)"))
        } else {
            parts.append(numberText(for: item))
        }
        if item.numberStatus == "stale" { parts.append(bridge.t("待刷新")) }
        if item.readOnly { parts.append(bridge.t("只读")) }
        if selected { parts.append(label("已选中", "Selected")) }
        return parts.joined(separator: label("，", ", "))
    }

    private func formulaRow(_ item: SidebarFormula, catalogPlaceholder: Bool, selected: Bool) -> some View {
        HStack(spacing: 8) {
            if !showingFavorites {
                Text("\(item.position ?? item.id + 1)")
                    .font(.caption.weight(selected ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(selected ? .primary : .secondary)
                    .fixedSize()
                    .frame(minWidth: 22, alignment: .trailing)
                    .help(bridge.t("文档位置序号"))
            }
            if catalogPlaceholder {
                Text(label("打开公式", "Open equation"))
                    .font(.callout)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    if !showingFavorites {
                        HStack(spacing: 5) {
                            let isStale = item.numberStatus == "stale"
                            Text(numberText(for: item))
                                .font(.caption.weight(item.numberText == nil ? .regular : .semibold))
                                .monospacedDigit()
                                .foregroundStyle(item.numberText == nil || isStale ? .secondary : .primary)
                                .lineLimit(1)
                            if isStale {
                                Text(bridge.t("待刷新"))
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(.orange)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            if item.readOnly {
                                Image(systemName: "lock")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    if let thumbnail = item.thumbnail {
                        let paper = colorScheme == .dark ? Color(red: 0.94, green: 0.94, blue: 0.93) : Color.white
                        Image(nsImage: thumbnail)
                            .resizable()
                            .interpolation(.high)
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .frame(height: 39)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(paper, in: RoundedRectangle(cornerRadius: 6))
                            .overlay {
                                RoundedRectangle(cornerRadius: 6)
                                    .strokeBorder(Color.black.opacity(0.09), lineWidth: 0.5)
                            }
                            .accessibilityHidden(true)
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: "function").font(.callout)
                            if item.latex.isEmpty {
                                Text(bridge.t(item.readOnly || !bridge.wordSessionActive ? "未能预览" : "正在生成预览"))
                                    .font(.caption)
                            } else {
                                Text(item.latex)
                                    .font(.system(.caption, design: .monospaced))
                                    .lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(height: 45)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: catalogPlaceholder ? 26 : showingFavorites ? 50 : 66, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func freshnessBanner(allItems: [SidebarFormula], totalCount: Int, isPartiallyLoaded: Bool, hasStaleNumbers: Bool) -> some View {
        let pendingCount = allItems.lazy.filter { $0.numberStatus == "pending" }.count
        if bridge.state.wordDocumentLoading {
            HStack(alignment: .top, spacing: 7) {
                ProgressView().controlSize(.small).padding(.top, 1)
                Text(
                    bridge.state.wordCatalogAvailable
                        ? label("目录可点选，编号和公式内容正在加载。", "Open any row while equation text and numbers load.")
                        : isPartiallyLoaded
                        ? label("当前公式可编辑，后台载入其余公式（\(allItems.count)/\(totalCount)）…", "Current equation ready; loading others (\(allItems.count)/\(totalCount))…")
                        : label("正在后台同步列表快照，已有公式仍可查看与编辑…", "Syncing list snapshot in background; loaded equations stay visible…")
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
        } else if pendingCount > 0 {
            Text(label("部分编号待载入（\(pendingCount) 项）；当前可继续编辑。", "\(pendingCount) equation numbers pending; editing stays available."))
                .font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.bottom, 6)
        }
    }

    private var staticSelectionBackground: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color.accentColor.opacity(0.15))
            Capsule(style: .continuous)
                .fill(Color.accentColor)
                .frame(width: 3, height: 18)
                .padding(.leading, 4)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
    }

    @ViewBuilder
    private func rowSelectionBackground(for itemID: Int) -> some View {
        if !showingFavorites && bridge.state.selected == itemID {
            if reduceMotion {
                staticSelectionBackground
            } else {
                ActiveSelectionRowBackground(
                    pulseToken: activeSelectionPulseID == itemID ? activeSelectionPulseCount : 0,
                    consumedPulseToken: $consumedSelectionPulseCount
                )
            }
        } else {
            Color.clear
        }
    }

    private func revealSelection(using scroll: ScrollViewProxy, selectionIsInResults: Bool, after delay: DispatchTimeInterval = .milliseconds(0)) {
        guard !showingFavorites, selectionIsInResults, let selected = bridge.state.selected else { return }
        let document = currentSelectionDocumentKey, path = bridge.state.documentPath
        let query = documentQuery, revision = bridge.wordPresentationRevision
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard !showingFavorites, currentSelectionDocumentKey == document, documentQuery == query,
                  bridge.state.documentPath == path, bridge.wordPresentationRevision == revision,
                  bridge.state.selected == selected else { return }
            scroll.scrollTo(selected, anchor: .center)
        }
    }
    private func thumbnailVisibility(_ index: Int, document: String, fileCopyGeneration: Int?, visible: Bool) {
        var payload: [String: Any] = ["index": index, "path": document, "visible": visible]
        if let fileCopyGeneration { payload["fileCopyGeneration"] = fileCopyGeneration }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let argument = String(data: data, encoding: .utf8) else { return }
        bridge.invoke("nativeWordThumbnailVisibility", argument: argument)
    }
}
