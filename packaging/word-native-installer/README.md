# Native Word installer preparation

This directory is independent of the frozen 0.4.1 release. It prepares installation, upgrades, rollback and verification for a **compiled, independently written global Word template plus native bridge**. It does not install the existing wef task pane or alter TLS trust. No real Word folder, security preference, application installation or final package is changed by preparing these tools.

## Installation layouts

The preferred candidate is `binding: startup-adjacent`: a Word-created `EquationLabStartup.dotm` uses the system `dlopen`/`dlsym`/libffi loader and resolves `MathTypeBridgeProbe.bundle` beside it in the actual Word Startup folder. The app installs three files/directories there as the current user: the unchanged compiled template, native bundle and `EquationLabInstallContext.json`. This needs no system-directory write or admin account. The CLI libffi proof is only an ABI test; real Word Declare, sandbox and cold AutoExec acceptance are required before `dynamicPathBound` becomes true.

The fallback is `binding: system-fixed`. The native bundle is installed through a normal administrator-authorized package at one host-accepted path:

```text
/Library/Application Support/Equation Lab/Word/MathTypeBridgeProbe.bundle
/Library/Application Support/Microsoft/Office365/Equation Lab/Word/MathTypeBridgeProbe.bundle
```

The app then installs the compiled template and context file for the selected user. A root package never guesses the logged-in user's home or Startup folder. `prepare-fixed-pkg.mjs` only creates the scripts/resources/distribution and command arrays for an **unsigned candidate**; it never invokes pkgbuild, Installer, Word or security tools. Final package creation remains gated by the main thread's host validation.

