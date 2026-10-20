import SwiftUI
import AppKit

// Preserve SwiftUI's window delegate and forward its remaining behaviors.
// Closing hides the retained editor. Its WebKit process, draft and font caches
// remain available for Dock reopening and the next Word activation.
struct EditorWindowLifecycle: NSViewRepresentable {
    let bridge: DesktopBridge
    func makeCoordinator() -> Coordinator { Coordinator(bridge) }
    func makeNSView(context: Context) -> WindowObserverView {
        let view = WindowObserverView(); view.attach = { [weak coordinator = context.coordinator] window in coordinator?.attach(window) }; return view
    }
    func updateNSView(_ nsView: WindowObserverView, context: Context) {}
    static func dismantleNSView(_ nsView: WindowObserverView, coordinator: Coordinator) { coordinator.detach() }
    final class WindowObserverView: NSView {
        var attach: ((NSWindow) -> Void)?
        override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); if let window { attach?(window) } }
    }
    @MainActor final class Coordinator: NSObject, NSWindowDelegate {
        weak var bridge: DesktopBridge?
        weak var window: NSWindow?
        var previous: NSWindowDelegate?
        private var closing = false
        init(_ bridge: DesktopBridge) { self.bridge = bridge }
        func attach(_ window: NSWindow) {
            guard self.window !== window else { return }
            detach(); self.window = window; bridge?.editorWindow = window; previous = window.delegate; window.delegate = self
            window.animationBehavior = .none
            window.collectionBehavior.insert(.moveToActiveSpace)
            bridge?.editorWindowDidAttach()
        }
        func detach() { if window?.delegate === self { window?.delegate = previous }; window = nil; previous = nil }
        override func responds(to selector: Selector!) -> Bool { super.responds(to: selector) || previous?.responds(to: selector) == true }
        override func forwardingTarget(for selector: Selector!) -> Any? { previous?.responds(to: selector) == true ? previous : super.forwardingTarget(for: selector) }
        func windowShouldClose(_ sender: NSWindow) -> Bool {
            guard let bridge else { return previous?.windowShouldClose?(sender) ?? true }
            guard !closing else { return false }
            closing = true
            bridge.prepareToClose { [weak self, weak sender] saved in
                self?.closing = false
                if saved { sender?.orderOut(nil) }
            }
            return false
        }
    }
}
