import Foundation
import AppKit

enum InspectorTab: String, CaseIterable, Identifiable {
    case style = "样式", spacing = "排版", document = "文档"
    var id: String { rawValue }
}

struct SidebarFormula: Identifiable, Decodable {
    let id: Int
    var label: String = ""
    var detail: String = ""
    var latex: String = ""
    var image: String? = nil
    var readOnly: Bool = false
    var position: Int? = nil
    var thumbnail: NSImage? {
        guard let image else { return nil }
        return FormulaImageCache.shared.image(key: image)
    }
}

private final class FormulaImageCache {
    static let shared = FormulaImageCache()
    private let cache: NSCache<NSString, NSImage> = { let result = NSCache<NSString, NSImage>(); result.totalCostLimit = 48 * 1024 * 1024; result.countLimit = 128; return result }()
    func image(key: String) -> NSImage? {
        if let found = cache.object(forKey: key as NSString) { return found }
        guard let comma = key.firstIndex(of: ","), let data = Data(base64Encoded: String(key[key.index(after: comma)...])) else { return nil }
        guard let image = NSImage(data: data) else { return nil }
        cache.setObject(image, forKey: key as NSString, cost: data.count)
        return image
    }
}

struct RulerTab: Identifiable, Codable, Equatable {
    var position: Int
    var type: Int
    var id: Int { position }
}
struct MatrixContext: Decodable { let rows: Int; let columns: Int }

struct OpenWordDocument: Decodable, Identifiable, Equatable {
    let identity: String
    let name: String
    let readOnly: Bool
    var id: String { identity }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        identity = try values.decode(String.self, forKey: .identity)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? "Word 文档"
        readOnly = try values.decodeIfPresent(Bool.self, forKey: .readOnly) ?? false
    }
    private enum CodingKeys: String, CodingKey { case identity, name, readOnly }
}

struct EditorOption: Identifiable, Decodable {
    let value: String
    let label: String
    var id: String { value }
}

struct EditorField: Identifiable, Decodable {
    let id: String
    let label: String
    var value: String
    var options: [EditorOption] = []
    var disabled: Bool = false
    var unit: String = ""
    var units: [String] = []
    var style: String = "0"
}

struct FormulaTemplate: Identifiable, Decodable {
    let id: String
    let label: String
    let hint: String
    let category: String
    let latex: String
}

struct DocumentNumbering: Decodable {
    var hasDocumentContext: Bool
    var actualNumber: String?
    var chapter: Int?
    var section: Int?
    var equation: Int?
    var bookmark: String?
    var referenceCount: Int?
    var position: Int
    var total: Int
    var format: String?
    var mode: String
}

struct WorkbenchState: Decodable {
    var documentName = "新建公式"
    var otherWordDocumentName: String? = nil
    var openWordDocuments: [OpenWordDocument] = []
    var wordWorkspaceConnected = false
    var wordDocumentIdentity: String? = nil
    var documentPath = ""
    var latex = ""
    var selected: Int? = nil
    var objects: [SidebarFormula] = []
    var favorites: [SidebarFormula] = []
    var categories: [String] = []
    var templates: [FormulaTemplate] = []
    var activeCategory = "常用结构"
    var fonts: [EditorField] = []
    var sizes: [EditorField] = []
    var extraSizes: [EditorField] = []
    var spaces: [EditorField] = []
    var layout: [EditorField] = []
    var numbering: DocumentNumbering? = nil
    var statusTitle = "正在载入公式引擎…"
    var statusDetail = ""
    var statusError = false
    var statusWarning = false
    var message = ""
    var messageError = false
    var valid = false
    var canExport = false
    var wordOutcomeUnknown = false
    var wordDocumentUnavailable = false
    var wordDocumentLoading = false
    var wordDocumentLoadFailed = false
    var wordDocumentTotal = 0
    var busy = false
    var mode = "rebuild"
    var readOnly = false
    var canSaveEdit = false
    var canArrange = false
    var canFactoryReset = false
    var arrangeAll = false
    var zoom = 0
    var effectiveZoom = 100
    var keyboardVisible = false
    var ruler: [RulerTab] = []
    var matrix: MatrixContext? = nil

