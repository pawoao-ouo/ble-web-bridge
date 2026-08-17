#!/bin/sh
# 一键初始化：创建 D1 + KV、建表、设置口令、部署。
# 需要先 npm i -g wrangler 并 wrangler login。
set -e

DB_NAME="ble_bridge"
KV_NAME="ble_bridge_kv"

command -v wrangler >/dev/null || { echo "先装 wrangler: npm i -g wrangler"; exit 1; }

echo "==> 1/5 创建 D1 数据库 $DB_NAME"
DB_OUT=$(wrangler d1 create "$DB_NAME" 2>&1 || true)
echo "$DB_OUT"
DB_ID=$(echo "$DB_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$DB_ID" ]; then
  echo "已存在？从列表里取 id"
  DB_ID=$(wrangler d1 list --json 2>/dev/null | python3 -c "
import sys,json
for d in json.load(sys.stdin):
    if d['name']=='$DB_NAME': print(d['uuid']); break
")
fi
[ -n "$DB_ID" ] || { echo "拿不到 D1 id，手动填进 wrangler.toml"; exit 1; }
echo "    D1 id = $DB_ID"

echo "==> 2/5 创建 KV namespace $KV_NAME"
KV_OUT=$(wrangler kv namespace create "$KV_NAME" 2>&1 || true)
echo "$KV_OUT"
KV_ID=$(echo "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1)
[ -n "$KV_ID" ] || { echo "拿不到 KV id，手动填进 wrangler.toml"; exit 1; }
echo "    KV id = $KV_ID"

echo "==> 3/5 写进 wrangler.toml"
python3 - "$DB_ID" "$KV_ID" <<'PY'
import sys, re, pathlib
db, kv = sys.argv[1], sys.argv[2]
p = pathlib.Path('wrangler.toml')
t = p.read_text()
t = t.replace('PUT_YOUR_D1_ID_HERE', db).replace('PUT_YOUR_KV_ID_HERE', kv)
p.write_text(t)
print('    wrangler.toml 已更新')
PY

echo "==> 4/5 建表"
wrangler d1 execute "$DB_NAME" --remote --file worker/schema.sql

echo "==> 5/5 设置两个口令（交互输入，不会写进文件）"
echo "    GATE_PASS：手机页面进门用"
wrangler secret put GATE_PASS
echo "    API_TOKEN：控制端脚本用"
wrangler secret put API_TOKEN

echo "==> 部署"
wrangler deploy

cat <<'EOF'

完成。接下来：
  1. 手机浏览器打开 worker 地址，输 GATE_PASS，点连接选设备
  2. 控制端：
       export BRIDGE_URL=https://<your-worker>.workers.dev
       export BRIDGE_TOKEN=<刚才设的 API_TOKEN>
       sh scripts/push.sh level 40
  3. 想要后台保活，按 docs/keepalive.md 生成媒体并填进 worker.js
EOF
