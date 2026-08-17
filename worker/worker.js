/**
 * ble-web-bridge — Cloudflare Worker
 *
 * 职责：
 *   1. POST /api/push   控制端写一条命令进 D1
 *   2. GET  /api/poll   手机页面拉最新命令 + 心跳
 *   3. POST /api/ack    手机页面报活
 *   4. GET  /api/auth   校验 GATE_PASS，通过后下发 API_TOKEN
 *   5. GET  /           返回手机端页面
 *   6. POST /mcp        MCP (JSON-RPC 2.0) 端点，给 LLM 客户端直接调
 *   7. GET  /media/*    保活用的静音音频 / 黑屏视频
 *
 * 环境要求（wrangler.toml + secret）：
 *   binding  DB          D1 database
 *   binding  KV          KV namespace（只存心跳时间戳）
 *   secret   GATE_PASS   页面口令
 *   secret   API_TOKEN   控制端凭证
 */

import PAGE_HTML from './page.html';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/* ---------------- 命令队列（D1） ---------------- */

async function pushCommand(env, cmd, args) {
  const seq = Date.now();
  const res = await env.DB
    .prepare('INSERT INTO commands (seq, cmd, args, ts) VALUES (?, ?, ?, ?)')
    .bind(seq, cmd, JSON.stringify(args || {}), seq)
    .run();
  if (!res.success) return json({ error: 'db write failed' }, 500);
  return json({ ok: true, seq });
}

function rowToCmd(r) {
  return { cmd: r.cmd, args: JSON.parse(r.args), seq: r.seq, ts: r.ts };
}

async function readQueue(env) {
  const { results } = await env.DB
    .prepare('SELECT seq, cmd, args, ts FROM commands ORDER BY seq DESC LIMIT 5')
    .all();
  const rows = results || [];
  return {
    now: rows.length ? rowToCmd(rows[0]) : null,
    recent: rows.map(rowToCmd),
  };
}

/* ---------------- 心跳（KV，写多读多但不要求强一致） ---------------- */

async function touchAck(env) {
  await env.KV.put('bridge_ack', Date.now().toString());
  return json({ ok: true });
}

async function ackAge(env) {
  const v = parseInt((await env.KV.get('bridge_ack')) || '0', 10);
  return v ? Math.floor((Date.now() - v) / 1000) : -1;
}

/* ---------------- HTTP API ---------------- */

async function handleApi(request, env, url, path) {
  const method = request.method;
  const seg = path.replace('/api/', '');

  // 页面口令：通过后把控制端 token 下发，避免硬编码在 HTML 里
  if (seg === 'auth' && method === 'GET') {
    const ok = url.searchParams.get('pass') === env.GATE_PASS;
    return json(ok ? { ok: true, token: env.API_TOKEN } : { ok: false });
  }

  const token =
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('token');

  if (seg === 'push' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    if ((body.token || token) !== env.API_TOKEN) return json({ error: 'bad token' }, 403);
    if (!body.cmd) return json({ error: 'cmd required' }, 400);
    return pushCommand(env, body.cmd, body.args);
  }

  if (seg === 'poll' && method === 'GET') {
    if (token !== env.API_TOKEN) return json({ error: 'bad token' }, 403);
    const q = await readQueue(env);
    return json({ now: q.now, recent: q.recent, ack_age: await ackAge(env) });
  }

  if (seg === 'ack' && method === 'POST') {
    if (token !== env.API_TOKEN) return json({ error: 'bad token' }, 403);
    return touchAck(env);
  }

  return json({ error: 'not found' }, 404);
}

/* ---------------- MCP（给 LLM 客户端直接挂） ---------------- */

