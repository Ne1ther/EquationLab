# 安装与使用

[下载 Equation Lab 0.6.5（build85）](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.5/Equation-Lab-0.6.5.pkg)

1. 保存文档，退出 Word 和 Equation Lab。
2. 双击安装包，按 macOS 安装器提示完成安装。
3. 重新打开 Word，新建或打开文档，点击顶部的 **Equation Lab**。

适用 M 系列 Mac、macOS 14 及以上；Word 功能需要桌面版 Word for Mac。App、插件、字体资源和运行时已打包在一起，不用另外安装开发工具。

双击公式进入独立编辑窗口；左边浏览当前文档的公式，右边调整样式、排版和编号预览。新公式点“完成并插入”，已有公式点“更新公式”；按钮在编辑模式选择栏的右侧。“取消”会保留 Word 原内容。插入后关闭窗口，从 Dock 重开会重新读取文档公式。插入时也能选择左侧已有公式；如果草稿已修改，会先询问是否放弃。

要给已有公式编号，先在 Word 正文普通段落中选中公式对象，再用功能区的“右侧编号”或“左侧编号”添加编号或移动已有编号；“独立编号”会给选中公式添加右侧编号。此操作适用于每段一个公式；表格、列表、修订或受保护内容暂不支持。操作后点“更新编号”，更新自动序号和交叉引用。编辑器中的编号格式和预览不会改写已有编号；保存编辑会保留原编号。使用 #C/#S 格式前，先在 Word 中设置章、节编号。

左侧文件名菜单列出 Word 当前打开的文档。同名文件按文档身份区分；只读项不可选。有未保存修改时，切换前会询问是否放弃。保存忙碌、保存结果未确定或 Word 状态未知时不能切换。切换 Word 当前文档后，干净的编辑器会自动跟随；有修改的草稿留在原文档。来源文档关闭后会清理其不可用公式列表，并保留草稿。菜单刷新更新文档列表和可用状态；公式区刷新重新读取当前文档公式，有未保存修改时会跳过并保留草稿。文档信息刷新本身不会重读公式。

## Word 里没有显示 Equation Lab

先完全退出 Word。在 Equation Lab 的 **Office 插件**窗口中安装或修复插件，再重新打开 Word。程序会检测 Word 和它的实际 Startup 位置；如果移动过 Word 或更改过启动目录，重新修复一次。

如果系统要求选择 Office 文件夹，按窗口提示选择。安装前需要关闭 Word，窗口也会提示仍在运行的程序。

## 更新

默认每天检查一次，有新版时在工具栏显示更新按钮。在 **Equation Lab → 检查更新…** 中可随时手动检查、设置自动下载；下载完成后选择合适的时间安装。

## 安装报错

退出 Word 和 Equation Lab 后重试。仍失败时，请在安装器的 **窗口 → 安装器日志 → 显示所有日志** 中保存日志，在 [issue](https://github.com/Ne1ther/EquationLab/issues) 附上安装包名称、Mac 芯片、macOS 和 Word 版本。

---

Save your documents and quit Word and Equation Lab, then open the [0.6.5 build85 installer](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.5/Equation-Lab-0.6.5.pkg). Reopen Word and find the Equation Lab ribbon. The package includes the app, plugin, and runtime; desktop Word is required for Word integration. Use Done and Insert for a new equation, Update Equation for an existing one, or Cancel to keep Word unchanged. These buttons share a row with the editing mode controls. To number an existing equation, select its object in a plain body paragraph and choose Right Number or Left Number to add or move its number; Independent Number adds a right-side number. This supports one equation per paragraph and excludes tables, lists, tracked changes, and protected content. Choose Update Numbers after inserting, deleting, or moving numbers to refresh sequence numbers and REF cross-references. The editor's numbering preview does not change existing Word numbers, and saving an edit preserves the existing number. Set up chapter and section numbering in Word before using #C/#S formats. Reopening from the Dock refreshes the document list. The filename menu lists open Word documents and distinguishes them by identity; read-only choices are disabled. A changed draft prompts before switching. Switching is unavailable while saving, when the save result is unknown, or when Word's state is unavailable. A clean editor follows the active Word document; a changed draft stays with its original document. Closing the source document clears its unavailable formula list and keeps the draft. The menu refresh updates document metadata; the formula refresh rereads the current document's equations but skips the refresh when the draft has unsaved changes. If the ribbon is missing, quit Word, repair the plugin from the app's Office plugin window, and reopen Word. For an installation error, attach the Installer log and version details to an issue.
