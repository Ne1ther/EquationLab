<p align="center">
  <img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab">
</p>

<h1 align="center">Equation Lab</h1>

做这个项目，主要是想在 Mac 的 Word 里继续编辑 MathType 公式。编辑器也能单独用，可以点模板输入，也可以直接写 LaTeX。

还在慢慢做，目前是预览版。有需要可以试试，哪里不好用，欢迎[提个 issue](https://github.com/Ne1ther/EquationLab/issues)。如果能附上公式和复现步骤，会更方便我排查。

[English](README.en.md)

## 下载

**[下载 Equation-Lab-0.5.5.pkg（约 80 MB）](https://github.com/Ne1ther/EquationLab/releases/download/v0.5.5/Equation-Lab-0.5.5.pkg)**

目前支持 **M 系列芯片的 Mac，macOS 14 及以上**。安装包里带了 App 和 Word 插件，插件默认安装，不用另外装 Node、Python 或其他开发工具。要在 Word 里用，需要电脑上已有桌面版 Word for Mac。

安装前保存文档，退出 Word。装好后重新打开 Word，就能从顶部的 **Equation Lab** 功能区使用。

这个包还没有做 Apple 开发者签名和公证，macOS 可能会拦截。[安装说明](docs/install.md)里写了具体情况，[Release 页面](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5)里有版本说明和校验文件。

## 现在能做什么

- 在画布里编辑公式，或者直接改 LaTeX，同时看 Word 字体排版的预览。
- 插入分式、根号、积分、求和、矩阵、字母和符号，也能搜索模板。
- 调整字体、字号和间距，导出 SVG、PDF、PNG。
- 在 Word 中编辑、回存 MathType 公式，添加编号和引用。

界面可以切换中文和英文。更详细的功能放在[这里](docs/features.md)。

## 界面

这是实际运行的工作台，下面同时显示排版预览和 LaTeX。

![Equation Lab 工作台](docs/preview/workbench.png)

模板和字母可以按分类找，也可以搜索。

![模板库](docs/preview/template-library.png)

![字母库](docs/preview/letter-library.png)

矩阵和 Word 插件的设置窗口：

<table>
  <tr><th>矩阵</th><th>Word 插件</th></tr>
  <tr>
    <td><img src="docs/preview/matrix-builder.png" width="460" alt="自定义矩阵"></td>
    <td><img src="docs/preview/word-plugin.png" width="460" alt="Word 插件管理"></td>
  </tr>
</table>

[全部 7 张截图在这里](docs/preview/README.md)，也放了排版设置和渲染示例。

## 自己编译

需要 M 系列 Mac、macOS 14+、Swift 6 的命令行工具，以及 Node 和 npm。

```sh
npm ci
swift build
npm test
./scripts/build_and_run.sh --build-only
```

App 会生成在 `dist/EquationLab.app`。开发版使用本机的 Node，下载的完整安装包则自带运行时。

[开发说明](docs/development.md)里有源码和依赖的介绍。如果要自己制作带 Word 插件的完整安装包，还需要 Word 编译过的加载器，具体看[打包说明](packaging/README.md)。

## 还有哪些限制

目前只接了 Word for Mac，还没有 Excel 和 PowerPoint 集成。MathType 的功能和跨平台兼容还在补，不能保证所有公式、所有 Word 版本都正常。旧文档用到的特殊字体，也需要电脑上有。

完整安装包还没在全新 Mac 上走完首次安装测试。遇到问题请先保留原文档，方便复现和排查。

## 许可证

原创代码和图标使用 [MIT](LICENSE)。第三方软件、字体、产品标识和空公式协议样本的来源见[第三方声明](THIRD_PARTY_NOTICES.md)。这是独立项目，与 Microsoft、MathType 官方无关。
