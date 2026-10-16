import SwiftUI
import AppKit

struct EquationRuler: View {
    @ObservedObject var bridge: DesktopBridge
    @State private var tabType = 0
    @State private var dragging: Int?
    @State private var dragX: CGFloat = 0
    private let names = ["左对齐", "居中", "右对齐", "关系对齐", "小数点对齐"]
    private let marks = ["└", "┴", "┘", "=", "·"]
    private var scale: CGFloat {
        let full = Double(bridge.state.sizes.first?.value ?? "12") ?? 12
        return CGFloat(Double(bridge.state.effectiveZoom) * 0.29 / max(2, full))
    }
    private func save(_ tabs: [RulerTab]) {
        bridge.action("ruler", ["tabs": tabs.sorted { $0.position < $1.position }.map { ["position": $0.position, "type": $0.type] }])
    }
    var body: some View {
        HStack(spacing: 4) {
            Menu {
                ForEach(0..<names.count, id: \.self) { i in Button(bridge.t(names[i])) { tabType = i } }
                Divider()
                Button(bridge.t("插入制表符")) { bridge.action("editorCommand", ["command": "insertTab"]) }
                Button(bridge.t("清除制表位")) { save([]) }.disabled(bridge.state.ruler.isEmpty)
            } label: { Text(marks[tabType]).font(.system(size: 17, weight: .semibold)).frame(width: 24, height: 28) }
                .menuStyle(.borderlessButton).fixedSize().help(bridge.t("选择制表位类型；点击标尺添加，拖动移动，拖出删除"))
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    Canvas { context, size in
                        var baseline = Path(); baseline.move(to: CGPoint(x: 0, y: 29)); baseline.addLine(to: CGPoint(x: size.width, y: 29))
                        context.stroke(baseline, with: .color(.secondary.opacity(0.35)), lineWidth: 0.5)
                        let majorStep = [10, 20, 50, 100, 200, 500].first { CGFloat($0) * scale >= 40 } ?? 500
                        let minorStep = majorStep / 5
                        let count = max(0, Int(size.width / max(1, scale * CGFloat(minorStep))))
                        for tick in 0...count {
                            let x = CGFloat(tick * minorStep) * scale, major = tick % 5 == 0
                            var path = Path(); path.move(to: CGPoint(x: x, y: major ? 19 : 24)); path.addLine(to: CGPoint(x: x, y: 29))
                            context.stroke(path, with: .color(.secondary.opacity(0.6)), lineWidth: 0.5)
                            if major { context.draw(Text("\(tick * minorStep)").font(.system(size: 9).monospacedDigit()).foregroundColor(.secondary), at: CGPoint(x: x + 2, y: 9), anchor: .leading) }
                        }
                    }.contentShape(Rectangle()).onTapGesture { location in
                        let position = Int((max(0, location.x) / scale).rounded()) * 32
                        guard position <= 32767, !bridge.state.ruler.contains(where: { $0.position == position }) else { return }
                        save(bridge.state.ruler + [RulerTab(position: position, type: tabType)])
                    }
                    ForEach(bridge.state.ruler) { tab in
                        Text(marks[min(4, max(0, tab.type))]).font(.system(size: 17, weight: .semibold)).foregroundStyle(.blue)
                            .frame(width: 20, height: 24)
                            .position(x: dragging == tab.id ? dragX : CGFloat(tab.position) / 32 * scale, y: 25)
                            .help("\(bridge.t(names[min(4, max(0, tab.type))])) · \(String(format: "%.2f", Double(tab.position) / 32)) pt")
                            .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .named("ruler"))
                                .onChanged { value in dragging = tab.id; dragX = value.location.x }
                                .onEnded { value in
                                    var tabs = bridge.state.ruler.filter { $0.id != tab.id }
                                    if value.location.y >= -12 && value.location.y <= 52 && value.location.x >= 0 && value.location.x <= geometry.size.width {
                                        let p = min(32767, Int((value.location.x / scale).rounded()) * 32)
                                        if !tabs.contains(where: { $0.position == p }) { tabs.append(RulerTab(position: p, type: tab.type)) }
                                    }
                                    dragging = nil; save(tabs)
                                })
                            .contextMenu { Button(bridge.t("删除制表位")) { save(bridge.state.ruler.filter { $0.id != tab.id }) } }
                    }
                }.coordinateSpace(name: "ruler")
            }
            Text("pt").font(.system(size: 9)).foregroundStyle(.secondary).frame(width: 16)
        }.disabled(bridge.state.readOnly || bridge.state.busy)
            .padding(.horizontal, 7).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
            .onExitCommand { dragging = nil }
    }
}

