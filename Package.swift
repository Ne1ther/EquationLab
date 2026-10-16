// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "EquationLab", platforms: [.macOS(.v14)], products: [.executable(name: "EquationLab", targets: ["EquationLab"]), .executable(name: "EquationFontMetrics", targets: ["EquationFontMetrics"])], targets: [.executableTarget(name: "EquationLab", path: "macos", swiftSettings: [.swiftLanguageMode(.v5)]), .executableTarget(name: "EquationFontMetrics", path: "font-metrics", swiftSettings: [.swiftLanguageMode(.v5)])])
