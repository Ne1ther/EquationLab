# 版本与下载

源码和界面预览放在本仓库。安装包在GitHub的 **Releases** 标签页单独发布，下载后按[安装说明](install.md)操作。

## 0.5.5 build38

[v0.5.5 build38](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5) 作为预览版（Pre-release）发布。完整安装包及校验文件位于该 Release 的附件中。

- 主下载：`Equation-Lab-0.5.5.pkg`，包含macOS App、Word插件、原生桥及本地后台服务。
- 附件：`SHA256SUMS.txt`，用于核对安装包下载内容。
- 支持：Apple Silicon、macOS 14及以上；Word集成需要桌面版Microsoft Word for Mac。
- 本版修复完整集合打开、关闭和切换分类时的主线程卡顿，保留全部目录、搜索及预览。
- 两份渲染资源改用 STIX 字形、项目自绘几何和 MathJax 间距规则，生成脚本与许可证随源码提供。
- 本地源码回归210项、公开导出测试129项和安装器测试23项通过；本轮未新增Word/Windows跨平台兼容结论。

当前采用ad-hoc应用签名，安装包未Developer ID签名及Apple公证；全新机器首次安装仍待实机验收。完整原版MathType功能等价尚未建立。

build38 已完成包内资源散列、应用签名、独立运行时及默认插件安装脚本检查；未在本机执行安装或修改现有 Word 插件。其他材料的来源审查见第三方声明，源码构建见[开发说明](development.md)。

安装包不提交到源码Git中；源码ZIP也不作为普通用户的安装入口。
