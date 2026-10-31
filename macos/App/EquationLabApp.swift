import SwiftUI
import AppKit
import CoreText

@main
struct EquationLabApp: App {
    init() {
        if let font = Bundle.main.resourceURL?.appendingPathComponent("engine/fonts/STIXTwoMath-Regular.otf") {
            CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil)
        }
    }
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var bridge = DesktopBridge()
    @StateObject private var updater = AppUpdater()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        Window("Equation Lab", id: "main") {
            WorkbenchView(bridge: bridge, updater: updater)
                .environmentObject(bridge)
                .environment(\.locale, bridge.language.locale)
                .onAppear { delegate.bridge = bridge; bridge.ensureNativeService(); bridge.verifyWordPlugin(); bridge.presentDeferredWordSetup(); bridge.startWordWorkspaceObservation(); updater.start() }
                .onOpenURL { bridge.openWordURL($0) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { bridge.verifyWordPlugin(); updater.checkAutomaticallyIfDue() }
                }
        }
        .defaultSize(width: 1380, height: 900)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .commands { WorkbenchCommands(bridge: bridge, updater: updater) }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var bridge: DesktopBridge? {
        didSet { if let bridge { let urls = pendingURLs; pendingURLs.removeAll(); for url in urls { bridge.openWordURL(url) } } }
    }
    private var pendingURLs: [URL] = []
    func application(_ application: NSApplication, open urls: [URL]) {
        if let bridge { for url in urls { bridge.openWordURL(url) } }
        else { pendingURLs.append(contentsOf: urls.prefix(16)) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }
    func applicationDidBecomeActive(_ notification: Notification) {
        bridge?.recordApplicationFocus(true)
        bridge?.refreshVisibleWordDocumentIfNeeded()
        bridge?.syncActiveWordWorkspace()
    }
    func applicationDidResignActive(_ notification: Notification) { bridge?.recordApplicationFocus(false) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        bridge?.reopenEditorFromDock()
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let bridge, bridge.hasWordSessionOrRequest else { bridge?.stopEngine(); bridge?.stopOwnedNativeService(); return .terminateNow }
        bridge.prepareToClose { [weak self] saved in
            if saved { self?.bridge?.stopEngine(); self?.bridge?.stopOwnedNativeService() }
            sender.reply(toApplicationShouldTerminate: saved)
        }
        return .terminateLater
    }
}
