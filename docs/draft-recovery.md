# 恢复未保存的公式草稿

从 0.6.13 起，未保存的公式可以在本机恢复。

编辑公式时，App 会在停下输入后把草稿存到本机。除了公式内容，还会保存字体、字号、标尺和编号设置。“保留结构 · 替换字符”模式也会保留原生基底和替换内容。中文组字期间不会读取或改写输入框。

再次打开 App，如果发现上次留下的草稿，编辑区上方会出现“恢复草稿”。点它后可以继续独立编辑，导出 Word 文件，或重新选择 Word 文档和插入位置。当前有修改时，会先让你决定是否放弃当前编辑。

如果上次保存回 Word 时没有收到确认，恢复后会提醒你先检查原文档。恢复草稿本身不会再次提交公式，也不会恢复旧的 Word 编辑会话。

不需要的恢复副本可以点“丢弃”。草稿只存于本机的 `~/Library/Application Support/Equation Lab/drafts/`，保留最近 10 份记录，14 天后清理过期记录。它们不进入项目仓库，也不会自动上传。

---

# Recover an unsaved equation draft

Local draft recovery is available from 0.6.13.

After you pause typing, the app saves a local draft with its content, fonts, sizes, ruler and numbering settings. Character-only editing also retains the original native structure and replacements. Backup waits until input-method composition ends.

On the next launch, **Restore draft** appears above the editor. The recovered equation is an independent draft: you can keep editing, export it, or choose a Word destination again. The app asks before replacing edits already in progress.

If the previous Word save was not confirmed, check the original document before inserting again. Recovery does not repeat the submission or revive the old Word session.

Use **Discard** to remove a recovery copy. Drafts stay on this Mac in `~/Library/Application Support/Equation Lab/drafts/`. The app keeps up to 10 recent records and removes expired records after 14 days. They are not added to the repository or uploaded automatically.
