#!/bin/sh
# 从命令行推指令。
#
#   export BRIDGE_URL=https://your-worker.workers.dev
#   export BRIDGE_TOKEN=your-api-token
#
#   sh scripts/push.sh level 40           # 设为 40，一直保持
#   sh scripts/push.sh level 40 10        # 设为 40，10 秒后自动停
#   sh scripts/push.sh stop
#   sh scripts/push.sh pattern 15,35,55 0.9 4
#   sh scripts/push.sh status
set -e

: "${BRIDGE_URL:?先 export BRIDGE_URL}"
: "${BRIDGE_TOKEN:?先 export BRIDGE_TOKEN}"

CMD="$1"

post() {
  curl -sS -m 20 -X POST "$BRIDGE_URL/api/push" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BRIDGE_TOKEN" \
    -d "$1"
  echo
}

case "$CMD" in
  level)
    LEVEL="${2:?用法: push.sh level <0-100> [duration]}"
    if [ -n "$3" ]; then
      post "{\"cmd\":\"level\",\"args\":{\"level\":$LEVEL,\"duration\":$3}}"
    else
      post "{\"cmd\":\"level\",\"args\":{\"level\":$LEVEL}}"
    fi
    ;;
  stop)
    post '{"cmd":"stop","args":{}}'
    ;;
  pattern)
    PAT="${2:?用法: push.sh pattern <15,35,55> [interval] [loops]}"
    post "{\"cmd\":\"pattern\",\"args\":{\"pattern\":\"$PAT\",\"interval\":${3:-0.9},\"loops\":${4:-4}}}"
    ;;
  status)
    curl -sS -m 20 "$BRIDGE_URL/api/poll?token=$BRIDGE_TOKEN" | python3 -m json.tool
    ;;
  *)
    echo "用法: push.sh {level <0-100> [dur] | stop | pattern <a,b,c> [interval] [loops] | status}"
    exit 1
    ;;
esac
