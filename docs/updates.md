# 应用更新

默认每天自动检查一次更新，有新版时会在工具栏显示更新按钮。你也可以在 **Equation Lab → 检查更新…** 中手动检查或开启自动下载。下载完成后，由你选择何时安装。

更新文件来自本项目的 GitHub Releases，下载不需要登录 GitHub。App 会先核对更新清单的签名，再按清单校验下载的安装包。下载失败可以重试，也可以去 Release 页面手动下载。

发布新版本时，需要一并上传同一次构建生成的 PKG、`EquationLab-update.json` 和 `SHA256SUMS.txt`，见[打包说明](../packaging/README.md)。

---

The app checks daily by default and shows a toolbar button when an update is available. Choose **Equation Lab → Check for updates…** for a manual check or optional automatic downloads. Updates come from this project's GitHub Releases without a GitHub login. Downloads are verified before you choose when to open Installer. Publish the PKG, update metadata, and checksums from the same build.
