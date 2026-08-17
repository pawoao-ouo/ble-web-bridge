# MCP 接入

Worker 的 `/mcp` 是一个 JSON-RPC 2.0 端点，任何 MCP 客户端都能挂上去，让 LLM 直接调设备。

## 客户端配置

```json
{
  "mcpServers": {
    "ble-bridge": {
      "url": "https://your-worker.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer $$BRIDGE_TOKEN"
      }
    }
  }
}
```

token 用环境变量引用，别写字面量。

## 手动测

```bash
# 列工具
curl -sS -X POST https://your-worker.workers.dev/mcp \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool

# 调一个
curl -sS -X POST https://your-worker.workers.dev/mcp \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"level","arguments":{"level":40,"duration":10}}}'
```

## 四个工具

| 名字 | 参数 | 说明 |
|---|---|---|
| `level` | `level` 0-100，`duration` 秒（可选） | 设强度，省略 duration 则保持 |
| `stop` | 无 | 立即停止 |
| `pattern` | `pattern` 逗号分隔，`interval` 秒，`loops` 次 | 按序列走 |
| `status` | 无 | 返回页面心跳年龄，判断桥在不在线 |

## 注意

`/mcp` 只走 POST，且强制校验 `Authorization`。SSE 传输没实现——大部分 MCP 客户端支持 streamable HTTP，够用了。

调完 `level` 之后建议紧跟一次 `status`，确认页面确实在线；否则命令写进了 D1 但没人来取，看起来"成功"实际没生效。
