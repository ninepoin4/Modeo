/**
 * Modeo HTTP 服务：静态资源 + API + SSE 流式对话。
 * 零依赖，node server.js 启动。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { loadHarnessConfigs, loadUserHarnessConfigs } from './src/core/harness.js';
import { MODE_IDS, MODE_ID_PATTERN, applyHarnessDefaults, validateHarnessShape } from './src/core/types.js';
import { parseYaml, stringifyYaml } from './src/core/yaml.js';
import { createProvider } from './src/core/provider.js';
import { netFetch } from './src/core/net.js';
import * as sessionStore from './src/core/session.js';
import * as approvalsMgr from './src/core/approvals.js';
import { runAgentTurn, assembleSystemPrompt } from './src/runtime/engine.js';
import { createAuditHooks } from './src/core/audit.js';
import { appendSessionEvent, deleteSessionEvents, findOrphanEvents } from './src/core/sessionEvents.js';
import { atomicWriteFileSync } from './src/core/atomic.js';
import { compressSession } from './src/runtime/compress.js';
import { createAllTools } from './src/tools/registry.js';
import { loadPlugins } from './src/tools/pluginLoader.js';
import { listCheckpoints, restoreCheckpoint, ensureBaseline, getBaselineDir } from './src/tools/checkpoints.js';
import { diffWorkspace } from './src/tools/diff.js';
import * as charManager from './src/characters/manager.js';
import { normalizeCharacter, validateCharacter } from './src/characters/schema.js';
import { importCcv3, exportCcv3 } from './src/characters/ccv3.js';
import { importCharacterCardFromPng } from './src/characters/png.js';
import { buildPack, installPack, listPacks, getPack, savePackFile, deletePack, fetchPackJson, fetchMarketIndex, PackError } from './src/characters/pack.js';
import { listThemes, getTheme, saveTheme, deleteTheme, uploadThemeBackground, BUILTIN_THEMES } from './src/core/themes.js';
import { listSkills, deleteSkill, matchSkills } from './src/core/skillStore.js';
import { getPreferences, recordToolUsage, recordApprovalRejection, summarizePreferences } from './src/core/preferences.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const PUBLIC_DIR = fs.existsSync(WEB_DIR) ? WEB_DIR : path.join(ROOT, 'public');
const DATA_DIR = process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const WORKSPACE_ROOT = process.env.MODEO_WORKSPACE_DIR
  ? path.resolve(process.env.MODEO_WORKSPACE_DIR)
  : path.join(ROOT, 'workspaces', 'default');
const USER_HARNESS_DIR = path.join(DATA_DIR, 'harness');
const PORT = Number(process.env.MODEO_PORT || 8787);
// 工具执行管道钩子（P0-2）：默认注册审计后置钩子，每次工具执行落 data/audit.log
const toolPipeline = createAuditHooks(DATA_DIR);

fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(USER_HARNESS_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

const harnesses = new Map();
for (const h of loadHarnessConfigs(path.join(ROOT, 'configs', 'harness'))) {
  harnesses.set(h.id, h);
}
for (const h of loadUserHarnessConfigs(USER_HARNESS_DIR)) {
  harnesses.set(h.id, h);
}

function reloadUserMode(id) {
  try {
    const text = fs.readFileSync(path.join(USER_HARNESS_DIR, `${id}.yaml`), 'utf8');
    const cfg = parseYaml(text);
    if (validateHarnessShape(cfg).length) {
      harnesses.delete(id);
      return;
    }
    harnesses.set(cfg.id, applyHarnessDefaults(cfg));
  } catch {
    harnesses.delete(id);
  }
}

const PLUGINS_DIR = process.env.MODEO_PLUGINS_DIR ? path.resolve(process.env.MODEO_PLUGINS_DIR) : path.join(ROOT, 'plugins');
let toolRegistry = createAllTools(WORKSPACE_ROOT);
let pluginInfo = [];

async function reloadPlugins() {
  const { tools, loaded } = await loadPlugins(PLUGINS_DIR);
  pluginInfo = loaded;
  toolRegistry = createAllTools(WORKSPACE_ROOT, tools);
  return pluginInfo;
}

await reloadPlugins();

const DEFAULT_SETTINGS = {
  provider: 'mock',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  theme: 'paper',
  activeProviderId: 'mock',
  providers: [],
};

/**
 * 多厂商规范化（2026-08-18）：确保 settings 里总有 providers 数组（含不可删的 mock 内置项）、
 * activeProviderId 有效，并把激活厂商投影到顶层 provider/baseUrl/apiKey/model——
 * 让 createProvider() 与所有读顶层字段的代码无需改动。
 */
function ensureProviders(s) {
  let providers = Array.isArray(s.providers) ? s.providers : [];
  providers = providers.map((p) => ({
    ...p,
    id: p.id || randomUUID(),
    provider: p.provider === 'mock' ? 'mock' : (p.provider || 'openai'),
    baseUrl: p.baseUrl || '',
    apiKey: p.apiKey || '',
    model: p.model || '',
    models: Array.isArray(p.models) ? p.models : [],
  }));
  if (providers.length === 0) {
    providers = [{ id: 'mock', name: 'Mock（离线演示）', provider: 'mock', baseUrl: '', apiKey: '', model: 'mock', models: [] }];
  }
  if (!providers.some((p) => p.provider === 'mock')) {
    providers.unshift({ id: 'mock', name: 'Mock（离线演示）', provider: 'mock', baseUrl: '', apiKey: '', model: 'mock', models: [] });
  }
  const activeId = s.activeProviderId && providers.some((p) => p.id === s.activeProviderId)
    ? s.activeProviderId
    : (providers.find((p) => p.provider !== 'mock')?.id || 'mock');
  const active = providers.find((p) => p.id === activeId) || providers[0];
  return {
    ...s,
    providers,
    activeProviderId: active.id,
    // 投影激活厂商（兼容旧读取路径）
    provider: active.provider === 'mock' ? 'mock' : (active.provider || 'openai'),
    baseUrl: active.baseUrl || '',
    apiKey: active.apiKey || '',
    model: active.model || active.models?.[0] || 'gpt-4o-mini',
  };
}

