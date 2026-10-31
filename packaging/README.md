# 打包

版本与运行时配置在 `packaging/release.json`。先执行 `npm ci`，使用现有脚本构建：

```sh
EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR="/path/to/accepted-native-artifacts" \
EQUATIONLAB_UPDATE_PRIVATE_KEY="$PWD/.local/update-signing/ed25519-private.pem" \
./scripts/package_release.sh --app-only --output dist/0.6.11-build99
```

版本和构建号默认读取配置；输出目录须为空。本地功能迭代用 `./scripts/build_and_run.sh --word-test run`，不运行安装器。

上面的原生组件目录需要先按下一段的流程准备，不能拿旧版模板代替。`--app-only` 省去 ZIP 和 DMG；提供有效的原生组件后，仍会生成完整 PKG 和签名更新清单。

安装包包含 App、独立 Node 运行时、生产依赖、字体、预览资源、Word 模板与辅助组件。运行路径相对 App 定位；无需用户安装开发工具。

Word 模板在真实 Word 中编译、保存，并通过冷启动加载检查。当前标准模块为 `AutoExec`、`EquationLabEntryPoints`、`EquationLabDynamicStartupLoader`、`EquationLabDocumentContext` 和 `EquationLabRibbon`，另有 `EquationLabWordEvents` 类和模板自带的 `ThisDocument`。启动入口只有 `AutoExec.Main`；目录中的旧 `EquationLabStartupLoader.bas` 是固定路径探针，不导入当前模板。

`word-native-installer/artifacts.mjs` 按模板、源码、原生组件和验收记录的哈希冻结产物。VBA 导入文件使用 CRLF 行尾；发布时核对实际保存的七个模块，并重开 Word 验证入口和文档事件。冻结前还须确认 Equation Lab 顶栏和永久打开面板按钮可见，在验收记录中填写 `ribbonVerified: true`。验收源码只收录模板实际包含的模块。

安装器从 Word 设置中检测 Startup 位置，只管理本产品记录的文件。安装前检查 Word 和 App 已退出；安装后验证用户安装记录、后台服务和新 Word 进程的加载记录。

完整发布上传对应版本的 `Equation-Lab-<version>.pkg`、`EquationLab-update.json`、`SHA256SUMS.txt`。更新密钥只保存在本地，公共验证密钥在 `updater/UpdateTrust.swift`；不要把私钥放进 Git 或 App。

源码导出使用 `node packaging/export-source.mjs --review --output dist/source-review`，输出目录须不存在。主仓库保留源码、文档和演示，安装包放 GitHub Releases。

只从构建清单复制运行所需的源码、依赖和资源。`evidence/`、`research/`、`.local/` 和 `output/` 里的私有文档、测试副本、截图和记录不进入安装包或源码导出。发布前检查包内清单与待提交文件，不上传个人文档或本地路径。App 使用 ad-hoc 代码签名，更新清单使用 Ed25519 签名。
