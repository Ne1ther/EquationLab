# 开发

需要 Node.js 24 和 Swift 6.2 / Xcode 命令行工具：

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

`macos/` 是原生界面，`desktop/` 是编辑画布，`src/` 是公式引擎与本地服务，`native-word-probe/` 是 Word 插件，`updater/` 处理更新。具体入口见[文件说明](file-guide.md)。

## 0.6.13 维护要点

侧栏现在可以显示并搜索文档里保存的公式编号，例如 `(3.28)`。编号属于载入快照；Word 重编号后会重新读取。编辑器也增加了[本机草稿恢复](draft-recovery.md)，保存请求丢失响应时会继续核对原操作，不自动重复插入。

文档副本编排会读取公式所在节的纸张、页边距和等宽双栏宽度，保留左右缩进，清除独立公式段落的首行或悬挂缩进。Word 内插入和编号使用对应的宿主宏；修改后须在 Word 中编译、保存并验收，再冻结发行组件。

每次原生插入使用独立文件，通过 `EquationLabInsertBody` 书签导入正文，排除源文件最后一个段落标记及其节设置。行内插入会在清除临时段落标记后恢复原正文的样式和 `ParagraphFormat`。回归时同时检查公式 Native、正文、段落样式、缩进、分栏和编号，不能只看公式是否出现。

`native-word-probe/automatic-loader/build-ribbon-template.mjs` 可以刷新已编译模板中的功能区资源，保留 VBA 项目字节。图标更新后仍需核对新模板哈希和 Word 冷启动；打包入口会拒绝与当前图标资源不一致的模板。

长文档性能测试可使用项目脚本，输入文件按只读方式处理：

```sh
node scripts/benchmark-document.mjs --output .local/document-benchmark
node scripts/benchmark-document.mjs --document /path/to/local-copy.docx --counts none --scenario sidebar --output /path/to/private-report
```

脚本测量后台解析、列表缓存、缩略图、只读预检和预览排队，不操作 Word。报告中的后台耗时不能代替 Word 首次可编辑或保存耗时。私人论文和结果保留在本地，不作为公开测试夹具。

Version 0.6.13 includes number search, local draft recovery and receipt reconciliation after a lost save response. Copy arrangement reads section geometry, including two equal-width columns. Native insertion imports a bookmarked body from a unique file, keeping the source’s final section mark out of Word; inline insertion restores the surrounding paragraph’s style and formatting. Compile and verify the matching macros in Word before freezing them. Refreshing ribbon artwork preserves the compiled VBA but changes the template hash, so cold-start evidence must use the refreshed file. Offline benchmarks measure backend work separately from live Word behavior.

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

对已经保存且未做改动的 DOCX/DOCM，直接走 `ELFILE1` 路径：只解开核对过边界与校验和的 XML、关系及 OLE 数据，跳过无关图片的解压。遇到尚未保存的大文档时，先用带一次性激活 token 的 `ELFRAG1` 载入当前要改的公式，等编辑器完全就绪后，再到后台分批请求其余内容。

后台分批读取使用 `ELPART1`，每批最多读取 3000 个 Word 字符，并尽量在段落末尾结束。每批读完后把控制权交还给 Word 消息循环。Word 刚收到用户输入时暂停读取，空闲后继续。这个过程不调用 `DoEvents`，不改变选区，也不保存或重命名原文档。文档关闭、文本或结构变化、请求失效时，捕获会停止；列表读取失败时仍保留当前公式和草稿。

服务端把各批正文拼合在一起，隔离内部关系 ID 与资源路径，同时核对公式总数、文档身份和当前对象的 Native SHA-256。这些分块只在本地充当读取和编辑数据源；当保存写回时，依然只针对原文档中校验过范围、序号和 Native 哈希的单个 OLE 对象。快照文件以批量 UTF-16 写出，原生端剔除不用于公式预览的图片缓存后再压缩传输。

测试大文档时，分别记录首次可编辑时间、加载完整列表的总耗时和单批最长耗时。列表还在加载时，也要测试输入和字号修改、从侧栏选中的公式能否正确保存，以及取消、来源关闭和编号引用更新。完整列表显示出来后，这些操作仍需逐项检查。单台设备上的耗时不能当成所有论文的性能保证。

## 验证与发布

分阶段插入、文档编号与引用检查、批量样式、编号作用范围和连接诊断接口见[文档后端工具](document-tools.md)。

```sh
npm test
swift test
./native-word-probe/script/build_and_run.sh
node --test packaging/word-native-installer/installer.test.mjs
```

有 Word 时，`node native-word-probe/script/run_session_cleanup_tests.mjs` 可检查连续关闭、迟到响应和取消写回。它不代替 Word 界面验证。

Word 回归测试要完整覆盖新建插入、完整公式列表加载与切换、双击已有公式、编辑后存回、保存文档后再重开，以及编号与引用。测试时要记下测试 App 的实际路径、版本号和组件哈希。核对前台焦点切换时，看系统当前真正激活的前台应用，不能只凭窗口露在外面或代码内部的 active 标记做判断。

`node scripts/build/build-word-demo.mjs` 生成公开的 30 公式演示，PDF 用桌面 Word 导出。完整发布见[打包说明](../packaging/README.md)和[发布流程](source-publication.md)。

原始研究材料、Word 验证记录和私有配置留在忽略目录中。维护当前仓库的 Git 历史，不创建另一份上传仓库。

---

Use the commands above to build and test. Local Word iteration deploys a user-writable App and user-scoped components; reserve Installer for the final installation check. Record the actual running build and component hashes, and check the system's foreground application for focus tests. Native/VBA changes also need compilation and validation inside Word before freezing release inputs.

See [Document backend tools](document-tools.md) for document checks, batch copies, insertion loading, and connection diagnostics.

Clean saved documents use a checked compact ZIP snapshot. Large unsaved documents open the exact equation first, then capture main-story ranges in separate Word callbacks, yielding between batches and deferring while Word receives recent user input. Joining the ranges preserves native data and numbering metadata while isolating relationship names. The source document is never saved, renamed or selected for this capture. Measure first-edit readiness, full-list completion and the longest callback separately; test draft retention, target save-back, cancellation and document closure in real Word.
