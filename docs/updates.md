# 应用更新

0.5.9 起，更新检查直接读取 GitHub Release 中的签名文件，不依赖匿名 API 配额，也不需要用户登录或填写令牌。

应用菜单里的「检查更新…」可以检查 GitHub 上的最新正式发布。默认每天检查一次；「自动下载安装包」默认关闭，可以自行开启。后台检查不会弹出窗口打断输入，有新版时工具栏会出现入口。

只请求公开版本信息和安装包，不上传公式、Word 文档或使用记录。网络不可用时可以继续编辑，稍后重试。

下载完成后仍由用户点击「安装更新…」。先保存公式并完全退出 Word，应用会打开 macOS 安装器并退出。安装器可能要求管理员验证；装完后重新打开 Equation Lab。完整 PKG 同时维护 Word 插件。

0.5.7 及更早版本没有更新代码，不能远程补上这个入口。需要先从 [Releases](https://github.com/Ne1ther/EquationLab/releases/latest) 手动安装一次新版。

## 发布与校验

每个新版 Release 必须包含完整 PKG、`SHA256SUMS.txt` 和 `EquationLab-update.json`。后者的 Ed25519 签名绑定版本、build、架构、最低系统要求、安装包 URL、字节数、SHA-256 和中英文更新说明。应用使用内置公钥验证签名，并在下载后及打开安装器前检查安装包字节。

更新仅接受本仓库的 HTTPS 安装地址，网络跳转限 GitHub 的下载服务；不安装较旧的版本或 build。下载和校验可以取消，校验失败不会打开安装器。

这份更新签名与 Apple 的 Developer ID 签名、公证是两回事，不能替代后两者。当前安装包仍是未公证的预览版。

发布者通过 `EQUATIONLAB_UPDATE_PRIVATE_KEY` 指向本地私钥文件。私钥保存在被忽略的 `.local/update-signing/`，不能提交到仓库，也不能随清理缓存删除。发布说明写在 `packaging/update-notes.json`；构建脚本会核对签名公钥和版本，再自动生成更新附件。请在安全位置另行备份私钥；丢失后已有客户端无法验证使用新密钥签发的更新。

协议和篡改测试使用 `swift test`；打包签名测试包含在 `npm test`。可选的实际下载测试：

```sh
EQUATIONLAB_LIVE_UPDATE_TEST=1 swift test --filter testLiveGitHubDownloadAndRedirects
```

该测试使用实际 GitHub URL 下载 0.5.7 的约 80 MB 安装包，并核对已发布的 SHA-256，不执行安装。

参考：[GitHub 最新附件链接](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)、[Apple CryptoKit 签名验证](https://developer.apple.com/documentation/cryptokit/curve25519/signing/publickey/isvalidsignature(_:for:))。