    mutating func apply(_ payload: [String: Any]) throws {
        func value<T: Decodable>(_ key: String, _ type: T.Type) throws -> T? {
            guard let raw = payload[key] else { return nil }
            return try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed]))
        }
        if let v = try value("documentName", String.self) { documentName = v }
        if payload["otherWordDocumentName"] is NSNull { otherWordDocumentName = nil } else if let v = try value("otherWordDocumentName", String.self) { otherWordDocumentName = v }
        if payload["openWordDocuments"] is NSNull { openWordDocuments = [] } else if let v = try value("openWordDocuments", [OpenWordDocument].self) { openWordDocuments = v }
        if payload["wordWorkspaceConnected"] is NSNull { wordWorkspaceConnected = false } else if let v = try value("wordWorkspaceConnected", Bool.self) { wordWorkspaceConnected = v }
        if payload["wordDocumentIdentity"] is NSNull { wordDocumentIdentity = nil } else if let v = try value("wordDocumentIdentity", String.self) { wordDocumentIdentity = v }
        if let v = try value("documentPath", String.self) { documentPath = v }
        if let v = try value("latex", String.self) { latex = v }
        if payload["selected"] is NSNull { selected = nil } else if let v = try value("selected", Int.self) { selected = v }
        if let v = try value("objects", [SidebarFormula].self) { objects = v }
        if let v = try value("wordDocumentLoading", Bool.self) { wordDocumentLoading = v }
        if let v = try value("wordDocumentLoadFailed", Bool.self) { wordDocumentLoadFailed = v }
        if let v = try value("wordDocumentTotal", Int.self) { wordDocumentTotal = v }
        if let v = try value("favorites", [SidebarFormula].self) { favorites = v }
        if let v = try value("categories", [String].self) { categories = v }
        if let v = try value("templates", [FormulaTemplate].self) { templates = v }
        if let v = try value("activeCategory", String.self) { activeCategory = v }
        if let v = try value("fonts", [EditorField].self) { fonts = v }
        if let v = try value("sizes", [EditorField].self) { sizes = v }
        if let v = try value("extraSizes", [EditorField].self) { extraSizes = v }
        if let v = try value("spaces", [EditorField].self) { spaces = v }
        if let v = try value("layout", [EditorField].self) { layout = v }
        if payload["numbering"] is NSNull { numbering = nil } else if let v = try value("numbering", DocumentNumbering.self) { numbering = v }
        if let v = try value("statusTitle", String.self) { statusTitle = v }
        if let v = try value("statusDetail", String.self) { statusDetail = v }
        if let v = try value("statusError", Bool.self) { statusError = v }
        if let v = try value("statusWarning", Bool.self) { statusWarning = v }
        if let v = try value("message", String.self) { message = v }
        if let v = try value("messageError", Bool.self) { messageError = v }
        if let v = try value("valid", Bool.self) { valid = v }
        if let v = try value("canExport", Bool.self) { canExport = v }
        if let v = try value("wordOutcomeUnknown", Bool.self) { wordOutcomeUnknown = v }
        if let v = try value("wordDocumentUnavailable", Bool.self) { wordDocumentUnavailable = v }
        if let v = try value("busy", Bool.self) { busy = v }
        if let v = try value("mode", String.self) { mode = v }
        if let v = try value("readOnly", Bool.self) { readOnly = v }
        if let v = try value("canSaveEdit", Bool.self) { canSaveEdit = v }
        if let v = try value("canArrange", Bool.self) { canArrange = v }
        if let v = try value("canFactoryReset", Bool.self) { canFactoryReset = v }
        if let v = try value("arrangeAll", Bool.self) { arrangeAll = v }
        if let v = try value("zoom", Int.self) { zoom = v }
        if let v = try value("effectiveZoom", Int.self) { effectiveZoom = v }
        if let v = try value("keyboardVisible", Bool.self) { keyboardVisible = v }
        if let v = try value("ruler", [RulerTab].self) { ruler = v }
        if payload["matrix"] is NSNull { matrix = nil } else if let v = try value("matrix", MatrixContext.self) { matrix = v }
    }
}
