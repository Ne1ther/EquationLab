# 开发

需要 Node.js 24 和 Swift 6.2 / Xcode 命令行工具：

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

`macos/` 是原生界面，`desktop/` 是编辑画布，`src/` 是公式引擎与本地服务，`native-word-probe/` 是 Word 插件，`updater/` 处理更新。具体入口见[文件说明](file-guide.md)。

## Word 联调

本地迭代直接部署用户可写的测试 App，不反复使用安装器或管理员密码：

```sh
./scripts/build_and_run.sh --word-test --build-only
# 保存并退出 Word 和 Equation Lab 后：
./scripts/build_and_run.sh --word-test run
./scripts/build_and_run.sh --word-test --verify
```

构建位于 `.local/word-test/Equation Lab.app`，实际运行位置是 `/Applications/Equation Lab.app`。`deployment.json` 记录两者的路径、构建标识、哈希和原版备份。`--build-only` 不部署；`run` 更新本产品管理的 Startup 插件和用户服务，失败时恢复原安装；`--verify` 核对实际组件、进程和 Word 冷启动记录。

默认从当前完整 App 复用运行时和已验证的原生资源，也可用 `EQUATIONLAB_WORD_TEST_SEED` 指定。依赖锁或原生版本改变时，需要匹配的新 seed。原生组件和 VBA 改动须重新构建，并在 Word 中编译、保存和验证，再冻结给发行包使用。

## 验证与发布

```sh
npm test
swift test
./native-word-probe/script/build_and_run.sh
node --test packaging/word-native-installer/installer.test.mjs
```

有 Word 时，`node native-word-probe/script/run_session_cleanup_tests.mjs` 可检查连续关闭、迟到响应和取消写回。它不代替 Word 界面验证。

Word 回归覆盖插入、完整公式列表、切换、双击、编辑回存、保存重开、编号和引用。测试时记录实际 App 路径、版本和组件哈希。前台切换要核对系统实际前台应用；不要仅凭窗口可见或内部 active 状态判断。

`node scripts/build/build-word-demo.mjs` 生成公开的 30 公式演示，PDF 用桌面 Word 导出。完整发布见[打包说明](../packaging/README.md)和[发布流程](source-publication.md)。

原始研究材料、Word 验证记录和私有配置留在忽略目录中。维护当前仓库的 Git 历史，不创建另一份上传仓库。

---

Use the commands above to build and test. Local Word iteration deploys a user-writable App and user-scoped components; reserve Installer for the final installation check. Record the actual running build and component hashes, and check the system's foreground application for focus tests. Native/VBA changes also need compilation and validation inside Word before freezing release inputs.
