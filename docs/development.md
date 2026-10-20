# 开发

安装 Node.js 24 和 Swift 6.2 / Xcode 命令行工具后：

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

Word 联调先构建完整副本，再直接更新应用程序目录，不用反复运行系统安装器：

```sh
./scripts/build_and_run.sh --word-test --build-only
# 保存并退出 Word 和 Equation Lab 后：
./scripts/build_and_run.sh --word-test run
./scripts/build_and_run.sh --word-test --verify
```

构建副本在 `.local/word-test/Equation Lab.app`，实际运行位置是 `/Applications/Equation Lab.app`。`.local/word-test/deployment.json` 分别记录两者路径、构建 UUID、哈希和原发行版备份。它使用 release Swift 配置、内置 Node 和已验收的原生 Word 资源。默认从当前 `dist/` 完整 App 或 `/Applications/Equation Lab.app` 复用运行时；也可用 `EQUATIONLAB_WORD_TEST_SEED` 指定完整 App。依赖锁或原生组件版本变化时需要匹配的新 seed，不会静默复用旧 helper、自动下载运行时或生成 PKG。

`--build-only` 只构建副本，不碰 `/Applications`、插件或运行中的服务。`run` 要求 Word/App 已退出，且当前用户对 `/Applications` 父目录有写权限；它在同一目录中交换 App，再事务更新已有的用户 Startup 插件和后台服务，不用管理员密码、PKG 或 sudo。首次发行版保留在隐藏且无 `.app` 后缀的基线备份中，不自动删除；只有登记过的本用户旧开发副本会在成功后清理。部署失败会恢复原 App 和自有服务，未知目标或备份会被拒绝。`--verify` 不启动应用，核对实际 App 的 UUID/哈希、Startup、服务进程及端口归属和 Word 冷启动回执。独立界面开发仍用普通入口。

若后台服务已经绑定测试副本且 Word 仍在运行，`--build-only` 也会拒绝覆盖，避免运行中的旧服务读取新资源。

应用关联只刷新本轮已验证的备份、构建副本和实际 `/Applications/Equation Lab.app`，不扫描或清空 LaunchServices 数据库。

`macos/` 是原生界面，`desktop/` 是公式编辑画布，`src/` 是公式数据、排版和本地服务，`native-word-probe/` 是 Word 原生插件，`updater/` 处理更新。

验证命令：

```sh
npm test
swift test
./native-word-probe/script/build_and_run.sh
node --test packaging/word-native-installer/installer.test.mjs
```

本机装有 Word 时，可额外检查原生编辑会话的回收：

```sh
node native-word-probe/script/run_session_cleanup_tests.mjs
```

它使用独立端口和真实会话服务，检查连续关闭 20 次、迟到响应和取消写回；Word 界面的切换、保存重开仍要单独测试。

`node scripts/build/build-word-demo.mjs` 重新生成公开的 30 公式演示。用桌面 Word 检查并导出 PDF；预览和单元测试之外，还需验证冷启动、编辑回存和保存重开。

开发构建使用仓库内的运行资源。[第三方资源](../THIRD_PARTY_NOTICES.md)已随源码提供。完整发行包需要在 Word 中编译启动模板并验证加载，见[打包说明](../packaging/README.md)。

本仓库根目录是日常维护的 Git 工作区。原始研究材料、主机验证记录和私有配置保留在被忽略的本地目录中，不进入源码发布。

---

The source tree contains the native macOS UI, equation canvas, rendering engine, native Word integration, and updater. Use the commands above to build and test. A complete release also needs a Word-compiled startup template with real host validation; see the packaging guide.

With Word installed, `node native-word-probe/script/run_session_cleanup_tests.mjs` checks repeated owner closure and late responses against the real session service on separate ports. It does not replace Word UI or save/reopen testing.

For Word development, use `./scripts/build_and_run.sh --word-test --build-only`, then save and quit Word and Equation Lab before `--word-test run`. The release-configured build is staged at `.local/word-test/Equation Lab.app` and runs from `/Applications/Equation Lab.app`. It reuses an accepted App's bundled runtime and native artifacts; `EQUATIONLAB_WORD_TEST_SEED` selects that App. A changed dependency lock or native source version requires a matching seed. It never silently falls back to an older helper, downloads a runtime or creates a PKG.

Build-only stays inside `.local`. Run requires write permission on the `/Applications` parent folder, swaps the App within that folder, then updates the existing user-owned Word installation and service without a password, PKG or sudo. It retains the original release in a hidden baseline directory without an `.app` suffix, removes only recorded user-owned previous development copies after success, and restores the original App/service on deployment failure. Unknown targets or backups are refused. `deployment.json` records the build and actual destination separately. `--word-test --verify` checks the actual bundle UUID/hashes, Startup files, service process and listening-port ownership, and the matching Word cold-start receipt without launching apps.

Build-only also refuses to overwrite a test copy already used by the Word service while Word is running, so the old running service cannot read newly replaced resources.

Only this deployment's verified backup, build copy and actual Applications App registrations are refreshed; the LaunchServices database is never scanned or reset.
