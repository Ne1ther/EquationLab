// Retained build36 data-selection path for the before/after performance comparison.
import Foundation

enum LegacyFeatureCatalog {
    struct Document: Decodable { let items: [CatalogItem] }
    static var all: [CatalogItem] = []
    static func key(_ category: String) -> String {
        ["常用结构": "structures", "积分与求和": "largeOperators", "矩阵": "matrices", "运算与关系": "operators", "标记与函数": "markings"][category] ?? "letters"
    }
    static func title(_ category: String) -> String {
        ["常用结构": "全部结构", "积分与求和": "全部大运算符", "矩阵": "全部矩阵与多行", "运算与关系": "全部符号", "标记与函数": "全部标记与函数"][category] ?? "全部字母"
    }
    static func groupTitle(_ group: String) -> String {
        if ["abrack", "paren", "brace", "brack", "bar", "dbar", "obrack", "floor", "ceil", "intval"].contains(group) { return "括号与围栏" }
        if ["sub", "sup", "subsup"].contains(group) { return "上下标" }
        if group == "int" { return "积分" }
        if ["intop", "sumop"].contains(group) { return "自定义运算符" }
        if ["sum", "prod", "coprod"].contains(group) { return "求和与乘积" }
        if ["union", "inter"].contains(group) { return "集合运算" }
        if group == "lim" { return "极限" }
        if ["arrow", "vec", "arrows"].contains(group) { return "箭头与向量" }
        if ["hat", "tilde", "arc", "character-marks"].contains(group) { return "重音与字符标记" }
        if ["ubar", "obar", "strike", "box", "hbrace", "hbrack"].contains(group) { return "线、框与上下括注" }
        return ["root": "根式", "frac": "分式", "ldiv": "长除法", "braket": "Bra–ket", "jstat": "线、框与上下括注", "matrix": "矩阵预设", "matrix-layout": "矩阵布局", "functions": "常用函数", "operators": "算术运算", "relations": "等式与不等式", "sets": "集合", "logic": "逻辑"][group] ?? "其他"
    }
    static func groups(for items: [CatalogItem]) -> [String] {
        let order = ["分式", "根式", "上下标", "括号与围栏", "Bra–ket", "长除法", "积分", "求和与乘积", "集合运算", "极限", "自定义运算符", "矩阵预设", "矩阵布局", "算术运算", "等式与不等式", "集合", "逻辑", "重音与字符标记", "线、框与上下括注", "箭头与向量", "常用函数", "其他"]
        let present = Set(items.map { groupTitle($0.group) })
        return order.filter { present.contains($0) } + present.filter { !order.contains($0) }.sorted()
    }
}


struct LegacyLibraryQuery {
    var category: String
    var query = ""
    var group = ""
    var items: [CatalogItem] { LegacyFeatureCatalog.all.filter { $0.category == LegacyFeatureCatalog.key(category) } }
    var groups: [String] { LegacyFeatureCatalog.groups(for: items) }
    var activeGroup: String { groups.contains(group) || group == "全部" ? group : groups.first ?? "全部" }
    var filtered: [CatalogItem] {
        items.filter { query.isEmpty ? (activeGroup == "全部" || LegacyFeatureCatalog.groupTitle($0.group) == activeGroup) :
            "\($0.label) \($0.hint) \($0.latex) \($0.originalToken ?? "")".localizedCaseInsensitiveContains(query) }
    }
    var available: [CatalogItem] { filtered.filter(\.available) }
    var pending: [CatalogItem] { filtered.filter { !$0.available } }
    var gridHeight: CGFloat { min(330, max(170, CGFloat((available.count + 5) / 6) * 92 + (pending.isEmpty ? 0 : 48))) }

    func layoutSummary() -> Int {
        groups.reduce(0) { $0 + (activeGroup == $1 ? 1 : 0) } + available.count + pending.count + Int(gridHeight) + (filtered.isEmpty ? 0 : 1)
    }
}
