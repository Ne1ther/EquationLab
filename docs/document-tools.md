# 文档检查与批量处理

在编辑器右侧打开 **文档 → 文档检查与批量处理**，可以检查编号和引用，将当前公式的样式应用到更多公式，或按范围整理编号格式。等文档列表载入完成后即可使用。

检查面板读取当前载入的文档。批量处理先给出修改预览，再保存为新的 Word 文件。保存后在 Word 中打开副本，检查排版并更新编号与引用；当前打开的原文档保持原样。

开发版本中，字体样式和编号的只读预检运行时，LaTeX 源码与公式画布仍可继续输入并更新预览。保存、写副本和切换文档等操作会等待预检结束。报告使用启动预检时的设置；如需采用之后调整的字号或编号格式，请关闭报告并重新预检。报告打开后，先关闭面板再继续编辑。

## 检查编号与引用

点“检查编号与引用…”查看公式编号、正文引用和检查结果。搜索框可以按编号、引用或提示内容筛选；与当前文档公式对应的项目可以直接选中该公式。

报告区分 Equation Lab 和旧 MathType 编号，显示锁定字段、断开的引用、缺少引用书签等情况。重新起号和混合编号格式也会列出，方便核对章节安排。旧 MathType 编号即使没有单式书签，也可按文档中保存的显示值查看。

要在正文中添加引用，回到 Word 的 Equation Lab 功能区，点“插入引用”。在列表中搜索编号或附近文字，选择目标后插入到当前光标位置。候选来自能明确定位到公式的编号书签。

## 批量应用字体、字号和间距

1. 选一条公式，在右侧调好字体、字号和内部间距。
2. 打开“应用当前公式样式…”，选择“当前公式”或“全文公式（另存副本）”。
3. 查看预检结果中的修改、保持原样和跳过项目，以及对应原因。
4. 点“另存应用后的副本…”，选择新文件名。

样式处理修改公式原生的整体设置，同时保留局部特殊格式、编号和引用。预检会逐项说明处理结果，适合先查看再保存。

## 保存文档样式预设

在“应用当前公式样式…”中选择“保存文档预设（另存副本）”，将当前字体、字号和间距存为该文档后续公式的预设。

打开带有预设的文档后，新插入的公式会沿用这套预设。你也可以选择“将文档预设载入当前草稿”，将它用于当前公式，再点更新公式或完成插入。

## 编号的作用范围

在右侧 **文档 → Word 编排** 中选好编号格式，再选择“预检重编全部已有编号（副本）…”或“仅设为后续新公式默认（副本）…”。从 Word 连接进入时，先在 Word 保存文档，然后在文件选择器里选这个已保存的 `.docx`。

| 菜单选项 | 用途 |
| --- | --- |
| 当前公式 | 修改当前 Equation Lab 公式的编号格式 |
| 全部已有编号 | 统一整理可识别的 Equation Lab 和旧 MathType 编号格式 |
| 仅后续新增公式 | 保存后续新增编号的默认格式，已有编号沿用原格式 |

“当前公式”和“全部已有编号”用来修改现有编号。如果只想给以后新增的公式设置默认格式，选“仅后续新增公式”。预检会列出修改和跳过的项目；保存后用 Word 打开新副本，点功能区的“更新编号”重算序号和交叉引用。

对缺少单式书签的旧 MathType 编号，批量预检支持已识别的分隔符和括号替换，例如 `(2.1)` 改为 `(2-1)`。章节或序号字段的结构需要变动时，这类编号会跳过，并在预检里列出原因。

## 连接诊断

打开 **Office 插件**面板查看连接状态。反馈问题时，点“复制连接诊断”，把诊断文本和复现步骤一起提供。诊断包括 App 与组件版本、本地服务状态、最近操作阶段和耗时，不含文档内容与路径；是否分享这段文本由你决定。

## 命令行

给 AI 使用时，可从 [Equation Lab Skill](../skills/equation-lab/SKILL.md) 开始。它包含查看公式清单、生成可编辑的 MathType 公式、核对编号和引用、批量编辑的操作步骤。在 Word 正文指定位置插入公式时，使用 Word 功能区的对应命令。

在 App 顶栏点 **AI → 安装或导出 Skill…**。Codex 和 DSH 默认读取共享目录，点 Claude Code 或 Antigravity 卡片可添加链接。其他客户端可通过 **🧠 其他客户端** 复制说明或导出文件夹。 [各客户端设置](../skills/equation-lab/references/installing.md)

文档检查和副本处理也可直接用于 `.docx` 文件：

```sh
node src/cli.mjs audit input.docx
node src/cli.mjs references input.docx '1.2'
node src/cli.mjs read-preset input.docx
node src/cli.mjs edit-batch input.docx edits.json new-equation-copy.docx

node src/cli.mjs plan-typography input.docx typography-options.json typography-plan.json
node src/cli.mjs apply-typography input.docx typography-plan.json new-style-copy.docx

node src/cli.mjs plan-numbering input.docx numbering-options.json numbering-plan.json
node src/cli.mjs apply-numbering input.docx numbering-plan.json new-number-copy.docx
```

样式选项 `typography-options.json` 示例：

```json
{"indices":[0,2],"typography":{"fullSize":12,"sizes":{"1":{"unit":"%","value":60}}}}
```

编号选项 `numbering-options.json` 示例：

