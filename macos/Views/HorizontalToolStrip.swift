import SwiftUI

/// Native scrolling remains available. Overflow also exposes ordinary buttons,
/// so a horizontal wheel or trackpad gesture is never required.
struct HorizontalToolStrip<Item: Identifiable, Content: View>: View {
    let title: String
    let items: [Item]
    let height: CGFloat
    let itemWidth: CGFloat
    var spacing: CGFloat = 7
    var revealID: Item.ID? = nil
    let previousLabel: String
    let nextLabel: String
    @ViewBuilder let content: (Item) -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var firstVisible: Item.ID?
    @State private var bounds = CGRect.zero
    @State private var space = UUID()

    var body: some View {
        GeometryReader { geometry in
            let overflow = bounds.width > geometry.size.width + 1
            let viewport = geometry.size.width - (overflow ? 58 : 0)
            ScrollViewReader { proxy in
                HStack(spacing: 5) {
                    if overflow {
                        pageButton(-1, proxy: proxy, viewport: viewport)
                            .disabled(bounds.minX >= -1)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: spacing) {
                            ForEach(items) { item in content(item).id(item.id) }
                        }
                        .fixedSize(horizontal: true, vertical: false)
                        .scrollTargetLayout()
                        .background {
                            GeometryReader { contentGeometry in
                                let rect = contentGeometry.frame(in: .named(space))
                                Color.clear.onAppear { bounds = rect }
                                    .onChange(of: rect) { _, value in bounds = value }
                            }
                        }
                    }
                    .coordinateSpace(name: space)
                    .scrollPosition(id: $firstVisible, anchor: .leading)
                    if overflow {
                        pageButton(1, proxy: proxy, viewport: viewport)
                            .disabled(bounds.maxX <= viewport + 1)
                    }
                }
                .onChange(of: items.map(\.id)) { _, ids in
                    firstVisible = ids.first
                    if let first = ids.first { proxy.scrollTo(first, anchor: .leading) }
                }
                .onChange(of: revealID) { _, id in
                    // No anchor: reveal only as much as needed. Selecting an
                    // already visible category must not shift the entire row.
                    if let id { proxy.scrollTo(id) }
                }
                .onChange(of: geometry.size.width) { _, _ in
                    if !overflow, let first = items.first?.id { proxy.scrollTo(first, anchor: .leading) }
                }
            }
        }.frame(height: height)
    }

    private func pageButton(_ direction: Int, proxy: ScrollViewProxy, viewport: CGFloat) -> some View {
        Button {
            let ids = items.map(\.id)
            guard !ids.isEmpty else { return }
            let current = firstVisible.flatMap { ids.firstIndex(of: $0) } ?? 0
            let step = max(1, Int(viewport / (itemWidth + spacing)) - 1)
            let target = min(ids.count - 1, max(0, current + direction * step))
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) {
                proxy.scrollTo(ids[target], anchor: target == ids.count - 1 ? .trailing : .leading)
            }
        } label: {
            Image(systemName: direction < 0 ? "chevron.left" : "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.tint).frame(width: 24)
        }
        .buttonStyle(WorkbenchButtonStyle(surface: true, horizontalPadding: 0, cornerRadius: 6))
        .accessibilityLabel(title + " · " + (direction < 0 ? previousLabel : nextLabel))
        .help(direction < 0 ? previousLabel : nextLabel)
    }
}
