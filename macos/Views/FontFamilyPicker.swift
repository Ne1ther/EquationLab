import SwiftUI
import AppKit

/// AppKit owns editing, completion and keyboard navigation. The installed-font
/// catalog is read once, and changing the interface never changes font names.
struct FontFamilyPicker: NSViewRepresentable {
    @Binding var value: String
    var placeholder: String
    var accessibilityLabel: String
    private static let families = NSFontManager.shared.availableFontFamilies.sorted { $0.localizedStandardCompare($1) == .orderedAscending }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSComboBox {
        let view = NSComboBox()
        view.usesDataSource = true
        view.dataSource = context.coordinator
        view.delegate = context.coordinator
        view.isEditable = true
        view.completes = true
        view.numberOfVisibleItems = 11
        view.controlSize = .regular
        view.font = .systemFont(ofSize: 12)
        view.bezelStyle = .roundedBezel
        view.stringValue = value
        view.placeholderString = placeholder
        view.setAccessibilityLabel(accessibilityLabel)
        return view
    }
    func updateNSView(_ view: NSComboBox, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.committedValue != value {
            view.stringValue = value
            context.coordinator.committedValue = value
        }
        view.placeholderString = placeholder
        view.setAccessibilityLabel(accessibilityLabel)
    }
    final class Coordinator: NSObject, NSComboBoxDataSource, NSComboBoxDelegate {
        var parent: FontFamilyPicker
        var committedValue: String
        private var query = ""
        private var visible = FontFamilyPicker.families
        init(_ parent: FontFamilyPicker) { self.parent = parent; committedValue = parent.value }
        func numberOfItems(in comboBox: NSComboBox) -> Int { visible.count }
        func comboBox(_ comboBox: NSComboBox, objectValueForItemAt index: Int) -> Any? {
            visible.indices.contains(index) ? visible[index] : nil
        }
        func comboBox(_ comboBox: NSComboBox, completedString string: String) -> String? {
            FontFamilyPicker.families.first { $0.range(of: string, options: [.anchored, .caseInsensitive]) != nil }
        }
        func controlTextDidBeginEditing(_ notification: Notification) {
            query = ""; visible = FontFamilyPicker.families
            (notification.object as? NSComboBox)?.reloadData()
        }
        func controlTextDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox else { return }
            query = view.stringValue
            visible = query.isEmpty ? FontFamilyPicker.families : FontFamilyPicker.families.filter { $0.localizedCaseInsensitiveContains(query) }
            view.reloadData()
        }
        func controlTextDidEndEditing(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox else { return }
            commit(view.stringValue)
        }
        private func commit(_ text: String) {
            let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            let chosen = FontFamilyPicker.families.first { $0.caseInsensitiveCompare(text) == .orderedSame } ?? text
            committedValue = chosen
            parent.value = chosen
        }
        func comboBoxSelectionDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox, visible.indices.contains(view.indexOfSelectedItem) else { return }
            let chosen = visible[view.indexOfSelectedItem]
            view.stringValue = chosen
            commit(chosen)
        }
    }
}
