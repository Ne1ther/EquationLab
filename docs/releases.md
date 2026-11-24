# 版本记录

## 0.7.10 · build114

修复带大型嵌入对象的长 Word 文档在侧栏停在第一条公式的问题。侧栏分批显示公式和已读到的正文编号，全文核对期间可以搜索已载入的条目。核对结束后，进度提示变成勾选。更新还整理了文档工具入口和 AI Skill 安装面板。

Long Word documents with large embedded objects now display equations and available numbers in batches. You can search loaded rows while Equation Lab checks the full document. A checkmark appears when the check finishes. This update also reorganizes the document tools and AI Skill setup.

[下载 0.7.10 · Download 0.7.10](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.10)

## 0.7.7 · build111

修复不同版本 WebKit 下的 Word 排版预览缩放。放大宽公式或高公式后，可以横向和纵向滚动查看完整公式。

Fixes Word layout preview zoom differences across WebKit versions. Wide and tall equations remain fully reachable by scrolling horizontally and vertically after zooming in.

[下载 0.7.7 · Download 0.7.7](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.7)

## 0.7.6 · build110

- **草稿保护。** 新建、打开副本和切换公式前会提示处理未保存的编辑。草稿恢复涵盖编号、排版和原生字符替换。
- **Word 编号。** 在仍使用旧 Equation Lab 编号的文档里，首次保存编号格式前会提示确认把全文编号字段转换为共享 MathType 编号。已使用共享编号的文档继续按当前公式更新编号格式。
- **公式列表。** 打开 DOCX 副本时先显示公式目录，缩略图随浏览加载。文档和收藏夹分别记住搜索条件。
- **标尺和 PDF。** 修复从制表位侧边拖动时的跳位，圆角公式框导出矢量 PDF 时保留圆角。

在桌面版 Word 的 30 公式共享编号副本中，第 9 式从 `(1.9)` 改为 `(1-9)`，对应的 `REF` 引用随之更新。99 个 `SEQ` 域、其余 29 式的编号结构、全部 30 个公式的 OLE 数据与书签，以及对照 `REF` 均保持原样。

- **Draft protection.** The app prompts before replacing unsaved edits when you start a draft, open a copy, or switch equations. Recovery includes numbering, layout, and native character replacements.
- **Word numbering.** The first format save in a document with legacy Equation Lab numbering asks for confirmation before converting its numbering fields to shared MathType numbering. In documents already using shared numbering, the format change applies to the current equation.
- **Equation list.** DOCX copies show the equation list first and load thumbnails as you browse. Documents and Favorites keep separate search terms.
- **Ruler and PDF.** Tab stops no longer jump when grabbed off center. Vector PDF export preserves rounded equation boxes.

In a 30-equation Word for Mac test copy using shared numbering, equation 9 changed from `(1.9)` to `(1-9)` and its `REF` updated. All 99 `SEQ` fields, the other 29 numbering structures, all 30 equation OLE payloads and their bookmarks, and the control `REF` were unchanged.

[下载 0.7.6 · Download 0.7.6](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.6)

## 0.7.5 · build109

- 修复 Word 保存后重新打开公式时偶尔出现的旧编号，结束编辑后会自动刷新。
- 修复 AI Skill 面板卡顿。手工添加的链接会显示为「待核验」，连接说明和导出可直接打开。
- 减少空闲查询和收藏缩略图的开销，改善部分 Word 文档的编号与排版设置读取。

- Fixes stale equation numbers when reopening a formula after saving in Word. Numbering refreshes automatically when editing ends.
- Fixes stalls in the AI Skill panel. Manual links are shown as unverified, and setup instructions and export remain available.
- Reduces idle polling and favorite thumbnail overhead, and improves how numbering and layout settings are read in some Word documents.

[下载 0.7.5 · Download 0.7.5](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.5)

## 0.7.4 · build108

- 加快未保存的长 Word 文档读取，缩略图后台生成时优先响应公式编辑和写回。
- 改善公式内容和编号一起更新时的定位，以及编号变更后的自动刷新。
- 修复标尺拖拽误删和文字输入撤销，优化更新包复用与 AI Skill 链接状态。

