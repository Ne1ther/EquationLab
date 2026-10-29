# 文档检查与批量处理

在编辑器右侧打开 **文档 → 文档检查与批量处理**，可以检查编号和引用，将当前公式的样式应用到更多公式，或按范围整理编号格式。等文档列表载入完成后即可使用。

检查面板读取当前载入的文档。批量处理先给出修改预览，再保存为新的 Word 文件。保存后在 Word 中打开副本，检查排版并更新编号与引用；当前打开的原文档保持原样。

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

打开带有预设的文档后，新插入会话会采用它。也可选择“将文档预设载入当前草稿”，在当前公式中使用。载入后按正常流程更新公式或完成插入。

## 编号的作用范围

先在 **Word 编排** 中选择编号格式，再打开“将编号格式应用到副本…”。

| 菜单选项 | 用途 |
| --- | --- |
| 当前公式 | 修改当前 Equation Lab 公式的编号格式 |
| 全部已有编号 | 统一整理文档中可处理的 Equation Lab 编号格式 |
| 仅后续新增公式 | 保存后续新增编号的默认格式，已有编号沿用原格式 |

当前公式和全部已有编号这两个范围处理现有编号。要另外设置后续默认，可选择“仅后续新增公式”。预检会列出修改和跳过的项目，保存后在 Word 中打开副本，点“更新编号”重算序号与交叉引用。

旧 MathType 公式的编号通过 Word 功能区调整。“更新编号”沿用其原有编号字段与重新起号设置，并更新相关引用。

## 连接诊断

打开 **Office 插件**面板，先检查连接状态，需要报告问题时点“复制连接诊断”。诊断包含 App 和组件版本、本地服务状态、最近操作阶段与耗时，可随复现步骤一并提供。文档内容和路径留在本机，复制后由你选择如何分享。

## 命令行

文档检查和副本处理也可直接用于 `.docx` 文件：

```sh
node src/cli.mjs audit input.docx
node src/cli.mjs references input.docx '1.2'
node src/cli.mjs read-preset input.docx

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
| `all` | 检查全部公式并处理已有 Equation Lab 编号 |
| `future` | 设置文档后续编号默认格式 |

前三种范围可加 `updateFuture:true`，同时更新后续默认。只保存样式预设时使用 `indices:[]`，并提供 `preset`；修改已有公式时在 `indices` 中列出目标。

计划文件和输出副本使用新路径。生成计划后，阅读其中的 `targets`、`summary` 和各项原因，再运行 `apply`。计划对应生成时的源文件；源文件变化后，重新生成计划即可。副本按计划调整公式设置，并保留公式对象、段落和书签。

---

# Document checks and batch tools

Open **Document → Document checks and batch tools** in the inspector to review numbering and references, apply the current equation’s style to more equations, or organize number formats by scope. The tools are available once the document list finishes loading.

Checks read the loaded document. Batch tools preview changes and save a new Word file. Open the copy in Word, check its layout, and update numbering and references to use the result. The original open document stays as it is.

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

New insertion sessions adopt the preset when you open a document containing it. You can also choose Load document preset into draft to use it in the current equation, then update the equation or finish inserting as usual.

## Choose a numbering scope

Set the format under **Word layout**, then open Apply numbering format to a copy.

| Menu option | Purpose |
| --- | --- |
| Current equation | Change the current Equation Lab equation’s number format |
| Existing numbered equations | Apply the format to eligible Equation Lab numbers in the document |
| Future equations only | Store the default for later numbered insertions while keeping existing formats |

The first two options work on existing numbers. Choose Future equations only to set the later default separately. Review changed and skipped entries, save the copy, then open it in Word and choose Update Numbers to recalculate sequences and cross-references.

Use the Word ribbon to adjust legacy MathType numbering. Update Numbers follows its existing fields and sequence-restart settings and updates related references.

## Connection diagnostics

Open the **Office plugin** panel to check connection status. Use Copy connection diagnostics when reporting an issue. It includes app and component versions, local service status, recent operation stages, and timing, ready to accompany your reproduction steps. Document content and paths stay on your Mac; you choose how to share the copied report.

## Command line

The commands and JSON examples above work directly with `.docx` files. Equation indices start at zero. Numbering plans support four scopes:

| `scope` | Selection |
| --- | --- |
| `current` | One equation specified by `index` |
| `selected` | Multiple equations specified by `indices` |
| `all` | Check all equations and process existing Equation Lab numbers |
| `future` | Set the default format for later numbers |

For the first three scopes, add `updateFuture:true` to update the future default too. To store only a style preset, use `indices:[]` with `preset`. List target indices when changing existing equations.

Use new paths for plans and output copies. After creating a plan, review its `targets`, `summary`, and per-entry reasons, then run `apply`. A plan matches the source file used to create it; regenerate the plan if that file changes. The copy applies the reviewed settings while retaining equation objects, paragraphs, and bookmarks.
