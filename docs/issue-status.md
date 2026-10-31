# GitHub 反馈处理记录

2026-10-31。当前公开安装包是 **0.6.12（build100）**。各条反馈的定位、修复版本和待确认结果如下。

| Issue | 核对结果 | 当前处理 |
| --- | --- | --- |
| [#2 行内公式插入后选不中](https://github.com/Ne1ther/EquationLab/issues/2) | 旧插入流程中的提示。当前版本支持新建公式，也支持编辑已有 MathType 原生对象。 | 本轮用 0.6.11 正式安装版完成行内插入、修改、保存及再次打开，DOCX 保留 `Equation.DSMT4` 和更新后的 Equation Native 内容。尚未收到反馈者对更新版本的复测结果。 |
| [#3 M2 安装失败](https://github.com/Ne1ther/EquationLab/issues/3) | 附件日志显示 `preinstall` 因 Office 文件夹访问权限被拒绝而退出，随后出现 `PKInstallErrorDomain 112`。这份日志没有指向 M2 或 WPS 冲突。 | **0.6.12 已发布此修复。** 完整安装包遇到该权限错误时先装好 App，保留现有 Word 组件；打开 App 后按提示授权并完成用户级插件安装。其他安装错误仍正常报告。 |
| [#4 双击无法确认 Word 文档](https://github.com/Ne1ther/EquationLab/issues/4) | 原报告为 0.6.6，后续确认 0.6.9 仍无法打开。弹窗表示插件没有拿到可验证的文档／公式上下文。 | 0.6.11 修复了自动启动入口，并已在本机验证真实冷启动、原生公式打开和保存。本轮公开样例也读取到 30 个公式及匹配的编号。尚未确认报告中的 macOS 15.7.4 环境，因此继续跟踪，不将它标为已解决。 |
| [#5 中文输入被打断](https://github.com/Ne1ther/EquationLab/issues/5) | 附件动图能看到长拼音被拆开，但没有应用版本或输入法信息。 | 0.6.11 已发布组字保护：组字时延后 Word 宏轮询，提交后恢复。发布所用 Word 组件在本机正文的六秒长拼音实测中通过；编辑器修复也在发布前通过 LaTeX 区和公式画布实测。仍需确认反馈者使用的版本及更新后的结果。 |

## 复测时怎样定位

先从 **Equation Lab → 关于**确认版本。然后打开 **Office 插件 → 检查连接**，需要进一步排查时点**复制连接诊断**。诊断只包含版本、组件及连接状态，不带文档内容、文件名或路径。

双击报错时，区分“功能区未加载”“无法确认文档上下文”和“编辑器已经打开但没有置前”。这三个现象的处理入口不同。请保留具体提示；不必反复重装或把论文原件上传到 issue。

本轮安装回归使用临时目录模拟目录和数据库权限拒绝，验证了预检不写文件、延后配置不改 Word、授权后完成安装、失败回滚及其他加载项保留。候选 App 和 PKG 另行构建核对；这些检查不等同于另一台 Mac 上的系统授权验收。

---

# GitHub issue status

Checked on 2026-10-31. The public installer is **0.6.12 (build100)**.

- **[#2](https://github.com/Ne1ther/EquationLab/issues/2):** This warning came from the older insertion flow. The installed 0.6.11 release passed an inline insert, edit, save and reopen test on our Mac, with the native `Equation.DSMT4` object intact. Creating new equations is supported. Reporter confirmation on the updated version is still pending.
- **[#3](https://github.com/Ne1ther/EquationLab/issues/3):** The attached log identifies denied Office-folder access in `preinstall`, followed by installer error 112. The fix in 0.6.12 lets the full package install the app first and finish Word setup from the app after folder consent. Existing Word components are left intact until then. **This change ships in 0.6.12.**
- **[#4](https://github.com/Ne1ther/EquationLab/issues/4):** The report covers 0.6.6 and 0.6.9. Version 0.6.11 fixes the automatic startup entry and has passed local Word cold-start and native-equation lifecycle checks. We also opened the public 30-equation sample in this pass. The reporter’s macOS 15.7.4 environment remains unconfirmed, so this issue stays open.
- **[#5](https://github.com/Ne1ther/EquationLab/issues/5):** The animation shows interrupted Chinese composition, but does not identify the app version. Version 0.6.11 defers Word macro polling during composition. The shipped Word components passed six-second composition tests in Word on our Mac. The editor fix also passed real input tests in its LaTeX field and formula canvas before release. Confirmation from the reporter is still needed.

Use **About** to check the app version, then **Office plugin → Check connection / Copy connection diagnostics**. Diagnostics contain versions and connection states, without document content, names or paths. The installer regression tests simulate denied filesystem access; they do not establish a successful macOS consent flow on another machine.
