# Word 启动记录

原生组件 0.0.12 导出 `int32_t MathTypeBridgeWriteStartupReceipt()`。Word 加载模板并完成原生类注册后调用它，安装器据此检查插件是否在新的 Word 进程中加载。

实现位于 `src/startup_receipt.mm`，要求真实 Word 进程、主线程和注册状态 `1`。组件从自身路径定位相邻的 Startup 目录，读取 `EquationLabInstallContext.json`，核对安装 ID、模板构建号、安装时间、组件版本和模板哈希。

记录写入 `Startup/.EquationLab/native-startup-receipt.json`，包含：

- schema `equationlab.word-native-startup-receipt.v1` 和入口 `AutoExec`；
- 安装 ID、模板构建号、组件版本与模板/可执行文件 SHA-256；
- Word PID、版本、注册结果、类 ID、组件路径和时间。

目录权限为 `0700`，文件为 `0600`，写入采用临时文件加原子替换，拒绝符号链接。写入失败会保留已有记录。

## 返回值

| 值 | 含义 |
| --- | --- |
| `0` | 写入成功 |
| `-1` | 不是 Word 进程 |
| `-4` | 不是主线程 |
| `-6` | 原生类尚未注册 |
| `-7` | 安装上下文缺失或无效 |
| `-8` | 组件身份、版本或模板哈希不匹配 |
| `-9` | 写入失败或遇到符号链接 |
| `-10` | 组件路径或 Word 信息无效 |

安装或更新前须退出 Word。验证时同时核对新 PID、当前安装 ID 和组件哈希；已有旧记录不能证明新版本已加载。

测试：`node native-word-probe/script/run_startup_receipt_tests.mjs`。真实 Word 冷启动验收另行记录，不以测试注入的环境代替。
