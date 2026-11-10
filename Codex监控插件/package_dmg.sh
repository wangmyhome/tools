#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="CodexNotch.app"
DMG_NAME="CodexNotch-1.0.dmg"
STAGING="build/dmg-staging"
OUTPUT="build/$DMG_NAME"

bash build.sh

rm -rf "$STAGING" "$OUTPUT"
mkdir -p "$STAGING"
cp -R "build/$APP_NAME" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
cp "Resources/使用说明.txt" "$STAGING/"

hdiutil create \
    -volname "CodexNotch" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    -fs HFS+ \
    "$OUTPUT"

rm -rf "$STAGING"
echo "Created: $OUTPUT"
