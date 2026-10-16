import Foundation

struct CatalogItem: Identifiable, Decodable {
    let id: String
    let category: String
    let group: String
    let label: String
    let latex: String
    let sample: String
    let hint: String
    let originalToken: String?
    let sourceStatus: String
    var available: Bool { sourceStatus == "verified-local" }
    var matrixDimensions: (Int, Int)? {
        guard let token = originalToken, token.hasPrefix("TMPL-matrix/") else { return nil }
        let parts = token.split(separator: "/")
        guard parts.count == 3, parts[1] == "m" || parts[2] == "n" else { return nil }
        return (Int(parts[1]) ?? 3, Int(parts[2]) ?? 3)
    }
    var template: FormulaTemplate { FormulaTemplate(id: id, label: label, hint: hint, category: category, latex: latex) }
}

/// Immutable results are shared by every layout pass. Opening a collection
/// must never regroup the full catalogue from inside an item filter.
struct CatalogResults {
    let available: [CatalogItem]
    let pending: [CatalogItem]
    var isEmpty: Bool { available.isEmpty && pending.isEmpty }

    init(_ items: [CatalogItem]) {
        var available: [CatalogItem] = [], pending: [CatalogItem] = []
        for item in items {
            if item.available { available.append(item) } else { pending.append(item) }
        }
        self.available = available; self.pending = pending
    }
}

struct CatalogSection {
    let groups: [String]
    let all: CatalogResults
    private let grouped: [String: CatalogResults]
    private let searchable: [(item: CatalogItem, text: String)]

    init(_ items: [CatalogItem]) {
        groups = FeatureCatalog.groups(for: items)
        all = CatalogResults(items)
        grouped = Dictionary(grouping: items, by: { FeatureCatalog.groupTitle($0.group) }).mapValues { CatalogResults($0) }
        searchable = items.map { ($0, "\($0.label) \($0.hint) \($0.latex) \($0.originalToken ?? "")") }
    }

    func activeGroup(_ selection: String) -> String {
        selection == "全部" || groups.contains(selection) ? selection : groups.first ?? "全部"
    }

    func results(group: String, query: String) -> CatalogResults {
        if query.isEmpty { return group == "全部" ? all : grouped[group] ?? CatalogResults([]) }
        // Search intentionally spans the current module, preserving the
        // existing behavior even while a particular subcategory is selected.
        return CatalogResults(searchable.compactMap { $0.text.localizedCaseInsensitiveContains(query) ? $0.item : nil })
    }
}

enum FeatureCatalog {
    struct Document: Decodable { let items: [CatalogItem] }
    static let all: [CatalogItem] = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("engine/src/template-catalog.json"),
              let data = try? Data(contentsOf: url), let result = try? JSONDecoder().decode(Document.self, from: data) else { return [] }
        return result.items
    }()
    private static let sections = Dictionary(grouping: all, by: \.category).mapValues { CatalogSection($0) }
    private static let empty = CatalogSection([])
    static func section(_ category: String) -> CatalogSection { sections[key(category)] ?? empty }
    private static let categoryKeys = ["常用结构": "structures", "积分与求和": "largeOperators", "矩阵": "matrices", "运算与关系": "operators", "标记与函数": "markings"]
    private static let categoryTitles = ["常用结构": "全部结构", "积分与求和": "全部大运算符", "矩阵": "全部矩阵与多行", "运算与关系": "全部符号", "标记与函数": "全部标记与函数"]
    static func key(_ category: String) -> String { categoryKeys[category] ?? "letters" }
    static func title(_ category: String) -> String { categoryTitles[category] ?? "全部字母" }
    private static let groupNames: [String: String] = {
        var names = ["root": "根式", "frac": "分式", "ldiv": "长除法", "braket": "Bra–ket", "jstat": "线、框与上下括注", "matrix": "矩阵预设", "matrix-layout": "矩阵布局", "functions": "常用函数", "operators": "算术运算", "relations": "等式与不等式", "sets": "集合", "logic": "逻辑"]
        for (keys, title) in [
            (["abrack", "paren", "brace", "brack", "bar", "dbar", "obrack", "floor", "ceil", "intval"], "括号与围栏"),
            (["sub", "sup", "subsup"], "上下标"), (["int"], "积分"), (["intop", "sumop"], "自定义运算符"),
            (["sum", "prod", "coprod"], "求和与乘积"), (["union", "inter"], "集合运算"), (["lim"], "极限"),
            (["arrow", "vec", "arrows"], "箭头与向量"), (["hat", "tilde", "arc", "character-marks"], "重音与字符标记"),
            (["ubar", "obar", "strike", "box", "hbrace", "hbrack"], "线、框与上下括注")
        ] { for key in keys { names[key] = title } }
        return names
    }()
    static func groupTitle(_ group: String) -> String { groupNames[group] ?? "其他" }
    static func groups(for items: [CatalogItem]) -> [String] {
        let order = ["分式", "根式", "上下标", "括号与围栏", "Bra–ket", "长除法", "积分", "求和与乘积", "集合运算", "极限", "自定义运算符", "矩阵预设", "矩阵布局", "算术运算", "等式与不等式", "集合", "逻辑", "重音与字符标记", "线、框与上下括注", "箭头与向量", "常用函数", "其他"]
        let present = Set(items.map { groupTitle($0.group) })
        return order.filter { present.contains($0) } + present.filter { !order.contains($0) }.sorted()
    }
}

