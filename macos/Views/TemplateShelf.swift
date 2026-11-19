import SwiftUI
import AppKit

private struct ShelfCategory: Identifiable { let id: String }

private enum TemplateArtwork {
    static let images: [String: NSImage] = {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("template-previews"),
              let data = try? Data(contentsOf: root.appendingPathComponent("index.json")),
              let names = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return names.compactMapValues { NSImage(contentsOf: root.appendingPathComponent($0)) }
    }()
    static func symbol(_ category: String) -> String {
        switch category {
        case "常用结构": "function"
        case "积分与求和": "sum"
        case "矩阵": "square.grid.2x2"
        case "希腊字母": "character"
        case "运算与关系": "plus.forwardslash.minus"
        default: "textformat"
        }
    }
}

enum TemplateShelfOrder {
    static func isWordInlineInsertion(
        wordSessionActive: Bool,
        wordSessionIsInsertion: Bool,
        layout: [EditorField]
    ) -> Bool {
        wordSessionActive
            && wordSessionIsInsertion
            && layout.first(where: { $0.id == "layout-mode" })?.value == "inline"
    }

    static func isSmallFraction(_ item: FormulaTemplate) -> Bool {
        item.category == "常用结构" && (item.latex.hasPrefix("\\tfrac") || item.hint == "小分式")
    }

    static func isRegularFraction(_ item: FormulaTemplate) -> Bool {
        item.category == "常用结构" && (item.latex.hasPrefix("\\frac") || item.hint == "分式")
    }

    static func templates(
        for category: String,
        from allTemplates: [FormulaTemplate],
        prioritizeInlineSmallFraction: Bool
    ) -> [FormulaTemplate] {
        var items = allTemplates.filter { $0.category == category }
        if category == "矩阵" {
            return [FormulaTemplate(id: "matrix:custom", label: "", hint: "自定义矩阵", category: "矩阵", latex: "")] + items
        }
        guard prioritizeInlineSmallFraction,
              category == "常用结构",
              let smallIndex = items.firstIndex(where: isSmallFraction) else {
            return items
        }
        let targetIndex = items.firstIndex(where: isRegularFraction) ?? 0
        guard smallIndex > targetIndex else { return items }
        let smallFraction = items.remove(at: smallIndex)
        items.insert(smallFraction, at: targetIndex)
        return items
    }
}

