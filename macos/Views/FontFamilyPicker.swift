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
            visible = FontFamilyPicker.families
            (notification.object as? NSComboBox)?.reloadData()
        }
        func controlTextDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox else { return }
            let query = view.stringValue
            visible = query.isEmpty ? FontFamilyPicker.families : FontFamilyPicker.families.filter { $0.localizedCaseInsensitiveContains(query) }
            view.reloadData()
        }
        func controlTextDidEndEditing(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox else { return }
            commit(view.stringValue, in: view)
        }
        private func commit(_ text: String, in view: NSComboBox) {
            let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let chosen = text.isEmpty ? committedValue : (FontFamilyPicker.families.first { $0.caseInsensitiveCompare(text) == .orderedSame } ?? text)
            if view.stringValue != chosen { view.stringValue = chosen }
            guard chosen != committedValue else { return }
            committedValue = chosen
            parent.value = chosen
        }
        func comboBoxSelectionDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSComboBox, visible.indices.contains(view.indexOfSelectedItem) else { return }
            commit(visible[view.indexOfSelectedItem], in: view)
        }
    }
}
