# 功能与验证入口

当前使用方式见[使用说明](features.md)，每次发布的改动见[版本记录](releases.md)。这里按功能列出维护和验证入口。

| 功能 | 代码与测试 |
| --- | --- |
| 公式结构、原生数据、多行与矩阵 | `src/native.mjs`、`src/native-layout.mjs`；`tests/native-layout.test.mjs`、`tests/native-complex-inputs.test.mjs` |
| 字体、字号、间距与矢量导出 | `src/font-renderer.mjs`、`src/typography-native.mjs`、`src/vector-pdf.mjs` |
| Word 编辑、空白插入、保存确认 | `src/word-native-session.mjs`；`tests/word-native-insertion.test.mjs`、`tests/desktop-word-insertion.test.mjs` |
| 文档列表、Dock 重开、草稿保护 | `desktop/word-document-workspace.js`、`src/word-document-requests.mjs`；`tests/desktop-word-workspace.test.mjs`、`tests/word-document-requests.test.mjs` |
| Word 选区、双击与原位置回存 | `native-word-probe/automatic-loader/`、`native-word-probe/src/`；`tests/word-ribbon.test.mjs` 及原生测试 |
| 窗口恢复与前台交接 | `macos/Services/DesktopBridge.swift`、`WordFocusHandoff.swift`；`tests/updates/WordSessionLifecycleTests.swift` |
| 编号和交叉引用 | `src/layout.mjs`、`src/word-numbering.mjs`、Word Ribbon 命令 |
| 文档审计、引用搜索与批量副本 | `src/document-audit.mjs`、`src/document-typography.mjs`、`src/document-numbering-plan.mjs`；相关文档工具测试 |
| 自动更新 | `macos/Services/AppUpdater.swift`、`updater/`；`tests/updates/AppUpdaterTests.swift` |
| 安装与修复 | `packaging/word-native-installer/`；安装器测试及真实 Word 加载记录 |

发布前除代码测试外，还要在 Word 中检查插入、列表切换、双击、保存、重开、编号和引用。程序化读回用于核对原生公式是否改变，界面测试用于核对实际显示和前台切换。

公开的 [30 公式演示](examples/equation-lab-30-formulas.docx) 提供编号、引用和多种公式结构，可用于开发回归。

---

The table maps current features to their code and tests. Word insertion, list switching, double-click, saving, reopening, numbering, and references also need host checks. Use the public thirty-equation demo for repeatable numbering, reference, and layout checks.
