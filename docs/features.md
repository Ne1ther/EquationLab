# 使用

Word 的 Equation Lab 功能区可以插入、编辑、编号和引用公式。双击已有 MathType 公式会打开独立编辑窗口；左侧显示当前文档的公式，可以搜索和切换。

编辑器支持模板与 LaTeX 输入、字体字号、分式、根式、求和、积分、矩阵、收藏，以及 PDF、SVG、PNG 导出。界面可切换中文和英文。

## 选择文档和插入公式

左侧标题将文档图标、文件名和下拉箭头居中排列。打开菜单即可选择 Word 当前打开的文档，同名文件也能区分。菜单中的刷新更新文档列表与可用状态；公式区的刷新重新读取当前文档公式。

底部的“插入到 Word”提供行内、居中、右侧编号和左侧编号四种方式。顶部文件名决定目标文档；正在编辑已有公式时，新公式放在它所在段落之后。独立草稿使用所选文档在 Word 中的空光标位置，内容、字体字号和标尺一起带入。

从 Word 功能区开始插入时，会先打开空白编辑区。写好后点“完成并插入”，收到 Word 的保存结果后返回文档。编辑已有公式时，使用编辑模式栏右侧的“更新公式”。两个流程都可以点“取消”返回原文档。

有修改的草稿在切换文档或公式前会提示处理；来源文档关闭后，草稿仍会保留。“文件 → 新建独立草稿”和“打开文件副本…”适合单独写公式或编辑文件副本。

## 长文档与公式列表

长文档先打开当前选中的公式，其余列表分批载入。缩略图随浏览逐项生成和更新，当前公式会自动滚动到可见位置。加载期间可以继续输入、调整字号或取消；文档内容变化时会保留当前草稿，之后可重新读取列表。

多行公式可用 `\\` 换行，也可输入 `aligned`、`gathered` 或 `cases` 环境。保存时各行一起回到 Word。旧 MathType 公式可保留原结构替换字符，也可使用编辑器中的结构工具调整；黑板体、花体、颜色和多行排版都有对应显示。

手动填写分式和根式时，编辑区下方会显示光标所在的分子、分母或根号范围，蓝色虚线标出当前输入区域。点“移出根号”或“移出分式”即可继续填写外部内容；“选中结构”可选中整个结构一起替换。点击求和符号或它的上下限后，可把“上下限位置”设为“上下”或“右侧”，位置随公式一起保存到 Word。

“Word 排版预览”和“LaTeX 源码”保持展开，可以并排对照。Word 预览使用公式的原生字体、字号和间距；写回 Word 时使用矢量呈现，缩放时保留线条与字符细节。

## 编号格式、章和节

在 Word 正文中选中一个已有公式对象，再点“右侧编号”或“左侧编号”，可添加编号或把编号移到另一侧；再次点击同一侧会沿用现有编号。“独立编号”在选中公式右侧添加编号。这些操作用于每段一个公式的普通正文段落。

在 App 的 **文档 → Word 编排** 中选择编号预设或输入自定义格式，设置章和节。`#C` 表示章，`#S` 表示节，`#E` 表示公式序号。点“更新公式”应用到当前公式；新公式在“完成并插入”时生效。格式会成为本篇文档后续新增编号的默认值。

章和节从插入位置之前的 Equation Lab 编号字段读取。修改任一值会从当前公式建立新的章节设置，并把公式序号从 1 开始；后续公式沿用它，直到下一处章／节标记。空文档第一次插入时也可以设置。

没有正在编辑的公式时，Word 功能区的“编号格式”和“章 / 节设置”打开原生弹窗，设置后续新增编号。编辑期间，这两个入口会回到 App 的编号设置。

批量整理 Equation Lab 编号时，在 **文档检查与批量处理 → 将编号格式应用到副本…** 中选择当前公式、全部已有编号或仅后续新增公式。前两项整理已有编号，后一项设置文档后续默认。预览结果后另存副本，范围和结果一目了然。[查看详细用法](document-tools.md)

## 交叉引用与旧 MathType 编号

Word 功能区的“插入引用”打开可搜索的列表。通过编号和附近文字找到目标，选中后插入到当前光标位置。

插入、删除或移动公式后，点“更新编号”重算自动序号和交叉引用（REF），保留各公式的编号格式。旧 MathType 编号也通过 Word 功能区处理：“更新编号”识别 MTEqn、MTChap、MTSec，以及 MTPlaceRef 内部的相关字段，沿用原有的重新起号与重复序号设置。

**文档检查与批量处理 → 检查编号与引用…** 可查看公式编号、正文引用和检查结果，搜索断开的引用、锁定编号或缺少引用书签的项目。能对应到当前文档公式的项目可直接选中该公式。

## 字体、字号和间距

公式内部的上下标、分子分母、积分上下限等距离，在右侧 **排版 → 间距** 中调整。字体、标准字号和额外字号也在右侧设置，预览随修改更新。

要把当前设置用于更多公式，打开 **文档检查与批量处理 → 应用当前公式样式…**，选择当前公式或全文公式，预检后另存副本。选择“保存文档预设（另存副本）”可为后续公式保存一套样式；“将文档预设载入当前草稿”可将它用于正在编辑的公式。

独立公式与上下文的留白在 **Word 的“段落”设置 → 段前、段后** 调整。修改“Equation Lab”段落样式可应用到使用该样式的公式段落。行内公式随正文行距排版，正文可用自动或最小值行距。

## 连接诊断

