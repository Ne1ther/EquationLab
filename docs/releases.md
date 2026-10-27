# 版本记录

## 0.6.7 · build90

这版重点修了编号写回。右侧编辑器改好编号格式后，点“更新公式”会应用到当前公式，也会留作这篇文档后续新增编号的格式。新文档首次插入和连续插入也走同一套规则，完成后光标移到新公式后面。Word 的“更新编号”继续负责重算已有序号和引用。

补了靠后公式打开时的侧栏滚动、保存后系统重开的文档恢复，以及最后一份文档关闭后的状态清理。改过字体或标尺的草稿会继续受到切换保护。

本轮在 Word 16.114.1 / Apple Silicon 上逐条打开 30 个演示公式和 11 种复杂公式，检查了新文档连续插入、编辑器与 Word 编号格式联动、左右编号、删除后重编号和 REF 更新、多文档切换与关闭。120 条复杂公式的未保存文档完成了末尾内容和字号修改、保存和重开，前 119 条公式的 Native 数据未变。测试副本和私人材料保留在本地。验证范围仍不等于所有 Word 版本、所有 MathType 公式或 Windows 往返。

This release connects editor numbering changes to Word and later insertions, fixes the first insertion in a new document, and advances the insertion cursor. It also improves sidebar positioning, document recovery after reopening, and cleanup when the last Word document closes. Font-only and ruler-only drafts remain protected during switching.

Word 16.114.1 on Apple Silicon checks covered all 30 demo equations, 11 complex inputs, repeated insertion, numbering formats, left/right placement, deletion and REF updates, and document switching and closure. The last equation and point size in an unsaved 120-equation document survived saving and reopening; the other 119 Native payloads were unchanged. Test copies and private materials are not distributed. This is not a claim of compatibility with every Word version, MathType formula, or Windows round trip.

## 0.6.6 · build86

这次主要解决了长文档打开时的等待。尚未保存的长文档会先打开正在编辑的公式，其余内容分批读取，缩略图随着浏览补齐。列表加载期间，输入的内容和字号修改都会保留。已保存且没有修改的文档使用更快的读取路径。

旧公式也补了一些：黑板体、花体、颜色和部分多行结构现在可以正常显示；修复了模板同步后误报“有未保存更改”的情况。无法识别的旧字体字符仍会显示方框和提示，保留原始数据，暂时还不能承诺完整兼容。

“更新编号”开始识别旧 MathType 的 MTEqn、MTChap、MTSec，以及 MTPlaceRef 内的编号字段和相关交叉引用，保留原有的重置和重复序号设置，不修改无关的图表编号。

在 Apple Silicon、Word 16.114.1 上，用长文档副本测试了公式保存、字号修改、删除后的重编号、引用更新和保存重开；也测试了三份文档之间的选择和来源关闭后的列表清理。测试文档与记录留在本地，不随安装包或源码发布。此次没有逐条完成长文档中所有公式的手工编辑，也没有进行 Windows 往返验证。

发行包已检查结构、内置组件哈希和更新签名。本次没有完成本机系统安装，不把这些检查写成安装验收通过。

[下载 0.6.6](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.6)

This update focuses on the wait when opening long documents. The selected equation opens first in a long document with unsaved changes; the rest load in batches, with thumbnails appearing as you browse. Typing and point-size changes stay in place when the list finishes loading. Clean saved documents use a faster reading path.

More legacy blackboard/script characters, colors, and multiline structures now display correctly. Template synchronization no longer causes a false unsaved-change warning. Unrecognized legacy font characters still show a square and a warning, with original data retained. Update Numbers now recognizes MTEqn, MTChap, MTSec, and related fields inside MTPlaceRef, preserving reset/repeat settings and updating equation references without changing unrelated figure/table sequences.

Tested on Apple Silicon with Word 16.114.1 using a long-document copy: equation save-back, point-size changes, renumbering after deletion, cross-reference updates, and save/reopen. Three-document selection and source-closure cleanup were also tested. Private test documents and records stay local. Every equation was not manually edited, and Windows round trips were not tested.

Package structure, bundled component hashes, and the update signature were checked. The full system installation was not completed for this release, so those checks are not an installer acceptance result.

## 0.6.5 · build85

- Word 文档菜单按文档身份区分同名文件；后台更新文档信息不抢焦点，切换时保护未保存草稿，并清理已关闭来源的不可用公式。
- 修复 Word 字段选择和“下一条 / 上一条”切换。
- 启动失败时才提供重试；重新安装用户服务后会重新启动。
- 修复新文档插入等待和回调丢失后的恢复。
- 清理重复的网页侧栏代码，保留原生文档和收藏列表。
- Word 正文普通段落中选中已有公式后，可用“右侧编号”或“左侧编号”添加或移动编号；“独立编号”添加右侧编号。仅支持每段一个公式，不支持表格、列表、修订或受保护内容。重复点击同一侧不会重复编号；“更新编号”刷新自动序号和交叉引用。编辑器中的编号格式只作预览，保存编辑保留现有 Word 编号。

[下载 0.6.5](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.5)

This release improves the Word document menu, protects changed drafts while switching, fixes field selection and Next / Previous navigation, retries failed launches, restarts the reinstalled user service, and recovers insertion and document operations after missed callbacks. In a plain body paragraph, Right Number and Left Number add or move a number on the selected existing equation; Independent Number adds one on the right. This supports one equation per paragraph and excludes tables, lists, tracked changes, and protected content. Repeating the same side does not duplicate it. Update Numbers refreshes automatic sequence numbers and cross-references. The editor's number formatting is a preview; saving an edit preserves existing Word numbering. It removes duplicate web sidebar code and keeps the native document and favorites lists.

