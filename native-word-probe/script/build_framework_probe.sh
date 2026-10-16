#!/bin/zsh
set -euo pipefail
probe_root="${0:A:h:h}"
probe_build="$probe_root/build"
probe_flags=()
if [[ "${PROBE_SANITIZE:-0}" == 1 ]]; then
  probe_build="$probe_root/build-asan"
  probe_flags=(-g -fsanitize=address,undefined -fno-sanitize=vptr -fno-omit-frame-pointer)
fi
mkdir -p "$probe_build"
xcrun clang++ -std=c++20 -Wall -Wextra -Werror "${probe_flags[@]}" -I "$probe_root/include" \
  "$probe_root/src/framework_probe.cpp" "$probe_root/src/object_tests.cpp" "$probe_root/src/transport_tests.cpp" "$probe_root/src/mathtype_alias_tests.cpp" -framework CoreFoundation -framework CoreGraphics \
  -Wl,-rpath,"/Applications/Microsoft Word.app/Contents/Frameworks" \
  -o "$probe_build/framework-probe"
"$probe_build/framework-probe" "$probe_build/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe" "$@"