- Loads unsaved Word documents faster and prioritizes editing and saving over thumbnails.
- Improves target selection when saving equation content and numbering together, and automatically refreshes numbering when needed.
- Fixes ruler drag and text undo, and improves update package reuse and AI Skill link status.

[下载 0.7.4 · Download 0.7.4](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.4)

## 0.7.3 · build107

- 修改现有单条 Word 公式的编号格式后，列表只更新这一条的编号，保留其余公式和缩略图。取消编辑后重新打开也会沿用已核对的列表，常规流程中无需手动刷新。
- 标尺支持撤销与重做、还原制表位及就地用法提示。现在可以分别删除旧恢复草稿和取消当前编辑。
- 减少 Word 读取公式时的界面重绘干扰，并在安装内置更新前更明确地提示需先退出 Word 或结束当前编辑。

- Changing the numbering format of an existing Word equation updates only that item's number in the list while keeping other rows and thumbnails intact. Reopening after cancelling also reuses the verified list, so routine editing does not require a manual refresh.
- The equation ruler now supports undo and redo, reverting tab stop changes, and inline help. You can delete an older recovery draft and cancel the current edit separately.
- Reduces UI redraw interference while reading equations from Word and clarifies pre-install update prompts when Word is running or an edit is in progress.

[下载 0.7.3 · Download 0.7.3](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.3)

## 0.7.2 · build106

修复「适合窗口」模式下公式和标尺闪动、空闲时 CPU 占用偏高的问题。修改单条 Word 公式的编号格式后，侧栏会保留公式列表和缩略图，可直接点回刚编辑的公式。

---

Fixes equation and ruler flicker and high idle CPU usage in Fit to Window. After changing a Word equation's numbering format, the sidebar keeps the equation list and thumbnails so you can reopen the edited equation directly.

[下载 0.7.2 · Download 0.7.2](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.2)

## 0.7.1 · build105

在 **AI → 安装或导出 Skill…** 选择 Codex、Claude Code、Antigravity 或 DeepSeek Harness。四个客户端共用一份本地 Skill，其他客户端也可复制连接说明或导出文件夹。彩色 AI 按钮直接打开使用指引。

---

Choose Codex, Claude Code, Antigravity, or DeepSeek Harness under **AI → Install or Export Skill…**. The four clients can share one local Skill. Copy setup instructions or export the Skill folder for other clients. The colorful AI button opens the guide directly.

[下载 0.7.1 · Download 0.7.1](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.1)

## 0.7.0 · build104

- **本地 AI Skill**。工具栏点 **AI → 安装或导出 Skill… → 安装到 Codex**，即可用 `$equation-lab` 检查 Word 公式、编号和引用，或批量编辑后另存副本。也可以导出给同一台 Mac 上支持 Skill 的客户端。
- **长文档目录**。支持的 Word 文档可先显示可点选的公式目录，再补齐编号和公式内容。缩略图按需加载。
- **编辑体验**。窄窗缩放菜单更易读，侧栏能区分空文档和读取失败。行内公式优先展示小分式模板。

在 Codex 里试一句：`请用 $equation-lab 检查这份 Word 的公式、编号和交叉引用。`

适用于 Apple Silicon 和 macOS 14+。实时联动需要桌面版 Word for Mac。安装前请保存文档并退出 Word 和 Equation Lab。

---

- **Local AI Skill.** Choose **AI → Install or Export Skill… → Install for Codex**. Use `$equation-lab` to check Word equations, numbers, and references, or apply batch edits to a new copy. You can also export it to another client that supports Skills on the same Mac.
- **Long-document directory.** Supported Word documents can show a selectable equation directory first, then fill in equation text and numbers. Thumbnails load on demand.
- **A clearer editor.** The zoom menu stays readable in narrow windows, and the sidebar distinguishes empty documents from read failures. The compact fraction template comes first for inline equations.

Try in Codex: `Use $equation-lab to check this Word file’s equations, numbers, and cross-references.`

Requires Apple Silicon and macOS 14 or later. Live integration requires desktop Word for Mac. Save your documents and quit Word and Equation Lab before installing.

