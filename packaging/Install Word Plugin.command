#!/bin/bash
set -euo pipefail
TASK_LOCATION="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_APP="/Applications/Equation Lab.app"
if [[ ! -d "$TASK_APP" ]]; then
  if [[ -d "$TASK_LOCATION/Equation Lab.app" ]]; then
    echo '请先将 Equation Lab 拖入 Applications，再打开应用中的“安装 Word 插件”。'
    exit 1
  fi
  echo '未找到 /Applications/Equation Lab.app。请先安装 Equation Lab。'
  exit 1
fi
"$TASK_APP/Contents/Resources/runtime/bin/node" "$TASK_APP/Contents/Resources/installer/install-word-plugin.mjs" --app "$TASK_APP"
printf '\nWord 插件准备完成。请打开 Equation Lab，并重新打开 Word。\n'
