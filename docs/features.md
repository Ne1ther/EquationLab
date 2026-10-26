# 使用

Word 的 Equation Lab 功能区可以插入、编辑、编号和引用公式。双击已有 MathType 公式会打开独立编辑窗口；左侧显示当前文档的公式，可以搜索和切换。

编辑器支持模板与 LaTeX 输入、字体字号、分式、根式、求和、积分、矩阵、收藏，以及 PDF、SVG、PNG 导出。界面可切换中文和英文。

点击 Word 的插入按钮会先打开空白编辑区，点“完成并插入”后才写入文档。编辑已有公式时，编辑模式栏右侧显示“取消”和“更新公式”。

插入后关闭窗口，从 Dock 重开会重新读取当前 Word 文档。插入过程中也可选择左侧已有公式；未保存的内容或格式设置会先提示保留或放弃。双击已有公式后，编辑窗口会置前，保存后回到 Word。

左侧文件名菜单列出 Word 当前打开的文档，并按文档身份区分同名文件；只读文档不可选。有未保存草稿时，切换前会询问是否放弃。保存忙碌、结果未确定或 Word 状态未知时，切换不可用。Word 当前文档变化时，干净的编辑器会自动跟随；有修改的草稿仍留在原文档。关闭来源文档后会清理其不可用公式列表，并保留草稿。菜单中的刷新更新文档列表与可用状态；公式区的刷新重新读取当前文档公式，有未保存修改时会跳过并保留草稿。Word 提供的文档信息更新，并不等于公式列表已重新读取。

多行公式可用 `\\` 换行，也可输入 `aligned`、`gathered` 或 `cases` 环境。保存时各行一起回到 Word。

## 长文档和旧公式

已保存且没有修改的文档会直接读取公式所需的数据。未保存的长文档先打开选中的公式，其余内容分批加载；缩略图按浏览位置补齐。加载时可以继续编辑、调整字号，也可以取消；如果文档内容已经改变，当前草稿会保留，列表读取会停止。

补充了旧 MathType 的部分黑板体、花体、颜色和多行结构支持。遇到尚未识别的旧字体字符时，会保留原始字符记录，并用方框和提示说明。这里仍有兼容范围，不能把能预览等同于所有 MathType 或 Windows 往返都已验证。

## 编号

在 Word 正文中选中一个已有公式对象，再点功能区的“右侧编号”或“左侧编号”，可添加编号或把编号移到另一侧；重复点击同一按钮不会重复添加。选中公式后点“独立编号”会在右侧添加编号。此操作适用于正文中每段一个公式的普通段落；表格、列表、修订或受保护内容暂不支持。新公式仍按原来的“插入”流程创建。

插入、删除或移动编号后，点“更新编号”，让 Word 更新自动序号和交叉引用（REF）。已有编号的格式由 Word 字段控制；预设或自定义格式用于新编号。若要使用章/节编号（#C/#S），先在 Word 中设置章节编号。编辑器 **文档 → Word 编排** 中的格式和预览用于查看，不会直接改写现有 Word 编号；双击公式编辑并保存会保留原编号，实际编号请在 Word 功能区操作。

“更新编号”也识别旧 MathType 的 MTEqn、MTChap、MTSec 序号，以及 MTPlaceRef 内部的相关字段。更新时保留原有的重置和重复序号设置，再更新指向公式编号的引用；不会运行 MTPlaceRef 宏，也不会重排手写编号或修改无关的图表序号。

## 公式与上下文的间距

独立公式上下留白在 **Word 的“段落”设置 → 段前、段后** 调整。可修改“Equation Lab”段落样式，一次应用到整篇文档。行内公式随正文的行距排版，正文建议用自动或最小值行距。

公式内部的上下标、分子分母、积分上下限等距离，在编辑器右侧 **排版 → 间距** 调整。

[30 公式演示](examples/equation-lab-30-formulas.docx) · [PDF](examples/equation-lab-30-formulas.pdf)

---

Use the Word ribbon to insert, edit, number, and reference equations. Select an existing equation object, then choose Right Number or Left Number to add a number or move it to that side. Repeating the same command does not add a duplicate. Independent Number adds a right-side number to the selected equation. New equations still use the existing insertion flow. After inserting, deleting, or moving numbers, choose Update Numbers to refresh automatic sequence numbers and REF cross-references. Chapter/section formats (#C/#S) require chapter and section numbering to be set up in Word first. The editor's Document → Word Layout controls and preview do not change existing Word numbering; saving an edit preserves it. For space around an equation, change Before/After spacing in Word's Paragraph settings. Internal spacing is in the editor's Layout inspector.

Insertion starts with a blank editor. Choose Done and Insert to add the equation to Word, or Cancel to leave the document unchanged. Existing equations use Cancel and Update Equation beside the editing mode controls.

Reopening from the Dock refreshes the current Word document after insertion. You can select an existing equation during insertion; changed content or formatting prompts before switching. Double-click brings the editor forward; saving returns to Word.

The filename menu on the left lists open Word documents and distinguishes documents by identity, including files with the same name. Read-only documents cannot be selected. If the draft has changed, switching asks before discarding it. Switching is unavailable while saving, when the save result is unknown, or when Word's state cannot be read. A clean editor follows changes to Word's active document; a changed draft stays with its original document. Closing that document clears its unavailable formula list and keeps the draft. The menu refresh updates document metadata; the formula refresh rereads equations in the current document, but skips the refresh when the draft has unsaved changes. A metadata update does not itself reload the formula list.

Clean saved documents use a faster reading path. Long documents with unsaved changes open the selected equation first, then load the list in batches, with thumbnails appearing as you browse. Typing, point-size changes, and cancellation remain available during loading. A change to the source document stops loading and keeps the current draft. More legacy blackboard/script characters, colors, and multiline structures are supported; unmapped legacy font characters still show a square and a warning while retaining their original data.

Update Numbers also recognizes legacy MathType MTEqn, MTChap, and MTSec sequence fields, including related fields nested inside MTPlaceRef. It retains reset and repeat switches, then updates references to equation numbers. It does not run the MTPlaceRef macro, renumber manually typed text, or change unrelated figure/table sequences. These checks do not establish full MathType or Windows round-trip compatibility.