struct TemplateShelf: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var shelf = "模板"
    private var isWordInlineInsertion: Bool {
        TemplateShelfOrder.isWordInlineInsertion(
            wordSessionActive: bridge.wordSessionActive,
            wordSessionIsInsertion: bridge.wordSessionIsInsertion,
            layout: bridge.state.layout
        )
    }
    private var visibleCategories: [String] {
        shelf == "符号" ? bridge.state.categories.filter { ["希腊字母", "运算与关系", "标记与函数"].contains($0) } : bridge.state.categories
    }
    private var currentTemplates: [FormulaTemplate] {
        TemplateShelfOrder.templates(
            for: bridge.state.activeCategory,
            from: bridge.state.templates,
            prioritizeInlineSmallFraction: isWordInlineInsertion
        )
    }
    private func templateHelp(_ item: FormulaTemplate) -> String {
        if isWordInlineInsertion {
            if TemplateShelfOrder.isSmallFraction(item) {
                return bridge.language.usesEnglish
                    ? "Small fraction · Compact height for inline Word text"
                    : "小分式 · 紧凑高度，行内插入不易撑开行距"
            }
            if TemplateShelfOrder.isRegularFraction(item) {
                return bridge.language.usesEnglish
                    ? "Fraction · Standard full height"
                    : "分式 · 标准完整高度"
            }
        }
        return bridge.t(item.hint.isEmpty ? item.label : item.hint)
    }
    private func templateAccessibilityHint(_ item: FormulaTemplate) -> String {
        guard isWordInlineInsertion, TemplateShelfOrder.isSmallFraction(item) else { return "" }
        return bridge.language.usesEnglish
            ? "Compact height for inline Word text"
            : "紧凑高度，行内插入不易撑开行距"
    }
    private enum ShelfTopBarDensity {
        case full
        case compactActions
        case tight
    }

    @ViewBuilder
    private func shelfTopBar(_ density: ShelfTopBarDensity) -> some View {
        let catalogTitle = bridge.t(FeatureCatalog.title(bridge.state.activeCategory))
        let catalogIcon = bridge.state.activeCategory == "希腊字母" ? "character.book.closed.fill" : "square.grid.3x3.fill"
        let showActionLabels = density == .full
        let actionPadding: CGFloat = showActionLabels ? 8 : (density == .tight ? 4 : 5)
        let iconPadding: CGFloat = density == .tight ? 3 : 4
        let iconWidth: CGFloat = density == .tight ? 16 : 18

        HStack(spacing: density == .tight ? 3 : (density == .compactActions ? 5 : 6)) {
            Picker(bridge.t("工具类型"), selection: $shelf) {
                Text(bridge.t("符号")).tag("符号")
                Text(bridge.t("模板")).tag("模板")
                Text(bridge.t("收藏")).tag("收藏")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .fixedSize()

            Spacer(minLength: density == .tight ? 2 : 4)

            Button { bridge.action("click", ["id": "add-favorite"]) } label: {
                if showActionLabels {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill").foregroundStyle(.orange)
                        Text(bridge.t("收藏公式")).lineLimit(1)
                    }
                } else {
                    Image(systemName: "star.fill").foregroundStyle(.orange).frame(width: iconWidth)
                }
            }
            .font(.system(size: 11, weight: .medium))
            .buttonStyle(WorkbenchButtonStyle(tint: .orange, surface: true, horizontalPadding: actionPadding))
            .fixedSize()
            .disabled(bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bridge.state.busy)
            .help(bridge.t("收藏公式"))
            .accessibilityLabel(bridge.t("收藏公式"))

            Button {
                if bridge.state.activeCategory == "希腊字母" { bridge.showLetterLibrary.toggle() }
                else { bridge.showFeatureLibrary.toggle() }
            } label: {
                if showActionLabels {
                    HStack(spacing: 4) {
                        Image(systemName: catalogIcon).foregroundStyle(.purple)
                        Text(catalogTitle).lineLimit(1)
                    }
                } else {
                    Image(systemName: catalogIcon).foregroundStyle(.purple).frame(width: iconWidth)
                }
            }
            .font(.system(size: 11, weight: .medium))
            .buttonStyle(WorkbenchButtonStyle(tint: .purple, selected: bridge.showLetterLibrary || bridge.showFeatureLibrary, surface: true, horizontalPadding: actionPadding))
            .fixedSize()
            .help(catalogTitle)
            .accessibilityLabel(catalogTitle)

            Divider().frame(height: 15).padding(.horizontal, density == .tight ? 0 : (density == .compactActions ? 1 : 2))

            HStack(spacing: density == .tight ? 1 : 2) {
                Button { bridge.showRuler.toggle() } label: {
                    Image(systemName: "ruler").foregroundStyle(bridge.showRuler ? .blue : .secondary).frame(width: iconWidth)
                }
                .buttonStyle(WorkbenchButtonStyle(selected: bridge.showRuler, horizontalPadding: iconPadding))
                .help(bridge.t("显示或隐藏标尺"))
                .accessibilityLabel(bridge.t("显示或隐藏标尺"))

                Button { bridge.showEditorMenu() } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(.indigo).frame(width: iconWidth)
                }
                .buttonStyle(WorkbenchButtonStyle(tint: .indigo, horizontalPadding: iconPadding))
                .help(bridge.t("公式菜单"))
                .accessibilityLabel(bridge.t("公式菜单"))

                Button { bridge.action("click", ["id": "undo"]) } label: {
                    Image(systemName: "arrow.uturn.backward").frame(width: iconWidth)
                }
                .buttonStyle(WorkbenchButtonStyle(horizontalPadding: iconPadding))
                .help(bridge.t("撤销"))
                .accessibilityLabel(bridge.t("撤销"))
                .disabled(bridge.state.busy || bridge.state.readOnly)

                Button { bridge.action("click", ["id": "redo"]) } label: {
                    Image(systemName: "arrow.uturn.forward").frame(width: iconWidth)
                }
                .buttonStyle(WorkbenchButtonStyle(horizontalPadding: iconPadding))
                .help(bridge.t("重做"))
                .accessibilityLabel(bridge.t("重做"))
                .disabled(bridge.state.busy || bridge.state.readOnly)
            }
            .foregroundStyle(.secondary)
            .fixedSize()

            Picker(bridge.t("缩放"), selection: Binding(get: { bridge.state.zoom }, set: { bridge.action("zoom", ["value": $0]) })) {
                Text(bridge.t("适合窗口")).tag(0)
                ForEach([50, 75, 100, 125, 150, 200, 250, 300], id: \.self) { Text("\($0)%").tag($0) }
            }
            .labelsHidden()
            .controlSize(.small)
            .frame(minWidth: bridge.language.usesEnglish ? 106 : 82, alignment: .trailing)
            .fixedSize()
            .layoutPriority(1)
            .help(bridge.t("画布缩放"))
            .accessibilityLabel(bridge.t("画布缩放"))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                shelfTopBar(.full)
                shelfTopBar(.compactActions)
                shelfTopBar(.tight)
            }
            .onChange(of: shelf) { _, value in
                if value == "符号" && !["希腊字母", "运算与关系", "标记与函数"].contains(bridge.state.activeCategory) {
                    bridge.action("category", ["name": "希腊字母"])
                }
            }
            .onChange(of: bridge.state.activeCategory) { _, category in
                if shelf == "符号" && !["希腊字母", "运算与关系", "标记与函数"].contains(category) { shelf = "模板" }
            }
            .popover(isPresented: $bridge.showLetterLibrary, arrowEdge: .bottom) { LetterLibrary(bridge: bridge) }
            .popover(isPresented: $bridge.showFeatureLibrary, arrowEdge: .bottom) { FeatureLibrary(bridge: bridge) }
            if shelf == "收藏" {
                if bridge.state.favorites.isEmpty {
                    Text(bridge.t("收藏常用公式后，可在这里快速插入。")).font(.caption).foregroundStyle(.secondary).frame(height: 100)
                } else {
                    HorizontalToolStrip(title: bridge.t("收藏"), items: bridge.state.favorites, height: 100, itemWidth: 117,
                                        previousLabel: bridge.t("向左翻页"), nextLabel: bridge.t("向右翻页")) { item in
                            Button { bridge.invoke("nativeFavorite", argument: item.id) } label: {
                                VStack(spacing: 6) {
                                    if let thumbnail = item.thumbnail {
                                        Image(nsImage: thumbnail).resizable().scaledToFit().frame(width: 85, height: 46)
                                    } else { Image(systemName: "function").font(.title2).frame(width: 85, height: 46) }
                                    Text(bridge.t("收藏 \(item.id + 1)")).font(.caption2).foregroundStyle(.secondary)
                                }.padding(10)
                            }.buttonStyle(WorkbenchButtonStyle(surface: true))
                                .disabled(bridge.state.busy || bridge.wordSessionActive && (bridge.state.readOnly || bridge.state.wordOutcomeUnknown || bridge.state.wordDocumentUnavailable))
                    }
                }
            } else {
                HorizontalToolStrip(title: bridge.t("工具分类"), items: visibleCategories.map { ShelfCategory(id: $0) }, height: 30, itemWidth: 90, spacing: 4, revealID: bridge.state.activeCategory,
                                    previousLabel: bridge.t("向左翻页"), nextLabel: bridge.t("向右翻页")) { item in
                            let category = item.id
                            Button { bridge.action("category", ["name": category]) } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: TemplateArtwork.symbol(category)).symbolRenderingMode(.hierarchical)
                                        .foregroundStyle(bridge.state.activeCategory == category ? .white : Color.accentColor)
                                    Text(bridge.t(category)).lineLimit(1)
                                }.font(.system(size: 11, weight: .medium)).padding(.horizontal, 4).fixedSize()
                            }
                            .buttonStyle(WorkbenchButtonStyle(selected: bridge.state.activeCategory == category, filledSelection: true))
                            .foregroundStyle(bridge.state.activeCategory == category ? .white : .primary)
                            .accessibilityAddTraits(bridge.state.activeCategory == category ? .isSelected : [])
                }
                if bridge.state.activeCategory == "希腊字母" {
                    CommonLetters(bridge: bridge)
                } else {
                    HorizontalToolStrip(title: bridge.t("模板"), items: currentTemplates, height: 82, itemWidth: 72,
                                        previousLabel: bridge.t("向左翻页"), nextLabel: bridge.t("向右翻页")) { item in
                            let prioritizedInlineFraction = isWordInlineInsertion && TemplateShelfOrder.isSmallFraction(item)
                            let tileShape = RoundedRectangle(cornerRadius: WorkbenchMetrics.cornerRadius, style: .continuous)
                            Button {
                                if item.id == "matrix:custom" { bridge.openMatrixBuilder() }
                                else { bridge.action("template", ["id": item.id]) }
                            } label: {
                                VStack(spacing: 6) {
                                    if item.id == "matrix:custom" {
                                        Image(systemName: "square.grid.3x3.fill").font(.system(size: 27)).foregroundStyle(.blue)
                                            .overlay(alignment: .bottomTrailing) { Image(systemName: "plus.circle.fill").font(.system(size: 13)).foregroundStyle(.blue).background(.background, in: Circle()).offset(x: 5, y: 3) }
                                            .frame(height: 37)
                                    } else { TemplateGlyph(item: item).frame(height: 37) }
                                    Text(bridge.t(item.hint.isEmpty ? item.label : item.hint))
                                        .font(.system(size: 11, weight: prioritizedInlineFraction ? .medium : .regular))
                                        .foregroundStyle(prioritizedInlineFraction ? Color.accentColor : .secondary)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                        .allowsTightening(true)
                                        .padding(.horizontal, 4)
                                }
                                .frame(width: 72, height: 76)
                                .background(prioritizedInlineFraction ? Color.accentColor.opacity(0.05) : .clear, in: tileShape)
                                .overlay {
                                    if prioritizedInlineFraction {
                                        tileShape.strokeBorder(Color.accentColor.opacity(0.28), lineWidth: 0.75)
                                    }
                                }
                            }
                            .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 0))
                            .disabled(bridge.state.readOnly)
                            .help(templateHelp(item))
                            .accessibilityHint(templateAccessibilityHint(item))
                    }
                }
            }
        }
        .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 10)
        .background(.regularMaterial)
        .overlay(alignment: .bottom) { Divider() }
    }
}