function loadSettings() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    /* 无文件或损坏：走默认 */
  }
  const base = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    // 旧格式（无 providers）迁移：顶层有真实厂商配置则升格为厂商 1 并激活它
    if (!Array.isArray(raw.providers) || raw.providers.length === 0) {
      if (raw.baseUrl || raw.apiKey || (raw.model && raw.model !== 'gpt-4o-mini')) {
        const migratedId = randomUUID();
        raw.providers = [{ id: migratedId, name: 'OpenAI 兼容', provider: 'openai', baseUrl: raw.baseUrl || '', apiKey: raw.apiKey || '', model: raw.model || '', models: [] }];
        raw.activeProviderId = migratedId;
      }
    }
    return ensureProviders({ ...base, ...raw });
  }
  return ensureProviders(base);
}

function saveSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

/**
 * 对外脱敏：apiKey 不回传明文，改为 apiKeySet 布尔（顶层与每个厂商条目都脱敏）。
 * 前端保存时 apiKey 传空字符串表示未修改，null 表示清除，服务端保留/清除原值。
 */
function publicSettings(s) {
  const { apiKey, providers, ...rest } = s;
  return {
    ...rest,
    apiKeySet: Boolean(apiKey),
    providers: (providers || []).map((p) => {
      const { apiKey: k, ...restP } = p;
      return { ...restP, apiKeySet: Boolean(k) };
    }),
  };
}

function publicMode(h) {
  return {
    id: h.id,
    name: h.name,
    description: h.description,
    tools: h.tools,
    defaultModel: h.defaultModel,
    ui: h.ui,
    context: h.context,
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024, res = null) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // 先回 413 再断开，避免客户端只见断连无响应
        if (res && !res.headersSent) {
          try {
            sendJson(res, 413, { error: '请求体过大' });
          } catch {
            /* 响应可能已被占用 */
          }
        }
        req.destroy();
        reject(new Error('请求体过大'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, res = null) {
  const text = await readBody(req, undefined, res);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败');
  }
}

function getSessionOr404(res, id) {
  try {
    return sessionStore.getSession(id);
  } catch (err) {
    sendJson(res, 404, { error: err.message || '会话不存在' });
    return null;
  }
}

/**
 * 每会话串行锁：同一会话的读-改-写操作排队执行，防止并发请求互相覆盖会话文件。
 * 用法：withSessionLock(id, () => handler(req, res, id))
 */
const sessionLocks = new Map();
function withSessionLock(id, fn) {
  const prev = sessionLocks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn); // 前一个失败也继续执行本任务
  const tracked = next
    .catch(() => {})
    .finally(() => {
      if (sessionLocks.get(id) === tracked) sessionLocks.delete(id);
    });
  sessionLocks.set(id, tracked);
  // 返回吞错版本：fn 的 rejection 已在调用处转为错误响应，
  // 此处保证不泄漏为 unhandled rejection（否则一个坏请求即可崩溃整个进程）。
  return tracked;
}

/** 加载会话角色阵容（多角色支持） */
function loadCast(session) {
  const ids = session.characters && session.characters.length
    ? session.characters
    : session.characterId
      ? [session.characterId]
      : [];
  const cast = [];
  for (const cid of ids) {
    try {
      cast.push(charManager.loadCharacter(cid));
    } catch {
      // 跳过缺失角色
    }
  }
  return cast;
}

