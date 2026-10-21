#!/bin/zsh
set -euo pipefail
probe_root="${0:A:h:h}"
probe_build="$probe_root/build"
probe_version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$probe_root/Info.plist")
if ! rg -Fq "CompiledHelperVersion=@\"$probe_version\";" "$probe_root/src/startup_receipt.mm"; then
  print -u2 "Native receipt version and Info.plist differ; refusing to build."
  exit 1
fi
probe_flags=()
if [[ "${PROBE_SANITIZE:-0}" == 1 ]]; then
  probe_build="$probe_root/build-asan"
  probe_flags=(-g -fsanitize=address,undefined -fno-sanitize=vptr -fno-omit-frame-pointer)
fi
probe_bundle="$probe_build/MathTypeBridgeProbe.bundle"
mkdir -p "$probe_bundle/Contents/MacOS"
cp "$probe_root/Info.plist" "$probe_bundle/Contents/Info.plist"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -fobjc-arc -fvisibility=hidden \
  -I "$probe_root/include" -c "$probe_root/src/editor_transport.mm" -o "$probe_build/editor_transport.o"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -fobjc-arc -fvisibility=hidden \
  -I "$probe_root/include" -c "$probe_root/src/startup_receipt.mm" -o "$probe_build/startup_receipt.o"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -fobjc-arc -fvisibility=hidden \
  -I "$probe_root/include" -c "$probe_root/src/ribbon_commands.mm" -o "$probe_build/ribbon_commands.o"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -fobjc-arc -fvisibility=hidden \
  -I "$probe_root/include" -c "$probe_root/src/word_insertion.mm" -o "$probe_build/word_insertion.o"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -fvisibility=hidden -bundle \
  -I "$probe_root/include" "$probe_root/src/bridge.cpp" "$probe_root/src/equation_object.cpp" "$probe_root/src/interop_runtime.cpp" \
  "$probe_build/editor_transport.o" "$probe_build/startup_receipt.o" "$probe_build/ribbon_commands.o" "$probe_build/word_insertion.o" -framework AppKit -framework Foundation -framework CoreFoundation -framework CoreGraphics \
  -o "$probe_bundle/Contents/MacOS/MathTypeBridgeProbe"
/usr/bin/codesign --force --sign - "$probe_bundle"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -I "$probe_root/include" \
  "$probe_root/src/probe.cpp" \
  -Wl,-rpath,"/Applications/Microsoft Word.app/Contents/Frameworks" \
  -o "$probe_build/abi-probe"
"$probe_build/abi-probe" "$probe_bundle/Contents/MacOS/MathTypeBridgeProbe" "$@"