**Office 插件**面板提供安装与修复、连接检查，以及“复制连接诊断”。诊断汇总 App 与组件版本、本地服务状态和最近操作阶段，便于描述连接或保存问题。

[30 公式演示](examples/equation-lab-30-formulas.docx) · [PDF](examples/equation-lab-30-formulas.pdf) · [文档检查与批量处理](document-tools.md)

---

# Using Equation Lab

Use the Word ribbon to insert, edit, number, and reference equations. Double-click a MathType equation to open its editor, then browse and search the document’s equations in the sidebar.

The editor offers templates and LaTeX input, fonts and sizes, fractions, radicals, sums, integrals, matrices, favorites, and PDF, SVG, and PNG export. The interface is available in Chinese and English.

## Choose a document and insert an equation

The sidebar title centers the document icon, filename, and menu arrow. Its menu lists open Word documents and distinguishes matching names. Refresh in this menu updates the document list; refresh in the equation area reloads the current document’s equations.

Insert into Word at the bottom offers inline, centered, right-numbered, and left-numbered placement. The filename at the top selects the destination. While editing an existing equation, insertion goes after its paragraph. A standalone draft uses the selected document’s empty Word cursor, carrying its content, fonts, sizes, and ruler into the insertion session.

Starting from the Word ribbon opens a blank editor. Choose Finish and insert when ready; the app returns to the document after receiving Word’s save result. For an existing equation, choose Update equation beside the editing mode controls. Both flows offer Cancel to return to the original document.

Changed drafts prompt before switching documents or equations and remain available if the source document closes. Use File → New standalone draft or Open a file copy to work independently.

## Long documents and the equation list

Long documents open the current equation first and load the rest in batches. Thumbnails appear and update individually as you browse, and the current equation scrolls into view. You can keep typing, adjust sizes, or cancel while loading. If the document changes, the app keeps the current draft so you can reload the list later.

Use `\\` for line breaks, or enter an `aligned`, `gathered`, or `cases` environment. All lines save back to Word together. For legacy MathType equations, you can replace characters while preserving the original structure or use the editor’s structure tools. The preview includes blackboard and script characters, colors, and multiline layouts.

When filling fractions and radicals by hand, the controls below the editor identify the current numerator, denominator, or root. A blue outline marks the input scope. Choose Exit Root or Exit Fraction to continue outside it, or Select Structure to replace the whole structure. Click a sum or one of its limits, then choose Above / below or Right side under Limits position. The placement saves with the equation in Word.

Word Layout Preview and LaTeX Source remain expanded for comparison. The Word preview uses the equation’s native fonts, sizes, and spacing. Saving to Word uses vector artwork so lines and characters retain their detail when enlarged.

## Number formats, chapters, and sections

Select an equation object in Word and choose Right Number or Left Number to add a number or move it to that side. Repeating the same-side command keeps the existing number. Independent Number adds a right-side number. These actions are for plain body paragraphs containing one equation each.

Under **Document → Word layout**, choose a number-format preset or enter a custom format, then set the chapter and section. `#C` means chapter, `#S` section, and `#E` equation sequence. Update equation applies the settings to the current equation; Finish and insert applies them to a new one. The format becomes this document’s default for later numbered insertions.

Chapter and section values come from Equation Lab sequence fields before the insertion position. Changing either value starts a new chapter/section context at the current equation and restarts equation numbering at 1. Later equations follow it until the next chapter/section marker. You can also set these values on the first insertion in an empty document.

With no equation being edited, Number Format and Chapter / Section in the Word ribbon open native dialogs for later insertions. During editing, these commands return to the app’s numbering settings.

For batch changes to Equation Lab numbering, use **Document checks and batch tools → Apply numbering format to a copy…**. Choose the current equation, existing numbered equations, or future equations only. The first two change existing numbers; the last stores the future default. Review the results and save a copy. [Read the detailed guide](document-tools.md)

## Cross-references and legacy MathType numbers

Insert Reference in the Word ribbon opens a searchable list. Find a target by its number or nearby text, then insert the reference at the current cursor.

After inserting, deleting, or moving equations, choose Update Numbers to recalculate sequence numbers and REF cross-references while retaining their formats. Use the Word ribbon for legacy MathType numbering too. Update Numbers recognizes MTEqn, MTChap, MTSec, and related fields inside MTPlaceRef, preserving existing sequence-restart and repeat settings.

**Document checks and batch tools → Check numbering and references…** lists equation numbers, body references, and findings. Search for broken references, locked numbers, or missing reference bookmarks. Entries matched to an equation in the current document can select that equation directly.

## Fonts, sizes, and spacing

Use **Layout → Spacing** in the inspector to adjust distances inside the equation, including scripts, fractions, and integral limits. Font, standard size, and extra-size settings are also on the right, with an updating preview.

To reuse the current style, open **Document checks and batch tools → Apply current formula style…**. Choose the current equation or all equations, review the preview, and save a copy. Store document preset in a copy saves a style for future equations; Load document preset into draft applies it to the current draft.

For space around display equations, adjust Before and After in **Word → Paragraph**. Editing the Equation Lab paragraph style applies to paragraphs using that style. Inline equations follow body line spacing; automatic or at-least spacing works well.

## Connection diagnostics

The **Office plugin** panel provides installation and repair, a connection check, and Copy connection diagnostics. Diagnostics collect app and component versions, local service status, and recent operation stages to help describe connection or saving issues.

[30-equation demo](examples/equation-lab-30-formulas.docx) · [PDF](examples/equation-lab-30-formulas.pdf) · [Document checks and batch tools](document-tools.md)
