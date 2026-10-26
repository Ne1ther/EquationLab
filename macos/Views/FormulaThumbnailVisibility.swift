import SwiftUI
import AppKit

// List creates rows for layout and accessibility before they become visible.
// NSView's clip chain is the authority; creating a row alone must not rasterize it.
struct FormulaThumbnailVisibility: NSViewRepresentable {
    let key: String
    let enabled: Bool
    let onVisible: () -> Void

    func makeNSView(context: Context) -> FormulaThumbnailVisibilityView { FormulaThumbnailVisibilityView() }
    func updateNSView(_ view: FormulaThumbnailVisibilityView, context: Context) {
        if view.key != key { view.key = key; view.requested = false }
        view.enabled = enabled
        view.onVisible = onVisible
        view.scheduleCheck()
    }
}

final class FormulaThumbnailVisibilityView: NSView {
    var key = ""
    var enabled = false
    var requested = false
    var onVisible: (() -> Void)?
    private weak var clip: NSClipView?
    private var observation: NSObjectProtocol?
    private var scheduled = false

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); scheduleCheck() }
    override func viewDidMoveToSuperview() { super.viewDidMoveToSuperview(); scheduleCheck() }
    override func layout() { super.layout(); scheduleCheck() }

    func scheduleCheck() {
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.scheduled = false
            self.observeClip()
            self.checkVisibility()
        }
    }
    private func observeClip() {
        let current = enclosingScrollView?.contentView
        guard current !== clip else { return }
        if let observation { NotificationCenter.default.removeObserver(observation) }
        clip = current
        observation = nil
        if let current {
            current.postsBoundsChangedNotifications = true
            observation = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: current, queue: .main) { [weak self] _ in self?.checkVisibility() }
        }
    }
    private func checkVisibility() {
        guard enabled, !requested, window?.isVisible == true, !isHiddenOrHasHiddenAncestor,
              bounds.width > 0, bounds.height > 0, !visibleRect.isEmpty else { return }
        requested = true
        onVisible?()
    }
    deinit { if let observation { NotificationCenter.default.removeObserver(observation) } }
}
