#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
bash build.sh

APP="/Applications/CodexNotch.app"
killall CodexNotch 2>/dev/null || true
rm -rf "$APP"
ditto "build/CodexNotch.app" "$APP"
xattr -cr "$APP" 2>/dev/null || true
open "$APP"

echo "Installed: $APP"