struct TemplateGlyph: View {
    let item: FormulaTemplate
    var body: some View {
        Group {
            if let image = TemplateArtwork.images[item.id] {
                // Keep the same point scale for single-letter accents. Fitting
                // each image to the same height makes a vector's x much smaller
                // than a dotted x and exaggerates the accents.
                let scale = min(2.7, 58 / max(1, image.size.width), 32 / max(1, image.size.height))
                Image(nsImage: image).resizable().renderingMode(.template)
                    .frame(width: image.size.width * scale, height: image.size.height * scale)
                    .frame(width: 58, height: 37, alignment: .bottom)
            } else if item.hint == "分式" {
                VStack(spacing: 1) {
                    Text("a").italic(); Rectangle().frame(width: 23, height: 1); Text("b").italic()
                }.font(.custom("Times New Roman", size: 17))
            } else if item.hint == "小分式" {
                VStack(spacing: 0.5) {
                    Text("a").italic(); Rectangle().frame(width: 15, height: 0.75); Text("b").italic()
                }.font(.custom("Times New Roman", size: 12))
            } else if item.hint == "上标" || item.hint == "下标" {
                HStack(alignment: item.hint == "上标" ? .top : .bottom, spacing: 1) {
                    Text("a").font(.custom("Times New Roman", size: 28)).italic()
                    Text("b").font(.custom("Times New Roman", size: 15)).italic()
                }
            } else if item.label.count <= 5 {
                Text(item.label).font(.custom("Times New Roman", size: item.label.count > 5 ? 20 : 26))
            } else {
                Image(systemName: "function").font(.system(size: 25))
            }
        }.foregroundStyle(.primary)
    }
}
