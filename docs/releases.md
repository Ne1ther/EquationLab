# 版本记录

## 0.6.1

- 修复多行公式变成单行、换行被当作反斜杠保存的问题。
- 关闭编辑窗口后保留已加载的编辑器，从 Dock 或 Word 重新打开。
- 左侧公式列表直接在 App 内切换；保存时在后台核对并写回目标公式。
- 修复旧会话刚结束时再次双击失效的问题，冷启动后将编辑窗口置前。
- Word 的 Equation Lab 按钮与双击共用文档打开流程。
- 修复失效会话阻止编辑、取消和关闭窗口的问题。
- 根号与横线使用连续轮廓，消除高根号接头处的重叠粗线。
- 缓存文档解析和公式缩略图，减少反复打开时的重复工作。
- 修复取消或保存后，再开公式时文档列表偶尔只剩一条的问题。
- 提高章、节和编号信息的对比度。
- 删除旧的 Word 内嵌侧栏，保留独立编辑器里的文档公式列表。

[下载 0.6.1](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.1)

## 0.6.0

- 文档中的公式列表、搜索、切换和原位置回存。
- 编号格式预设、自定义输入、实时预览和文档编号详情。
- 修正求和上下限、根号、积分、数学减号及公式边缘裁切，提升预览清晰度。
- Word 跳转后的公式显示刷新；编号和交叉引用更新。
- 新增三节三十公式的 Word 和 PDF 演示。
- 简化安装、使用和开发说明。

[下载 0.6.0](https://github.com/Ne1ther/EquationLab/releases/tag/v0.6.0) · [历史版本](https://github.com/Ne1ther/EquationLab/releases)

---

0.6.1 browses document equations in the app and saves to the selected formula in the background. It fixes multiline conversion, stale sessions, lost document lists after cancelling or saving, and overlapping radical strokes. It brings the editor forward on cold launch, improves numbering readability, caches document parsing and thumbnails, and removes the old embedded Word task pane.
