# ble-web-bridge

远程控制一台只能靠蓝牙（BLE）说话的设备——控制端在任何地方，设备在你手机旁边。

```
控制端（脚本 / LLM / MCP 客户端）
        │  HTTPS POST /api/push
        ▼
Cloudflare Worker  ──写──▶  D1 (commands 表)
        │
        │  HTTPS GET /api/poll（1s 一次）
        ▼
手机浏览器页面（Web Bluetooth）
        │  GATT write
        ▼
BLE 设备
```

为什么绕这么一圈：Web Bluetooth 只跑在浏览器里，浏览器碰不到公网入口；Worker 有公网入口但碰不到蓝牙。中间用一张命令表把两边接起来，控制端只管写，页面只管读。

## 目录

| 路径 | 内容 |
|---|---|
| `worker/worker.js` | Cloudflare Worker：命令入口 + D1 队列 + 页面托管 + MCP 端点 |
| `worker/schema.sql` | D1 建表语句 |
| `page/index.html` | 手机端页面：Web Bluetooth 连接、轮询、后台保活 |
| `scripts/setup.sh` | 一键创建 D1、建表、写 secret、部署 |
| `scripts/push.sh` | 命令行推指令 |
| `docs/protocol.md` | 自定义设备协议怎么接 |
| `docs/keepalive.md` | iOS 切后台不掉线的做法和实测边界 |

## 快速开始

需要 `wrangler`（`npm i -g wrangler`）和一个 Cloudflare 账号。

```bash
git clone https://github.com/<you>/ble-web-bridge
cd ble-web-bridge

# 1. 创建 D1 + 建表 + 设置两个口令 + 部署
sh scripts/setup.sh

# 2. 手机 Safari/Chrome 打开 https://<your-worker>.workers.dev/
#    输入 GATE_PASS，点连接，选你的设备

# 3. 从任意机器推指令
export BRIDGE_URL=https://<your-worker>.workers.dev
export BRIDGE_TOKEN=<你设的 API_TOKEN>
sh scripts/push.sh level 40
sh scripts/push.sh stop
```

## 两个口令，分工不同

| 名字 | 谁用 | 作用 |
|---|---|---|
| `GATE_PASS` | 你，在手机页面上输一次 | 拦住随便点进链接的人 |
| `API_TOKEN` | 控制端脚本 | 推指令 / 拉队列的凭证 |

都存 Worker secret（`wrangler secret put`），**不写进代码，也不出现在页面 HTML 里**。页面验完 `GATE_PASS` 后由服务端把 `API_TOKEN` 下发到内存变量，刷新即失效。

## 延迟

端到端 1-2 秒，构成是页面 1 秒轮询间隔 + 一次 Worker 往返。想再低只能换长连接（WebSocket / SSE），把轮询间隔从 1000 往下调没用——Worker 冷启动和 D1 读取本身就占几十到几百毫秒，而 iOS 后台会限流定时器。

## 为什么用 D1 不用 KV

KV 是最终一致的，写完立刻读可能读到旧值，命令队列这种"写一条马上就要被读到"的场景会偶发丢指令。D1 是 SQLite，强一致，还能直接 SQL 查历史。

## 许可

MIT