The default Office group path is a suggestion, not a universal truth. Word exposes its configured location through [`Options.DefaultFilePath`](https://learn.microsoft.com/en-us/office/vba/api/word.options.defaultfilepath), with [`wdStartupPath=8`](https://learn.microsoft.com/en-us/office/vba/api/word.wddefaultfilepath). The installer requires an explicitly confirmed absolute path or its own previous installation record; it does not change Word's setting.

Microsoft documents [AutoExec in a global/Startup template](https://learn.microsoft.com/en-us/office/vba/word/concepts/customizing-word/auto-macros). Office for Mac is [sandboxed](https://learn.microsoft.com/en-us/office/vba/api/overview/office-mac), and library binding still needs actual host evidence. Apple distinguishes [home-domain and system-domain installation](https://developer.apple.com/library/archive/documentation/DeveloperTools/Reference/DistributionDefinitionRef/Chapters/Distribution_XML_Ref.html). Neither package creation nor copying a template proves that AutoExec ran.

## Required developer artifacts

`artifacts.mjs` accepts `{template,bundle,source,acceptance,output}` on stdin. It freezes into a new empty directory containing the compiled dotm, exact signed native bundle and `artifact-manifest.json`. It reads the ZIP/CFB structure, checks the macro-enabled **template** content type, VBA project and compiled-cache streams, hashes source/template/VBA/native files, checks native signing, and requires a matching developer host receipt. Structural checks alone are explicitly insufficient.

The main thread must provide `equationlab.word-native-loader-acceptance.v1`:

```json
{
  "schema": "equationlab.word-native-loader-acceptance.v1",
  "binding": "startup-adjacent",
  "architecture": "arm64",
  "wordVersion": "actual tested version",
  "templateBuildId": "unique build identity",
  "templateSha256": "64 lowercase hex",
  "sourceSha256": "64 lowercase hex",
  "binarySha256": "64 lowercase hex",
  "dynamicPathBound": true,
  "autoExecColdStartPassed": true,
  "legacyOwnedFiles": []
}
```

For the fixed layout, supply `binding: system-fixed`, `fixedLibraryPath`, and `fixedPathBound: true`. Freeze after native signing. Do not edit the VBA source, compiled cache or template signature during user installation. Any final signing change that changes native bytes must be reconciled before freezing the artifact manifest.

Known old manual Equation Lab bundles may be migrated only through `legacyOwnedFiles: [{owner:"Equation Lab",role:"native-bundle",sha256:"exact frozen tree digest"}]`. Filename, display name or a familiar symbol is not ownership evidence. An exact recognized old bundle is fully backed up and restored on uninstall. Unknown or modified same-name files remain untouched. This does not adopt third-party templates or older untracked AutoExec templates.

## App/installer protocol

`installer.mjs` uses only Node built-ins. It reads one JSON request from stdin and emits one JSON response. It never performs an implicit install. The app's explicit install action can internally run plan then commit with the returned digest without asking the user twice.

```json
{
  "schema": "equationlab.word-plugin-request.v1",
  "action": "plan",
  "installationScope": "user",
  "artifactManifestDirectory": "/installed/app/Contents/Resources/native-word-artifacts",
  "startupDirectory": "/confirmed/current/user/Word Startup",
  "startupDirectoryConfirmed": true
}
```

Actions: `plan`, `install`, `verify`, `uninstall`, `rollback`, `recover`. `install` also requires `approvedPlanDigest` from its fresh plan; this protects against changed resources/targets rather than creating a separate user permission flow. Fixed-system removal/recovery supplies the exact `fixedBundlePath`. User removal/verification can reuse its previously confirmed Startup record.

The first status query needs only `{schema:"equationlab.word-plugin-request.v1",action:"verify",installationScope:"user"}` and returns `not-installed` without selecting or creating any Startup directory. A QA application without approved native resources returns `UNRELEASED_ARTIFACTS` if installation is requested.

Phases distinguish `planned`, `system-artifacts-installed`, `awaiting-word-restart`, `native-registered`, `removed`, `rolled-back`, and `failed`. An installed file or healthy app port cannot produce `native-registered`.

## Application resource wiring

`packaging/build-release.mjs` copies the built-ins-only installer into `Contents/Resources/installer/word-native-installer.mjs`. A developer-prepared directory supplied explicitly by `EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR` becomes `Contents/Resources/native-word-artifacts`. The exact accepted native bytes and signature are preserved during outer application signing, and the copied artifact manifest is checked again. The old task-pane installer remains an optional resource; it is not the native entry point.

The default `--purpose release` requires validated native artifacts. `--purpose qa` can omit them and writes `availability.json` with `available:false`; this supports UI review while compiled-template/Word acceptance is pending. `--app-only` builds a self-contained application and report without creating ZIP/DMG. Every build requires a new empty `--output` directory, so the frozen 0.4.1 application and packages cannot be replaced by a rerun.

Example for a separate UI candidate, from the repository root:

```sh
env -u EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR -u EQUATIONLAB_WORD_PLUGIN_DIR \
  ./scripts/package_release.sh --purpose qa --app-only --version 0.4.1 --build 6 \
  --output output/qa-word-auto-candidate-20261014-build6
```

The app executes the installer with its own `Resources/runtime/bin/node`, supplies request JSON on stdin, and reads one JSON response from stdout. No project path or external Node installation is needed. For first use, a directory-only `NSOpenPanel` can start at the standard Office group-container candidate and authorize the chosen location. The user must confirm that this is Word's actual Startup path, or the app needs an existing host observation; folder access alone does not prove Word's configuration. A custom Startup directory remains supported without modifying Word settings.

## Transaction and recovery rules

- Plans do not create directories. Code signatures and exact source hashes are checked before writes.
- Word must have exited normally; the process check is repeated after staging. No document save, force quit, process termination or service restart is performed.
- Owned previous content is verified, copied into a private transaction backup and checked. Staging and rename occur in the destination filesystem; previous mapped files are never overwritten in place.
- Every phase has a journal. Failed commit restores original artifacts and installation state. A crash can be recovered from the retained journal; an active installer lock is not stolen.
- Upgrade/uninstall/rollback refuse externally changed content. Recovery conflicts retain both current files and backups rather than deleting unknown data.
- Only the exact native-bundle/template/context destinations are managed. Normal.dotm, documents, third-party add-ins, macro policy, Word.app, Gatekeeper, URL defaults and certificates are untouched.
- Access denial returns `WORD_STARTUP_ACCESS_DENIED` with normal folder/OS-authorization guidance. It does not request Full Disk Access or disabling security.

## Cold-start registration receipt

The upcoming native zero-argument export `MathTypeBridgeWriteStartupReceipt` should resolve its own image with dladdr, read the adjacent Startup `EquationLabInstallContext.json`, and write only metadata into `.EquationLab/native-startup-receipt.json`. The context has `installId`, `installedAt`, `templateBuildId`, helper version and receipt path. Receipt schema:

```json
{
  "schema": "equationlab.word-native-startup-receipt.v1",
  "entryPoint": "AutoExec",
  "installId": "copied from context",
  "templateBuildId": "copied from context",
  "helperVersion": "actual native bundle version",
  "templateSha256": "hash of the actual installed compiled template",
  "helperSha256": "hash of the actual loaded native executable",
  "wordPID": 123,
  "wordVersion": "actual host version",
  "registrationResult": 0,
  "registrationState": 1,
  "registeredCLSIDs": [
    "0002CE03-0000-0000-C000-000000000046",
    "0002CE03-0000-0000-C000-000000000056"
  ],
  "timestamp": "UTC ISO timestamp"
}
```

Verification requires matching current install/build/version, actual template/native hashes, a currently running Word PID, a timestamp after installation, both classes, and successful state. The receipt contains no document name, formula, path to a document, native body, ticket or editor URL. It proves registration within this integration contract; it does not prove the first double-click woke the correct app or that every formula round trip passed. `coldEditorWakeVerified` remains false until a separate actual edit acceptance is integrated. The frozen 0.0.4 bridge does not have this receipt export; the newly built 0.0.5 implements it and still needs actual Word AutoExec acceptance.

## Validation

```sh
node --test packaging/word-native-installer/installer.test.mjs
```

The tests use nonexecutable fixture bytes and an explicitly confined, remapped temporary filesystem. They simulate compiled/host flags and signature verification only to exercise installer behavior; they are not Word, native-binding or macro-execution evidence. Tests cover first install, exact legacy migration, no-admin adjacent layout, backup/upgrade/uninstall/rollback, forced process exit and journal recovery, mid-commit failures, stale plans, externally modified files, symlinks, normal permission errors and stale/missing receipts. No system or actual user Word target is used.
