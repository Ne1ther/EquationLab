# 安装 Equation Lab 和 Word 插件

当前支持 Apple Silicon Mac、macOS 14 及以上，以及桌面版 Microsoft Word for Mac。

## 第一次安装

1. 在项目的 GitHub **Releases** 页面下载完整的 `Equation-Lab-版本号.pkg`。
2. 保存文档，退出 Word 和 Equation Lab。
3. 双击安装包，按 macOS 系统安装器提示完成安装。
4. 重新打开 Word，在顶部点击 **Equation Lab**。

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

## 当前预览包的 macOS 提示

项目通过 GitHub 分发，不通过 App Store。当前预览包尚未 Developer ID 签名及 Apple 公证，macOS 可能提示或阻止打开来自互联网的安装包或 App。请核对下载来自项目的 Releases 页面，并参考 [Apple 对下载软件的说明](https://support.apple.com/102445)；无需为了安装插件关闭系统安全保护。

签名、公证属于以后改善下载体验的选项，GitHub 仍可作为发布渠道。

Word仍会遵守自己的宏和外部库策略；受组织策略限制的机器可能不能加载插件。安装器不会自动修改这些安全设置。参考[Microsoft的Mac版Office宏策略说明](https://learn.microsoft.com/en-us/microsoft-365-apps/mac/set-preference-macro-security-office-for-mac)。

当前已核对完整PKG的默认插件安装脚本，并将包解到临时目录，用包内Node和依赖完成公式引擎运行检查。该检查不替代全新Mac的首次安装验收。完整的首次使用确认仍需在没有开发环境、没有既有Equation Lab配置的Mac上，从下载PKG开始完成安装、Word冷启动、公式编辑、保存和重开。

当前准备的安装包为0.5.5 build38，包含新的开放渲染资源，并保留 build37 的完整集合响应修复。详情见[版本说明](releases.md)和[当前功能](features.md)。此轮没有新增Word/Windows跨平台兼容结论；完整PKG在全新机器上的首次安装仍待实机验收。
