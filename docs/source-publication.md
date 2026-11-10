# 源码与发布

日常开发、文档维护和推送都在当前 [Ne1ther/EquationLab](https://github.com/Ne1ther/EquationLab) 仓库完成，`main` 跟踪 `origin/main`。不再创建另一份上传仓库。

源码、公开演示和真实截图进入 Git。安装包、更新清单和校验值放在同一个仓库的 [Releases](https://github.com/Ne1ther/EquationLab/releases)。版本和构建号在 `packaging/release.json`，中英文更新内容在 `packaging/update-notes.json`。

## 更新一次版本

1. 同步版本配置、`package.json`、锁文件和 `src/version.mjs`。
2. 更新中英文 README、`packaging/source-README*.md.in`、使用说明及版本记录。
3. 运行相关测试，使用在 Word 中编译并验证过的模板构建正式包，见[打包说明](../packaging/README.md)。
4. 核对包内版本、原生组件、更新清单和安装包校验值，完成对应的 Word 验证。
5. 提交并推送源码和版本标签，发布同一构建的 PKG、`EquationLab-update.json`、`SHA256SUMS.txt`，再检查公开下载和自动更新。

`docs/preview/` 保存实际截图，`docs/examples/` 保存公开的 30 公式 Word/PDF 演示。历史开发记录在 `docs/history/`，不当作当前使用说明。

## 自动检查

`.github/workflows/ci.yml` 在 macOS 上安装锁定依赖、构建字体辅助程序并运行 Node、Swift 和离线安装逻辑检查。私有论文、研究工具和历史 Word 结果不是公开 CI 的输入。公开演示的固定文件回归与可选本机宿主语料见[兼容性回归](compatibility-regression.md)；没有运行 Word、真实安装或网络发行检查时，不把 CI 通过写成这些项目已验收。工作流随源码发布后才会在 GitHub 执行，本机通过不能代替远程结果。

## 本地材料

`research/`、`.local/`、`evidence/` 和 `output/` 存放原始输入、研究资料与 Word 验证记录，不提交到 Git。`.local/update-signing/` 存放用于签名的私钥，App 和源码中仅包含公开验证密钥。

`dist/` 只保留当前 PKG、签名更新清单、校验值和打包报告；重复展开的发行 App 可从 PKG 恢复。旧构建、缓存、安装的依赖和已替换的 App 可以清理；继续开发时用 `npm ci` 恢复依赖。原始材料、宿主编译模板、验证记录和活动 Git 检查点保留。

发布后在 `.local/README.md` 记下当前发行包、配套 Word 组件和验收记录的位置。清理旧 App 或安装包前，先保留其中的编译模板、helper、版本元数据和散列；测试收据按当时的构建保留，旧路径不再当作当前运行入口。视频成片和工程源文件也保留，依赖及渲染缓存可重新生成。

完全相同的测试文档可在核对长度和 SHA-256 后归并为一份保留原稿，并在本地清理清单记录每个旧路径、保留路径和散列；不同内容的 Word 保存结果不按文件名或大小猜测删除。重跑历史脚本时先复制独立夹具，原验收收据不改写。清理结果同时记录保留文件、已安装组件和 Git 状态的校验；`du` 目录占用减少不当作精确的 APFS 物理回收量。

历史 DOCX 和大型文本可无损归档，保留完整原始字节；常用原稿、当前 Word 编译输入和小型验收收据继续直接可读。先保存原路径、字节数、权限、时间、内容和压缩文件的 SHA-256，再逐项解压验证；确认恢复工具可用后才移除展开副本。历史路径和收据内容不重写，重跑脚本前按清单恢复，已有不同文件拒绝覆盖。归档、恢复工具及逐项清单都属于本机私有材料，入口见 `.local/README.md`，不要强制加入 Git。

如果需要打包一份干净的源码 ZIP，可以运行 `node packaging/export-source.mjs --review --output <新目录>`。该脚本会根据白名单清单导出，自动排除本地材料、依赖目录和私钥；它只是辅助打包脚本，不会替代主仓库的日常提交与推送。

资源来源与许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

---

Maintain and push the source from this checkout. Publish the installer, signed update metadata, and checksums through GitHub Releases. Keep both README languages and their export templates in sync. Original inputs, host-compiled templates, validation records, private keys, and active Git checkpoints stay local; only replaceable old builds are cleaned up.

After a release, update the local index with the package, Word components, and validation records. Preserve compiled inputs and metadata before removing old bundles. Keep video exports and project sources; dependencies and render caches can be rebuilt.

Keep the current PKG, signed update metadata, checksums and packaging report locally; its expanded App can be restored from the package. Run `npm ci` after dependency cleanup. Consolidate test documents only after matching their size and SHA-256, with a local old-path-to-retained-path mapping. Preserve distinct Word results and original receipts, and copy independent fixtures before rerunning historical scripts. Verify retained inputs, installed components and Git state; report directory allocation separately from physical APFS reclamation.

Historical DOCX and large text evidence may be archived byte-for-byte while common originals, current Word inputs and small receipts remain directly readable. Record original paths, metadata and hashes, verify every restored file and the recovery tool, then remove expanded copies. Restore exact paths before rerunning historical scripts; never overwrite a differing file or rewrite old receipts. Archives, manifests and recovery tools stay local and ignored.

Public macOS CI runs the locked Node suite, Swift tests and offline installer logic without private documents or research tools. The public demo regression and optional local host corpus have separate evidence limits; neither replaces actual Word, installation or release checks. A workflow added locally has no GitHub result until it is pushed and run.
