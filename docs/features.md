# 使用

Word 的 Equation Lab 功能区可以插入、编辑、编号和引用公式。双击已有 MathType 公式会打开独立编辑窗口；左侧显示当前文档的公式，可以搜索和切换。

编辑器支持模板与 LaTeX 输入、字体字号、分式、根式、求和、积分、矩阵、收藏，以及 PDF、SVG、PNG 导出。界面可切换中文和英文。

点击 Word 的插入按钮会先打开空白编辑区，点“完成并插入”后才写入文档。编辑已有公式时，编辑模式栏右侧显示“取消”和“更新公式”。

插入后关闭窗口，从 Dock 重开会重新读取当前 Word 文档。插入过程中也可选择左侧已有公式；未保存的内容或格式设置会先提示保留或放弃。双击已有公式后，编辑窗口会置前，保存后回到 Word。

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
