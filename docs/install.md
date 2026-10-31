# 安装与使用

**[下载 Equation Lab 0.6.11（build99）](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.11/Equation-Lab-0.6.11.pkg)**

适用 M 系列 Mac、macOS 14 及以上；Word 功能需要桌面版 Word for Mac。App、插件、字体资源和运行时已打包在一起，不用另外安装开发工具。

1. 保存文档，退出 Word 和 Equation Lab。
2. 双击安装包，按 macOS 安装器提示完成安装。
3. 重新打开 Word，新建或打开文档，点击顶部的 **Equation Lab**。

## 开始编辑

双击 Word 中的 MathType 公式，进入独立编辑窗口。左侧浏览和搜索文档公式，右侧调整样式、排版和编号。改好后点“更新公式”，保存回 Word 中的原位置。

要添加公式，在左侧顶部选择 Word 文档，再点底部“插入到 Word”，选择行内、居中、右侧编号或左侧编号。也可以从 Word 的 Equation Lab 功能区开始插入。写好后点“完成并插入”，App 会显示 Word 的保存结果；点“取消”返回原文档。

正在编辑已有公式时，新公式插在它所在段落之后；独立草稿使用所选文档在 Word 中的空光标位置。**文件 → 新建独立草稿**和**打开文件副本…**可用于单独写公式或编辑文件副本。

左侧文件名菜单列出 Word 打开的文档，并区分同名文件。切换前会提示处理未保存的草稿。菜单刷新更新文档列表；公式区刷新重新读取当前文档公式。长文档先打开当前公式，再分批补齐列表和缩略图，加载期间可继续输入和调整字号。

## 编号和引用

在 Word 正文中选中一个公式对象，点功能区的“右侧编号”或“左侧编号”，给它添加编号或移动编号位置。这项操作用于每段一个公式的普通正文段落；“独立编号”会在公式右侧添加编号。

在 App 的 **文档 → Word 编排** 中调整编号格式、章和节，点“更新公式”应用到当前公式；新公式在“完成并插入”时采用这些设置。格式也会用于后续新增编号。修改章或节会从当前公式重新起号，后面的公式沿用该设置，直到下一处章／节标记。

旧 MathType 公式的编号通过 Word 功能区调整。插入、删除或移动公式后，点“更新编号”重算公式序号和交叉引用。它也会更新旧 MathType 的 MTEqn、MTChap、MTSec 和 MTPlaceRef 中的相关字段。点“插入引用”后，可以在列表中搜索编号和附近文字，再选择目标。

## 检查和批量整理

在右侧 **文档 → 文档检查与批量处理** 中，可检查编号和引用，把当前公式的字体、字号、间距应用到文档副本，或按范围整理 Equation Lab 编号格式。

先查看预检结果，再点“另存应用后的副本…”。这些工具生成新文件；要使用修改后的文档，在 Word 中打开这个副本，检查排版并更新编号与引用。[详细用法](document-tools.md)

## Word 里没有显示 Equation Lab

先完全退出 Word。在 Equation Lab 的 **Office 插件**窗口中安装或修复插件，再重新打开 Word。程序会检测 Word 和它的实际 Startup 位置；如果移动过 Word 或更改过启动目录，重新修复一次。

如果系统要求选择 Office 文件夹，按窗口提示选择。安装前需要关闭 Word，窗口也会提示仍在运行的程序。

该面板还提供连接检查和“复制连接诊断”。诊断列出版本、组件状态、本地服务和最近操作阶段，便于随问题描述一起提供。

## 更新

默认每天检查一次，有新版时在工具栏显示更新按钮。在 **Equation Lab → 检查更新…** 中可随时手动检查、设置自动下载；下载完成后选择合适的时间安装。

安装包同时更新 App 和 Word 插件。保存文档并退出两个程序，安装完成后重新打开 Word，即可加载新组件。

## 安装报错

退出 Word 和 Equation Lab 后重试。仍失败时，请在安装器的 **窗口 → 安装器日志 → 显示所有日志** 中保存日志，在 [issue](https://github.com/Ne1ther/EquationLab/issues) 附上安装包名称、Mac 芯片、macOS 和 Word 版本。

---

# Installation and use

**[Download Equation Lab 0.6.11 (build99)](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.11/Equation-Lab-0.6.11.pkg)**

Use an Apple Silicon Mac with macOS 14 or later. Word integration requires desktop Word for Mac. The package includes the app, plugin, fonts, and runtime.

1. Save your documents and quit Word and Equation Lab.
2. Open the package and follow the macOS Installer.
3. Reopen Word, create or open a document, and choose the **Equation Lab** ribbon.

## Start editing

Double-click a MathType equation in Word to open its editor. Browse and search equations on the left, and adjust style, layout, and numbering on the right. Choose Update equation to save back in place.

To add an equation, choose a Word document at the top of the sidebar and use Insert into Word at the bottom. Pick inline, centered, right-numbered, or left-numbered placement. You can also start from the Word ribbon. Choose Finish and insert when ready; the app displays Word’s save result. Cancel returns to the original document.

While editing an existing equation, insertion goes after its paragraph. A standalone draft uses the selected document’s empty Word cursor. **File → New standalone draft** and **Open a file copy…** let you write independently or edit a file copy.

The filename menu lists open Word documents and distinguishes matching names. Switching prompts you to handle unsaved drafts. The menu refresh updates the document list; the formula-area refresh reloads the current document’s equations. Long documents open the current equation first and load the list and thumbnails in batches, so you can keep typing and adjusting sizes.

## Numbering and references

Select an equation object in Word and choose Right Number or Left Number to add a number or move it to that side. This action is for plain body paragraphs containing one equation each. Independent Number adds a right-side number.

Under **Document → Word layout** in the app, adjust the number format, chapter, and section, then choose Update equation. New equations use these settings at Finish and insert. The format also becomes the default for later numbered insertions. Changing the chapter or section restarts numbering at the current equation; later equations follow it until the next chapter/section marker.

Use the Word ribbon to adjust legacy MathType numbering. After inserting, deleting, or moving equations, choose Update Numbers to recalculate equation sequences and cross-references. This also updates legacy MTEqn, MTChap, MTSec, and related fields inside MTPlaceRef. Insert Reference opens a list you can search by number or nearby text.

## Check and organize a document

Under **Document → Document checks and batch tools**, check numbering and references, apply the current equation’s fonts, sizes, and spacing to a document copy, or choose a scope for Equation Lab number-format changes.

Review the preview, then choose Save changed copy. These tools create a new file. Open that copy in Word, check its layout, and update numbering and references to use the changes. [Read the full guide](document-tools.md)

## If the ribbon is missing

Quit Word completely. Install or repair the plugin from Equation Lab’s **Office plugin** window, then reopen Word. The app detects Word and its Startup folder. Run repair again if you moved Word or changed its startup location.

If prompted to choose an Office folder, follow the window’s instructions. The panel also provides a connection check and Copy connection diagnostics, which lists versions, component status, local service status, and recent operation stages for a problem report.

## Updates

The app checks daily by default and shows an update button for a newer version. Use **Equation Lab → Check for updates…** to check manually or set up automatic downloads. Install at a convenient time once the download finishes.

The installer updates both the app and Word plugin. Save your documents and quit both programs before installing, then reopen Word to load the new components.

## Installation errors

Quit Word and Equation Lab and retry. If installation still fails, save the log from **Installer → Window → Installer Log → Show All Logs**. Attach it to an [issue](https://github.com/Ne1ther/EquationLab/issues) with the package name, Mac chip, macOS version, and Word version.
