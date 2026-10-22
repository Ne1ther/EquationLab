# 源码与发布

日常开发、文档维护和推送都在当前 [Ne1ther/EquationLab](https://github.com/Ne1ther/EquationLab) 仓库完成，`main` 跟踪 `origin/main`。不再创建另一份上传仓库。

源码、公开演示和真实截图进入 Git。安装包、更新清单和校验值放在同一个仓库的 [Releases](https://github.com/Ne1ther/EquationLab/releases)。版本和构建号在 `packaging/release.json`，中英文更新内容在 `packaging/update-notes.json`。

## 更新一次版本

1. 同步版本配置、`package.json`、锁文件和 `src/version.mjs`。
2. 更新中英文 README、`packaging/source-README*.md.in`、使用说明及版本记录。
3. 跑相关测试，用已在 Word 中编译和验证的模板构建正式包，见[打包说明](../packaging/README.md)。
4. 核对包内版本、原生组件、更新清单和安装包校验值，完成对应的 Word 验证。
5. 提交并推送源码和版本标签，发布同一次构建的 PKG、`EquationLab-update.json`、`SHA256SUMS.txt`，再检查公开下载和自动更新。

`docs/preview/` 保存实际截图，`docs/examples/` 保存公开的 30 公式 Word/PDF 演示。历史开发记录在 `docs/history/`，不当作当前使用说明。

## 本地材料

`research/`、`.local/`、`evidence/`、`output/` 保留原始输入、研究材料和 Word 验证记录，不加入 Git。`.local/update-signing/` 保存更新私钥，App 和源码只带公开验证密钥。

`dist/` 只保留当前安装包。旧构建、缓存和已替换的 App 可以清理；原始材料、宿主编译模板、验证记录和活动 Git 检查点保留。

需要单独的源码 ZIP 时，运行 `node packaging/export-source.mjs --review --output <新目录>`。脚本按清单导出，排除本地材料、依赖目录和私钥；它不会代替当前仓库的提交与推送。

资源来源与许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

---

Maintain and push the source from this checkout. Publish the installer, signed update metadata, and checksums through GitHub Releases. Keep both README languages and their export templates in sync. Original inputs, host-compiled templates, validation records, private keys, and active Git checkpoints stay local; only replaceable old builds are cleaned up.
