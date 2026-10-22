# 安装与使用

[下载 Equation Lab 0.6.4](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.4/Equation-Lab-0.6.4.pkg)

1. 保存文档，退出 Word 和 Equation Lab。
2. 双击安装包，按 macOS 安装器提示完成安装。
3. 重新打开 Word，新建或打开文档，点击顶部的 **Equation Lab**。

适用 M 系列 Mac、macOS 14 及以上；Word 功能需要桌面版 Word for Mac。App、插件、字体资源和运行时已打包在一起，不用另外安装开发工具。

双击公式进入独立编辑窗口；左边浏览当前文档的公式，右边调整样式、排版和编号。新公式点“完成并插入”，已有公式点“更新公式”；按钮在编辑模式选择栏的右侧。“取消”会保留 Word 原内容。插入后关闭窗口，从 Dock 重开会重新读取文档公式。插入时也能选择左侧已有公式；如果草稿已修改，会先询问是否放弃。

## Word 里没有显示 Equation Lab

先完全退出 Word。在 Equation Lab 的 **Office 插件**窗口中安装或修复插件，再重新打开 Word。程序会检测 Word 和它的实际 Startup 位置；如果移动过 Word 或更改过启动目录，重新修复一次。

如果系统要求选择 Office 文件夹，按窗口提示选择。安装前需要关闭 Word，窗口也会提示仍在运行的程序。

## 更新

默认每天检查一次，有新版时在工具栏显示更新按钮。在 **Equation Lab → 检查更新…** 中可随时手动检查、设置自动下载；下载完成后选择合适的时间安装。

## 安装报错

退出 Word 和 Equation Lab 后重试。仍失败时，请在安装器的 **窗口 → 安装器日志 → 显示所有日志** 中保存日志，在 [issue](https://github.com/Ne1ther/EquationLab/issues) 附上安装包名称、Mac 芯片、macOS 和 Word 版本。

---

Save your documents and quit Word and Equation Lab, then open the [0.6.4 installer](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.4/Equation-Lab-0.6.4.pkg). Reopen Word and find the Equation Lab ribbon. The package includes the app, plugin, and runtime; desktop Word is required for Word integration. Use Done and Insert for a new equation, Update Equation for an existing one, or Cancel to keep Word unchanged. These buttons share a row with the editing mode controls. Reopening from the Dock refreshes the document list. Selecting an existing equation during insertion prompts before discarding a changed draft. If the ribbon is missing, quit Word, repair the plugin from the app's Office plugin window, and reopen Word. For an installation error, attach the Installer log and version details to an issue.