extension DesktopBridge {
    func showEditorMenu(atWebPoint point: NSPoint? = nil) {
        let menu = NSMenu(); menu.autoenablesItems = false
        func item(_ title: String, _ command: String, _ symbol: String? = nil, key: String = "", enabled: Bool = true) {
            let entry = NSMenuItem(title: t(title), action: #selector(editorMenuAction(_:)), keyEquivalent: key)
            entry.target = self; entry.representedObject = command; entry.isEnabled = enabled
            if let symbol { entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
            menu.addItem(entry)
        }
        let editable = !state.readOnly && !state.busy
        item("撤销", "undo", "arrow.uturn.backward", key: "z", enabled: editable)
        item("重做", "redo", "arrow.uturn.forward", enabled: editable)
        menu.addItem(.separator())
        item("剪切", "cutToClipboard", "scissors", key: "x", enabled: editable)
        item("复制", "copyToClipboard", "doc.on.doc", key: "c", enabled: !state.latex.isEmpty)
        item("粘贴", "pasteFromClipboard", "doc.on.clipboard", key: "v", enabled: editable)
        item("全选", "selectAll", enabled: !state.latex.isEmpty)
        menu.addItem(.separator())
        item("自定义矩阵…", "matrix", "square.grid.3x3.fill", enabled: editable)
        for (title, command) in [("上方插入行", "addRowBefore"), ("下方插入行", "addRowAfter"), ("左侧插入列", "addColumnBefore"), ("右侧插入列", "addColumnAfter"), ("删除当前行", "removeRow"), ("删除当前列", "removeColumn")] {
            let shape = state.matrix
            let bounded = command.hasPrefix("addRow") ? (shape?.rows ?? 31) < 31 : command.hasPrefix("addColumn") ? (shape?.columns ?? 31) < 31 : command == "removeRow" ? (shape?.rows ?? 0) > 1 : (shape?.columns ?? 0) > 1
            item(title, command, enabled: editable && bounded)
        }
        menu.addItem(.separator())
        item("全部符号与模板…", "library", "square.grid.3x3")
        item(showRuler ? "隐藏标尺" : "显示标尺", "ruler", "ruler")
        item("插入制表符", "insertTab", enabled: editable)
        // Context coordinates come from the web view, so the menu also stays
        // in the requested window when an accessibility click does not move
        // the physical pointer. The header button uses a stable canvas anchor.
        guard let view = webView else { return }
        let x = min(max(0, point?.x ?? view.bounds.width - 18), view.bounds.width)
        let top = min(max(0, point?.y ?? 2), view.bounds.height)
        let anchor = NSPoint(x: x, y: view.isFlipped ? top : view.bounds.height - top)
        DispatchQueue.main.async { menu.popUp(positioning: nil, at: anchor, in: view) }
    }
    @objc private func editorMenuAction(_ sender: NSMenuItem) {
        guard let command = sender.representedObject as? String else { return }
        switch command {
        case "matrix": openMatrixBuilder()
        case "library": if state.activeCategory == "希腊字母" { showLetterLibrary = true } else { showFeatureLibrary = true }
        case "ruler": showRuler.toggle()
        default: action("editorCommand", ["command": command])
        }
    }
}
