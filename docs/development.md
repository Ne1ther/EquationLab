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

## 0.6.14 长文档优化

只读排版和编号预检会在解析对象、扫描书签和准备目标之间交还执行权，让新的编辑预览先完成。每次让出最多运行一个预览；写副本与其他任务不会插入正在执行的预检，写任务之间仍保持先后顺序。ZIP/XML 解析和单个公式处理仍可能连续占用线程，这不是硬实时保证。内部 checkpoint 由调度器传入，RPC 数据不能启用它，写入路径也不使用它。

前端为这两类预检保留操作互斥，同时开放 LaTeX 和画布输入，避免后台可以响应但编辑区仍被禁用。预检选项在开始时复制，报告返回及应用时核对源路径、ticket、文档身份和快照。保存、写副本和导航保持禁用；原生撤销/重做、标尺和数学键盘也仍受 busy 状态约束。

侧栏快照只保留公式数据和独立复制的 OLE，不保留 ZIP、DOM 或整包媒体。最多缓存四份快照，按估算的保留数据限制在 64 MiB；存储预览另有 8 MiB / 128 批的缓存。两项额度都不是整个进程的内存上限。每次复用检查文件身份，重新读取时核对 SHA-256；旧图片按需读取，不能混入其他版本的文档。

对照测试复用同一组文件，避免重新生成 DOCX 导致输入变化：

```sh
node scripts/benchmark-document.mjs --counts 30,300 --document /path/to/private-copy.docx --output /path/to/baseline
# 修改源码后，复用报告中已核验的原始输入：
node scripts/benchmark-document.mjs --reuse-report /path/to/baseline/report.json --output /path/to/candidate
# JSON 格式为 {"inputs":["/absolute/document1.docx","/absolute/document2.docx"]}，最多四份：
node scripts/benchmark-snapshot-cache.mjs --inputs /path/to/inputs.json --output /path/to/new-cache-report.json
```

2026-11-10 本机离线对照中，300 公式合成文档在编号预检期间的预览排队中位数由 4702 ms 降为 53 ms；112 公式私人文档在排版预检期间由 2192 ms 降为 303 ms。每组只有五个实际完成的预览样本，不能当作总体 p95 或 Word 界面耗时。私人文档两类竞争批次总耗时分别增加约 0.6% 和 2.6%，因此收益主要是更早响应输入。

四份不同文件内容、同样公式结构的大文档缓存探针，八次命中的中位数由 539 ms 降为 2.2 ms；显式 GC 后 JS 堆由 140 MiB 降为 50 MiB。此项测量不含 Word、App 界面或渲染，RSS 仍包含整个探针进程。本地原始报告和输入散列见 `.local/optimization-20261110/STATUS.md`，私有文档不随源码分发。

2026-11-10 又用实际部署的开发 App 和 Word 16.114.4 验证了 112 公式原稿副本及 300 公式合成文档。该次尚未经 Word 重存的结构中，300 个目标的字号预检和编号预检均可处理；约 1.41 s / 5.94 s 的预检期间，新输入的预览请求往返约 4.9 ms / 7.6 ms，界面在预检结束前恢复了有效预览。这是两次单机观察，编号用例同时运行了公开源码回归；这些数值包含实际 App 引擎请求边界，不代表完整键盘延迟，也没有对应的旧版 Word 实测基线。112 公式文档的样式预检因未知旧字体编码而安全跳过，不能据此宣称批量修改兼容性已通过。实际安装身份、功能结果和完整日志见本机 `.local/word-live-20261110/STATUS.md`。

Read-only typography and numbering preflights now yield at safe boundaries so one pending editor preview can run. Writes keep their serial order. Compact snapshots omit ZIP/DOM/media backing data; stored previews are loaded lazily and checked against the snapshot hash. The 64 MiB snapshot and 8 MiB preview budgets estimate retained data, not total RSS. Reuse the same hashed inputs for comparisons. These small offline measurements do not establish real Word latency or a population p95.

The frontend keeps its operation lock during these preflights while allowing text and canvas input. Options are copied and report bindings are checked again before use. A separate Word 16.114.4 session with the deployed development App confirmed that fresh previews completed during both 300-equation preflights. The local host receipt keeps the exact build, observations and limits separate from the earlier offline comparison. Unsupported legacy font encodings still cause safe skips.

