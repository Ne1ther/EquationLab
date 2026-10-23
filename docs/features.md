# 使用

Word 的 Equation Lab 功能区可以插入、编辑、编号和引用公式。双击已有 MathType 公式会打开独立编辑窗口；左侧显示当前文档的公式，可以搜索和切换。

编辑器支持模板与 LaTeX 输入、字体字号、分式、根式、求和、积分、矩阵、收藏，以及 PDF、SVG、PNG 导出。界面可切换中文和英文。

点击 Word 的插入按钮会先打开空白编辑区，点“完成并插入”后才写入文档。编辑已有公式时，编辑模式栏右侧显示“取消”和“更新公式”。

插入后关闭窗口，从 Dock 重开会重新读取当前 Word 文档。插入过程中也可选择左侧已有公式；未保存的内容或格式设置会先提示保留或放弃。双击已有公式后，编辑窗口会置前，保存后回到 Word。

左侧文件名菜单列出 Word 当前打开的文档，并按文档身份区分同名文件；只读文档不可选。有未保存草稿时，切换前会询问是否放弃。保存忙碌、结果未确定或 Word 状态未知时，切换不可用。Word 当前文档变化时，干净的编辑器会自动跟随；有修改的草稿仍留在原文档。关闭来源文档后会清理其不可用公式列表，并保留草稿。菜单中的刷新更新文档列表与可用状态；公式区的刷新重新读取当前文档公式，有未保存修改时会跳过并保留草稿。Word 提供的文档信息更新，并不等于公式列表已重新读取。

多行公式可用 `\\` 换行，也可输入 `aligned`、`gathered` 或 `cases` 环境。保存时各行一起回到 Word。

## 编号

Word 里的编号在功能区设置，插入或删除后点“更新编号”。编辑器右侧 **文档 → Word 编排** 可试用常用格式或自定义格式，下方显示预览和该公式实际的章、节、序号、引用数。双击编辑后保存，会保留 Word 中原来的编号。

## 公式与上下文的间距

独立公式上下留白在 **Word 的“段落”设置 → 段前、段后** 调整。可修改“Equation Lab”段落样式，一次应用到整篇文档。行内公式随正文的行距排版，正文建议用自动或最小值行距。

公式内部的上下标、分子分母、积分上下限等距离，在编辑器右侧 **排版 → 间距** 调整。

[30 公式演示](examples/equation-lab-30-formulas.docx) · [PDF](examples/equation-lab-30-formulas.pdf)

---

Use the Word ribbon to insert, edit, number, and reference equations. Double-click to edit, and browse document equations on the left. The inspector previews number formats and shows the actual document number; saving an edit preserves the existing Word number. For space around an equation, change Before/After spacing in Word's Paragraph settings. Internal spacing is in the editor's Layout inspector.

Insertion starts with a blank editor. Choose Done and Insert to add the equation to Word, or Cancel to leave the document unchanged. Existing equations use Cancel and Update Equation beside the editing mode controls.

Reopening from the Dock refreshes the current Word document after insertion. You can select an existing equation during insertion; changed content or formatting prompts before switching. Double-click brings the editor forward; saving returns to Word.

The filename menu on the left lists open Word documents and distinguishes documents by identity, including files with the same name. Read-only documents cannot be selected. If the draft has changed, switching asks before discarding it. Switching is unavailable while saving, when the save result is unknown, or when Word's state cannot be read. A clean editor follows changes to Word's active document; a changed draft stays with its original document. Closing that document clears its unavailable formula list and keeps the draft. The menu refresh updates document metadata; the formula refresh rereads equations in the current document, but skips the refresh when the draft has unsaved changes. A metadata update does not itself reload the formula list.
