# Word 原生插件安装器

完整 PKG 安装 App，并按 Word 的实际 Startup 设置安装插件。macOS 尚未允许访问 Office 文件夹时，先完成 App 安装，再由 App 引导授权和用户级插件安装。插件安装会写入已验收的模板和辅助组件，并配置用户后台服务。安装记录包含组件哈希、版本和路径，后续修复、迁移或卸载只处理本产品管理的文件。

`artifacts.mjs` 冻结真实 Word 编译与冷启动验收后的输入，`build-automatic-pkg.mjs` 构建系统安装包，`automatic-install.mjs` 负责 PackageKit 安装流程。

`installer.mjs` 提供检查、安装、验证、迁移和移除操作。执行入口使用规范化路径，兼容 PackageKit 的 /tmp 与 /private/tmp 路径。

```sh
node --test packaging/word-native-installer/installer.test.mjs
node --test tests/word-automatic-install.test.mjs tests/word-service.test.mjs
```

完整命令与发布文件见[打包说明](../README.md)。实际验收流程必须确认安装器顺利退出、用户安装记录写入正确、后台服务正常运行、新打开的 Word 进程能顺利加载插件，并且双击公式能够完成编辑与保存写回。
