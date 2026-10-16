<p align="center">
  <img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab 图标">
</p>

<h1 align="center">Equation Lab</h1>

<p align="center">Mac 上的公式编辑器。可视化编辑、LaTeX 输入，以及 Word 中的 MathType 公式编辑。</p>

<p align="center">
  中文 · <a href="README.en.md">English</a> · <a href="docs/preview/README.md">界面图库</a> · <a href="https://github.com/Ne1ther/EquationLab/issues">反馈问题</a>
</p>

## [下载 Mac 完整安装包](https://github.com/Ne1ther/EquationLab/releases/download/v0.5.5/Equation-Lab-0.5.5.pkg)

**[Equation-Lab-0.5.5.pkg · 约 80 MB](https://github.com/Ne1ther/EquationLab/releases/download/v0.5.5/Equation-Lab-0.5.5.pkg)**

支持 **Apple Silicon（M 系列芯片）和 macOS 14+**，当前为 **0.5.5 build38 兼容性预览版**。

一个安装包包含 App、公式引擎和 Word 插件，**默认安装 Word 插件**。使用者无需下载源码或配置 Node、Python、Xcode 等开发环境。安装前保存文档并退出 Word，安装后重新打开 Word，使用 **Equation Lab** 顶部功能区。

[安装说明](docs/install.md) · [发布说明与校验文件](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5) · [所有版本](https://github.com/Ne1ther/EquationLab/releases)

当前安装包尚未 Apple 公证，macOS 可能提示或阻止打开，具体见安装说明。Word 集成需要桌面版 Word for Mac；独立公式编辑不需要 Word。

## 编辑公式，同时看排版和源码

![Equation Lab build38 工作台：公式、Word 排版预览与 LaTeX 源码](docs/preview/workbench.png)

在画布里编辑公式，也可以直接修改 LaTeX。下方并排显示 Word 字体排版预览和源码，右侧设置字体、字号与样式。

- **公式结构**：分式、根号、上下标、括号、积分、求和、矩阵和多行。
- **字母和符号**：分类浏览，按名称、符号或命令搜索，点选插入。
- **排版设置**：字体、字号、上下标、矩阵间距、标尺与制表位，支持 EQP 偏好导入导出。
- **Word 集成**：原生公式编辑与回存、编号和引用；App 内可管理插件。
- **导出与界面**：SVG、PDF、PNG 导出，中英文界面。

[查看完整功能范围](docs/features.md)

## 模板和字母，不用都靠背命令

![可分类和搜索的公式结构库](docs/preview/template-library.png)

结构库按分式、根式、上下标和括号等分类；字母库提供希腊字母、拉丁字母与字形变体。

![可搜索的字母库](docs/preview/letter-library.png)

## 矩阵与 Word 插件

<table>
  <tr>
    <th>自己设置矩阵</th>
    <th>在 App 里管理插件</th>
  </tr>
  <tr>
    <td><img src="docs/preview/matrix-builder.png" alt="矩阵行数、列数、括号、对齐和增广矩阵设置" width="460"></td>
    <td><img src="docs/preview/word-plugin.png" alt="Word 插件的安装、更新、连接检查和移除入口" width="460"></td>
  </tr>
  <tr>
    <td>选择行列数、括号和对齐方式，也可以设置增广矩阵。</td>
    <td>完整 PKG 默认安装插件；安装后可在这里检查连接、更新或移除。</td>
  </tr>
</table>

以上均为实际 App 截图。[打开全部 7 张界面截图](docs/preview/README.md)，包括排版设置和开放渲染资源的源码构建预览。图库中的单个示例不代表所有公式均已通过兼容验证。

## 从源码编译

需要 Apple Silicon、macOS 14+、带 Swift 6 的 Xcode Command Line Tools，以及 Node 和 npm。

```sh
npm ci
swift build
npm test
./scripts/build_and_run.sh --build-only
```

开发 App 输出到 `dist/EquationLab.app`，使用开发者本机的 Node。供普通用户下载的完整安装包自带运行时和依赖。

两份渲染资源随源码提供，使用随附的 STIX Two Math 字体、项目几何图形和 MathJax TeX 间距规则。生成器和许可证均已包含，可用 `node scripts/build/build-rendering-resources.mjs` 重建。

公开源码的 129 项测试已通过；10 个依赖本地原版资料和 Word 研究样本的测试未纳入公开源码。完整 Word 安装包的构建还需要经 Word 编译及宿主验证的加载器产物，桥接与 VBA 源码已提供。[开发说明](docs/development.md) · [打包说明](packaging/README.md)

## 源码目录

| 路径 | 内容 |
| --- | --- |
| `macos/` | SwiftUI / AppKit 原生界面 |
| `desktop/` | 内嵌公式编辑器 |
| `src/` | 公式、文档与渲染引擎 |
| `native-word-probe/` | Word 桥接与加载器源码 |
| `scripts/`、`packaging/` | 构建、资源生成与安装包 |
| `tests/` | 公开测试 |
| `design/equation-lab-icons/` | 应用图标和各尺寸资源 |
| `docs/preview/` | 实际界面截图 |

源码和精选展示放在仓库，**完整安装包放在同一仓库的 [Releases](https://github.com/Ne1ther/EquationLab/releases)**。REA 档案、原版材料、私人 Word 样本、机器配置、自动检查点、依赖目录和构建缓存保留在本地。

## 兼容范围与许可证

当前仍是兼容性预览。完整 MathType 功能等价、全部公式的 Windows / Mac 往返和所有 Word 版本尚未验证；Excel、PowerPoint 集成暂未提供。旧文档引用的特殊字体仍需本机可用。全新 Mac 首次安装尚待实机验收。

原创代码和美术资源使用 [MIT](LICENSE)。第三方软件、字体和产品标识保留各自条款；[第三方材料与来源记录](THIRD_PARTY_NOTICES.md)列出了具体情况及保留的空公式协议样本。Equation Lab 是独立项目。
