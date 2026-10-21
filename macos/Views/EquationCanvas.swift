import SwiftUI
import WebKit
import AppKit
import OSLog

enum EditorLifecycleLog {
    static let logger = Logger(subsystem: "app.equationlab.mac", category: "EditorLifecycle")
}

final class EquationWKWebView: WKWebView {
    let lifecycleID = UUID().uuidString
    private var revealRefreshScheduled = false

    func recordLifecycle(_ event: String) {
        EditorLifecycleLog.logger.info("\(event, privacy: .public) editor=\(self.lifecycleID, privacy: .public)")
    }

    override func selectAll(_ sender: Any?) {
        evaluateJavaScript("window.nativeSelectAllForKeyboard?.() === true") { [weak self] result, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard (result as? Bool) != true else { return }
                self.performDefaultSelectAll(sender)
            }
        }
    }

    private func performDefaultSelectAll(_ sender: Any?) {
        super.selectAll(sender)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        NotificationCenter.default.removeObserver(self, name: NSWindow.didChangeOcclusionStateNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: NSWindow.didBecomeKeyNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: NSApplication.didBecomeActiveNotification, object: nil)

        guard let window else { return }
        NotificationCenter.default.addObserver(self, selector: #selector(windowWasRevealed(_:)), name: NSWindow.didChangeOcclusionStateNotification, object: window)
        NotificationCenter.default.addObserver(self, selector: #selector(windowBecameKey(_:)), name: NSWindow.didBecomeKeyNotification, object: window)
        NotificationCenter.default.addObserver(self, selector: #selector(applicationBecameActive(_:)), name: NSApplication.didBecomeActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    /// Refresh the retained editor surface after its window is shown or the app
    /// returns to the foreground. This preserves MathLive's document, focus,
    /// selection and undo history.
    func refreshAfterReveal() {
        guard window?.isVisible == true, NSApp.isActive, !revealRefreshScheduled else { return }
        revealRefreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.revealRefreshScheduled = false
            guard self.window?.isVisible == true, NSApp.isActive else { return }

            self.needsLayout = true
            self.layoutSubtreeIfNeeded()
            self.setNeedsDisplay(self.bounds)
            self.layer?.setNeedsDisplay()
            self.displayIfNeeded()
            self.window?.displayIfNeeded()
            self.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
            self.recordLifecycle("reveal_refresh")
        }
    }

    @objc private func windowWasRevealed(_ notification: Notification) { refreshAfterReveal() }
    @objc private func windowBecameKey(_ notification: Notification) { refreshAfterReveal() }
    @objc private func applicationBecameActive(_ notification: Notification) { refreshAfterReveal() }

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
