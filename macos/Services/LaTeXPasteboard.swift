import AppKit

protocol LaTeXPasteboardSource {
    var changeCount: Int { get }
    func string(forType: NSPasteboard.PasteboardType) -> String?
    func data(forType: NSPasteboard.PasteboardType) -> Data?
}

extension NSPasteboard: LaTeXPasteboardSource {}

enum LaTeXPasteboard {
    enum Snapshot: Equatable {
        case text(String)
        case html(String)
        case unavailable
        case ownerChanged

        var payload: [String: String] {
            switch self {
            case .text(let text): return ["state": "available", "text": text]
            case .html(let html): return ["state": "available", "html": html]
            case .unavailable: return ["state": "unavailable"]
            case .ownerChanged: return ["state": "ownerChanged"]
            }
        }
    }

    static func snapshot(_ pasteboard: LaTeXPasteboardSource) -> Snapshot {
        let changeCount = pasteboard.changeCount
        let text = pasteboard.string(forType: .string) ?? richText(pasteboard)
        let result: Snapshot
        if let text {
            result = .text(text)
        } else if let html = pasteboard.string(forType: .html) {
            result = .html(html)
        } else {
            result = .unavailable
        }
        // A clipboard owner can change while a promised representation is read.
        return pasteboard.changeCount == changeCount ? result : .ownerChanged
    }

    private static func richText(_ pasteboard: LaTeXPasteboardSource) -> String? {
        if let data = pasteboard.data(forType: .rtf),
           let text = NSAttributedString(rtf: data, documentAttributes: nil) {
            return text.string
        }
        if let data = pasteboard.data(forType: .rtfd),
           let text = NSAttributedString(rtfd: data, documentAttributes: nil) {
            return text.string
        }
        return nil
    }
}
