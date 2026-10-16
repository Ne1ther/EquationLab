import Foundation

struct EquationLetter: Identifiable, Decodable {
    let id: String
    let family: String
    let pair: Int
    let name: String
    let symbol: String
    let latex: String
    let kind: String
    let requiresUnicodeFont: Bool?
    var caseName: String { kind == "upper" ? "大写" : kind == "lower" ? "小写" : "变体" }
    var unicode: String { symbol.unicodeScalars.map { String(format: "U+%04X", $0.value) }.joined(separator: " ") }
    func isAvailable(lowercaseGreekFont: String) -> Bool {
        // Two Symbol omissions are explicitly authored in the bundled STIX
        // face by the native writer, rather than relying on preview fallback.
        true
    }
}

enum LetterCatalog {
    static let all: [EquationLetter] = {
        guard let file = Bundle.main.resourceURL?.appendingPathComponent("engine/src/letter-catalog.json"),
              let data = try? Data(contentsOf: file),
              let letters = try? JSONDecoder().decode([EquationLetter].self, from: data) else { return [] }
        return letters
    }()
    static let commonPairs = [0, 1, 2, 3, 4, 7, 10, 11, 12, 15, 16, 17, 18, 20, 22, 23]
    static var common: [[EquationLetter]] { commonPairs.map { pair in all.filter { $0.family == "greek" && $0.pair == pair } } }
}