const MCP_TOOLS = [
  {
    name: 'level',
    description: '设置强度。level 0-100，duration 秒（可选，省略则保持）。',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'integer', description: '0-100' },
        duration: { type: 'integer', description: '持续秒数，省略则一直保持' },
      },
      required: ['level'],
    },
  },
  {
    name: 'stop',
    description: '立即停止。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pattern',
    description: '按序列走。pattern 是逗号分隔强度，interval 每档秒数，loops 重复次数。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '如 15,35,55,35' },
        interval: { type: 'number', description: '默认 0.9' },
        loops: { type: 'integer', description: '默认 4' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'status',
    description: '查页面是否在线，返回心跳年龄（秒），-1 表示从未上线。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function rpc(id, result) {
  return json({ jsonrpc: '2.0', id, result });
}
function rpcErr(id, code, message) {
  return json({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMcp(request, env) {
  // MCP 客户端用 Authorization: Bearer <API_TOKEN>
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (token !== env.API_TOKEN) return rpcErr(null, -32000, 'unauthorized');

  let req;
  try { req = await request.json(); } catch { return rpcErr(null, -32700, 'parse error'); }
  const { id, method, params } = req;

  if (method === 'initialize') {
    return rpc(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ble-web-bridge', version: '1.0.0' },
    });
  }

  if (method === 'tools/list') return rpc(id, { tools: MCP_TOOLS });

  if (method === 'tools/call') {
    const name = params?.name;
    const a = params?.arguments || {};
    let text;

    if (name === 'level') {
      const level = Math.max(0, Math.min(100, parseInt(a.level ?? 0, 10)));
      await pushCommand(env, 'level', { level, duration: a.duration });
      text = `已设为 ${level}`;
    } else if (name === 'stop') {
      await pushCommand(env, 'stop', {});
      text = '已停止';
    } else if (name === 'pattern') {
      await pushCommand(env, 'pattern', {
        pattern: a.pattern || '15,30,15',
        interval: a.interval ?? 0.9,
        loops: a.loops ?? 4,
      });
      text = `序列已下发 ${a.pattern}`;
    } else if (name === 'status') {
      const age = await ackAge(env);
      text = age < 0 ? '页面从未上线' : `页面心跳 ${age} 秒前`;
    } else {
      return rpcErr(id, -32601, `unknown tool: ${name}`);
    }

    return rpc(id, { content: [{ type: 'text', text }] });
  }

  return rpcErr(id, -32601, `unknown method: ${method}`);
}

/* ---------------- 保活媒体 ----------------
 * iOS 上想让页面切后台还活着，要有一路正在播放的媒体。
 * 这里返回极小的静音音频 / 黑屏视频，支持 Range（Safari 必需）。
 * 生成方式见 docs/keepalive.md，产物用 base64 内联在下面两个常量里。
 */

const SILENT_M4A_B64 = ''; // 见 docs/keepalive.md 用 ffmpeg 生成后填入
const BLANK_MP4_B64 = '';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function mediaResponse(request, b64, contentType) {
  if (!b64) return new Response('media not embedded, see docs/keepalive.md', { status: 501 });
  const bytes = b64ToBytes(b64);
  const total = bytes.length;
  const base = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  };
  const range = request.headers.get('Range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (start >= total) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${total}` } });
    }
    if (end >= total) end = total - 1;
    const chunk = bytes.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunk.length) },
    });
  }
  return new Response(bytes, { headers: { ...base, 'Content-Length': String(total) } });
}

/* ---------------- 入口 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (path.startsWith('/api/')) return handleApi(request, env, url, path);
    if (path === '/mcp') {
      if (request.method !== 'POST') return rpcErr(null, -32000, 'POST only');
      return handleMcp(request, env);
    }
    if (path === '/media/silent.m4a') return mediaResponse(request, SILENT_M4A_B64, 'audio/mp4');
    if (path === '/media/blank.mp4') return mediaResponse(request, BLANK_MP4_B64, 'video/mp4');

    if (path === '/' || path === '/index.html') {
      return new Response(PAGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    return new Response('not found', { status: 404 });
  },
};
