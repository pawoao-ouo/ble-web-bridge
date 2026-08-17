# ble-web-bridge

远程控制一台只能靠蓝牙（BLE）说话的设备——控制端在任何地方，设备在你手机旁边。

两个版本，选一个：

**零成本版**：不要电脑、不要 MCP、不要服务器、不要氪金。指令走公共消息总线，AI 只输出可点击链接，你手指点一下就到设备。→ [docs/zero-cost.md](docs/zero-cost.md)

**Worker 版**：自建 Cloudflare Worker + D1 命令队列，有鉴权、有命令历史、有 MCP 端点。→ 见下文

## 零成本版一句话原理

ntfy.sh 支持纯 GET 发布消息，所以一条指令可以写成一个普通网址。AI 把这些网址排版成面板给你，你点哪个就是**你的浏览器**发的请求——AI 自己一个字节的网络请求都没发，也就没有连外部服务器带来的风控问题。

```
你 ←→ AI（只输出文本）
        │ 你点链接
        ▼
   ntfy.sh 公共总线（免注册）
        │ SSE 实时下推
        ▼
   手机页面（GitHub Pages）
        │ Web Bluetooth
        ▼
      BLE 设备
```

## Worker 版架构

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
| `page/ntfy.html` | **零成本版**手机页面：SSE 收指令 + Web Bluetooth |
| `page/index.html` | Worker 版手机页面：轮询 + Web Bluetooth |
| `page/silent.m4a` `page/blank.mp4` | 后台保活用的静音音频 / 黑屏视频 |
| `scripts/make_panel.py` | 生成 Markdown 控制面板（零成本版用） |
| `worker/worker.js` | Cloudflare Worker：命令入口 + D1 队列 + 页面托管 + MCP |
| `worker/schema.sql` | D1 建表语句 |
| `scripts/setup.sh` | Worker 版一键部署 |
| `scripts/push.sh` | Worker 版命令行推指令 |
| `docs/zero-cost.md` | **零成本版完整教程**（含让 AI 代搭的那条指令） |
| `docs/protocol.md` | 自定义设备协议怎么抓包接入 |
| `docs/keepalive.md` | iOS 切后台不掉线的做法和实测边界 |
| `docs/mcp.md` | Worker 版 MCP 接入 |

## 浏览器要求

Web Bluetooth 只在部分浏览器可用：

- Android Chrome / Edge：原生支持
- 桌面 Chrome / Edge：原生支持
- iOS Safari：**不支持**，需要用 Bluefy 之类支持 Web Bluetooth 的浏览器

这是浏览器的限制，不是这个项目的问题。

## Worker 版快速开始

需要 `wrangler`（`npm i -g wrangler`）和一个 Cloudflare 账号。

```bash
git clone https://github.com/pawoao-ouo/ble-web-bridge
cd ble-web-bridge

# 1. 创建 D1 + 建表 + 设置两个口令 + 部署
sh scripts/setup.sh

# 2. 手机浏览器打开 https://<your-worker>.workers.dev/
#    输入 GATE_PASS，点连接，选你的设备

# 3. 从任意机器推指令
export BRIDGE_URL=https://<your-worker>.workers.dev
export BRIDGE_TOKEN=<你设的 API_TOKEN>
sh scripts/push.sh level 40
sh scripts/push.sh stop
```

## 两个口令，分工不同（Worker 版）

| 名字 | 谁用 | 作用 |
|---|---|---|
| `GATE_PASS` | 你，在手机页面上输一次 | 拦住随便点进链接的人 |
| `API_TOKEN` | 控制端脚本 | 推指令 / 拉队列的凭证 |

都存 Worker secret（`wrangler secret put`），**不写进代码，也不出现在页面 HTML 里**。页面验完 `GATE_PASS` 后由服务端把 `API_TOKEN` 下发到内存变量，刷新即失效。

## 延迟

- 零成本版：1 秒内。SSE 服务端主动下推。
- Worker 版：1-2 秒。页面 1 秒轮询间隔 + 一次 Worker 往返。

Worker 版想再低只能换长连接，把轮询间隔从 1000 往下调没用——Worker 冷启动和 D1 读取本身就占几十到几百毫秒，而 iOS 后台会限流定时器。

## 为什么 Worker 版用 D1 不用 KV

KV 是最终一致的，写完立刻读可能读到旧值，命令队列这种"写一条马上就要被读到"的场景会偶发丢指令。D1 是 SQLite，强一致，还能直接 SQL 查历史。

## 许可

MIT