## 0.6.4 · build73

- 插入后关闭窗口，再从 Dock 打开会刷新当前文档的公式列表。
- 插入时可以选择左侧已有公式；未保存的内容或格式设置会先提示确认。
- 修复双击后编辑器未置前的问题，保存或关闭后返回 Word。
- “取消”和“完成并插入 / 更新公式”移到编辑模式栏右侧，不再单独占一行。
- 文档重开使用新会话，核对目标公式，避免迟到请求恢复旧窗口。

在 Word 16.114 上验证了插入后列表从 1 条变为 2 条、侧栏切换、草稿保留与放弃、保存重开，以及冷启动和重复双击的前台切换。

[下载 0.6.4](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.4)

Reopening from the Dock now refreshes the equation list after insertion. Existing equations can be selected during insertion, with confirmation before discarding changed content or formatting. Double-click brings the editor forward, and saving or closing returns to Word. Cancel and the submit action share the editing mode row. Tested in Word 16.114 with insertion from one to two equations, sidebar selection, draft protection, save/reopen, and cold and repeated foreground handoffs.

## 0.6.3 · build68

- Word 用浅蓝色选中公式时，也能直接点“编辑选中”，不用先选出对象边框。
- 双击和功能区共用同一条打开流程，避免重复激活。
- 保留旧 DSEquations 对象的外部编辑入口。
- 验证自动检查更新：旧版显示更新按钮，同版本不误报。

在 Word 16.114 上逐一打开 30 个公式，核对完整列表；公式 26 修改、保存和重开通过，编号和引用保留。

[下载 0.6.3](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.3)

Blue text selections in Word can now open directly with Edit Selected. Double-click and Ribbon commands share one activation path, while legacy DSEquations still open in their external editor. Verified all 30 equations in Word 16.114, full lists, equation 26 save/reopen and numbering, plus automatic update detection and the update button.

## 0.6.2 · build67

- 新公式从空白画布开始，完成后才插入；取消不会留下占位公式。
- “取消”和“完成并插入 / 更新公式”放到编辑区上方，支持 ⌘A 替换整条公式。
- 修复文档列表偶尔只剩一条、保存后无法重开和隐藏窗口恢复空白的问题；减少重复捕获和窗口切换。
- 修复冷启动后，从侧栏选择另一条公式保存时超时的问题。
- 补齐卷积星号、\dots、\displaystyle，以及 cases 行距；保留多行公式和中文标注。
- 修复行内插入拆开后续正文的问题。
- 插入结果无法确认时保留草稿、停止重复提交并允许关闭；插入后的排版错误不再误报为未插入。

这次在 Word 16.114、M 系列 Mac 上逐一打开了 30 个公式，也测试了 11 条复杂公式、空白插入、编辑保存和重新打开。

[下载 0.6.2](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.2)

New equations start blank, with Cancel and Done and Insert / Update Equation above the canvas. This release fixes incomplete document lists, cold-start sidebar saves, reopening and hidden-window rendering, reduces repeated document captures, and adds convolution asterisks, \dots, \displaystyle, and cases row spacing. If Word cannot confirm an insertion, the draft stays available and the window can close without repeating it. Tested in Word 16.114 on Apple Silicon with all 30 demo equations, 11 complex formulas, insertion, saving, and reopening.

## 0.6.1 · build63

- 修复多行公式变成单行、换行被当作反斜杠保存的问题。
- 关闭编辑窗口后保留已加载的编辑器，从 Dock 或 Word 重新打开。
- 左侧公式列表直接在 App 内切换；保存时在后台核对并写回目标公式。
- 修复旧会话刚结束时再次双击失效的问题，冷启动后将编辑窗口置前。
- Word 的 Equation Lab 按钮与双击共用文档打开流程。
- 修复失效会话阻止编辑、取消和关闭窗口的问题。
- 根号与横线使用连续轮廓，消除高根号接头处的重叠粗线。
- 缓存文档解析和公式缩略图，减少反复打开时的重复工作。
- 修复取消或保存后，再开公式时文档列表偶尔只剩一条的问题。
- 补齐安装包里的 Word 功能区资源，防止装好后没有 Equation Lab 顶栏。
- 提高章、节和编号信息的对比度。
- 删除旧的 Word 内嵌侧栏，保留独立编辑器里的文档公式列表。

[下载 0.6.1](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.1)

## 0.6.0

- 文档中的公式列表、搜索、切换和原位置回存。
- 编号格式预设、自定义输入、实时预览和文档编号详情。
- 修正求和上下限、根号、积分、数学减号及公式边缘裁切，提升预览清晰度。
- Word 跳转后的公式显示刷新；编号和交叉引用更新。
- 新增三节三十公式的 Word 和 PDF 演示。
- 简化安装、使用和开发说明。

[下载 0.6.0](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.0) · [历史版本](https://github.com/Ne1ther/EquationLab/releases)

---

0.6.1 build63 browses document equations in the app and saves to the selected formula in the background. It fixes multiline conversion, stale sessions, lost document lists, overlapping radical strokes, and missing Word ribbon resources in the installer. It improves reopening, numbering readability, and document caching, and removes the old embedded Word task pane.