async function handleMessages(req, res, id) {
  const session = getSessionOr404(res, id);
  if (!session) return;
  const body = await readJson(req, res);
  const content = String(body.content || '').trim();
  if (!content) return sendJson(res, 400, { error: '消息内容为空' });
  // 消息级模型 override（pi 模型接力思想）：可选，仅本条消息生效
  const modelOverride = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;

  const harness = harnesses.get(session.modeId);
  if (!harness) return sendJson(res, 400, { error: '会话模式配置缺失' });
  if (session.modeId === 'code') {
    try {
      ensureBaseline(session.id, WORKSPACE_ROOT);
    } catch {
      // 基线创建失败不阻断对话
    }
  }

  let character = null;
  if (session.characterId) {
    try {
      character = charManager.loadCharacter(session.characterId);
    } catch {
      character = null;
    }
  }
  const cast = loadCast(session);

  session.messages.push({ role: 'user', content, id: randomUUID() });
  session.updatedAt = new Date().toISOString();
  // 自动会话标题（2026-08-15 新增）：首条消息生成默认标题，避免永远叫"新会话"
  if (!session.title || session.title === '新会话') {
    const flat = content.replace(/\s+/g, ' ').trim();
    session.title = flat.length > 24 ? `${flat.slice(0, 24)}…` : flat;
  }
  sessionStore.saveSession(session);
  // 事件日志：用户消息（崩溃排障轨迹）
  appendSessionEvent(DATA_DIR, session.id, { type: 'user_message', messageId: session.messages[session.messages.length - 1].id, content: content.slice(0, 2000) });

  const wantsSSE = String(req.headers.accept || '').includes('text/event-stream');
  if (!wantsSSE) {
    const events = [];
    await runAgentTurn({
      session,
      harness,
      character,
      characters: cast,
      provider: createProvider(loadSettings()),
      toolRegistry,
      approvals: approvalsMgr,
      workspaceRoot: WORKSPACE_ROOT,
      persist: sessionStore.saveSession,
      emit: (e) => {
        events.push(e);
        appendSessionEvent(DATA_DIR, session.id, e);
        if (e.type === 'tool_result') recordToolUsage(DATA_DIR, e.toolCall?.name);
      },
      settings: loadSettings(),
      toolPipeline,
      modelOverride,
      dataDir: DATA_DIR,
      skills: matchSkills(DATA_DIR, content),
      prefsText: summarizePreferences(getPreferences(DATA_DIR)),
    });
    return sendJson(res, 200, { session, events });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // 客户端断开（停止按钮/关页面）→ abort 本轮：防止服务端继续跑完（耗 token、占锁）
  // 注意：用 res.on('close') 而非 req.on('close')——Node 中 req close 在请求体接收完即触发一次，
  // 客户端真正断开时不触发；res close 在连接关闭时可靠触发（正常 end 由 turnDone 保护）。
  const abortCtl = new AbortController();
  let turnDone = false;
  const emit = (e) => {
    // 事件日志：落盘轨迹（tool_call / tool_result / approval / done / error 等）
    appendSessionEvent(DATA_DIR, session.id, e);
    if (e.type === 'tool_result') recordToolUsage(DATA_DIR, e.toolCall?.name);
    if (res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch {
      /* 连接已断，忽略 */
    }
  };
  res.on('close', () => {
    if (!turnDone) abortCtl.abort();
  });
  res.on('error', () => {});
  res.write(`data: ${JSON.stringify({ type: 'session', session })}\n\n`);
  try {
    await runAgentTurn({
      session,
      harness,
      character,
      characters: cast,
      provider: createProvider(loadSettings()),
      toolRegistry,
      approvals: approvalsMgr,
      workspaceRoot: WORKSPACE_ROOT,
      persist: sessionStore.saveSession,
      emit,
      settings: loadSettings(),
      signal: abortCtl.signal,
      toolPipeline,
      modelOverride,
      dataDir: DATA_DIR,
      skills: matchSkills(DATA_DIR, content),
      prefsText: summarizePreferences(getPreferences(DATA_DIR)),
    });
  } finally {
    turnDone = true;
  }
  if (!res.destroyed) res.end();
}

async function handleResume(req, res, id) {
  const session = getSessionOr404(res, id);
  if (!session) return;
  const harness = harnesses.get(session.modeId);
  if (!harness) return sendJson(res, 400, { error: '会话模式配置缺失' });
  let character = null;
  if (session.characterId) {
    try {
      character = charManager.loadCharacter(session.characterId);
    } catch {
      character = null;
    }
  }
  const cast = loadCast(session);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const abortCtl = new AbortController();
  let turnDone = false;
  const emit = (e) => {
    appendSessionEvent(DATA_DIR, session.id, e);
    if (e.type === 'tool_result') recordToolUsage(DATA_DIR, e.toolCall?.name);
    if (res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch {
      /* 连接已断，忽略 */
    }
  };
  res.on('close', () => {
    if (!turnDone) abortCtl.abort();
  });
  res.on('error', () => {});
  try {
    await runAgentTurn({
      session,
      harness,
      character,
      characters: cast,
      provider: createProvider(loadSettings()),
      toolRegistry,
      approvals: approvalsMgr,
      workspaceRoot: WORKSPACE_ROOT,
      persist: sessionStore.saveSession,
      emit,
      settings: loadSettings(),
      resume: true,
      signal: abortCtl.signal,
      toolPipeline,
      dataDir: DATA_DIR,
      prefsText: summarizePreferences(getPreferences(DATA_DIR)),
    });
  } finally {
    turnDone = true;
  }
  if (!res.destroyed) res.end();
}

function handlePrompt(res, id) {
  const session = getSessionOr404(res, id);
  if (!session) return;
  const harness = harnesses.get(session.modeId);
  if (!harness) return sendJson(res, 400, { error: '会话模式配置缺失' });
  let character = null;
  if (session.characterId) {
    try {
      character = charManager.loadCharacter(session.characterId);
    } catch {
      character = null;
    }
  }
  const cast = loadCast(session);
  const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
  const systemPrompt = assembleSystemPrompt(harness, cast, WORKSPACE_ROOT, session, null, {
    skills: matchSkills(DATA_DIR, lastUser?.content || ''),
    prefsText: summarizePreferences(getPreferences(DATA_DIR)),
  });
  const messages = session.messages.filter((m) => m.role !== 'notice').map((m) => ({
    role: m.role,
    content: m.content && m.content.length > 800 ? `${m.content.slice(0, 800)}…（已截断，共 ${m.content.length} 字符）` : m.content,
    toolCalls: m.toolCalls || undefined,
    name: m.name || undefined,
  }));
  sendJson(res, 200, {
    sessionId: id,
    modeId: session.modeId,
    modeName: harness.name,
    systemPrompt,
    tools: harness.tools,
    model: loadSettings().model || harness.defaultModel,
    messageCount: messages.length,
    messages,
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
};

/** 上传文件扩展名白名单（排除 html/svg/js 等可执行/可被浏览器直接执行脚本的类型） */
const UPLOAD_ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.mp3', '.wav', '.ogg', '.m4a',
  '.mp4', '.webm', '.ogv', '.mov',
  '.pdf', '.txt', '.md', '.json', '.csv', '.zip',
]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
/** body 上限：base64 膨胀约 4/3，放宽到 40MB 以便读到超限内容后返回 413 而非断开连接 */
const UPLOAD_BODY_LIMIT = 40 * 1024 * 1024;

function serveStatic(req, res, urlPath) {
  if (urlPath.startsWith('/themes/skins/')) {
    const SKINS_DIR = path.join(DATA_DIR, 'themes', 'skins');
    const rel = decodeURIComponent(urlPath.slice('/themes/skins/'.length));
    if (!rel || rel.includes('\\') || !/^[0-9a-f]{8}\.(png|jpe?g|webp|gif)$/.test(rel)) {
      return sendJson(res, 403, { error: 'forbidden' });
    }
    const target = path.normalize(path.join(SKINS_DIR, rel));
    if (target !== SKINS_DIR && !target.startsWith(SKINS_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    fs.readFile(target, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
      });
      res.end(data);
    });
    return;
  }
  if (urlPath.startsWith('/uploads/')) {
    const rel = decodeURIComponent(urlPath.slice('/uploads/'.length));
    if (!rel || rel.includes('\\')) return sendJson(res, 403, { error: 'forbidden' });
    const target = path.normalize(path.join(UPLOADS_DIR, rel));
    // 分隔符边界校验：防 /uploads/../uploads2/x 前缀同名越界
    if (target !== UPLOADS_DIR && !target.startsWith(UPLOADS_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    fs.readFile(target, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
      });
      res.end(data);
    });
    return;
  }
  let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(target, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  // Host 校验：仅接受本机访问（防 DNS rebinding / 跨站请求滥用本地 API）
  const host = String(req.headers.host || '');
  const hostOk =
    host === `127.0.0.1:${PORT}` ||
    host === `localhost:${PORT}` ||
    host === `127.0.0.1` ||
    host === `localhost` ||
    host === `[::1]:${PORT}` ||
    host === `[::1]`;
  if (!hostOk) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'forbidden host' }));
  }
  // CSRF 防护：浏览器跨站请求（Origin 存在且非同源）拒绝。
  // 无 Origin（curl/脚本/同源 GET 等）与 Origin: null（Electron file:// 页面）放行。
  const origin = String(req.headers.origin || '');
  if (origin && origin !== 'null') {
    let originOk = false;
    try {
      const o = new URL(origin);
      const oh = o.hostname.toLowerCase();
      // hostname 必须为本机回环，且端口（若携带）与 PORT 一致
      const hostIsLocal = oh === '127.0.0.1' || oh === 'localhost' || oh === '::1';
      const portOk = !o.port || Number(o.port) === PORT;
      originOk = hostIsLocal && portOk;
    } catch {
      originOk = false;
    }
    if (!originOk) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'forbidden origin' }));
    }
  } else if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') {
    // Sec-Fetch-Site: cross-site 明确标记跨站（无 Origin 时兜底）
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'forbidden origin' }));
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && p === '/api/health') {
      return sendJson(res, 200, { ok: true, modes: harnesses.size });
    }
    if (method === 'GET' && p === '/api/plugins') {
      return sendJson(res, 200, { plugins: pluginInfo });
    }
    if (method === 'POST' && p === '/api/plugins/reload') {
      await reloadPlugins();
      return sendJson(res, 200, { plugins: pluginInfo });
    }
    if (method === 'GET' && p === '/api/modes') {
      return sendJson(res, 200, { modes: [...harnesses.values()].map(publicMode) });
    }
    if (method === 'POST' && p === '/api/modes') {
      const body = await readJson(req);
      try {
        const cfg = typeof body.config === 'string' ? parseYaml(body.config) : body.config;
        const errors = validateHarnessShape(cfg);
        if (errors.length) return sendJson(res, 400, { error: `模式配置校验失败: ${errors.join('；')}` });
        if (MODE_IDS.includes(cfg.id)) return sendJson(res, 400, { error: '不允许覆盖内置模式' });
        fs.writeFileSync(path.join(USER_HARNESS_DIR, `${cfg.id}.yaml`), stringifyYaml(cfg), 'utf8');
        reloadUserMode(cfg.id);
        return sendJson(res, 201, { mode: publicMode(harnesses.get(cfg.id)) });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '模式创建失败' });
      }
    }
    if (method === 'PUT' && p.startsWith('/api/modes/')) {
      const id = p.slice('/api/modes/'.length);
      if (MODE_IDS.includes(id)) return sendJson(res, 400, { error: '不允许修改内置模式' });
      const file = path.join(USER_HARNESS_DIR, `${id}.yaml`);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '自定义模式不存在' });
      const body = await readJson(req);
      try {
        const cfg = typeof body.config === 'string' ? parseYaml(body.config) : body.config;
        if (cfg.id !== id) return sendJson(res, 400, { error: '配置 id 与路径不一致' });
        const errors = validateHarnessShape(cfg);
        if (errors.length) return sendJson(res, 400, { error: `模式配置校验失败: ${errors.join('；')}` });
        fs.writeFileSync(file, stringifyYaml(cfg), 'utf8');
        reloadUserMode(id);
        return sendJson(res, 200, { mode: publicMode(harnesses.get(id)) });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '模式更新失败' });
      }
    }
    if (method === 'DELETE' && p.startsWith('/api/modes/')) {
      const id = p.slice('/api/modes/'.length);
      if (MODE_IDS.includes(id)) return sendJson(res, 400, { error: '不允许删除内置模式' });
      const file = path.join(USER_HARNESS_DIR, `${id}.yaml`);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '自定义模式不存在' });
      fs.unlinkSync(file);
      harnesses.delete(id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'GET' && p.startsWith('/api/modes/')) {
      const h = harnesses.get(p.slice('/api/modes/'.length));
      if (!h) return sendJson(res, 404, { error: '模式不存在' });
      return sendJson(res, 200, { mode: h });
    }
    if (method === 'GET' && p === '/api/sessions') {
      return sendJson(res, 200, { sessions: sessionStore.listSessions() });
    }
    if (method === 'DELETE' && p.startsWith('/api/sessions/') && !p.slice('/api/sessions/'.length).includes('/')) {
      const id = p.slice('/api/sessions/'.length).split('/')[0];
      if (!id) return sendJson(res, 400, { error: '缺少会话 id' });
      return withSessionLock(id, async () => {
        try {
          sessionStore.deleteSession(id);
          // 顺带清理该会话的快照、基线与事件日志（目录不存在则跳过）
          deleteSessionEvents(DATA_DIR, id);
          for (const dir of [path.join(DATA_DIR, 'checkpoints', id), path.join(DATA_DIR, 'baselines', id)]) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 404, { error: err.message || '会话不存在' });
        }
      });
    }
    if (method === 'POST' && p === '/api/sessions') {
      const body = await readJson(req);
      const modeId = body.modeId || 'chat';
      if (!harnesses.has(modeId)) return sendJson(res, 400, { error: '模式不存在' });
      if (body.characterId) {
        try {
          charManager.loadCharacter(body.characterId);
        } catch {
          return sendJson(res, 400, { error: '角色不存在' });
        }
      }
      const session = sessionStore.createSession({ modeId, characterId: body.characterId || null });
      if (modeId === 'code') {
        try {
          ensureBaseline(session.id, WORKSPACE_ROOT);
        } catch {
          // 基线创建失败不阻断创建
        }
      }
      return sendJson(res, 201, { session });
    }
    if (method === 'POST' && p === '/api/sessions/import') {
      const body = await readJson(req);
      try {
        const session = sessionStore.importSession(body.session);
        return sendJson(res, 201, { session });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '会话导入失败' });
      }
    }
    if (method === 'GET' && p.startsWith('/api/sessions/') && p.endsWith('/diff')) {
      const id = p.slice('/api/sessions/'.length, -'/diff'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      if (session.modeId !== 'code') return sendJson(res, 400, { error: 'diff 仅适用于 Code 模式会话' });
      try {
        ensureBaseline(id, WORKSPACE_ROOT);
      } catch {
        // 继续尝试 diff，基线缺失时按"全部新增"处理
      }
      const baselineDir = getBaselineDir(id);
      const result = diffWorkspace(baselineDir, WORKSPACE_ROOT);
      return sendJson(res, 200, {
        sessionId: id,
        hasBaseline: Boolean(baselineDir),
        summary: result.summary,
        files: result.files,
        diffText: result.text,
      });
    }
    if (method === 'GET' && p.startsWith('/api/sessions/') && p.endsWith('/checkpoints')) {
      const id = p.slice('/api/sessions/'.length, -'/checkpoints'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      return sendJson(res, 200, { checkpoints: listCheckpoints(id) });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/checkpoints/restore')) {
      const id = p.slice('/api/sessions/'.length, -'/checkpoints/restore'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        try {
          const restored = restoreCheckpoint({ sessionId: id, checkpointId: body.checkpointId, workspaceRoot: WORKSPACE_ROOT });
          session.messages.push({
            role: 'assistant',
            content: `系统提示：已恢复快照（还原 ${restored.restoredFiles} 个文件）。`,
            id: randomUUID(),
          });
          sessionStore.saveSession(session);
          return sendJson(res, 200, { session, restored });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || '恢复失败' });
        }
      });
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/world-state')) {
      const id = p.slice('/api/sessions/'.length, -'/world-state'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        const ws =
          session.worldState && typeof session.worldState === 'object' && !Array.isArray(session.worldState)
            ? { ...session.worldState }
            : {};
        let changed = 0;
        const source = body.worldState && typeof body.worldState === 'object' ? body.worldState : body.updates;
        if (source && typeof source === 'object' && !Array.isArray(source)) {
          for (const [k, v] of Object.entries(source)) {
            if (k && typeof v === 'string' && v.trim()) {
              ws[k.trim()] = v.trim();
              changed++;
            }
          }
        }
        if (!changed) return sendJson(res, 400, { error: '需要 worldState 或 updates 对象且至少一个非空值' });
        session.worldState = ws;
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'DELETE' && p.startsWith('/api/sessions/') && p.endsWith('/world-state')) {
      const id = p.slice('/api/sessions/'.length, -'/world-state'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        session.worldState = {};
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/characters')) {
      const id = p.slice('/api/sessions/'.length, -'/characters'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        try {
          charManager.loadCharacter(body.characterId);
        } catch {
          return sendJson(res, 400, { error: '角色不存在' });
        }
        const cast =
          session.characters && session.characters.length
            ? [...session.characters]
            : session.characterId
              ? [session.characterId]
              : [];
        if (!cast.includes(body.characterId)) cast.push(body.characterId);
        session.characters = cast;
        if (!session.characterId) session.characterId = body.characterId;
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'DELETE' && p.startsWith('/api/sessions/') && p.includes('/characters/')) {
      const rest = p.slice('/api/sessions/'.length);
      const parts = rest.split('/');
      const id = parts[0];
      const characterId = parts[2];
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        session.characters = (session.characters || []).filter((c) => c !== characterId);
        if (session.characterId === characterId) {
          session.characterId = session.characters.length ? session.characters[0] : null;
        }
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/active-character')) {
      const id = p.slice('/api/sessions/'.length, -'/active-character'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        const cast = session.characters && session.characters.length ? session.characters : [session.characterId].filter(Boolean);
        if (!cast.includes(body.characterId)) return sendJson(res, 400, { error: '角色不在阵容中' });
        session.characterId = body.characterId;
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'GET' && p.startsWith('/api/sessions/') && p.endsWith('/export')) {
      const id = p.slice('/api/sessions/'.length, -'/export'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      return sendJson(res, 200, sessionStore.exportSession(id));
    }
    if (method === 'GET' && p.startsWith('/api/sessions/')) {
      const id = p.slice('/api/sessions/'.length).split('/')[0];
      if (!id) return sendJson(res, 400, { error: '缺少会话 id' });
      return sendJson(res, 200, { session: getSessionOr404(res, id) });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/messages')) {
      const id = p.slice('/api/sessions/'.length, -'/messages'.length);
      return withSessionLock(id, () =>
        handleMessages(req, res, id).catch((err) => {
          if (!res.headersSent) sendJson(res, 400, { error: err.message || '消息处理失败' });
          res.end();
        })
      );
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/answer-question')) {
      const id = p.slice('/api/sessions/'.length, -'/answer-question'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req, res);
        if (!session.pendingQuestion) return sendJson(res, 400, { error: '没有待回答的问题' });
        session.pendingQuestion.answer = String(body.answer || '');
        if (body.skipped === true) session.pendingQuestion.skipped = true;
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/resume')) {
      const id = p.slice('/api/sessions/'.length, -'/resume'.length);
      return withSessionLock(id, () =>
        handleResume(req, res, id).catch((err) => {
          if (!res.headersSent) sendJson(res, 400, { error: err.message || '恢复处理失败' });
          res.end();
        })
      );
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/switch-mode')) {
      const id = p.slice('/api/sessions/'.length, -'/switch-mode'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        if (!harnesses.has(body.modeId)) return sendJson(res, 400, { error: '模式不存在' });
        const updated = sessionStore.switchMode(session, body.modeId);
        if (body.modeId === 'code') {
          try {
            ensureBaseline(id, WORKSPACE_ROOT);
          } catch {
            // 基线创建失败不阻断切换
          }
        }
        return sendJson(res, 200, { session: updated, mode: publicMode(harnesses.get(body.modeId)) });
      });
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/goal')) {
      const id = p.slice('/api/sessions/'.length, -'/goal'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const body = await readJson(req);
        sessionStore.setGoal(session, body.goal);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/permission-mode')) {
      const id = p.slice('/api/sessions/'.length, -'/permission-mode'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        if (session.modeId !== 'code') return sendJson(res, 400, { error: '权限模式仅适用于 Code 模式会话' });
        const body = await readJson(req);
        // 切换到无审批模式（激进）需要显式确认标记，防 API 被任意调用开启
        if (body.mode === 'aggressive' && body.confirm !== true) {
          return sendJson(res, 400, { error: '切换到无审批模式需要 confirm: true 确认' });
        }
        const updated = sessionStore.setPermissionMode(session, body.mode);
        return sendJson(res, 200, { session: updated });
      });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/compress')) {
      const id = p.slice('/api/sessions/'.length, -'/compress'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        const harness = harnesses.get(session.modeId);
        if (!harness) return sendJson(res, 400, { error: '会话模式配置缺失' });
        try {
          const settings = loadSettings();
          const result = await compressSession({
            session,
            provider: createProvider(settings),
            opts: { model: settings.model || harness.defaultModel },
          });
          sessionStore.saveSession(session);
          return sendJson(res, 200, { session, ...result });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || '压缩失败' });
        }
      });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/clear')) {
      const id = p.slice('/api/sessions/'.length, -'/clear'.length);
      return withSessionLock(id, async () => {
        const session = getSessionOr404(res, id);
        if (!session) return;
        sessionStore.clearMessages(session);
        return sendJson(res, 200, { session });
      });
    }
    if (method === 'POST' && p === '/api/reset') {
      sessionStore.resetSessions();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'GET' && p.startsWith('/api/prompt/')) {
      const id = p.slice('/api/prompt/'.length);
      return handlePrompt(res, id);
    }
    if (method === 'GET' && p === '/api/characters') {
      return sendJson(res, 200, { characters: charManager.listCharacters() });
    }
    if (method === 'POST' && p === '/api/characters') {
      const body = await readJson(req);
      if (!body.yaml) return sendJson(res, 400, { error: '缺少 yaml 内容' });
      try {
        const character = charManager.saveCharacter(body.yaml);
        return sendJson(res, 201, { character });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '角色保存失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/parse') {
      const body = await readJson(req);
      try {
        const data = parseYaml(body.yaml || '');
        return sendJson(res, 200, { data });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'YAML 解析失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/stringify') {
      const body = await readJson(req);
      try {
        const data = body.data || {};
        const { ok, errors } = validateCharacter(data);
        if (!ok) {
          return sendJson(res, 400, { error: `角色校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}` });
        }
        const normalized = normalizeCharacter(data);
        const yaml = stringifyYaml(normalized);
        return sendJson(res, 200, { yaml });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '序列化失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/import-ccv3') {
      const body = await readJson(req);
      try {
        let character;
        if (body.pngBase64) {
          character = await importCharacterCardFromPng(Buffer.from(body.pngBase64, 'base64'));
        } else if (body.json) {
          character = importCcv3(typeof body.json === 'string' ? JSON.parse(body.json) : body.json);
        } else {
          return sendJson(res, 400, { error: '缺少 json 或 pngBase64' });
        }
        const saved = charManager.saveCharacter(stringifyYaml(character));
        return sendJson(res, 201, { character: saved });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '导入失败' });
      }
    }
    if (method === 'GET' && p === '/api/characters/packs') {
      return sendJson(res, 200, { packs: listPacks() });
    }
    if (method === 'POST' && p === '/api/characters/packs/import') {
      const body = await readJson(req);
      try {
        const pack = getPack(body.packId);
        const result = installPack(pack, { overwrite: body.overwrite === true });
        return sendJson(res, 200, { result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '包安装失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/packs/save') {
      const body = await readJson(req);
      try {
        const meta = savePackFile(body.id, body.pack);
        return sendJson(res, 201, { pack: meta });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '包保存失败' });
      }
    }
    if (method === 'DELETE' && p.startsWith('/api/characters/packs/')) {
      const id = p.slice('/api/characters/packs/'.length);
      try {
        deletePack(id);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 404, { error: err.message || '包不存在' });
      }
    }
    if (method === 'POST' && p === '/api/characters/export-pack') {
      const body = await readJson(req);
      try {
        const all = charManager.listCharacters();
        const ids = Array.isArray(body.characterIds) && body.characterIds.length ? body.characterIds : all.map((c) => c.id);
        const characters = ids.map((id) => charManager.loadCharacter(id));
        const pack = buildPack(characters, { name: body.name, author: body.author });
        return sendJson(res, 200, pack);
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '打包失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/import-pack') {
      const body = await readJson(req);
      try {
        const pack = typeof body.pack === 'string' ? JSON.parse(body.pack) : body.pack;
        const result = installPack(pack, { overwrite: body.overwrite === true });
        return sendJson(res, 201, { result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '包导入失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/import-pack-url') {
      const body = await readJson(req);
      try {
        const pack = await fetchPackJson(body.url);
        const result = installPack(pack, { overwrite: body.overwrite === true });
        return sendJson(res, 201, { result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'URL 导入失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/market/refresh') {
      const body = await readJson(req);
      try {
        const index = await fetchMarketIndex(body.url);
        return sendJson(res, 200, { index });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '市场刷新失败' });
      }
    }
    if (method === 'POST' && p === '/api/characters/market/install') {
      const body = await readJson(req);
      try {
        const pack = await fetchPackJson(body.url);
        const result = installPack(pack, { overwrite: body.overwrite === true });
        return sendJson(res, 201, { result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '市场安装失败' });
      }
    }
    if (method === 'GET' && p.startsWith('/api/characters/') && p.endsWith('/export-ccv3')) {
      const id = p.slice('/api/characters/'.length, -'/export-ccv3'.length);
      try {
        const character = charManager.loadCharacter(id);
        return sendJson(res, 200, exportCcv3(character));
      } catch (err) {
        return sendJson(res, 404, { error: err.message || '角色不存在' });
      }
    }
    if (method === 'GET' && p.startsWith('/api/characters/')) {
      const id = p.slice('/api/characters/'.length);
      try {
        const character = charManager.loadCharacter(id);
        const yaml = charManager.loadCharacterYaml(id);
        return sendJson(res, 200, { character, yaml });
      } catch (err) {
        return sendJson(res, 404, { error: err.message || '角色不存在' });
      }
    }
    if (method === 'PUT' && p.startsWith('/api/characters/')) {
      const id = p.slice('/api/characters/'.length);
      const body = await readJson(req);
      try {
        const character = charManager.updateCharacter(id, body.yaml);
        return sendJson(res, 200, { character });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '角色更新失败' });
      }
    }
    if (method === 'DELETE' && p.startsWith('/api/characters/')) {
      const id = p.slice('/api/characters/'.length);
      try {
        charManager.deleteCharacter(id);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 404, { error: err.message || '角色不存在' });
      }
    }
    if (method === 'GET' && p === '/api/approvals/pending') {
      return sendJson(res, 200, { approvals: approvalsMgr.getPending() });
    }
    if (method === 'POST' && p.startsWith('/api/approvals/')) {
      const id = p.slice('/api/approvals/'.length);
      const body = await readJson(req);
      // 审批决策会改写会话（参数编辑）+ 触发 resume 读-改-写，须与会话消息端点同锁防竞态（2026-08-15 修复）
      const approveSessionId = String(body.sessionId || '');
      const run = async () => {
        try {
          if (body.decision === 'approve') {
            const a = approvalsMgr.approve(id, approveSessionId, body.args);
            // 审批弹窗可编辑参数：同步更新会话挂起状态，resume 执行时用编辑后的参数（pi Steering 思想）
            if (approveSessionId && body.args && typeof body.args === 'object' && !Array.isArray(body.args)) {
              try {
                const s = sessionStore.getSession(approveSessionId);
                if (s?.pendingApproval?.toolCall) {
                  s.pendingApproval.toolCall = { ...s.pendingApproval.toolCall, args: body.args };
                  sessionStore.saveSession(s);
                }
              } catch {
                // 会话不存在等异常忽略：审批记录已含新参数，resume 会走 404 分支
              }
            }
            return sendJson(res, 200, { approval: a });
          }
          if (body.decision === 'deny') {
            approvalsMgr.deny(id, approveSessionId);
            const a = approvalsMgr.getApproval(id);
            // 使用偏好反馈信号（2026-08-17）：记录拒绝的工具，供偏好统计注入
            recordApprovalRejection(DATA_DIR, a?.toolCall?.name);
            return sendJson(res, 200, { approval: a });
          }
          return sendJson(res, 400, { error: 'decision 必须是 approve 或 deny' });
        } catch (err) {
          return sendJson(res, 404, { error: err.message || '审批不存在' });
        }
      };
      return approveSessionId ? withSessionLock(approveSessionId, run) : run();
    }
    if (method === 'GET' && p === '/api/settings') {
      return sendJson(res, 200, { settings: publicSettings(loadSettings()) });
    }
    if (method === 'POST' && p === '/api/settings') {
      const body = await readJson(req);
      const prev = loadSettings();
      const settings = { ...prev, ...body };
      if (Array.isArray(body.providers)) {
        // 多厂商模式：规范化每个厂商条目（apiKey 空串=未修改保留 / null=清除）
        const providers = body.providers.map((np) => {
          const old = prev.providers.find((op) => op.id === np.id);
          // apiKey：undefined/''（脱敏客户端未带或留空）= 保留原值；null = 清除；其他 = 新值
          let apiKey = np.apiKey;
          if (apiKey === undefined || apiKey === '') apiKey = old ? old.apiKey : '';
          else if (apiKey === null) apiKey = '';
          return {
            ...np,
            id: np.id || randomUUID(),
            apiKey,
            models: Array.isArray(np.models) ? np.models : (old?.models || []),
          };
        });
        // mock 内置厂商恒存在（即使前端误删）
        if (!providers.some((p) => p.provider === 'mock')) {
          providers.unshift({ id: 'mock', name: 'Mock（离线演示）', provider: 'mock', baseUrl: '', apiKey: '', model: 'mock', models: [] });
        }
        settings.providers = providers;
        settings.activeProviderId =
          body.activeProviderId && providers.some((p) => p.id === body.activeProviderId) ? body.activeProviderId : providers[0].id;
        const active = providers.find((p) => p.id === settings.activeProviderId);
        settings.provider = active.provider === 'mock' ? 'mock' : (active.provider || 'openai');
        settings.baseUrl = active.baseUrl || '';
        settings.apiKey = active.apiKey || '';
        settings.model = active.model || active.models?.[0] || 'gpt-4o-mini';
      } else {
        // 旧单厂商模式兼容：apiKey 空串保留 / null 清除 / 其他更新——均落到激活厂商条目
        // （顶层 apiKey 是投影只读，直接写会被 ensureProviders 覆盖）
        const activeIdx = settings.providers.findIndex((p) => p.id === settings.activeProviderId);
        if (body.apiKey === null && activeIdx >= 0) settings.providers[activeIdx].apiKey = '';
        else if (body.apiKey && activeIdx >= 0) settings.providers[activeIdx].apiKey = body.apiKey;
      }
      const normalized = ensureProviders(settings);
      saveSettings(normalized);
      return sendJson(res, 200, { settings: publicSettings(normalized) });
    }
    if (method === 'POST' && p === '/api/providers/fetch-models') {
      const body = await readJson(req);
      const baseUrl = String(body.baseUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/chat\/completions$/i, '');
      if (!/^https?:\/\//i.test(baseUrl)) {
        return sendJson(res, 400, { error: 'Base URL 需以 http(s):// 开头' });
      }
      const apiKey = body.apiKey || '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await netFetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal,
        });
        const text = await r.text();
        let j;
        try {
          j = JSON.parse(text);
        } catch {
          return sendJson(res, 502, { error: `模型列表响应不是 JSON（HTTP ${r.status}）` });
        }
        // OpenAI 兼容格式：{data:[{id}]}；兼容 {models:[...]} / 纯数组
        const raw = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : Array.isArray(j) ? j : [];
        const models = raw.map((m) => (typeof m === 'string' ? m : m && m.id)).filter(Boolean).map(String);
        return sendJson(res, 200, { models: [...new Set(models)] });
      } catch (err) {
        return sendJson(res, 502, { error: `获取模型列表失败: ${err.message || String(err)}` });
      } finally {
        clearTimeout(timer);
      }
    }
    if (method === 'GET' && p === '/api/themes') {
      return sendJson(res, 200, { themes: listThemes() });
    }
    if (method === 'POST' && p === '/api/themes') {
      const body = await readJson(req);
      const theme = saveTheme(body);
      return sendJson(res, 201, { theme });
    }
    if (method === 'POST' && p === '/api/themes/background') {
      const body = await readJson(req);
      const r = uploadThemeBackground(body.dataUrl);
      if (!r.ok) return sendJson(res, 400, { error: r.error });
      return sendJson(res, 201, { url: r.url, size: r.size });
    }
    if (method === 'DELETE' && p.startsWith('/api/themes/')) {
      const id = decodeURIComponent(p.slice('/api/themes/'.length));
      return sendJson(res, 200, deleteTheme(id));
    }
    // 自进化技能管理（2026-08-17）：GET 列表（含评分/状态），DELETE 删除技能
    if (method === 'GET' && p === '/api/skills') {
      return sendJson(res, 200, { skills: listSkills(DATA_DIR) });
    }
    if (method === 'DELETE' && p.startsWith('/api/skills/')) {
      const name = decodeURIComponent(p.slice('/api/skills/'.length));
      deleteSkill(DATA_DIR, name);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && p === '/api/uploads') {
      const body = JSON.parse(await readBody(req, UPLOAD_BODY_LIMIT));
      const name = String(body.name || '').trim();
      const data = String(body.data || '');
      if (!name || !data) return sendJson(res, 400, { error: '缺少 name 或 data（base64）' });
      if (data.length > UPLOAD_BODY_LIMIT) return sendJson(res, 413, { error: '文件过大（上限 20MB）' });
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return sendJson(res, 400, { error: 'data 不是有效的 base64' });
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) return sendJson(res, 400, { error: 'data 不是有效的 base64' });
      if (buf.length > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: '文件过大（上限 20MB）' });
      const ext = path.extname(name).toLowerCase();
      if (!UPLOAD_ALLOWED_EXT.has(ext)) {
        return sendJson(res, 400, { error: `不支持的文件类型${ext ? '：' + ext : ''}（支持图片/音视频/PDF/文本/JSON/CSV/ZIP）` });
      }
      // 存储名：uuid 前缀 + 清洗后的原始文件名（保留可读性，防路径穿越）
      const base = path.basename(name, ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'file';
      const filename = `${randomUUID().slice(0, 8)}-${base}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
      return sendJson(res, 201, { url: `/uploads/${filename}`, name: base + ext, size: buf.length, type: MIME[ext] || 'application/octet-stream' });
    }
    if (p.startsWith('/api/')) {
      return sendJson(res, 404, { error: '接口不存在' });
    }
    return serveStatic(req, res, p);
  } catch (err) {
    if (!res.headersSent) return sendJson(res, 400, { error: err.message || String(err) });
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Modeo 已启动: http://127.0.0.1:${PORT}`);
  console.log(`沙箱工作区: ${WORKSPACE_ROOT}`);
  // 启动扫描：事件日志存在但会话文件缺失（会话文件损坏/异常删除）→ 提示可排障
  try {
    const orphans = findOrphanEvents(DATA_DIR, sessionStore.listSessions().map((s) => s.id));
    if (orphans.length) {
      console.warn(`检测到 ${orphans.length} 个孤儿会话事件日志（会话文件缺失）：${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ' ...' : ''}`);
    }
  } catch {
    // 扫描失败不影响启动
  }
});