本轮宿主联调还修复了三处实际流程问题：新 Word 会话等待对应文档身份发布，避免旧状态将它提前结束；原生组件 0.0.40 保留成功回退后的就绪状态；后台目标保存先在校验过的目标文档上设置未保存标记，避免 Word 普通保存漏写。新 VBA 已在 Word 中重新编译，其他模块经提取核对保持一致。最终测试 App 在全新的 300 公式副本上完成末条定位、单条更新、普通保存和关闭重开；其余 299 条 Native、编号及书签保持。112 公式原稿副本也通过单条保存重开。这些结果对应本轮测试构建，不能仅凭相同版本号推定正式安装包已通过相同验收。

本轮还记录了编号预检的边界：Word 重存该合成文档时，会将图片类型定义转换为额外的隐藏 VML 图形；当前预检将这种段落内容安全跳过。原始结构副本可预检全部 300 个编号目标，重存副本的整篇编号暂不可用。保存前后的编号、书签和已验收 Native 数据仍保持；本轮没有放宽此项保护规则。

Host testing also exposed and fixed premature session retirement, a false native timeout after successful owner fallback, and a missing Word document dirty flag during background target saves. The updated VBA was compiled in Word and its other modules were checked unchanged. The final development App passed a last-equation update, ordinary save, close and reopen on a fresh 300-equation copy, preserving the other 299 Native payloads, numbering and bookmarks. A separate 112-equation copy passed a single-equation save and reopen. These results belong to the tested build; matching version numbers alone do not establish the same acceptance for an installed release package.

Numbering preflight still skips the extra hidden VML shapes that Word creates when resaving this synthetic fixture. All 300 targets were eligible in the original structure; whole-document renumbering of the resaved copy remains unsupported. The verified Native payloads, numbering and bookmarks were preserved.

## Word 联调

本地迭代直接部署用户可写的测试 App，不反复使用安装器或管理员密码：

```sh
./scripts/build_and_run.sh --word-test --build-only
# 保存并退出 Word 和 Equation Lab 后：
./scripts/build_and_run.sh --word-test run
./scripts/build_and_run.sh --word-test --verify
```

构建位于 `.local/word-test/Equation Lab.app`，实际运行位置是 `/Applications/Equation Lab.app`。`deployment.json` 记录两者的路径、构建标识、哈希和原版备份。`--build-only` 不部署；`run` 更新本产品管理的 Startup 插件和用户服务，失败时恢复原安装；`--verify` 核对实际组件、进程和 Word 冷启动记录。

如果当前安装是 QA 或正式发行构建，部署只接受完整包散列与已核验 seed 一致、且属于 root 或当前用户的副本，并将它保留为新的基线。已有基线转入 `historicalBaselines` 继续保留；不同来源或散列变化的 App 仍会拒绝替换。构建记录中的旧安装身份不能单独证明当前副本已登记。

默认从当前完整 App 复用运行时和已验证的原生资源，也可用 `EQUATIONLAB_WORD_TEST_SEED` 指定。依赖锁或原生版本改变时，需要匹配的新 seed。原生组件和 VBA 改动须重新构建，并在 Word 中编译、保存和验证，再冻结给发行包使用。

### 清理后恢复开发输入

本地清理可移除 `node_modules/`、旧测试 App、展开包和独立运行时缓存；继续开发先运行 `npm ci`。`dist/` 保留当前 PKG、签名更新清单、校验值和报告，展开的 App 可按需恢复。以下仅示例恢复旧版 0.6.13/build101 正式发行 seed；如果旧包已清理，请改用实际保留的匹配版本：

```sh
equationlab_pkg_tmp="$(mktemp -d "${TMPDIR:-/tmp}/equationlab-seed.XXXXXX")"
pkgutil --expand-full dist/0.6.13-build101/Equation-Lab-0.6.13.pkg "$equationlab_pkg_tmp/expanded"
export EQUATIONLAB_WORD_TEST_SEED="$equationlab_pkg_tmp/expanded/component.pkg/Payload/Applications/Equation Lab.app"
```