```json
{"scope":"selected","indices":[0,2],"numberFormat":"(#C1.#E1)","updateFuture":false}
```

公式索引从 0 开始。编号计划支持四种范围：

| `scope` | 选择方式 |
| --- | --- |
| `current` | 用 `index` 指定一条公式 |
| `selected` | 用 `indices` 指定多条公式 |
| `all` | 检查全部公式并处理可识别的 Equation Lab 和旧 MathType 编号 |
| `future` | 设置文档后续编号默认格式 |

前三种范围可加 `updateFuture:true`，同时更新后续默认。只保存样式预设时使用 `indices:[]`，并提供 `preset`；修改已有公式时在 `indices` 中列出目标。

计划文件和输出副本使用新路径。生成计划后，阅读其中的 `targets`、`summary` 和各项原因，再运行 `apply`。计划对应生成时的源文件；源文件变化后，重新生成计划即可。副本按计划调整公式设置，并保留公式对象、段落和书签。

---

# Document checks and batch tools

Open **Document → Document checks and batch tools** in the inspector to review numbering and references, apply the current equation’s style to more equations, or organize number formats by scope. The tools are available once the document list finishes loading.

Checks read the loaded document. Batch tools preview changes and save a new Word file. Open the copy in Word, check its layout, and update numbering and references to use the result. The original open document stays as it is.

In the development build, read-only style and numbering preflights keep LaTeX and canvas input available, including fresh previews. Saving, writing a copy and navigation remain blocked until the check ends. Each report uses the settings captured when its preflight began; close it and run another preflight to use later settings. Close the result panel before continuing to edit.

## Check numbering and references

Choose Check numbering and references to view equation numbers, body references, and findings. Search by number, reference, or finding text. An entry matched to an equation in the current document can select that equation directly.

The report distinguishes Equation Lab and legacy MathType numbers and shows locked fields, broken references, and missing reference bookmarks. It also lists sequence restarts and mixed formats to help you review chapter numbering. Legacy MathType numbers can be listed from their saved display even without an individual equation bookmark.

To add a reference in the body, use Insert Reference in Word’s Equation Lab ribbon. Search by number or nearby text, select a target, and insert at the current cursor. The list uses numbering bookmarks that identify individual equations.

## Apply fonts, sizes, and spacing

1. Select an equation and adjust its fonts, sizes, and internal spacing in the inspector.
2. Open Apply current formula style and choose Current equation or All equations in a copy.
3. Review the changed, unchanged, and skipped entries and their reasons.
4. Choose Save changed copy and select a new filename.

Style processing changes native equation settings while retaining local special formatting, numbering, and references. The preview explains the result for each equation before you save.

## Store a document style preset

Under Apply current formula style, choose Store document preset in a copy to save the current fonts, sizes, and spacing for future equations in that document.

When you open a document with a saved preset, newly inserted equations automatically adopt it. You can also choose Load document preset into draft to apply it to the current equation, then update or insert as usual.

## Choose a numbering scope

Set the format under **Document → Word layout**, then choose “Preview renumbering all existing (copy)…” or “Set default for future formulas only (copy)…”. In a live Word session, save the document in Word and select the saved `.docx` when prompted.

| Menu option | Purpose |
| --- | --- |
| Current equation | Change the current Equation Lab equation’s number format |
| Existing numbered equations | Apply the format to eligible Equation Lab and legacy MathType numbers |
| Future equations only | Store the default for later numbered insertions while keeping existing formats |

The first two options work on existing numbers. Choose Future equations only to set the later default separately. Review changed and skipped entries, save the copy, then open it in Word and choose Update Numbers to recalculate sequences and cross-references.

For legacy MathType numbers without individual bookmarks, the preflight supports recognized separator and bracket changes, such as `(2.1)` to `(2-1)`. If the change would alter the chapter or sequence fields, the report explains why the number is skipped.

## Connection diagnostics

Open the **Office plugin** panel to check the connection status. When reporting an issue, click Copy connection diagnostics to copy app and component versions, local service status, recent stages, and operation timing. The copied text omits document content and paths. You choose how to share it.

## Command line

The [Equation Lab Skill](../skills/equation-lab/SKILL.md) gives AI agents the commands for listing, generating, batch editing, and verifying editable MathType equations. Use the Word ribbon to insert an equation at a specific position in existing text.

In the App toolbar, open **AI** and turn on **AI collaboration** to see the status of local skill and command-line tasks. Start the work from your AI session. Turning the switch off stops status reporting while commands already running continue.

The commands and JSON examples above work directly with `.docx` files. Equation indices start at zero. Numbering plans support four scopes:

| `scope` | Selection |
| --- | --- |
| `current` | One equation specified by `index` |
| `selected` | Multiple equations specified by `indices` |
| `all` | Check all equations and process eligible Equation Lab and legacy MathType numbers |
| `future` | Set the default format for later numbers |

For the first three scopes, add `updateFuture:true` to update the future default too. To store only a style preset, use `indices:[]` with `preset`. List target indices when changing existing equations.

Use new paths for plans and output copies. After creating a plan, review its `targets`, `summary`, and per-entry reasons, then run `apply`. A plan matches the source file used to create it; regenerate the plan if that file changes. The copy applies the reviewed settings while retaining equation objects, paragraphs, and bookmarks.
