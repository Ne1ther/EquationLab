import Foundation

@main
struct CatalogLibraryCheck {
    static func main() throws {
        let file = URL(fileURLWithPath: CommandLine.arguments[1])
        let items = try JSONDecoder().decode(FeatureCatalog.Document.self, from: Data(contentsOf: file)).items
        LegacyFeatureCatalog.all = items
        let categories = ["常用结构", "积分与求和", "矩阵", "运算与关系", "标记与函数"]
        let start = DispatchTime.now().uptimeNanoseconds
        let sections = Dictionary(uniqueKeysWithValues: categories.map { category in
            (category, CatalogSection(items.filter { $0.category == FeatureCatalog.key(category) }))
        })
        let indexMs = elapsed(start)
        var assertions = 0
        func check(_ value: Bool, _ label: String) {
            precondition(value, label); assertions += 1
        }
        for category in categories {
            let source = items.filter { $0.category == LegacyFeatureCatalog.key(category) }
            let section = sections[category]!
            let expectedGroups = LegacyFeatureCatalog.groups(for: source)
            check(section.groups == expectedGroups, category + " group order")
            check(FeatureCatalog.title(category) == LegacyFeatureCatalog.title(category), category + " title")
            for selection in [""] + expectedGroups + ["全部", "invalid"] {
                let expectedGroup = expectedGroups.contains(selection) || selection == "全部" ? selection : expectedGroups.first ?? "全部"
                check(section.activeGroup(selection) == expectedGroup, category + " selection")
                for query in ["", "sqrt", "ge", "TMPL-int/ex", "vec", "根", "不存在-no-match"] {
                    let expected = source.filter {
                        query.isEmpty ? (expectedGroup == "全部" || LegacyFeatureCatalog.groupTitle($0.group) == expectedGroup) :
                        "\($0.label) \($0.hint) \($0.latex) \($0.originalToken ?? "")".localizedCaseInsensitiveContains(query)
                    }
                    let result = section.results(group: expectedGroup, query: query)
                    check(result.available.map(\.id) == expected.filter(\.available).map(\.id), category + " available/search order")
                    check(result.pending.map(\.id) == expected.filter { !$0.available }.map(\.id), category + " pending/search order")
                    check(result.isEmpty == expected.isEmpty, category + " empty state")
                }
            }
        }
        for item in items { check(FeatureCatalog.groupTitle(item.group) == LegacyFeatureCatalog.groupTitle(item.group), "group mapping: " + item.group) }
        let pending = CatalogItem(id: "pending-test", category: "operators", group: "unknown", label: "Pending Ω", latex: "\\test", sample: "x", hint: "pending", originalToken: nil, sourceStatus: "pending")
        let mixed = CatalogSection([items[0], pending])
        check(mixed.results(group: "全部", query: "").pending.map(\.id) == [pending.id], "pending retention")
        check(mixed.results(group: "其他", query: "Ω").pending.map(\.id) == [pending.id], "unicode search")
        check(mixed.results(group: "其他", query: "PENDING").pending.map(\.id) == [pending.id], "case-insensitive search")
        let empty = CatalogSection([])
        check(empty.activeGroup("") == "全部" && empty.results(group: "全部", query: "").isEmpty, "empty catalogue")

        var timings: [[String: Any]] = [], checksum = 0
        for category in categories {
            let before = LegacyLibraryQuery(category: category)
            let section = sections[category]!, group = section.activeGroup("")
            var legacy: [Double] = []
            for _ in 0..<3 {
                let t = DispatchTime.now().uptimeNanoseconds
                checksum += before.layoutSummary(); legacy.append(elapsed(t))
            }
            var current: [Double] = []
            for _ in 0..<1000 {
                let t = DispatchTime.now().uptimeNanoseconds
                let results = section.results(group: section.activeGroup(""), query: "")
                checksum += section.groups.reduce(0) { $0 + (group == $1 ? 1 : 0) }
                checksum += results.available.count + results.pending.count + min(330, max(170, ((results.available.count + 5) / 6) * 92 + (results.pending.isEmpty ? 0 : 48))) + (results.isEmpty ? 0 : 1)
                current.append(elapsed(t))
            }
            timings.append(["category": category, "items": section.all.available.count + section.all.pending.count,
                            "initialGroup": group, "legacySamples": legacy.count, "currentSamples": current.count,
                            "legacyMedianMs": median(legacy), "currentMedianMs": median(current)])
        }
        let report: [String: Any] = ["assertions": assertions, "entries": items.count, "indexBuildMs": indexMs,
                                     "timings": timings, "checksum": checksum,
                                     "scope": "Release Swift catalogue selection/layout-input CPU benchmark; excludes SwiftUI drawing, AX and click-to-pixel latency."]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
    static func elapsed(_ start: UInt64) -> Double { Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000 }
    static func median(_ items: [Double]) -> Double { items.sorted()[items.count / 2] }
}
