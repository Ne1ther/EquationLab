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

### 大文档读取

已保存且没有修改的 DOCX/DOCM 使用 `ELFILE1`：读取经过边界和校验和检查的 XML、关系与 OLE 数据，不解压无关图片。未保存的大文档先用带一次性激活 token 的 `ELFRAG1` 打开当前公式，编辑器就绪后才请求其余内容。

后台捕获使用 `ELPART1`，每次读取最多 3000 个 Word 字符，并优先在段落边界结束；各批之间交还 Word 消息循环。Word 最近收到用户输入时暂停读取，空闲后继续。此路径不调用 `DoEvents`、不改变选区、不保存或重命名原文档。捕获期间文档关闭、文本或结构变化、请求失效时停止；列表失败仍保留当前公式和草稿。

服务端合并各批的正文并隔离关系 ID 与内部资源路径，再核对公式数量、文档身份和当前对象的 Native SHA-256。分块结果只作为私有读取和编辑来源；写回仍针对原文档中经过范围、序号和 Native 哈希校验的单个 OLE 对象。快照文件使用批量 UTF-16 写出，原生端删除不用于公式预览的图片缓存后压缩传输。

回归需分别记录首次可编辑时间、完整列表耗时和最长单批耗时；同时验证加载期间的输入与字号修改、侧栏目标保存、取消、来源关闭及编号引用。完整列表出现不能替代这些检查，也不能把某一台机器的测量写成所有论文的性能保证。

## 验证与发布

分阶段插入、文档编号与引用检查、批量样式、编号作用范围和连接诊断接口见[文档后端工具](document-tools.md)。

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

See [Document backend tools](document-tools.md) for document checks, batch copies, insertion loading, and connection diagnostics.

Clean saved documents use a checked compact ZIP snapshot. Large unsaved documents open the exact equation first, then capture main-story ranges in separate Word callbacks, yielding between batches and deferring while Word receives recent user input. Joining the ranges preserves native data and numbering metadata while isolating relationship names. The source document is never saved, renamed or selected for this capture. Measure first-edit readiness, full-list completion and the longest callback separately; test draft retention, target save-back, cancellation and document closure in real Word.
