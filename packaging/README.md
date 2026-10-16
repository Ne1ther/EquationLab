# Equation Lab release packaging

The distribution channel is GitHub Releases. `scripts/package_release.sh` creates a self-contained Apple Silicon application, a complete App + Word `.pkg`, ZIP and optional read-only DMG. The complete PKG is the primary download for ordinary users. Recipients need no Node, npm, Swift, Xcode, Python, source checkout, local compilation, macro import or plugin-folder selection. The current local candidate is 0.5.5 build38 under `dist/0.5.5-build38/`, including the replacement rendering resources. Build37 is retained as the previous reference; older package reports are in `evidence/maintenance/2026-10-16-cleanup/release-reports/`. This workflow does not submit the app to the Mac App Store.

The builder uses v6 optical icon assets, release Swift executables and official Node24.21.0 verified against the vendor SHA256 manifest. It installs locked production dependencies into a private staging tree, applies `prune-dependencies.mjs`, verifies production entries and internal symlinks, preserves licenses, and strips only Node local symbols before nested signing. Native dependencies outside system libraries are rejected. No private key, developer certificate, vendor installer or REA binary is shipped.

```sh
EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR="$PWD/native-word-probe/releases/0.0.11" \
  ./scripts/package_release.sh --output "$PWD/dist/NEW_EMPTY_RELEASE_DIRECTORY"
```

For repeat local builds, `EQUATIONLAB_NODE_RUNTIME_CACHE` can reuse a trusted, previously verified runtime. The cache contains `bin/node`, `LICENSE`, and `runtime-cache.json` with schema `equationlab.node-runtime-cache.v1`, the exact Node `version`, `source`, optional `archiveSha256`, and SHA-256 values in `files` for both files. The builder checks the version and digests, uses the local npm build tool, and records that provenance. The default still downloads and verifies the official Node archive. Cache files stay outside the source export.

A release requires a frozen real Word-compiled template and host-accepted signed helper. `--purpose qa` can omit these and clearly disables native installation. Freezing uses `word-native-installer/artifacts.mjs` with matching source/template/helper hashes and real cold AutoExec acceptance. ZIP extraction and DMG read-only engine execution receive fresh signature checks.

`Contents/Resources/runtime/bin/node` is the runtime; `engine/` holds the renderer and production dependencies, and `engine/bin/EquationFontMetrics` is the CoreText helper. All runtime paths are bundle-relative. Node exported symbols are compared before and after stripping; native Word artifacts keep their exact host-accepted signatures.

The complete PKG installs the App and native Word integration automatically. The App toolbar and Word menu expose an Office plugin manager. A previously registered user installation can update directly through the App; first installation and uninstall use bundled system installers. Neither path asks the user to choose a plugin folder.

The native integration combines the compiled global RibbonX `.dotm`, adjacent signed helper and generated install context. Cold Word AutoExec writes a receipt bound to install ID, template/helper hashes, version and live Word PID. Verify distinguishes waiting for restart from actual registration. Plan/install/verify/uninstall preserve unknown files and reject changed owned files. Word's macro policy remains in effect. A login LaunchAgent maintains the local native transport after the App closes.

The previous Web sideload manifest is backed up and removed only when its installed hash matches its ownership record. A fresh native installation does not require Office.js, a local HTTPS certificate or developer add-in activation. The older manual NSOpenPanel/Web workflows are development history, not the current user installation flow.

The standalone App works without Word. Current Office integration targets Word only. Full original MathType parity remains unverified; see [current feature scope](../docs/features.md).

```sh
node --test packaging/word-native-installer/installer.test.mjs
```

The builder checks the relocated engine using its bundled runtime and dependencies, preserves the frozen Word component signatures, and verifies the final application and extracted ZIP signatures. Real Word editing and fresh-machine installation are separate validation steps.

By default signing is ad-hoc, and the PKG is unsigned. Open-source publication and GitHub preview releases do not depend on App Store submission or buying a signing identity. macOS may warn about or block downloaded unsigned/unnotarized artifacts, so the current preview must not be described as friction-free on every fresh Mac.

Optional direct-distribution signing uses `EQUATIONLAB_SIGN_IDENTITY` for a real existing Developer ID Application identity and `EQUATIONLAB_INSTALLER_SIGN_IDENTITY` for a Developer ID Installer identity. These certificates and notarization support distribution outside the Mac App Store; GitHub can remain the download channel. No Apple account credentials are read, and notarization is not automatic. A Gatekeeper policy override never counts as distribution trust. See [Apple Developer ID](https://developer.apple.com/developer-id/) and [Apple's downloaded-software guidance](https://support.apple.com/102445).
