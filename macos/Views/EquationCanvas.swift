import SwiftUI
import WebKit
import AppKit
import OSLog

enum EditorLifecycleLog {
    static let logger = Logger(subsystem: "app.equationlab.mac", category: "EditorLifecycle")
}

final class EquationWKWebView: WKWebView {
    let lifecycleID = UUID().uuidString
    func recordLifecycle(_ event: String) {
        EditorLifecycleLog.logger.info("\(event, privacy: .public) editor=\(self.lifecycleID, privacy: .public)")
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); syncAppearance() }
    func syncAppearance() {
        var colors: [String: String] = [:]
        effectiveAppearance.performAsCurrentDrawingAppearance {
            for (name, color) in [("surface", NSColor.windowBackgroundColor), ("control", .controlBackgroundColor), ("selected", .controlColor), ("label", .labelColor), ("secondary", .secondaryLabelColor), ("separator", .separatorColor)] {
                guard let rgb = color.usingColorSpace(.sRGB) else { continue }
                colors["--native-" + name] = "rgba(\(Int(rgb.redComponent * 255)),\(Int(rgb.greenComponent * 255)),\(Int(rgb.blueComponent * 255)),\(rgb.alphaComponent))"
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: colors), let json = String(data: data, encoding: .utf8) else { return }
        evaluateJavaScript("for(const [key,value] of Object.entries(\(json))) document.documentElement.style.setProperty(key,value)", completionHandler: nil)
    }
}

struct EquationWebView: NSViewRepresentable {
    @ObservedObject var bridge: DesktopBridge
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration(); configuration.userContentController.add(bridge, name: "native")
        let web = EquationWKWebView(frame: .zero, configuration: configuration)
        web.recordLifecycle("created")
        web.navigationDelegate = bridge; web.setValue(false, forKey: "drawsBackground"); bridge.webView = web
        if let root = Bundle.main.resourceURL?.appendingPathComponent("web"), let file = Bundle.main.resourceURL?.appendingPathComponent("web/index.html") {
            web.loadFileURL(file, allowingReadAccessTo: root)
        }
        return web
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
