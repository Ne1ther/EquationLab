# 安装 Equation Lab 和 Word 插件

当前支持 Apple Silicon Mac、macOS 14 及以上，以及桌面版 Microsoft Word for Mac。

请使用 **0.5.7 或更新版本**。0.5.5、0.5.6 的完整安装脚本存在路径判断问题，可能显示安装成功却没有安装 Word 插件。已经遇到这个问题时，退出 Word 后重新安装新版完整 PKG。

Use **0.5.7 or later**. Earlier packages could report success while skipping the Word add-in installation script. Quit Word and reinstall the newer complete PKG if the ribbon is missing.

## 第一次安装

1. 在项目的 GitHub **Releases** 页面下载完整的 `Equation-Lab-版本号.pkg`。
2. 保存文档，退出 Word 和 Equation Lab。
3. 双击安装包，按 macOS 系统安装器提示完成安装。
4. 重新打开 Word，新建或打开一篇文档，在顶部点击 **Equation Lab**。

一个安装包会安装 App 和 Word 插件。无需下载源码、配置开发环境、执行终端命令、导入宏或选择插件目录。

完整PKG自带Node运行时、公式引擎依赖、字体辅助程序和STIX Two Math字体；使用者无需安装Node、npm、Swift、Xcode、Python或Homebrew。Word集成需要本机已有桌面版Word。导入文档所指定的其他特殊字体仍需本机可用。

Word插件默认随完整PKG安装到当前登录用户的Word启动目录，并设置本地后台服务；不是只复制App后再要求用户自行安装插件。安装完成后需要重新打开Word，插件才能加载。只复制App的开发版本不代表完整PKG安装流程。

首次安装可能需要系统管理员验证。这是 macOS 系统安装器的授权步骤，与 App Store 无关。

## 安装后管理插件

打开 Equation Lab，点击窗口工具栏的 **Office 插件**，也可以使用 Mac 顶部的 **Word** 菜单。

- **安装／更新 Word 插件**：已有登记的插件自动更新；首次使用时由 App 准备并打开系统安装包，之后复用本机缓存。
- **检查连接**：检查 Word 是否已加载插件。
- **移除**：打开插件卸载包，保留 Equation Lab App 和个人公式。

更新插件前请先保存文档并退出 Word。完成后重新打开 Word，即可继续使用固定顶栏。

## Word 里没有显示 Equation Lab

先新建或打开一篇文档。Word 的“新建和最近使用的文件”页面没有文档功能区。

安装前要用 **Word → 退出 Word**（⌘Q）完全退出，关掉文档窗口还不够。0.5.5 的安装包遇到仍在运行的 Word 会中止，但界面只显示笼统的“安装失败”。

在 Word 的 **工具 → 模板和加载项** 中找 `EquationLabStartup.dotm`，这里能看到是否加载，以及文件的完整路径。再看 **Word → 偏好设置 → 文件位置 → 启动**：如果这里指定了另一个文件夹，插件就可能装在 Word 不会读取的位置。单纯开启宏或反复点击“安装／更新”不会改变这个位置。

0.5.5 build38 会优先沿用旧安装记录，尚不能识别这个差异。如果不需要自定义启动目录，可以在 Word 中选中“启动”后点“重置”，完全退出 Word，再重开文档。这会让 Word 恢复读取默认启动目录；自定义目录中的其他插件也会停止自动加载，请先确认那里是否还有自己需要的模板。

从 0.5.6 build39 开始，插件窗口会自动查找 Word，显示版本和应用位置；如果没找到，也可以手动选择 Word。安装器会读取 Word 实际使用的启动目录。如果旧版装在另一位置，退出 Word 后点击“安装 / 更新 Word 插件”，会自动迁移自己的组件，保留其他加载项；迁移失败会恢复旧安装。新目录里有不属于当前安装的同名文件时，会停止并提示冲突。

如果 App 提示 macOS 不允许访问 Word 文件夹，点击 **允许访问 Word 文件夹**，在系统文件窗口中确认已经定位的 `UBF8T346G9.Office` 文件夹，再检查连接或更新。这个授权用于读取启动目录设置、管理本项目的插件文件，不会修改 Word 设置或其他加载项，也不需要开启完全磁盘访问。

**English:** Open a document first; the Word start screen has no ribbon. Quit Word with ⌘Q before installing. Under **Tools → Templates and Add-ins**, check whether `EquationLabStartup.dotm` is loaded and note its full path. Compare it with **Word → Preferences → File Locations → Startup**. Version 0.5.6 build39 detects Word and its actual Startup folder. If an older installation is in another folder, quit Word and click **Install / Update Word Plugin** to move the owned components automatically. Other add-ins are preserved, failures restore the old installation, and unowned filename conflicts stop the operation. The plugin window shows Word's version and application location and also offers manual selection.

If macOS blocks access to the Word folder, click **Allow access to the Word folder**, confirm the `UBF8T346G9.Office` folder shown in the system file dialog, then check the connection or update again. This allows reading the Startup setting and managing Equation Lab's own files. It does not change Word settings or other add-ins, and Full Disk Access is not required.

## 当前预览包的 macOS 提示

项目通过 GitHub 分发，不通过 App Store。当前预览包尚未 Developer ID 签名及 Apple 公证，macOS 可能提示或阻止打开来自互联网的安装包或 App。请核对下载来自项目的 Releases 页面，并参考 [Apple 对下载软件的说明](https://support.apple.com/102445)；无需为了安装插件关闭系统安全保护。

签名、公证属于以后改善下载体验的选项，GitHub 仍可作为发布渠道。

Word仍会遵守自己的宏和外部库策略；受组织策略限制的机器可能不能加载插件。安装器不会自动修改这些安全设置。参考[Microsoft的Mac版Office宏策略说明](https://learn.microsoft.com/en-us/microsoft-365-apps/mac/set-preference-macro-security-office-for-mac)。

当前已核对完整PKG的默认插件安装脚本，并将包解到临时目录，用包内Node和依赖完成公式引擎运行检查。该检查不替代全新Mac的首次安装验收。完整的首次使用确认仍需在没有开发环境、没有既有Equation Lab配置的Mac上，从下载PKG开始完成安装、Word冷启动、公式编辑、保存和重开。

0.5.7 已在本机移除旧 Word 插件、安装记录和后台服务后，通过系统安装器完成安装，再确认插件自动加载和公式保存重开。此项验证覆盖本机的完整 PKG 流程；没有旧开发环境的全新 Mac 仍待测试。

当前安装包为 0.5.8 build45，增加应用内[检查更新和自动下载](updates.md)，保留 0.5.7 的 Word 安装修复、Word 自动检测、启动目录修复和安装前关闭 Word 的系统提示。详情见[版本说明](releases.md)和[当前功能](features.md)。本轮未重跑系统安装器的完整 Word 流程；全新机器首次安装仍待实机验收。