[下载 0.7.0 · Download 0.7.0](https://github.com/Ne1ther/EquationLab/releases/tag/v0.7.0)

## 0.6.15 · build103

修复旧 MathType 编号与跨段落引用书签的兼容问题，以及编号失败后的部分写入。取消编辑和引用选择不再预先修改全文编号；失败时恢复正文与编号设置。改善长文档导航、快照复用、App 启动和预览调度，并更新彩色工作台、模板分类及窄窗口布局。

已在独立论文副本上完成 Word 和 App 各四种插入、保存重开，以及编号、引用、章节、默认格式和冲突回滚测试；原有 112 个公式 Native 与 28 个其他 OLE 对象保留。以上宿主测试对应所保留的匹配 Word 组件，正式安装后的核验另行记录。

适用于 Apple Silicon、macOS 14+ 和桌面版 Word for Mac。旧字体编码和复杂编号段落仍可能安全跳过；未覆盖所有 MathType 格式或 Windows 往返。安装前请保存并完全退出 Word 和 Equation Lab。App 使用 ad-hoc 签名，尚未公证；自动更新清单使用 Ed25519 签名。

---

Fixes legacy MathType numbering with enclosing reference bookmarks and partial writes after numbering failures. Cancelling an editor or reference selection no longer upgrades document numbering in advance; failures restore document edits and numbering settings. Improves long-document navigation, snapshot reuse, app startup and preview scheduling, and refreshes the colorful workbench, template categories and narrow-window layout.

On independent thesis copies, the matching Word components passed all four insertion modes from both Word and the app, save/reopen, numbering, references, chapters, default formats and conflict rollback. The original 112 Native equation payloads and 28 other OLE objects were preserved. Release-package installation is checked separately.

Apple Silicon, macOS 14 or later, and desktop Word for Mac. Unsupported font encodings and complex numbering paragraphs may still be safely skipped; not all MathType formats or Windows round trips have been verified. Save your documents and quit Word and Equation Lab before installing. The app is ad-hoc signed and not notarized; update metadata is signed with Ed25519.

[下载 0.6.15](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.15)

## 0.6.14 · build102

长文档的字号和编号预检现在会给编辑预览让出执行时间，预检期间仍可输入；侧栏使用更精简的文档快照，按需读取旧预览。修复新 Word 会话与文档状态竞争、宿主回退成功后被误判超时，以及后台目标更新后 Word 普通保存可能漏写的问题。

Word 16.114.4 测试中，300 公式副本的末条公式通过普通保存、关闭和重开，其他公式 Native、编号及书签保持。112 公式原稿副本也通过单条保存重开；其样式预检因未知字体编码而安全跳过。Word 重存的 300 公式样本含额外隐藏图形，整篇编号预检会保守跳过；未重存的原始结构可预检 300 条。预检结果不代表已执行批量修改。

[0.6.14 安装包](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.14/Equation-Lab-0.6.14.pkg)

### English

Long-document style and numbering preflights now make room for editor previews, and typing remains available while they run. The sidebar keeps more compact document snapshots and loads stored previews when needed. This build also fixes a Word session identity race, a false timeout after a successful host fallback, and a case where Word could omit a background equation update from an ordinary save.

In Word 16.114.4 testing, the last equation in a 300-equation copy survived an ordinary save, close, and reopen; the other Native payloads, numbers, and bookmarks stayed unchanged. A separate 112-equation copy also passed a single-equation save and reopen, while its style preflight safely skipped unsupported font encodings. The Word-resaved 300-equation sample contains extra hidden shapes, so whole-document numbering preflight skips those equations; the original, unresaved structure has 300 eligible targets. A preflight does not apply changes.

## 0.6.13 · build101

这版加入了保存结果核对、本机草稿恢复、侧栏正文编号和组合搜索、按版心与分栏编排、积分上下限与文档工具，以及长文档分批加载和缓存优化。

修复了插入时可能带入上一条公式的问题。每次插入使用独立文件，只导入公式正文，保留 Word 原来的页边距和分栏。行内公式还会保留正文的样式、缩进和行距。预览图准备好后才能提交；打开靠后的公式时，侧栏会定位到所选行，缩略图载入后也保持位置。

Word 功能区恢复新版图标。打包时会核对模板中的图标资源，避免更新宏时又带回旧图标。

[下载 0.6.13](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.13)

### English

This build brings together save-result recovery, local drafts, sidebar number search, page and column layout, integral controls and document tools, and staged loading and caching for longer documents.

Each insertion now uses its own file and imports only the equation body, preserving Word’s margins and columns. Inline insertion also keeps the surrounding paragraph’s style, indents, and line spacing. Submission waits for the preview image to be ready. Opening an equation later in a document brings its sidebar row into view, with stable row heights as thumbnails arrive.

The refreshed Word ribbon artwork is included again. Packaging checks the actual template images so that updating the macros cannot silently restore older icons.

## 0.6.12 · build100

这次调整了安装时的 Office 授权流程。如果 macOS 暂时不允许访问 Word 文件夹，先把 App 装好，再从 App 按提示授权、完成插件安装。App 内的“安装 / 更新 Word 插件”也支持首次安装，不用再打开一次系统安装器。

安装和修复仍按原有记录核对 Word 组件，保留其他加载项。这个版本也包含 0.6.11 的中文组字保护、Word 自动启动和公式编辑修复。

[下载 0.6.12](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.12)

This release improves Office folder consent during installation. If macOS has not granted access to Word's folder, the app installs first and guides you through consent and plugin setup. Install / Update Word plugin now also handles first-time setup from the app, without opening macOS Installer again.

Component ownership checks and other add-ins are preserved. The release includes the Chinese composition, Word startup and formula editing fixes from 0.6.11.

## 0.6.11 · build99

中文输入是这次的重点。Word 正文、公式画布和 LaTeX 源码区会等组字完成后再同步，长拼音可以继续停留和选词。Word 的启动入口也重新整理，打开 Word 后自动连接公式组件。

手动编辑增加结构位置提示和求和上下标操作，改善旧 MathType 矩阵括号、颜色与中文标注的显示。预览面板会保留内容，应用图标的留白也作了调整。

读回和更新旧 MathType 的编号、章和节及交叉引用时，保留原生公式和引用关系。

[下载 0.6.11](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.11)

This release focuses on Chinese input. Word, the formula canvas, and the LaTeX editor defer synchronization until composition finishes, allowing longer Pinyin input and candidate selection. Word startup now connects the native formula component automatically.

Manual editing adds structure cues and sum-limit controls. Rendering improves legacy MathType matrix delimiters, colors, and Chinese annotations; preview panels retain their contents, and the app icon has more consistent spacing. Numbering updates preserve native equations and references while improving legacy MathType chapter and section handling.

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

长文档先打开正在编辑的公式，其余内容分批读取，缩略图随浏览补齐。增加对旧 MathType 黑板体、花体、颜色及多行结构的显示支持。“更新编号”可识别 MTEqn、MTChap、MTSec 与 MTPlaceRef，保留原有的重置、重复序号和交叉引用关系。

[下载 0.6.6](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.6)

Long documents open the selected equation first and load the rest in stages. This release expands legacy MathType rendering and updates MTEqn, MTChap, MTSec, and MTPlaceRef numbering while retaining resets, repeated numbers, and references.

## 0.6.5 · build85

文档菜单区分同名文件，切换时保留草稿，并同步已关闭的文档。完善公式选区、上一条／下一条导航和重新打开流程。选中正文普通段落中的公式，可用左侧编号、右侧编号补上或移动编号，再用“更新编号”刷新序号与引用。侧栏统一为独立编辑器中的原生列表。

[下载 0.6.5](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.5)

The document menu distinguishes files with identical names, retains drafts during switching, and follows document closure. Equation selection, navigation, and reopening are improved. Left Number and Right Number add or move numbering for a selected equation in a plain body paragraph; Update Numbers refreshes its sequence and references.

## 0.6.4 · build73

从 Dock 重开时刷新文档公式，插入期间也可以切换到已有公式。“取消”、“完成并插入”和“更新公式”放到了编辑模式栏右侧。也调整了双击后的窗口置前和保存后返回 Word 的处理。

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
