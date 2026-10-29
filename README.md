<p align="center"><img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab"></p>
<h1 align="center">Equation Lab</h1>

做这个项目，是想在 Mac 的 Word 里继续编辑 MathType 公式。也能单独打开，用模板或 LaTeX 写公式。

[English](README.en.md)

**[下载 0.6.10 安装包（build98）](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.10/Equation-Lab-0.6.10.pkg)** · [版本记录](https://github.com/Ne1ther/EquationLab/releases) · [使用说明](docs/install.md)

适用 M 系列 Mac、macOS 14 及以上。安装包自带 App、Word 插件和运行时，不用另装 Node、Python 或 MathType。Word 功能需要桌面版 Word for Mac。

保存文档，退出 Word 和 Equation Lab，再双击安装包。装好后重开 Word，顶部就有 **Equation Lab**。双击公式进入独立编辑窗口，保存后回到原位置。

## 能做什么

- 选择 Word 文档，浏览、搜索、插入和编辑其中的 MathType 公式。
- 用模板或 LaTeX 输入，支持多行、分段和矩阵，调整字体、字号和间距。
- 设置公式编号、章和节，用可搜索的列表插入交叉引用。
- 检查文档编号与引用，预览批量样式和编号修改，再另存 Word 副本。
- 保存后续公式的文档样式预设，导出 PDF、SVG、PNG，复制 LaTeX。

在左侧顶部选好文档，点底部“插入到 Word”，就能选择行内、居中或左右编号。正在编辑已有公式时，新公式放在它所在段落之后；独立草稿则用该文档在 Word 中的空光标位置，内容和排版设置一起带入。点“完成并插入”后，App 会显示 Word 返回的保存结果。

左侧菜单列出 Word 打开的文档，也能区分同名文件。切换前会提示处理未保存的草稿。长文档先打开当前公式，其余列表分批载入；缩略图随浏览逐项补齐和更新，当前公式会自动滚动到可见位置。

在右侧 **文档 → Word 编排** 调整编号格式、章和节，再点“更新公式”应用到当前公式，并作为后续新增编号的默认设置。要集中整理已有编号，打开 **文档检查与批量处理**，选择当前公式、全部已有编号或仅后续新增公式，预览后保存副本。旧 MathType 公式的编号在 Word 功能区中调整；“更新编号”会重算公式序号和交叉引用。

同一面板还能搜索编号和引用、查看断开的引用，并把当前公式的字体、字号和间距应用到文档副本。副本工具会列出修改结果；保存后在 Word 中打开新文件，更新编号与引用即可继续编辑。[查看文档工具用法](docs/document-tools.md)

默认每天检查一次更新，有新版时会在工具栏显示更新按钮。也可在 **Equation Lab → 检查更新…** 中手动检查、设置自动下载。连接遇到问题时，可在 **Office 插件**面板检查状态并复制连接诊断。

![Equation Lab 工作台](docs/preview/workbench-0.6.10.png)

## 试一份文档

[下载 30 公式 Word 演示](docs/examples/equation-lab-30-formulas.docx) · [查看 PDF](docs/examples/equation-lab-30-formulas.pdf)

三节，每节十个公式，正文宋体小四。有根式、求和、积分、矩阵、编号和交叉引用，打开就能试。

![30 公式演示](docs/preview/word-30-formulas.png)

[更多实际截图](docs/preview/README.md) · [公式、字体和间距](docs/features.md)

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
