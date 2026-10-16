import SwiftUI

enum WorkbenchMetrics {
    static let footerHeight: CGFloat = 44
    static let controlHeight: CGFloat = 28
    static let cornerRadius: CGFloat = 8
}

/// State changes are local to the hovered/pressed control. No timer, drawing
/// loop, blur or shadow is needed for the native highlight and short rebound.
struct WorkbenchButtonStyle: ButtonStyle {
    var tint: Color = .accentColor
    var selected = false
    var surface = false
    var filledSelection = false
    var horizontalPadding: CGFloat = 6
    var cornerRadius: CGFloat = WorkbenchMetrics.cornerRadius

    func makeBody(configuration: Configuration) -> some View {
        Feedback(configuration: configuration, style: self)
    }

    private struct Feedback: View {
        let configuration: ButtonStyle.Configuration
        let style: WorkbenchButtonStyle
        @Environment(\.isEnabled) private var enabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.colorScheme) private var colorScheme
        @State private var hovering = false
        private var emphasized: Bool { enabled && (hovering || configuration.isPressed) }
        private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous) }
        private var fill: Color {
            if style.selected && style.filledSelection { return style.tint.opacity(configuration.isPressed ? 0.80 : 1) }
            if style.selected || emphasized { return style.tint.opacity(configuration.isPressed ? 0.20 : style.selected ? 0.14 : 0.09) }
            return style.surface ? Color(nsColor: .controlBackgroundColor).opacity(0.72) : .clear
        }
        var body: some View {
            configuration.label
                .padding(.horizontal, style.horizontalPadding)
                .frame(minHeight: WorkbenchMetrics.controlHeight)
                .background(fill, in: shape)
                .overlay {
                    shape.strokeBorder(style.tint.opacity(style.selected ? 0.38 : emphasized ? 0.22 : style.surface ? 0.10 : 0), lineWidth: 0.5)
                }
                .overlay(alignment: .top) {
                    shape.strokeBorder(Color.white.opacity(emphasized && colorScheme == .dark ? 0.08 : 0), lineWidth: 0.5)
                }
                .contentShape(shape)
                .scaleEffect(enabled && configuration.isPressed && !reduceMotion ? 0.965 : 1)
                .opacity(enabled ? 1 : 0.42)
                .animation(reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 0.80), value: configuration.isPressed)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovering)
                .onHover { hovering = $0 }
        }
    }
}

struct WorkbenchFooter: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(height: WorkbenchMetrics.footerHeight)
            .background(.bar)
            .overlay(alignment: .top) { Divider() }
    }
}

struct WorkbenchMenuSurface: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 8).frame(height: WorkbenchMetrics.controlHeight)
            .background(Color.accentColor.opacity(hovering ? 0.10 : 0.035), in: RoundedRectangle(cornerRadius: WorkbenchMetrics.cornerRadius, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: WorkbenchMetrics.cornerRadius, style: .continuous).strokeBorder(Color.accentColor.opacity(hovering ? 0.22 : 0.08), lineWidth: 0.5) }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovering)
            .onHover { hovering = $0 }
    }
}
