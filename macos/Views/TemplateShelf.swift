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

struct TemplateShelf: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var shelf = "模板"
    private var visibleCategories: [String] {
        shelf == "符号" ? bridge.state.categories.filter { ["希腊字母", "运算与关系", "标记与函数"].contains($0) } : bridge.state.categories
    }
    private var currentTemplates: [FormulaTemplate] {
        let items = bridge.state.templates.filter { $0.category == bridge.state.activeCategory }
        return bridge.state.activeCategory == "矩阵" ? [FormulaTemplate(id: "matrix:custom", label: "", hint: "自定义矩阵", category: "矩阵", latex: "")] + items : items
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                Picker(bridge.t("工具类型"), selection: $shelf) {
                    Label(bridge.t("符号"), systemImage: "sum").tag("符号"); Label(bridge.t("模板"), systemImage: "square.grid.2x2").tag("模板"); Label(bridge.t("收藏"), systemImage: "star").tag("收藏")
                }.pickerStyle(.segmented).labelsHidden().frame(width: 210).controlSize(.small)
                    .onChange(of: shelf) { _, value in
                        if value == "符号" && !["希腊字母", "运算与关系", "标记与函数"].contains(bridge.state.activeCategory) {
                            bridge.action("category", ["name": "希腊字母"])
                        }
                    }
                    .onChange(of: bridge.state.activeCategory) { _, category in
                        if shelf == "符号" && !["希腊字母", "运算与关系", "标记与函数"].contains(category) { shelf = "模板" }
                    }
                Spacer()
                Button { bridge.action("click", ["id": "add-favorite"]) } label: { Label(bridge.t("收藏公式"), systemImage: "star") }
                    .font(.system(size: 11, weight: .medium))
                    .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 10))
                    .disabled(bridge.state.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bridge.state.busy).fixedSize()
                Button {
                    if bridge.state.activeCategory == "希腊字母" { bridge.showLetterLibrary.toggle() }
                    else { bridge.showFeatureLibrary.toggle() }
                } label: {
                    Label(bridge.t(FeatureCatalog.title(bridge.state.activeCategory)), systemImage: bridge.state.activeCategory == "希腊字母" ? "character.book.closed.fill" : "square.grid.3x3.fill").foregroundStyle(.purple)
                }
                .font(.system(size: 11, weight: .medium))
                .buttonStyle(WorkbenchButtonStyle(tint: .purple, selected: bridge.showLetterLibrary, surface: true, horizontalPadding: 10)).fixedSize()
                .popover(isPresented: $bridge.showLetterLibrary, arrowEdge: .bottom) { LetterLibrary(bridge: bridge) }
                .popover(isPresented: $bridge.showFeatureLibrary, arrowEdge: .bottom) { FeatureLibrary(bridge: bridge) }
            }
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
                            }.buttonStyle(WorkbenchButtonStyle(surface: true)).disabled(bridge.wordSessionActive || bridge.state.busy)
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
                                    Text(bridge.t(category))
                                }.font(.system(size: 11, weight: .medium)).padding(.horizontal, 4)
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
                                        .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                                }.frame(width: 72, height: 76)
                            }
                            .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 0))
                            .disabled(bridge.state.readOnly)
                            .help(bridge.t(item.hint.isEmpty ? item.label : item.hint))
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
