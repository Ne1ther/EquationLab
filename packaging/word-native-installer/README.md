# Word 原生插件安装器

完整 PKG 将 App 与 Word 插件一起安装。它检测 Word 的实际 Startup 设置，写入已验收的模板和辅助组件，并配置用户后台服务。安装记录包含组件哈希、版本和路径，修复、迁移及卸载仅处理本产品管理的文件。

`artifacts.mjs` 冻结真实 Word 编译与冷启动验收后的输入，`build-automatic-pkg.mjs` 构建系统安装包，`automatic-install.mjs` 负责 PackageKit 安装流程。

`installer.mjs` 提供检查、安装、验证、迁移和移除操作。执行入口使用规范化路径，兼容 PackageKit 的 /tmp 与 /private/tmp 路径。

```sh
node --test packaging/word-native-installer/installer.test.mjs
node --test tests/word-installer-cli.test.mjs
```

完整命令与发布文件见[打包说明](../README.md)。实际验收包括安装器完成、用户安装记录、后台服务、新 Word 进程加载，以及双击公式编辑回存。
