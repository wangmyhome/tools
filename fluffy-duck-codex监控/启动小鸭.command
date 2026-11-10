#!/bin/bash
# 鸭力鸭 YaliYa 桌宠启动器：双击我即可
DIR="$(cd "$(dirname "$0")" && pwd)"

APP="$DIR/desktop/dist/鸭力鸭.app"
BIN="$APP/Contents/MacOS/YaliYa"

if [ -x "$BIN" ]; then
  # 已在跑就不重复拉起（App 自带单实例锁，这里只是避免白跑）
  if pgrep -q YaliYa; then exit 0; fi
  # 直接跑二进制：sync 改动 Resources 后 adhoc 签名失效，
  # LaunchServices(open) 会静默拒绝启动，直接 exec 不经过 Gatekeeper 校验
  nohup env -u ELECTRON_RUN_AS_NODE "$BIN" > /dev/null 2>&1 &
  exit 0
fi

# 兜底：打包版不存在时，跑开发模式
cd "$DIR/desktop"
npx electron .
