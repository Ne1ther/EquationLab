# EquationLab native editor transport

The native Word helper sends only POST JSON to fixed loopback `http://127.0.0.1:37952` and rejects redirects. It does not use the task-pane TLS endpoint. Version0.0.3 may request one App wake only after a specifically identified connection-refused failure; this feature has not yet been exercised inside Word.

## Open

`POST /api/native-open`

```json
{"session":"123","native":"base64 complete Equation Native stream"}
```

Session is an unsigned64 decimal string, not a JSON number. Native includes the28-byte Equation Native header and MTEF body. The response must be HTTP200:

```json
{"ticket":"64 lowercase hexadecimal characters","editorUrl":"equationlab://word-edit/<same ticket>"}
```

The helper immediately returns from DoVerb while the request is pending. On a valid reply, it opens that URL through NSWorkspace. Version0.0.4 resolves only the stable application bundle identity `app.equationlab.mac` with `URLForApplicationWithBundleIdentifier`, then passes both the URL and that exact application path to `openURLs:withApplicationAtURL:configuration:completionHandler`. Both `equationlab://wake` and `equationlab://word-edit/<ticket>` use the same target-selection helper. The system's default scheme association may still point to an old development app (`local.xuchang.equationlab`); it is neither used nor changed by this transport. A missing application, open error, or missing successful running-application result is `LaunchFailure` (diagnostic3), with no fallback to another scheme handler. On a bad URL/shape/launch/network error it ends the object edit without applying a formula. The source equation/ticket must not appear in service/access logs.

If the initial native-open error contains POSIX ECONNREFUSED (or the equivalent underlying CFStream POSIX error), the helper opens exactly `equationlab://wake` once and retries native-open up to eight times, at500ms intervals, within a ten-second wake deadline. The existing session/native body is retained only while active. HTTP4xx/5xx, malformed responses, timeouts, other network errors, and generic cannot-connect classification do not cause wake. Failure, cancellation, or object Close clears pending data and cancels retry. Standalone tests use real refused/restarted loopback sockets and a mocked URL launcher; they do not start an App.

## Poll and complete

`POST /api/native-poll {"ticket":"..."}`

Editing: `{"state":"editing"}`. Cancel: `{"state":"cancelled"}`. Complete:

```json
{"state":"complete","native":"base64 complete Equation Native","pdf":"base64 single-page PDF","width":2540,"height":1270}
```

Width and height are positive integral signed32 **HIMETRIC**, not CSS pixels or PDF points. Each decoded blob must be ≤16MiB. PDF must parse as exactly one page. Native must have header size28 and exact body-length field. The server must validate MTEF edits more strictly than this frame check. Both payloads and extent are validated before callbacks.

Polling is every second, main-thread asynchronous; three successive transient failures are retried, then the fourth ends editing. Tickets cannot be shared by simultaneous sessions. A result applies only to its object's still-active native session. Preview is supplied first, then CompleteEdit invokes the OLE client's SaveObject on the main/creation thread. The object refuses updates during NoScribble save state or from a different thread.

The server/App can implement `/api/native-read {"ticket":"..."}` privately; the helper does not call it. The app is responsible for secure local formula state and completion/cancel controls.

## Cleanup

On completion, cancellation, error, or Word object Close, helper cancels its pending request/timer and sends best-effort `POST /api/native-cancel {"ticket":"..."}`. Return HTTP200 `{ "state":"cancelled" }` and erase server-held native/PDF state immediately. Cancel of a completed result should act as acknowledgement/cleanup, not undo the Word save. If this endpoint is absent, lost, or the open reply was cancelled before the ticket was known, the server's20-minute expiry must remove the data. Local temp files, when necessary for app exchange, must be mode0600 and deleted on terminal state/expiry. Production transport creates no files.

Root's app/API contract and this helper must both be tested against each other before a native Word activation is claimed. Standalone tests substitute a known local HTTP server and URL-launch callback; they do not open EquationLab or Word.

## Explicit application routing tests

`node native-word-probe/script/run_launch_target_tests.mjs` builds a temporary Objective-C++ executable that includes the actual private production launcher. A fake workspace checks both wake and edit URLs against the stable bundle ID and verifies that the resolved application path is passed to the explicit open API. Eight cases cover success, absent application, open error and absent success object for both URL kinds; the default-handler API must never be called. No real NSWorkspace, GUI, default URL association or installed bundle is touched. The existing `self.launch` injection remains an independent override with its prior semantics, covered by the loopback transport tests. These checks do not substitute for the separate real Word-host routing and save/reopen acceptance trial.
