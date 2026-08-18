/**
 * MCP（Model Context Protocol）客户端（P2-⑦ 差距分析第三批）。
 * 支持两种传输：
 * - stdio：spawn 本地进程，stdin/stdout 走换行分隔 JSON-RPC 2.0
 * - HTTP：POST streamable HTTP 端点（初始化握手 + session 缓存）
 * 连接按 serverId 缓存，tools/list 结果缓存 60s。
 */
import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT = 30000;
const LIST_TTL = 60000;

class McpError extends Error {}

function lineEncode(obj) {
  return JSON.stringify(obj) + '\n';
}

/** stdio 客户端 */
export class McpStdioClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.child = null;
    this.buf = '';
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.seq = 0;
    this.toolsCache = null;
    this.toolsAt = 0;
    this.stderrTail = '';
  }

  async start() {
    const { command, args = [] } = this.cfg;
    if (!command) throw new McpError('stdio MCP 需要 command');
    this.child = spawn(command, args, { windowsHide: true });
    this.child.stdout.on('data', (d) => this._onData(d.toString()));
    this.child.stderr.on('data', (d) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
    });
    this.child.on('error', (e) => this._failAll(new McpError(`MCP 进程启动失败: ${e.message}`)));
    await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'modeo', version: '2.8.0' },
    });
    this._notify('notifications/initialized', {});
  }

  _onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new McpError(`MCP 错误: ${msg.error.message || JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
      }
    }
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.exitCode != null) {
        return reject(new McpError(`MCP 进程未运行${this.stderrTail ? `：${this.stderrTail.slice(-300)}` : ''}`));
      }
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`MCP 请求超时（${method}）`));
      }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(lineEncode({ jsonrpc: '2.0', id, method, params }));
    });
  }

  _notify(method, params) {
    try {
      this.child.stdin.write(lineEncode({ jsonrpc: '2.0', method, params }));
    } catch {
      /* ignore */
    }
  }

  async listTools() {
    if (this.toolsCache && Date.now() - this.toolsAt < LIST_TTL) return this.toolsCache;
    const r = await this._request('tools/list', {});
    const tools = (r?.tools || []).map((t) => ({ name: t.name, description: t.description || '' }));
    this.toolsCache = tools;
    this.toolsAt = Date.now();
    return tools;
  }

  async callTool(name, args) {
    const r = await this._request('tools/call', { name, arguments: args || {} });
    const text = (r?.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return { text: text || '(无文本输出)', structured: r?.structuredContent ?? null, isError: !!r?.isError };
  }

  async close() {
    if (!this.child) return;
    this._failAll(new McpError('MCP 连接已关闭'));
    try {
      this.child.kill();
    } catch {
      /* ignore */
    }
    this.child = null;
  }
}

/** HTTP（streamable HTTP）客户端：initialize 拿 session 后缓存连接 */
export class McpHttpClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessionId = null;
    this.seq = 0;
    this.toolsCache = null;
    this.toolsAt = 0;
  }

  async _post(body) {
    const { url, headers = {} } = this.cfg;
    if (!url) throw new McpError('HTTP MCP 需要 url');
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: ctrl.signal });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      const text = await res.text();
      if (res.status !== 200) throw new McpError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      // streamable HTTP 可能返回 SSE 包装
      if (text.startsWith('event:')) {
        const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) throw new McpError('SSE 响应缺少 data');
        return JSON.parse(dataLine.slice(5).trim());
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async _request(method, params) {
    const id = ++this.seq;
    const msg = await this._post({ jsonrpc: '2.0', id, method, params });
    if (msg.error) throw new McpError(`MCP 错误: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async start() {
    await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'modeo', version: '2.8.0' },
    });
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools() {
    if (this.toolsCache && Date.now() - this.toolsAt < LIST_TTL) return this.toolsCache;
    const r = await this._request('tools/list', {});
    this.toolsCache = (r?.tools || []).map((t) => ({ name: t.name, description: t.description || '' }));
    this.toolsAt = Date.now();
    return this.toolsCache;
  }

  async callTool(name, args) {
    const r = await this._request('tools/call', { name, arguments: args || {} });
    const text = (r?.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return { text: text || '(无文本输出)', structured: r?.structuredContent ?? null, isError: !!r?.isError };
  }

  async close() {
    /* HTTP 无长连，无需清理 */
  }
}

/** 工厂 + 连接缓存（模块级单例） */
const clients = new Map();

export async function getMcpClient(cfg) {
  const key = cfg.id || cfg.url || cfg.command || 'default';
  let c = clients.get(key);
  if (c && c._alive) return c;
  if (c) {
    await c.close().catch(() => {});
    clients.delete(key);
  }
  const isHttp = /^https?:\/\//i.test(cfg.url || '');
  c = isHttp ? new McpHttpClient(cfg) : new McpStdioClient(cfg);
  await c.start();
  c._alive = true;
  clients.set(key, c);
  return c;
}

export async function closeMcpClient(key) {
  const c = clients.get(key);
  if (c) {
    await c.close().catch(() => {});
    clients.delete(key);
  }
}

export { McpError };
