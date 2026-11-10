#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP="build/CodexNotch.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -parse-as-library -module-cache-path build/module-cache Sources/CodexNotch/*.swift -o "$APP/Contents/MacOS/CodexNotch"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"
codesign --force --deep --sign - "$APP"
