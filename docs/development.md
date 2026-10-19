# 开发

安装 Node.js 24 和 Swift 6.2 / Xcode 命令行工具后：

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

`macos/` 是原生界面，`desktop/` 是公式编辑画布，`src/` 是公式数据、排版和本地服务，`native-word-probe/` 是 Word 原生插件，`updater/` 处理更新。

验证命令：

```sh
npm test
swift test
./native-word-probe/script/build_and_run.sh
node --test packaging/word-native-installer/installer.test.mjs
```

`node scripts/build/build-word-demo.mjs` 重新生成公开的 30 公式演示。用桌面 Word 检查并导出 PDF；预览和单元测试之外，还需验证冷启动、编辑回存和保存重开。

开发构建使用仓库内的运行资源。[第三方资源](../THIRD_PARTY_NOTICES.md)已随源码提供。完整发行包需要在 Word 中编译启动模板并验证加载，见[打包说明](../packaging/README.md)。

本仓库根目录是日常维护的 Git 工作区。原始研究材料、主机验证记录和私有配置保留在被忽略的本地目录中，不进入源码发布。

---

The source tree contains the native macOS UI, equation canvas, rendering engine, native Word integration, and updater. Use the commands above to build and test. A complete release also needs a Word-compiled startup template with real host validation; see the packaging guide.
