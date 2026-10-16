import SwiftUI
import AppKit

private enum WorkbenchArtwork {
    static let header = load("EquationLab-header")
    static let darkHeader = load("EquationLab-header-dark")
    static let word = load("Word")
    static let office = load("Microsoft365")
    static let language: NSImage? = {
        guard let source = NSImage(systemSymbolName: "globe.asia.australia.fill", accessibilityDescription: nil),
              let symbol = source.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [.systemGreen, .systemBlue])) else { return nil }
        // Native Menu labels otherwise become template images and lose their
        // palette. Cache the SF Symbol's original-color rendering once.
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        symbol.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
        image.unlockFocus()
        image.isTemplate = false
        return image
    }()
    private static func load(_ name: String) -> NSImage? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("brand/\(name).png") else { return nil }
        return NSImage(contentsOf: url)
    }
}

struct WorkbenchIdentity: View {
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        HStack(spacing: 9) {
            if let image = colorScheme == .dark ? WorkbenchArtwork.darkHeader : WorkbenchArtwork.header {
                Image(nsImage: image).resizable().scaledToFit().frame(width: 47, height: 32).accessibilityHidden(true)
            }
            Text("Equation Lab").font(.system(size: 16, weight: .semibold))
        }.fixedSize().accessibilityElement(children: .combine)
    }
}

struct OfficeProductLabel: View {
    @ObservedObject var bridge: DesktopBridge
    var wordOnly = false
    var showsTitle = true
    private var isWord: Bool { wordOnly || bridge.wordSessionActive }
    var body: some View {
        HStack(spacing: 7) {
            if let image = isWord ? WorkbenchArtwork.word : WorkbenchArtwork.office {
                Image(nsImage: image).resizable().renderingMode(.original).scaledToFit().frame(width: 21, height: 21).accessibilityHidden(true)
            } else { Image(systemName: "doc.text").foregroundStyle(.tint) }
            if showsTitle { Text(bridge.t(isWord ? "Word 插件" : "Office 插件")) }
        }
    }
}

struct InterfaceLanguageMenu: View {
    @ObservedObject var bridge: DesktopBridge
    var body: some View {
        Menu {
            Picker(bridge.t("界面语言"), selection: $bridge.language) {
                Text(bridge.t("跟随系统")).tag(InterfaceLanguage.system)
                Text("简体中文").tag(InterfaceLanguage.simplifiedChinese)
                Text("English").tag(InterfaceLanguage.english)
            }
        } label: {
            HStack(spacing: 5) {
                if let image = WorkbenchArtwork.language {
                    Image(nsImage: image).resizable().renderingMode(.original).scaledToFit().frame(width: 17, height: 17)
                } else {
                    Image(systemName: "globe").foregroundStyle(.blue)
                }
                Text(bridge.language.shortLabel).font(.system(size: 12, weight: .medium))
            }.fixedSize()
        }
        .menuStyle(.borderlessButton).modifier(WorkbenchMenuSurface()).fixedSize()
        .help(bridge.t("界面语言"))
        .accessibilityLabel(bridge.t("界面语言"))
    }
}
