# 版本记录

## 0.6.11 · build99

中文输入是这次的重点。Word 正文、公式画布和 LaTeX 源码区会等组字完成后再同步，长拼音可以继续停留和选词。Word 的启动入口也重新整理，打开 Word 后自动连接公式组件。

手动编辑增加结构位置提示和求和上下标操作，改善旧 MathType 矩阵括号、颜色与中文标注的显示。预览面板会保留内容，应用图标的留白也作了调整。

完善旧 MathType 编号、章和节、交叉引用的读回与更新，保留原生公式与引用关系。

[下载 0.6.11](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.11)

This release focuses on Chinese input. Word, the formula canvas, and the LaTeX editor defer synchronization until composition finishes, allowing longer Pinyin input and candidate selection. Word startup now connects the native formula component automatically.

Manual editing gains structure cues and sum-limit controls. Rendering improves legacy MathType matrix delimiters, colors, and Chinese annotations; preview panels retain their contents, and the app icon has more consistent spacing. Numbering updates preserve native equations and references while improving legacy MathType chapter and section handling.

## 0.6.10 · build98

这次补上了整篇文档的整理工具。在右侧“文档”页检查公式编号与引用，选好范围后，可以统一字体、字号、间距和编号格式，另存一份整理好的 Word 副本。也可以只保存后续新公式的默认设置。

Word 的“插入引用”现在有可搜索的选择器，输入编号或附近的文字就能找到目标。选好后，引用会插回原来的光标位置。

长文档继续先打开当前公式，再分批补齐列表和缩略图；侧栏按变化更新，编辑和预览优先处理。还加了连接诊断，修复同路径升级后的后台服务记录，并把文档选择框的图标、文件名和箭头对齐。

[下载 0.6.10](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.10)

The Document inspector now includes numbering and reference checks, plus batch tools for fonts, sizes, spacing, and numbering. Choose the equations to process and save the result as a Word copy, or keep a preset for future equations.

Word's Insert Reference command now opens a searchable picker. Find an equation by its number or nearby text and insert the reference at the original cursor. Long documents open the selected equation first, then fill the list and previews in stages. Incremental sidebar updates prioritize editing and previews. This release also adds connection diagnostics, updates service receipts after in-place upgrades, and aligns the document selector's icon, filename, and arrow.

## 0.6.9 · build94

直接从 App 选择 Word 文档并插入行内、居中或左右编号公式。编辑已有公式时，新公式放在它所在段落之后；独立草稿会连同排版设置带入 Word 光标位置。App 和 Word 功能区共用编号格式、章和节，连续插入接着生成 `(1.1)`、`(1.2)`。

文档选择器改用 Word 图标，侧栏插入入口使用原生菜单。切换时保留草稿，来源关闭后清理旧列表，Word 功能区图标也重新整理了。

[下载 0.6.9](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.9)

Insert inline, centered, or left/right numbered equations directly from the app. New equations go after the paragraph being edited, or at the selected document's cursor for a standalone draft. The app and Word share number formats, chapters, and sections. This release also refreshes the Word icons and native menus, preserves drafts during switching, and clears closed document entries.

## 0.6.7 · build90

打通编辑器编号设置与 Word 写回。当前公式采用修改后的格式，后续新增编号沿用它；插入后光标移到新公式后面。打开靠后的公式时，侧栏自动滚动到选中位置。也改善了 Dock 重开后的文档恢复和最后一份文档关闭后的状态清理。

[下载 0.6.7](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.7)

Editor numbering settings now apply to Word and later insertions. The cursor advances after insertion, the sidebar scrolls to the selected equation, and document state is restored when reopening from the Dock.

## 0.6.6 · build86

长文档先打开正在编辑的公式，其余内容分批读取，缩略图随浏览补齐。增加旧 MathType 黑板体、花体、颜色和多行结构的显示支持。“更新编号”识别 MTEqn、MTChap、MTSec 与 MTPlaceRef，保留原有重置、重复序号和交叉引用关系。

[下载 0.6.6](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.6)

Long documents open the selected equation first and load the rest in stages. This release expands legacy MathType rendering and updates MTEqn, MTChap, MTSec, and MTPlaceRef numbering while retaining resets, repeated numbers, and references.

## 0.6.5 · build85

文档菜单区分同名文件，切换时保留草稿，并同步已关闭的文档。完善公式选区、上一条／下一条导航和重新打开流程。选中正文普通段落中的公式，可用左侧编号、右侧编号补上或移动编号，再用“更新编号”刷新序号与引用。侧栏统一为独立编辑器中的原生列表。

[下载 0.6.5](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.5)

The document menu distinguishes files with identical names, retains drafts during switching, and follows document closure. Equation selection, navigation, and reopening are improved. Left Number and Right Number add or move numbering for a selected equation in a plain body paragraph; Update Numbers refreshes its sequence and references.

## 0.6.4 · build73

从 Dock 重开时刷新文档公式，插入期间也可以切换到已有公式。取消、完成并插入和更新公式放到编辑模式栏右侧。改善双击后的窗口置前和保存后返回 Word。

[下载 0.6.4](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.4)

Dock reopening refreshes document equations. Existing equations can be selected during insertion, and the editing mode row now holds Cancel and the submit action. Window activation and the return to Word are improved.

## 0.6.3 · build68

Word 的浅蓝文字选区也能通过“编辑选中”打开公式。双击与功能区共用打开流程，并增加自动更新检查与工具栏更新按钮。

[下载 0.6.3](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.3)

Word's blue text selection can open an equation through Edit Selected. Double-click and ribbon commands share the same opening flow. Automatic update checks and the toolbar update button are added.

## 0.6.2 · build67

新公式从空白画布开始，完成后插入。补齐卷积星号、`\dots`、`\displaystyle`、cases 行距、多行公式与中文标注；改善文档列表、隐藏窗口恢复、侧栏保存和行内插入。

[下载 0.6.2](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.2)

New equations start on a blank canvas. Rendering adds convolution asterisks, `\dots`, `\displaystyle`, cases row spacing, multiline equations, and Chinese annotations. Document lists, window restoration, sidebar saves, and inline insertion are improved.

## 0.6.1 · build63

修复多行公式保存，加入文档解析与缩略图缓存，改善编辑器重开和原位置保存。根号使用连续轮廓，编号信息更清晰，安装包包含完整 Word 功能区资源。

[下载 0.6.1](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.1)

This release fixes multiline saving, caches document parsing and thumbnails, improves reopening and in-place saving, refines radical contours and numbering readability, and packages the complete Word ribbon.

## 0.6.0

加入文档公式列表、搜索、切换、原位置回存，以及编号预设、自定义格式和实时预览。提供三节三十个公式的 Word 与 PDF 演示。

[下载 0.6.0](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.0) · [所有版本](https://github.com/Ne1ther/EquationLab/releases)

Document equation browsing, search, switching, in-place saving, numbering presets, and live format previews are introduced, along with the thirty-equation Word and PDF demo.
