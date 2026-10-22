# 新公式默认设置

新公式默认使用 Times / Symbol 字体和 12 pt 完整字号。上下标、次级上下标、符号、次级符号分别为完整字号的 58%、42%、150%、100%。

在右侧检查器中调整字体、字号和间距。选择“设为新公式默认”后，新建公式沿用你的设置；“恢复 MathType 默认”恢复基础值，“恢复原始设置”回到本次载入时的值。已有公式保留自身设置。

`src/new-formula.mjs` 统一创建 App 预览、Word 插入和 DOCX 导出的原生数据。默认值来源及资源许可见[第三方说明](../THIRD_PARTY_NOTICES.md)，相关回归见 `tests/native-complex-inputs.test.mjs` 和 `tests/native-layout.test.mjs`。

---

New equations use Times / Symbol at 12 pt, with relative sizes of 58%, 42%, 150%, and 100%. Save your own defaults from the inspector; existing equations retain their settings. The shared factory is `src/new-formula.mjs`.
