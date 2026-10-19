# 应用更新

在 **Equation Lab → 检查更新…** 中手动检查，也可以设置每日检查和自动下载。发现新版会显示版本与更新内容；安装包下载完成后，再由你选择何时打开 macOS 安装器。

更新从本项目的 GitHub Releases 获取，不需要登录或配置 GitHub 令牌。更新元数据和安装包会先校验，失败时可以重新下载或从 Release 页面手动安装。

开发者发布时，安装包、`EquationLab-update.json` 和 `SHA256SUMS.txt` 必须来自同一次构建，一起上传。相关构建配置见[打包说明](../packaging/README.md)。

---

Choose **Equation Lab → Check for updates…** for manual checks, daily checks, and optional automatic downloads. Updates come from this project's GitHub Releases without a GitHub login. Downloads are verified before you choose when to open Installer. Publish the PKG, update metadata, and checksums from the same build.
