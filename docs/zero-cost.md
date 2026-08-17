# 零成本版：不要电脑、不要 MCP、不要服务器、不要氪金

上一版（`worker/`）用了 Cloudflare Worker + D1。虽然免费额度够用，但要注册账号、装 wrangler、在电脑上部署。这一版把这些全砍掉。

## 换掉了什么

| | Worker 版 | 零成本版 |
|---|---|---|
| 命令总线 | 自建 Cloudflare Worker + D1 | ntfy.sh 公共实例，免注册 |
| 部署 | wrangler，需要电脑 | GitHub 网页上传，手机就行 |
| 控制端 | 脚本 / MCP 客户端 | AI 输出的可点击链接 |
| 账号 | Cloudflare | 一个都不要（除了托页面用的 GitHub） |
| 花钱 | 免费额度内 | 0 |

## 为什么不走 MCP

MCP 要求 AI 客户端主动去连一个外部服务器。这件事本身会被风控盯上——服务器不稳、IP 不干净、请求模式异常，都可能让账号直接被封，而且申诉说不清。

这一版让 AI 只做一件事：**输出文本**。

ntfy.sh 支持纯 GET 发布消息，也就是说一条指令可以写成一个普通网址：

```
https://ntfy.sh/你的频道名/trigger?message=level:45
```

AI 把这些网址排版成一张可点击的面板给你。你点哪个，就是你的浏览器发出了那个请求——AI 自己一个字节的网络请求都没发。它看起来只是在跟你聊天，因为它确实只是在跟你聊天。

## 整条链路

```
你在手机上跟 AI 说话
      │
      ▼
AI 输出一张链接面板（纯文本，无网络请求）
      │  你手指点一下
      ▼
ntfy.sh 公共消息总线（免注册，免费）
      │  SSE 长连接实时下推
      ▼
另一个标签页里的手机页面（GitHub Pages 托管）
      │  Web Bluetooth GATT write
      ▼
BLE 设备
```

两个标签页都在你手机上，一个是 AI 对话，一个是控制页。中间只借了 ntfy.sh 传一句话。

## 第一步：让 AI 帮你搭

装 Minis（iOS，内置 Linux shell + 浏览器 + 文件系统），然后把下面这段整段发给它。**这就是那"一条指令"**：

```
帮我搭一个零成本的蓝牙远程控制链路，按这个规格做，做完给我能直接用的东西：

1. 生成一个随机频道名，格式 mybridge-<12位随机小写字母数字>，
   这个名字就是我的唯一凭证，记到文件里别丢。

2. 从 https://github.com/pawoao-ouo/ble-web-bridge 拿 page/ntfy.html，
   把里面的 BUS 保持 https://ntfy.sh 不变。
   如果我的设备协议不是默认的，问我要抓包结果再改 buildPacket。

3. 帮我把 page/ 目录下的 ntfy.html、silent.m4a、blank.mp4 三个文件
   传到我的 GitHub 仓库并开 Pages（用我的 GITHUB_TOKEN），
   给我最终的 https 网址。

4. 生成一张控制面板 markdown 给我，用我的频道名，
   包含这些档位的可点击链接：停、15、25、35、45、55、65、80，
   以及三个节奏序列（缓、中、猛）。

5. 最后告诉我：手机上先打开哪个网址、点什么按钮、
   然后回来点面板哪一项。
```

它会自己去 clone、改文件、传 GitHub、开 Pages、算出链接面板。你只需要在它问设备协议的时候回答，或者说"用默认的先试"。

## 第二步：手机上打开控制页

拿到 AI 给你的 Pages 网址（形如 `https://<你的用户名>.github.io/<仓库名>/ntfy.html`），用 **Chrome** 打开。

> iOS Safari 不支持 Web Bluetooth。iOS 上需要用支持它的浏览器（如 Bluefy）。
> Android Chrome 原生支持。这是浏览器的限制，跟这个方案无关。

打开后：

1. 填 AI 给你的频道名 → 点「进厨房」
2. 点「连接」→ 在弹出的设备列表里选你的设备
3. 点「保温」→ 会自动弹出画中画小窗（这是后台不掉线的关键，见 `keepalive.md`）

三个状态点都变绿就通了。

## 第三步：用 AI 给的面板控制

回到 AI 对话那个标签页，面板长这样：

```markdown
[停](https://ntfy.sh/mybridge-x7k2m9p4qw8n/trigger?message=stop)
[15](https://ntfy.sh/mybridge-x7k2m9p4qw8n/trigger?message=level:15)
[35](https://ntfy.sh/mybridge-x7k2m9p4qw8n/trigger?message=level:35)
[55](https://ntfy.sh/mybridge-x7k2m9p4qw8n/trigger?message=level:55)
[缓](https://ntfy.sh/mybridge-x7k2m9p4qw8n/trigger?message=pattern:15,25,15:1.2:6)
```

点一下，控制页那边一秒内响应。想让 AI 临场编节奏，直接说"给我一个越来越急的序列"，它算好参数拼成新链接给你。

## 指令格式

页面同时认两种写法。

纯文本简写（适合塞进 URL）：

| 写法 | 意思 |
|---|---|
| `stop` | 停 |
| `level:45` | 设为 45，保持 |
| `level:45:10` | 设为 45，10 秒后自动停 |
| `pattern:15,35,55:0.9:4` | 序列 15→35→55，每档 0.9 秒，重复 4 轮 |

JSON（适合脚本 POST）：

```bash
curl -d '{"cmd":"level","args":{"level":45,"duration":10}}' https://ntfy.sh/你的频道名
```

## 安全

**频道名就是唯一凭证。** ntfy.sh 公共实例上，任何知道频道名的人都能往里发消息，也能订阅看到内容。所以：

- 用至少 12 位随机字符，别用 `mybridge-test` 这种能猜到的
- 别把频道名截图发出去，也别写在公开仓库里
- 页面 URL 可以公开（里面没有频道名，是你手动填进去存在本机 localStorage 的）
- 想再稳一层：自己用 Docker 跑一个 ntfy 实例开鉴权。但那就需要服务器了，跟这版的主张相反

消息在 ntfy.sh 上默认保留 12 小时。这个方案不适合传任何敏感内容，它只传 `level:45` 这种数字。

## 延迟

实测从点链接到页面收到，1 秒内。SSE 是服务端主动下推，不是轮询，比 Worker 版的 1 秒轮询更快。

## 已验证 / 未验证

验证过：

- ntfy.sh 纯 GET 发布返回 200
- 页面 SSE 订阅收到消息并正确解析出 `level:45`
- 页面 JS 语法、保活媒体的 Range 支持

没验证：

- iOS 上第三方浏览器（Bluefy 等）跑这套的完整表现
- 后台保活能撑多久（只测到前台连续 15 分钟稳定）
- ntfy.sh 公共实例的长期可用性和限流阈值——它是别人的免费服务，随时可能变

## 什么时候该回到 Worker 版

- 需要命令历史、需要 SQL 查询
- 需要真正的鉴权（Worker 版有 secret 校验）
- 不想依赖第三方公共服务的可用性
