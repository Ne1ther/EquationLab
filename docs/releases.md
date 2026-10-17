# 版本与下载

源码和界面预览放在本仓库。安装包在GitHub的 **Releases** 标签页单独发布，下载后按[安装说明](install.md)操作。

## 0.5.6 build39

这版主要修 Word 安装后不显示插件的问题。

[下载完整安装包及校验文件](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.6)。支持 M 系列 Mac、macOS 14+，Word 集成需要桌面版 Word for Mac。

- 自动查找桌面版 Word，显示版本和位置；没有识别到时可以手动选择。
- 读取 Word 真正使用的启动目录。旧组件装在其他位置时，安装或更新会自动迁移自己的组件，保留其他加载项。
- 迁移失败会恢复旧安装；遇到其他来源的同名文件会停止，避免覆盖。
- macOS 阻止访问 Word 文件夹时，显示具体原因，并提供系统文件窗口授权入口。
- 安装器在开始前明确提示关闭 Word 和 Equation Lab，并可正常退出它们后继续安装。
- App、公式引擎、基础字体、Word 启动模板、原生桥和后台服务都在同一个 PKG 中，不需要用户另外安装开发工具。

215 项主测试、37 项安装器相关测试通过；独立导出的源码编译及 134 项测试通过。两组测试有重叠，不合并计算总数。新 PKG 解包后，在禁止访问项目源码、本机 Node/Python 且断网的环境中，成功生成原生公式、SVG 和 PNG。

本机 M3 Max、macOS 27.2、Word 16.114 已实测：新包中的 App 自动识别 Word；系统文件窗口授权后，插件能自动迁移到 Word 的自定义启动目录，再迁回默认目录；Word 冷启动加载顶栏，公式可以保存、重开和继续编辑，Zotero 文件未改变。

这次使用 PKG 中的原始 App 和当前用户安装接口完成插件测试。系统安装器的“关闭应用程序”提示已验证，管理员验证后的完整 PKG 安装流程仍未完成。

仍是未做 Developer ID 签名和 Apple 公证的预览版；全新 Mac、其他 Word 版本和 Windows 往返不在这次验证范围内。

## 0.5.5 build38

[v0.5.5 build38](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5) 作为预览版发布。完整安装包及校验文件位于该 Release 的附件中。

- 主下载：`Equation-Lab-0.5.5.pkg`，包含macOS App、Word插件、原生桥及本地后台服务。
- 附件：`SHA256SUMS.txt`，用于核对安装包下载内容。
- 支持：Apple Silicon、macOS 14及以上；Word集成需要桌面版Microsoft Word for Mac。
- 本版修复完整集合打开、关闭和切换分类时的主线程卡顿，保留全部目录、搜索及预览。
- 两份渲染资源改用 STIX 字形、项目自绘几何和 MathJax 间距规则，生成脚本与许可证随源码提供。
- 本地源码回归210项、公开导出测试129项和安装器测试23项通过；本轮未新增Word/Windows跨平台兼容结论。

当前采用ad-hoc应用签名，安装包未Developer ID签名及Apple公证；全新机器首次安装仍待实机验收。完整原版MathType功能等价尚未建立。

build38 已完成包内资源散列、应用签名、独立运行时及默认插件安装脚本检查；未在本机执行安装或修改现有 Word 插件。其他材料的来源审查见第三方声明，源码构建见[开发说明](development.md)。

安装包不提交到源码Git中；源码ZIP也不作为普通用户的安装入口。
