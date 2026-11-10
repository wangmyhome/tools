#!/bin/bash
# 把 desktop/ 源码同步进本地打包版 dist/鸭力鸭.app
# 打包版是「解包目录」形式（Contents/Resources/app/），改完源码跑一次这个脚本，
# 重启 App 就能看到改动。重新用打包工具出包时会被覆盖，记得那时别只依赖这个脚本。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/dist/鸭力鸭.app/Contents/Resources/app"

if [ ! -d "$APP" ]; then
  echo "没找到打包版：$APP"
  echo "（源码模式直接跑：cd desktop && npm start）"
  exit 1
fi

for f in main.js preload.js pet.html bubble.html taskcard.html app.html package.json codex-monitor.js codex-monitor.test.js; do
  if [ -f "$DIR/$f" ]; then
    cp "$f" "$APP/$f" 2>/dev/null || cp "$DIR/$f" "$APP/$f"
    echo "  ✓ $f"
  fi
done

[ -d "$DIR/assets" ] && cp -R "$DIR/assets/." "$APP/assets/" && echo "  ✓ assets/"
[ -d "$DIR/vendor" ] && cp -R "$DIR/vendor/." "$APP/vendor/" && echo "  ✓ vendor/"
[ -d "$DIR/monitors" ] && cp -R "$DIR/monitors" "$APP/monitors" && echo "  ✓ monitors/"

echo "已同步到：$APP"
echo "重启鸭力鸭后生效（托盘菜单 ▸ 退出鸭力鸭，再双击 启动小鸭.command）"
