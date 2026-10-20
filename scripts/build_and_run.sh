#!/usr/bin/env bash
# Standalone development uses local Node. --word-test reuses a complete,
# accepted App to build in a user-owned directory and runs it from Applications;
# no system Installer is involved.
set -euo pipefail
MODE="run"
WORD_TEST=false
MODE_SET=false
for ARG in "$@"; do
  case "$ARG" in
    --word-test) WORD_TEST=true ;;
    run|--verify|--build-only|--debug|--logs|--telemetry)
      if [[ "$MODE_SET" == true ]]; then echo 'Choose one build/run mode.' >&2; exit 2; fi
      MODE="$ARG"; MODE_SET=true ;;
    --help)
      echo 'usage: build_and_run.sh [run|--verify|--build-only|--debug|--logs|--telemetry]'
      echo '       build_and_run.sh --word-test [run|--build-only|--verify]'
      exit 0 ;;
    *) echo "Unknown option: $ARG" >&2; exit 2 ;;
  esac
done
APP_NAME="EquationLab"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ "$WORD_TEST" == true ]]; then
  case "$MODE" in
    --verify) exec node scripts/build/word-test.mjs --verify "$ROOT_DIR" ;;
    run) node scripts/build/word-test.mjs preflight "$ROOT_DIR" ;;
    --build-only) ;;
    *) echo '--word-test supports run, --build-only or --verify.' >&2; exit 2 ;;
  esac
  swift build -c release
  BUILD_DIR="$(swift build -c release --show-bin-path)"
  exec node scripts/build/word-test.mjs "$MODE" "$ROOT_DIR" "$BUILD_DIR"
fi
swift build
BUILD_DIR="$(swift build --show-bin-path)"
APP_BUNDLE="$ROOT_DIR/dist/$APP_NAME.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/web/vendor" "$APP_BUNDLE/Contents/Resources/engine"
cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp desktop/*.html desktop/*.css desktop/*.js "$APP_BUNDLE/Contents/Resources/web/"
cp -R node_modules/mathlive/fonts "$APP_BUNDLE/Contents/Resources/web/vendor/"
cp -R src "$APP_BUNDLE/Contents/Resources/engine/"
mkdir -p "$APP_BUNDLE/Contents/Resources/engine/fonts" "$APP_BUNDLE/Contents/Resources/licenses"
cp assets/fonts/* "$APP_BUNDLE/Contents/Resources/engine/fonts/"
cp assets/licenses/* LICENSE THIRD_PARTY_NOTICES.md "$APP_BUNDLE/Contents/Resources/licenses/"
node --input-type=module - "$ROOT_DIR" "$APP_BUNDLE/Contents/Resources" <<'NODE'
import {buildWorkbenchAssets} from './packaging/workbench-assets.mjs';
import {buildMathLiveEditor} from './packaging/mathlive-editor.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
const [root,resources]=process.argv.slice(2);
await buildMathLiveEditor({root,mathliveDirectory:path.join(root,'node_modules','mathlive'),output:path.join(resources,'web','vendor','mathlive.min.js')});
await buildWorkbenchAssets({root,resources});
const manifest=JSON.parse(await fs.readFile(path.join(root,'design/equation-lab-icons/v6/manifest.json'),'utf8'));
await fs.copyFile(path.join(root,'design/equation-lab-icons/v6',manifest.icns),path.join(resources,'EquationLab.icns'));
NODE
mkdir -p "$APP_BUNDLE/Contents/Resources/engine/bin"
cp "$BUILD_DIR/EquationFontMetrics" "$APP_BUNDLE/Contents/Resources/engine/bin/"
node scripts/build/build-template-previews.mjs "$APP_BUNDLE/Contents/Resources/template-previews"
cp package.json "$APP_BUNDLE/Contents/Resources/engine/"
# Keep module reads inside the bundle. A symlink back into Documents can make
# a GUI-launched Node worker wait on macOS privacy checks during bootstrap.
if [[ -L "$APP_BUNDLE/Contents/Resources/engine/node_modules" ]]; then
  unlink "$APP_BUNDLE/Contents/Resources/engine/node_modules"
fi
rsync -a --delete "$ROOT_DIR/node_modules/" "$APP_BUNDLE/Contents/Resources/engine/node_modules/"
NODE_BINARY="$(command -v node)"
RELEASE_VERSION="$(node --input-type=module -e 'import fs from "node:fs";process.stdout.write(JSON.parse(fs.readFileSync("packaging/release.json","utf8")).version)')"
RELEASE_BUILD="$(node --input-type=module -e 'import fs from "node:fs";process.stdout.write(JSON.parse(fs.readFileSync("packaging/release.json","utf8")).build)')"
cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>EquationLab</string><key>CFBundleIdentifier</key><string>local.xuchang.equationlab</string><key>CFBundleName</key><string>EquationLab</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>$RELEASE_VERSION</string><key>CFBundleVersion</key><string>$RELEASE_BUILD</string><key>CFBundleIconFile</key><string>EquationLab</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSPrincipalClass</key><string>NSApplication</string><key>NSHighResolutionCapable</key><true/><key>EquationLabNode</key><string>$NODE_BINARY</string>
<key>NSAppDataUsageDescription</key><string>仅在你安装 Word 插件时，将受管理的原生组件安装到 Word 的 Startup 文件夹。</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>local.xuchang.equationlab.word-edit</string><key>CFBundleURLSchemes</key><array><string>equationlab</string></array><key>CFBundleTypeRole</key><string>Editor</string></dict></array></dict></plist>
PLIST
codesign --force --sign - "$APP_BUNDLE" >/dev/null 2>&1
case "$MODE" in
  --build-only) ;;
  run) /usr/bin/open -n "$APP_BUNDLE" ;;
  --verify) /usr/bin/open -n "$APP_BUNDLE"; sleep 1; pgrep -x "$APP_NAME" >/dev/null ;;
  --debug) lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ;;
  --logs|--telemetry) /usr/bin/open -n "$APP_BUNDLE"; /usr/bin/log stream --info --style compact --predicate 'process == "EquationLab"' ;;
  *) echo 'usage: build_and_run.sh [run|--verify|--build-only|--debug|--logs|--telemetry]' >&2; exit 2 ;;
esac
