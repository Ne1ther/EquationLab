<p align="center"><img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab"></p>
<h1 align="center">Equation Lab</h1>

做这个项目，是想在 Mac 的 Word 里继续编辑 MathType 公式。也能单独打开，用模板或 LaTeX 写公式。

[English](README.en.md)

**[下载 0.6.5 安装包（build84）](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.5/Equation-Lab-0.6.5.pkg)** · [版本记录](https://github.com/Ne1ther/EquationLab/releases) · [使用说明](docs/install.md)

适用 M 系列 Mac、macOS 14 及以上。安装包自带 App、Word 插件和运行时，不用另装 Node、Python 或 MathType。Word 功能需要桌面版 Word for Mac。

保存文档，退出 Word 和 Equation Lab，再双击安装包。装好后重开 Word，顶部就有 **Equation Lab**。双击公式进入独立编辑窗口，保存后回到原位置。

## 能做什么

- 浏览、搜索文档里的 MathType 公式，编辑后保存回 Word。
- 用模板或 LaTeX 输入，支持多行、分段和矩阵，调整字体、字号和间距。
- 公式编号、交叉引用，编号格式预设、自定义和预览。
- 导出 PDF、SVG、PNG，复制 LaTeX。

新公式从空白画布开始，点“完成并插入”才写入 Word；已有公式用“更新公式”。提交按钮和“取消”位于“编辑公式结构 / 保留结构 · 替换字符”同一行的右侧。插入后关闭窗口，从 Dock 重开会刷新文档公式；插入时也能选择左侧已有公式，有未保存草稿会先提示。

左侧菜单列出 Word 打开的文档，并按文档身份区分同名文件。切换会保护未保存草稿，后台更新文档信息不会把窗口抢到前台。刷新文档菜单只更新文档信息；公式区刷新才会重读公式。

默认每天检查一次更新，有新版时会在工具栏显示更新按钮。也可在 **Equation Lab → 检查更新…** 中手动检查、设置自动下载。

![Equation Lab 工作台](docs/preview/workbench-0.6.5.png)

## 试一份文档

[下载 30 公式 Word 演示](docs/examples/equation-lab-30-formulas.docx) · [查看 PDF](docs/examples/equation-lab-30-formulas.pdf)

三节，每节十个公式，正文宋体小四。有根式、求和、积分、矩阵、编号和交叉引用，打开就能试。

![30 公式演示](docs/preview/word-30-formulas.png)

[更多实际截图](docs/preview/README.md) · [字体和间距](docs/features.md)

## 自己编译

需要 Node.js 24 和 Swift 6.2 / Xcode 命令行工具。

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

[开发说明](docs/development.md) · [目录和文件说明](docs/file-guide.md) · [打包说明](packaging/README.md)

遇到问题可以[提 issue](https://github.com/Ne1ther/EquationLab/issues)，带上版本、公式或复现步骤。

源码使用 [MIT 许可](LICENSE)，所用资源见 [第三方说明](THIRD_PARTY_NOTICES.md)。
