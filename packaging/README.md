# 打包

版本与运行时配置在 `packaging/release.json`。先执行 `npm ci`，使用现有脚本构建：

```sh
EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR="$PWD/.local/vendor-artifacts/build67-v27" \
EQUATIONLAB_UPDATE_PRIVATE_KEY="$PWD/.local/update-signing/ed25519-private.pem" \
./scripts/package_release.sh --no-dmg --output dist/release
```

版本和构建号默认读取配置；输出目录须为空。本地功能迭代用 `./scripts/build_and_run.sh --word-test run`，不运行安装器。

安装包包含 App、独立 Node 运行时、生产依赖、字体、预览资源、Word 模板与辅助组件。运行路径相对 App 定位；无需用户安装开发工具。

Word 模板须在真实 Word 中导入全部模块、编译、保存，并通过冷启动加载检查。`word-native-installer/artifacts.mjs` 按模板、源码、原生组件和验收记录的哈希冻结产物。VBA 导入文件使用 CRLF 行尾；发布时核对所有模块与源码一致，并实际重开 Word 验证入口和文档事件。冻结前还须确认 Equation Lab 顶栏和按钮可用，在验收记录中填写 `ribbonVerified: true`；缺少功能区资源或这项验收时，打包会中止。

安装器从 Word 设置中检测 Startup 位置，只管理本产品记录的文件。安装前检查 Word 和 App 已退出；安装后验证用户安装记录、后台服务和新 Word 进程的加载记录。

完整发布上传对应版本的 `Equation-Lab-<version>.pkg`、`EquationLab-update.json`、`SHA256SUMS.txt`。更新密钥只保存在本地，公共验证密钥在 `updater/UpdateTrust.swift`；不要把私钥放进 Git 或 App。

源码导出使用 `node packaging/export-source.mjs --review --output dist/source-review`，输出目录须不存在。主仓库保留源码、文档和演示，安装包放 GitHub Releases。
