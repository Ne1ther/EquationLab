# 新公式默认设置

新公式默认使用 Times / Symbol 字体和 12 pt 完整字号。上下标、次级上下标、符号、次级符号分别为完整字号的 58%、42%、150%、100%。

在右侧检查器中调整字体、字号与间距。点“设为新公式默认”，后续新建的公式就会沿用你的设置。“恢复 MathType 默认”回到基础预设，“恢复原始设置”回到这次载入公式时的值。文档中已有的公式保留原有设置。

`src/new-formula.mjs` 统一创建 App 预览、Word 插入和 DOCX 导出的原生数据。默认值来源及资源许可见[第三方说明](../THIRD_PARTY_NOTICES.md)，相关回归见 `tests/native-complex-inputs.test.mjs` 和 `tests/native-layout.test.mjs`。

---

New equations use Times / Symbol at 12 pt, with relative sizes of 58%, 42%, 150%, and 100%. Adjust and save your own defaults from the inspector; existing equations retain their current settings. The shared factory is `src/new-formula.mjs`.
