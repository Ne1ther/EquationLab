# 文件说明 / File guide

按功能找代码，可以从这些文件看起。

## 根目录 / Root

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `README.md / README.en.md` | 项目首页、安装包入口、截图和快速开始 / Overview and quick start |
| `Package.swift` | 原生 App、更新工具和 Swift 测试的构建配置 / Swift targets |
| `package.json / package-lock.json` | JavaScript 依赖及锁定版本 / JavaScript dependencies |
| `AGENTS.md` | 项目维护规则 / Maintenance rules |
| `.gitignore` | 本地材料、私钥和可重建目录的排除规则 / Local-only and generated files |
| `LICENSE / THIRD_PARTY_NOTICES.md` | 源码许可和第三方资源说明 / Licenses and resource notices |

## 公式引擎 / Equation engine

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `src/new-formula.mjs` | 创建带默认字体与结构的原生公式 / New native equations |
| `src/native.mjs` | 读取、修改和写回 Equation Native 数据 / Native equation data |
| `src/native-layout.mjs` | 原生结构到渲染布局的转换 / Native layout conversion |
| `src/radical-contour.mjs` | 根号的连续矢量轮廓 / Radical vector outlines |
| `src/native-dimensions.mjs` | 字号和距离的单位换算 / Native dimensions |
| `src/font-renderer.mjs` | 使用实际字体轮廓生成预览 / Font-based previews |
| `src/vector-pdf.mjs` | 矢量路径、裁切和 PDF 输出 / Vector export |
| `src/integral-templates.mjs` | 伸缩积分的原生轮廓模板 / Integral outlines |
| `src/typography-native.mjs` | 字体、字号、间距和相关原生设置 / Typography settings |
| `src/document.mjs` | DOCX、嵌入公式、图片和文档编排 / Word documents |
| `src/layout.mjs` | 公式位置、编号样式和引用域 / Equation placement and numbering |
| `src/word-numbering.mjs` | 从 Word 文档读取章、节、编号和引用详情 / Document numbering context |
| `src/word-native-session.mjs` | Word 编辑与空白插入会话、回存确认、取消和公式切换 / Word edit and insertion sessions |
| `src/desktop-rpc.mjs` | 原生 App 与引擎之间的命令接口 / App-to-engine commands |
| `src/app-services.mjs / src/server.mjs` | 本机后台服务和 Word 通信 / Local services |
| `src/cli.mjs / src/cli-entry.mjs` | 命令行入口与路径识别 / CLI entry points |
| `src/eqp.mjs` | 公式偏好文件的读写 / Preference files |
| `src/version.mjs` | 引擎版本 / Engine version |
| `src/*-catalog.json` | 符号、字母和模板目录 / Catalog data |
| `src/native-template-pieces.json / src/native-spacing-tables.json` | 原生结构和间距数据 / Native template data |
| `src/resources/ole-template.json` | 新建嵌入公式使用的基础对象 / Embedded equation base |

## Mac 界面 / Native app

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `macos/App/EquationLabApp.swift` | App 入口、窗口和菜单命令 / App entry and commands |
| `macos/Models/WorkbenchState.swift` | 侧栏、检查器和编辑器的共享状态 / Workbench state |
| `macos/Models/InterfaceLanguage.swift` | 界面语言和翻译 / Interface language |
| `macos/Services/DesktopBridge.swift` | 画布桥接、窗口复用和返回 Word / Canvas and Word handoff |
| `macos/Services/WordFocusHandoff.swift` | 编辑器与 Word 之间的前台交接 / Cooperative focus handoff |
| `macos/Services/EquationEngine.swift` | 启动和调用打包引擎 / Engine process |
| `macos/Services/WordHostInstallation.swift / macos/Services/WordPluginInstallation.swift` | Word 检测、插件安装、修复及连接检查 / Word installation |
| `macos/Services/AppUpdater.swift` | 检查新版、下载和打开安装器 / Update UI and downloads |
| `macos/Views/` | 编辑窗口、侧栏、工具栏和各类检查器 / App views |
| `macos/Views/NumberingFormatEditor.swift` | 编号预设、自定义格式、预览和文档详情 / Number format editor |
| `desktop/app.js` | 公式编辑、Word 会话和界面交互 / Editor behavior |
| `desktop/index.html / desktop/style.css / desktop/native.css` | 画布页面、基础样式与原生窗口样式 / Canvas markup and styles |
| `desktop/editable-macros.js / desktop/catalog-macros.js` | 模板结构与可编辑参数的适配 / Editable template adapters |
| `desktop/editor-viewport.js` | 公式画布的缩放与视口 / Editor viewport |
| `desktop/radical-rendering.js` | 编辑区根号的绘制适配 / Editor radical rendering |
| `desktop/preferences.js / desktop/localization.js` | 偏好设置与画布翻译 / Preferences and localization |
| `font-metrics/main.swift` | CoreText 字体轮廓与图形输出 / Font and graphics helper |

