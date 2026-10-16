# Native startup receipt, helper0.0.5

The exported zero-argument C function `int32_t MathTypeBridgeWriteStartupReceipt()` is compatible with the existing dynamic AutoExec loader's optional libffi call. It does not register classes or launch an app. It only reports a registration that already exists in the real Word process.

Production guards require the actual Word executable, Word's main thread, and `MathTypeBridgeMathTypeRegistrationState()==1`. The function uses `dladdr` on its own export to locate the helper image, resolves its real path, and derives the parent of `MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe` as the actual adjacent Startup directory. It never guesses a username, default Startup folder, app location or current working directory.

It reads only the adjacent `EquationLabInstallContext.json`, with schema `equationlab.word-native-install-context.v1`, and requires a valid UUID installId, nonempty templateBuildId, installedAt no later than the receipt time, helperVersion and a valid templateSha256. It checks helperVersion against both this compiled helper's0.0.5 constant and the actual bundle Info.plist, and checks the installed `EquationLabStartup.dotm` bytes against templateSha256. The declared context receiptPath is ignored; it cannot redirect output.

The only output is `Startup/.EquationLab/native-startup-receipt.json`. The directory is opened without following symlinks and is private to the current user. A new0600 temporary file is fully written and synced, then atomically renamed. Failure before rename leaves any prior receipt unchanged. Symlink files/directories are rejected. No document, formula, ticket, editor URL, security preference or native registry file is read or written.

Receipt fields match `packaging/word-native-installer`:

- schema `equationlab.word-native-startup-receipt.v1`, entryPoint `AutoExec`;
- installId, templateBuildId, compiled/Info-checked helperVersion;
- actual Word PID/version, successful registration result0/state1, both original MathType CLSIDs;
- UTC ISO timestamp, actual helper path, current helper executable-file SHA256, and verified template SHA256.

The hash records the current executable file, not an attestation of every mapped process page. Installation therefore still requires Word to exit before replacing native files, and verification must bind a new Word PID and current artifact hashes. The `AutoExec` entry-point field describes the agreed loader/export contract; it is not independent proof of which VBA procedure called the export. Real cold-start template execution remains a separate developer host acceptance.

Return codes:

| Code | Meaning |
| --- | --- |
| 0 | Receipt was committed |
| -1 | Not the real Word executable |
| -4 | Not Word's main thread |
| -6 | Original classes are not registered |
| -7 | Missing, malformed or unbound install context |
| -8 | Helper identity/version or installed template/hash mismatch |
| -9 | Receipt directory/file write failed or was a symlink |
| -10 | Invalid loaded image, Word metadata or Startup directory |

Missing receipt export in0.0.4 produced the loader's sentinel-1001;0.0.5 provides it without changing the VBA source or its zero-argument int32 ABI. The fixed-system package fallback needs a separately accepted context-location contract; this adjacent export does not silently read a default user Startup for a globally loaded bundle.

Reproduction:

```sh
node native-word-probe/script/run_startup_receipt_tests.mjs
native-word-probe/script/build_and_run.sh
node native-word-probe/automatic-loader/run_dynamic_ffi_probe.mjs
node native-word-probe/script/run_transport_tests.mjs
```

The receipt unit executable includes the actual private implementation and injects host/thread/registration metadata only inside a temporary filesystem. It verifies context/version/hash binding,0600 atomic replacement, previous receipt preservation on failure, Unicode Startup, ignored output redirection and rejected symlinks. The public export is also checked to reject the real CLI process. Those injected success cases are not Word/AutoExec evidence. The dynamic ffi probe calls the real public0.0.5 export and receives-1 outside Word. Frozen0.0.4 artifacts are not modified by the build.
