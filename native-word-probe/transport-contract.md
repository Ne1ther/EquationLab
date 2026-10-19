# Word 编辑通信

原生 Word 组件使用 `http://127.0.0.1:37952` 的 POST JSON 接口，不接受重定向。实现见 `src/editor_transport.mm` 和 `../src/word-native-session.mjs`。

## 打开

`POST /api/native-open`：

```json
{"session":"123","native":"base64 Equation Native","acknowledgement":true,"document":{"ooxml":"Flat OPC XML","index":0,"name":"demo.docx"}}
```

`session` 是无符号 64 位整数的十进制字符串。`native` 含 28 字节头和 MTEF 正文。`document` 可省略；提供时必须与当前公式的原生数据及正文索引匹配。

返回 `ticket`（64 个小写十六进制字符）和 `editorUrl`（`equationlab://word-edit/<ticket>`）。组件明确定位 `app.equationlab.mac`，不用系统默认 URL 处理程序。仅连接被拒绝时尝试一次唤醒，随后在十秒内最多重试八次。

## 编辑、保存和切换

`POST /api/native-poll` 携带 `ticket`，每秒轮询：

| 状态 | 内容 |
| --- | --- |
| `editing` | 继续等待 |
| `complete` | `native`、单页 `pdf`、`width`、`height` |
| `navigate` | 目标公式的零起始 `index` |
| `cancelled` | 结束编辑，保留原公式 |

宽高使用正整数 HIMETRIC。原生数据和 PDF 各不超过 16 MiB，组件先检查数据、单页 PDF 和尺寸，再在 Word 主线程回存。之后发送 `/api/native-ack`，携带 `ticket`、原 `session` 和 `ok`；App 通过 `/api/native-status` 等待确认。

App 使用 `/api/native-read` 取得当前公式和文档快照，使用 `/api/native-complete` 提交结果。`/api/native-navigate` 接受 `ticket` 和 `index`，丢弃旧快照后通知 Word 定位并打开目标。它不会替未保存的编辑自动提交。

## 清理与检查

完成、取消、错误或对象关闭后清理会话；失联会话在二十分钟后过期。临时目录权限为 `0700`，文件为 `0600`。日志不记录公式、文档名、ticket 或编辑 URL。

接口测试见 `tests/word-native-session.test.mjs`、`tests/word-native-rpc.test.mjs`；原生传输和应用定位测试见 `script/run_transport_tests.mjs`、`script/run_launch_target_tests.mjs`。发布时另测实际 Word 双击、切换、保存和重开。