## Word 插件 / Word integration

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `native-word-probe/automatic-loader/EquationLabDynamicStartupLoader.bas` | 在 Word Startup 位置加载自带原生组件 / Native component loading |
| `native-word-probe/automatic-loader/EquationLabEntryPoints.bas` | 自动启动和文档事件初始化 / Startup entry points |
| `native-word-probe/automatic-loader/EquationLabDocumentContext.bas` | 整篇公式捕获、字段选区定位、单次激活、插入和后台保存 / Document capture, field selection, single activation, insertion and background saves |
| `native-word-probe/automatic-loader/EquationLabWordEvents.cls` | Word 文档、窗口和选择事件 / Word events |
| `native-word-probe/automatic-loader/EquationLabRibbon.bas` | 插入、编辑、编号、引用等功能区命令 / Ribbon commands |
| `native-word-probe/src/` | 原生 OLE 对象、编辑通信及宿主检查 / Native Word component |
| `native-word-probe/src/word_insertion.mm` | 新公式片段的交付、插入结果确认和重试 / New equation delivery and acknowledgements |
| `native-word-probe/Info.plist` | 原生 Word 组件的版本与基本信息 / Component metadata |
| `word-ribbon/` | 原生 Word 功能区命令元数据与图标 / Native Word Ribbon metadata and icons |

## 构建与发布 / Build and release

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `scripts/build_and_run.sh` | 构建开发 App；`--word-test` 用免管理员密码的完整副本联调 Word / Development app and user-scoped Word testing |
| `scripts/build/word-test.mjs` | 组装、部署和核对本地 Word 测试副本 / Local Word test bundle and deployment checks |
| `scripts/package_release.sh` | 构建独立 App 和完整安装包 / Release entry point |
| `scripts/build/build-word-demo.mjs` | 生成公开的 30 公式演示 / Demo generator |
| `scripts/build/` | 生成模板预览、渲染资源和演示文档 / Build-time resources |
| `packaging/release.json / packaging/update-notes.json` | 发布版本、构建号和中英文更新内容 / Release settings and notes |
| `packaging/build-release.mjs` | 组装 App、运行时、依赖和 PKG / App and package builder |
| `packaging/mathlive-editor.mjs` | 校验 MathLive 版本并构建编辑区适配 / Pinned editor build |
| `packaging/word-native-installer/` | 原生插件产物校验、安装、修复与卸载 / Plugin installer |
| `packaging/word-service.mjs` | 用户后台服务的安装与管理 / User background service |
| `packaging/workbench-assets.mjs` | 复制画布、字体、图标和预览资源 / Workbench assets |
| `packaging/export-source.mjs` | 按发布清单导出源码 / Source export |
| `packaging/source-README*.md.in` | 与首页同步的源码导出说明 / Export README templates |
| `packaging/update-manifest.mjs` | 生成更新元数据和安装包校验信息 / Update metadata |
| `updater/UpdateManifest.swift / updater/UpdateTrust.swift` | 更新数据解析与公开验证密钥 / Update verification |
| `tests/` | 引擎、文档、编辑状态和通信测试 / Regression tests |

## 资源与说明 / Resources and docs

| 文件或目录 / Path | 做什么 / Purpose |
| --- | --- |
| `assets/fonts/ / assets/licenses/` | 随包字体及许可 / Bundled fonts and licenses |
| `design/equation-lab-icons/` | App 图标源文件与各分辨率导出 / App icon assets |
| `design/office-product-icons/` | Office 产品图标及来源记录 / Office product icons |
| `design/workbench-concepts/` | 工作台使用的品牌图形 / Workbench identity assets |
| `scripts/build/build-template-previews.mjs` | 构建时生成模板预览；生成目录不进 Git / Generates previews during builds |
| `docs/install.md / docs/features.md` | 安装、使用、编号及间距设置 / User guides |
| `docs/development.md / packaging/README.md` | 编译、测试和完整打包 / Developer guides |
| `docs/updates.md / docs/releases.md` | 更新方式和当前版本记录 / Update and release notes |
| `docs/ocr.md` | 图片识别的后续计划 / OCR plan |
| `docs/examples/` | 三节三十公式的 Word 和 PDF 演示 / Public demo documents |
| `docs/preview/` | 真实 App 截图和演示预览 / Actual screenshots |

本地的 `research/`、`.local/`、`evidence/`、`output/` 保存原始材料、私钥和验证记录，已忽略；`dist/` 放当前安装包。它们不属于 GitHub 源码树。
