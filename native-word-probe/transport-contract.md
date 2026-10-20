# Word 编辑通信

原生 Word 组件使用 `http://127.0.0.1:37952` 的 POST JSON 接口，不接受重定向。实现见 `src/editor_transport.mm` 和 `../src/word-native-session.mjs`。

## 打开

`POST /api/native-open`：

```json
{"session":"123","native":"base64 Equation Native","acknowledgement":true,"document":{"ooxml":"Flat OPC XML","index":0,"name":"demo.docx","identity":"123","snapshot":124}}
```

`session` 是无符号 64 位整数的十进制字符串。`native` 含 28 字节头和 MTEF 正文。`document` 可省略；提供时必须与当前公式的原生数据及正文索引匹配。

`identity` 标识当前 Word Document 的生命周期，`snapshot` 标识一次捕获。文档名不参与目标身份判断。读取结果的 `documentContext` 说明快照是否可用、公式数量及选中索引。

返回 `ticket`（64 个小写十六进制字符）和 `editorUrl`（`equationlab://word-edit/<ticket>`）。组件明确定位 `app.equationlab.mac`，不用系统默认 URL 处理程序。仅连接被拒绝时尝试一次唤醒，随后在十秒内最多重试八次。

## 编辑、保存和切换

`POST /api/native-poll` 携带 `ticket`，定期轮询：

| 状态 | 内容 |
| --- | --- |
| `editing` | 继续等待 |
| `complete` | `native`、单页 `pdf`、`width`、`height`，可带 `target` |
| `navigate` | 目标公式的零起始 `index` |
| `cancelled` | 结束编辑，保留原公式 |

宽高使用正整数 HIMETRIC。原生数据和 PDF 各不超过 16 MiB，组件先检查数据、单页 PDF 和尺寸，再在 Word 主线程回存。之后发送 `/api/native-ack`，携带 `ticket`、原 `session` 和 `ok`；App 通过 `/api/native-status` 等待确认。

App 使用 `/api/native-read` 取得当前公式和文档快照，左侧切换在 App 内完成。保存其他公式时，`/api/native-complete` 在原 ticket 中提交 `target: {index, expectedNativeSha256, documentIdentity}`。服务核对原会话和快照；Word 组件再核对 Document、原 InlineShape 锚点及 Native 哈希，在后台写回并确认。App 收到确认后返回 Word。

`/api/native-navigate` 保留供旧调用方使用，接受 `ticket` 和 `index`，通知 Word 打开目标；它不会替未保存的编辑自动提交。

同一 OLE 对象再次打开而没有新选择事件时，可复用服务已校验的文档快照。关联使用对象生命周期 ID，不使用指针地址或文档名。缓存最多保留 4 份快照、32 个对象关联和 32 MiB XML。写回仍须核对当前对象。

Native 写回立即清空全部 XML 缓存，同时为最多 32 个存活对象保留轻量的 Document 身份、旧快照锚点、索引和 Native SHA。它们没有 XML、文件名、路径或原生对象强引用。缺少新快照时，组件发布一个按需捕获请求；VBA 用已经绑定的 Document 和 InlineShape Range 捕获新快照，不依赖当前选择，也不改变前台窗口。服务仍核对新快照与该对象 Native SHA。

`MathTypeBridgeTakeDocumentCaptureRequest` 只领取当前最新激活的一次请求，`MathTypeBridgeDocumentCapture{RequestToken,Snapshot,Index,Identity}` 返回其绑定。VBA 强制生成新快照后调用 `MathTypeBridgeFinishDocumentCaptureRequest`；失败调用 `MathTypeBridgeFailDocumentCaptureRequest`。只有 Document 生命周期一致、新快照、当前 activation 且未过期的响应可继续。SaveObject 期间不可领取请求。重复打开同一对象共用该请求；文档清理、关闭及对象释放清除关联。请求超时会结束待打开会话，可重新双击重试，已知文档不会静默降为单式。

现有 OnTime 每秒只检查整数请求，WordOpenXML 不参与周期轮询。正常新捕获沿用约 25ms 的准备路径；只有缺快照的已知对象等待按需捕获，等待边界为三秒。原生测试可以模拟 VBA 回应；实际 Word 是否完成捕获须另行验证。

## 清理与检查

完成、取消、错误或对象关闭后清理会话；失联会话在二十分钟后过期。临时目录权限为 `0700`，文件为 `0600`。日志不记录公式、文档名、ticket 或编辑 URL。

接口测试见 `tests/word-native-session.test.mjs`、`tests/word-native-rpc.test.mjs`；原生传输和应用定位测试见 `script/run_transport_tests.mjs`、`script/run_launch_target_tests.mjs`。发布时另测实际 Word 双击、切换、保存和重开。
