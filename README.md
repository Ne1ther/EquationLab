<p align="center"><img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab"></p>
<h1 align="center">Equation Lab</h1>

做这个项目，是想在 Mac 的 Word 里继续编辑 MathType 公式。也可以单独打开编辑器，用模板输入，或者直接写 LaTeX。

[English](README.en.md)

**[下载 0.6.0 安装包](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.0/Equation-Lab-0.6.0.pkg)** · [版本记录](https://github.com/Ne1ther/EquationLab/releases) · [使用说明](docs/install.md)

适用于 M 系列 Mac、macOS 14 及以上。安装包包含 App、Word 插件和运行所需组件，不用另外装 Node、Python 或 MathType。在 Word 里使用时，需要已有桌面版 Word for Mac。

保存文档，退出 Word 和 Equation Lab，再双击安装包。装好后重新打开 Word，从顶部的 **Equation Lab** 功能区开始使用。双击公式可以继续编辑，保存后回到原来的位置。

## 平时怎么用

- 打开 Word 文档，左边查看、搜索文档里的 MathType 公式。
- 用模板或 LaTeX 编辑，调整字体、字号、符号和间距。
- 选行内、居中或带编号的排版；编号有常用格式，也能自己输入，并实时预览。
- 用 Word 的编号和交叉引用，导出公式的 PDF、SVG、PNG，或复制 LaTeX。
- 在 **Equation Lab → 检查更新…** 里检查新版，也可以开启每日检查和自动下载。

![Equation Lab 工作台](docs/preview/workbench-0.6.0.png)

## 试一份文档

[下载 30 公式 Word 演示](docs/examples/equation-lab-30-formulas.docx) · [查看 PDF](docs/examples/equation-lab-30-formulas.pdf)

三节，每节十个公式，正文宋体小四。包括根式、求和、积分、矩阵、编号和交叉引用，可以直接打开、双击编辑。

![30 公式演示](docs/preview/word-30-formulas.png)

[更多实际截图](docs/preview/README.md) · [字体和间距](docs/features.md)

## 目录怎么放

| 目录 | 内容 |
| --- | --- |
| [macos/](macos/) | Mac 原生窗口、侧栏、检查器和系统菜单 |
| [desktop/](desktop/) | 公式编辑画布和前端交互 |
| [src/](src/) | 公式数据、渲染、Word 文档读写和本地通信 |
| [native-word-probe/](native-word-probe/) | Word 功能区、文档事件和原生公式组件 |
| [font-metrics/](font-metrics/) | 字体轮廓、图片及 PDF 渲染工具 |
| [updater/](updater/) | 自动更新与下载校验 |
| [assets/](assets/) · [design/](design/) | 字体、资源许可、图标和模板预览 |
| [packaging/](packaging/) · [scripts/](scripts/) | 编译、安装器和发布脚本 |
| [tests/](tests/) | 公式、文档、界面交互和安装器测试 |
| [docs/](docs/) | 使用说明、实际截图和公开演示 |

[主要文件逐项说明](docs/file-guide.md)。安装包放在 [Releases](https://github.com/Ne1ther/EquationLab/releases)，不放进源码目录。

## 自己编译

需要 Node.js 24 和 Swift 6.2 / Xcode 命令行工具。

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

[开发说明](docs/development.md) · [打包说明](packaging/README.md)

遇到问题欢迎[提 issue](https://github.com/Ne1ther/EquationLab/issues)，带上版本、公式和复现步骤，我会更容易找到问题。

源码使用 [MIT 许可](LICENSE)，所用资源见 [第三方说明](THIRD_PARTY_NOTICES.md)。