然后使用上面的 `--word-test --build-only`；完成构建后可清除这份临时解包目录，并取消 `EQUATIONLAB_WORD_TEST_SEED`。解包不运行安装器，也不修改已安装 App 或 Word 插件。具体版本、配套组件、保留原稿及重复夹具的旧路径映射，以本机 `.local/README.md` 为准。重跑历史验证前，从保留文件复制独立夹具，不直接修改归档原稿。

上例 0.6.13 PKG 复原的是原来的 0.0.39 组件；0.6.14 使用 0.0.40 和重新编译的模板，不能直接将旧 PKG 作为匹配 seed。请使用当前完整测试 App、匹配的新发行包，或本机保留的新宿主验收资源。构建入口会核对版本和组件身份。

本机历史 DOCX 和大型报告、日志还可无损归档。常用原稿、已验收 Word 组件和小型收据直接保留；已归档文件的原路径和散列保存在 `.local/archives/20261109-evidence/manifest.json`。恢复工具不依赖 npm 包：

```sh
node research/tools/restore-local-archive.mjs --list
node research/tools/restore-local-archive.mjs --verify
node research/tools/restore-local-archive.mjs '.local/thesis-backend-20261029-La549f/typography-14pt.docx' --output /tmp/EquationLab-archived-typography.docx
```

省略 `--output` 恢复原路径，适用于旧脚本依赖的 JSON 或日志；已有不同文件会拒绝覆盖。恢复的 DOCX 保持原始字节，完整核验 SHA-256 后才交付，不经 Word 重存。恢复会重新占用空间。该工具、清单与私人夹具均留在本机忽略目录；既有 REA gzip 档案继续用 `research/tools/restore-research-archive.mjs`。

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

公开 macOS CI 运行 Node、Swift 和离线安装逻辑测试。公开演示回归与可选的本机 Word 保存语料分开，配置和证据边界见[兼容性回归](compatibility-regression.md)。CI 不运行 Word 或安装器，也不替代已安装 App 的验收。

Word 回归测试要完整覆盖新建插入、完整公式列表加载与切换、双击已有公式、编辑后存回、保存文档后再重开，以及编号与引用。测试时要记下测试 App 的实际路径、版本号和组件哈希。核对前台焦点切换时，看系统当前真正激活的前台应用，不能只凭窗口露在外面或代码内部的 active 标记做判断。

`node scripts/build/build-word-demo.mjs` 生成公开的 30 公式演示，PDF 用桌面 Word 导出。完整发布见[打包说明](../packaging/README.md)和[发布流程](source-publication.md)。

原始研究材料、Word 验证记录和私有配置留在忽略目录中。维护当前仓库的 Git 历史，不创建另一份上传仓库。

---

Use the commands above to build and test. Local Word iteration deploys a user-writable App and user-scoped components; reserve Installer for the final installation check. Record the actual running build and component hashes, and check the system's foreground application for focus tests. Native/VBA changes also need compilation and validation inside Word before freezing release inputs.

After local cleanup, run `npm ci` to restore locked dependencies. A matching PKG can be expanded into a new temporary directory for a release App seed without running Installer. The 0.6.13 example above contains helper 0.0.39 and the older template; it is not a matching seed for 0.6.14's helper 0.0.40 and recompiled template. The local index records accepted components and maps removed duplicate fixtures to identical retained originals; copy a fresh test fixture before running historical scripts.

Historical DOCX and large text evidence may also be archived without changing their original bytes. The local `restore-local-archive.mjs` tool lists entries, verifies archives and restores one exact path or a separate copy with `--output`; it refuses to overwrite a different file. Restore archived JSON or logs before running scripts that read their old paths. Common original inputs and accepted Word components stay directly available. These private archives and tools are not part of the published source.

See [Document backend tools](document-tools.md) for document checks, batch copies, insertion loading, and connection diagnostics.

Clean saved documents use a checked compact ZIP snapshot. Large unsaved documents open the exact equation first, then capture main-story ranges in separate Word callbacks, yielding between batches and deferring while Word receives recent user input. Joining the ranges preserves native data and numbering metadata while isolating relationship names. The source document is never saved, renamed or selected for this capture. Measure first-edit readiness, full-list completion and the longest callback separately; test draft retention, target save-back, cancellation and document closure in real Word.
