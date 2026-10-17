import AppKit
import Foundation

struct WordHostInstallation {
    let applicationURL: URL
    let version: String

    static func at(_ url: URL) -> WordHostInstallation? {
        guard let bundle = Bundle(url: url), bundle.bundleIdentifier == "com.microsoft.Word",
              let executable = bundle.executableURL,
              FileManager.default.isExecutableFile(atPath: executable.path) else { return nil }
        return WordHostInstallation(applicationURL: url.standardizedFileURL,
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
    }

    static func detect(preferredURL: URL? = nil) -> WordHostInstallation? {
        // Resolve by application identity, including Word outside /Applications.
        // Prefer the actual host when Word is running, then an explicit choice.
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Word")
            .compactMap(\.bundleURL)
        let registered = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.microsoft.Word")
        let candidates = running + [preferredURL, registered].compactMap { $0 }
        return candidates.lazy.compactMap { at($0) }.first
    }
}

extension DesktopBridge {
    func restoreWordOfficeAccess() {
        guard wordOfficeAccessURL == nil,
              let data = UserDefaults.standard.data(forKey: "EquationLab.WordOfficeBookmark") else { return }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope],
                                relativeTo: nil, bookmarkDataIsStale: &stale), !stale else { return }
        _ = url.startAccessingSecurityScopedResource()
        wordOfficeAccessURL = url
    }

    func chooseWordOfficeDirectory() {
        let expected = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers/UBF8T346G9.Office", isDirectory: true)
        let panel = NSOpenPanel()
        panel.title = t("允许访问 Word 文件夹")
        panel.message = t("请选择已定位的 UBF8T346G9.Office 文件夹，用于读取启动位置和管理 Equation Lab 插件。不会修改 Word 设置或其他插件。")
        panel.prompt = t("允许访问此文件夹")
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = expected
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard url.resolvingSymlinksInPath().standardizedFileURL == expected.resolvingSymlinksInPath().standardizedFileURL else {
            installationMessage = "请选择已定位的 UBF8T346G9.Office 文件夹，用于读取启动位置和管理 Equation Lab 插件。不会修改 Word 设置或其他插件。"
            return
        }
        wordOfficeAccessURL?.stopAccessingSecurityScopedResource()
        _ = url.startAccessingSecurityScopedResource()
        wordOfficeAccessURL = url
        if let data = try? url.bookmarkData(options: [.withSecurityScope],
                                            includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(data, forKey: "EquationLab.WordOfficeBookmark")
        }
        wordOfficeAccessRequired = false
        verifyWordPlugin(showResult: true)
    }

    @discardableResult
    func refreshWordApplication() -> Bool {
        let preferred = UserDefaults.standard.string(forKey: "EquationLab.WordApplicationPath")
            .map { URL(fileURLWithPath: $0) }
        let host = WordHostInstallation.detect(preferredURL: preferred)
        wordApplicationPath = host?.applicationURL.path ?? ""
        wordApplicationVersion = host?.version ?? ""
        return host != nil
    }

    func chooseWordApplication() {
        let panel = NSOpenPanel()
        panel.title = t("选择 Microsoft Word")
        panel.message = t("请选择桌面版 Microsoft Word 应用。")
        panel.prompt = t("选择 Word")
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.treatsFilePackagesAsDirectories = false
        panel.directoryURL = URL(fileURLWithPath: "/Applications", isDirectory: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let host = WordHostInstallation.at(url) else {
            installationMessage = "所选应用不是可用的桌面版 Microsoft Word。"
            return
        }
        UserDefaults.standard.set(host.applicationURL.path, forKey: "EquationLab.WordApplicationPath")
        refreshWordApplication()
        verifyWordPlugin()
    }
}
