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
import * as sessionStore from './src/core/session.js';
import * as approvalsMgr from './src/core/approvals.js';
import { runAgentTurn, assembleSystemPrompt } from './src/runtime/engine.js';
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
import { listThemes, getTheme, saveTheme, deleteTheme, BUILTIN_THEMES } from './src/core/themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const PUBLIC_DIR = fs.existsSync(WEB_DIR) ? WEB_DIR : path.join(ROOT, 'public');
const DATA_DIR = process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const WORKSPACE_ROOT = process.env.MODEO_WORKSPACE_DIR
  ? path.resolve(process.env.MODEO_WORKSPACE_DIR)
  : path.join(ROOT, 'workspaces', 'default');
const USER_HARNESS_DIR = path.join(DATA_DIR, 'harness');
const PORT = Number(process.env.MODEO_PORT || 8787);

fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
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
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

/**
 * 对外脱敏：apiKey 不回传明文，改为 apiKeySet 布尔。
 * 前端保存时 apiKey 传空字符串表示未修改，服务端保留原值。
 */
function publicSettings(s) {
  const { apiKey, ...rest } = s;
  return { ...rest, apiKeySet: Boolean(apiKey) };
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

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
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
  const body = await readJson(req);
  const content = String(body.content || '').trim();
  if (!content) return sendJson(res, 400, { error: '消息内容为空' });

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
  sessionStore.saveSession(session);

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
      emit: (e) => events.push(e),
      settings: loadSettings(),
    });
    return sendJson(res, 200, { session, events });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  res.write(`data: ${JSON.stringify({ type: 'session', session })}\n\n`);
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
  });
  res.end();
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
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
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
  });
  res.end();
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
  const systemPrompt = assembleSystemPrompt(harness, cast, WORKSPACE_ROOT, session);
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
    model: harness.defaultModel,
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
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(target, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
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
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/world-state')) {
      const id = p.slice('/api/sessions/'.length, -'/world-state'.length);
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
    }
    if (method === 'DELETE' && p.startsWith('/api/sessions/') && p.endsWith('/world-state')) {
      const id = p.slice('/api/sessions/'.length, -'/world-state'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      session.worldState = {};
      sessionStore.saveSession(session);
      return sendJson(res, 200, { session });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/characters')) {
      const id = p.slice('/api/sessions/'.length, -'/characters'.length);
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
    }
    if (method === 'DELETE' && p.startsWith('/api/sessions/') && p.includes('/characters/')) {
      const rest = p.slice('/api/sessions/'.length);
      const parts = rest.split('/');
      const id = parts[0];
      const characterId = parts[2];
      const session = getSessionOr404(res, id);
      if (!session) return;
      session.characters = (session.characters || []).filter((c) => c !== characterId);
      if (session.characterId === characterId) {
        session.characterId = session.characters.length ? session.characters[0] : null;
      }
      sessionStore.saveSession(session);
      return sendJson(res, 200, { session });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/active-character')) {
      const id = p.slice('/api/sessions/'.length, -'/active-character'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      const body = await readJson(req);
      const cast = session.characters && session.characters.length ? session.characters : [session.characterId].filter(Boolean);
      if (!cast.includes(body.characterId)) return sendJson(res, 400, { error: '角色不在阵容中' });
      session.characterId = body.characterId;
      sessionStore.saveSession(session);
      return sendJson(res, 200, { session });
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
      return handleMessages(req, res, id);
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/resume')) {
      const id = p.slice('/api/sessions/'.length, -'/resume'.length);
      return handleResume(req, res, id);
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/switch-mode')) {
      const id = p.slice('/api/sessions/'.length, -'/switch-mode'.length);
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
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/goal')) {
      const id = p.slice('/api/sessions/'.length, -'/goal'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      const body = await readJson(req);
      sessionStore.setGoal(session, body.goal);
      return sendJson(res, 200, { session });
    }
    if (method === 'PUT' && p.startsWith('/api/sessions/') && p.endsWith('/permission-mode')) {
      const id = p.slice('/api/sessions/'.length, -'/permission-mode'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      if (session.modeId !== 'code') return sendJson(res, 400, { error: '权限模式仅适用于 Code 模式会话' });
      const body = await readJson(req);
      const updated = sessionStore.setPermissionMode(session, body.mode);
      return sendJson(res, 200, { session: updated });
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/compress')) {
      const id = p.slice('/api/sessions/'.length, -'/compress'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      const harness = harnesses.get(session.modeId);
      if (!harness) return sendJson(res, 400, { error: '会话模式配置缺失' });
      try {
        const settings = loadSettings();
        const result = await compressSession({
          session,
          provider: createProvider(settings),
          opts: { model: harness.defaultModel || settings.model },
        });
        sessionStore.saveSession(session);
        return sendJson(res, 200, { session, ...result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || '压缩失败' });
      }
    }
    if (method === 'POST' && p.startsWith('/api/sessions/') && p.endsWith('/clear')) {
      const id = p.slice('/api/sessions/'.length, -'/clear'.length);
      const session = getSessionOr404(res, id);
      if (!session) return;
      sessionStore.clearMessages(session);
      return sendJson(res, 200, { session });
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
        const yaml = fs.readFileSync(path.join(ROOT, 'characters', `${id}.yaml`), 'utf8');
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
      try {
        if (body.decision === 'approve') approvalsMgr.approve(id);
        else if (body.decision === 'deny') approvalsMgr.deny(id);
        else return sendJson(res, 400, { error: 'decision 必须是 approve 或 deny' });
        return sendJson(res, 200, { approval: approvalsMgr.getApproval(id) });
      } catch (err) {
        return sendJson(res, 404, { error: err.message || '审批不存在' });
      }
    }
    if (method === 'GET' && p === '/api/settings') {
      return sendJson(res, 200, { settings: publicSettings(loadSettings()) });
    }
    if (method === 'POST' && p === '/api/settings') {
      const body = await readJson(req);
      const settings = { ...loadSettings(), ...body };
      // apiKey 为空字符串表示"未修改"：保留原值（前端脱敏后不回传密钥）
      if (body.apiKey === '' && loadSettings().apiKey) {
        settings.apiKey = loadSettings().apiKey;
      }
      saveSettings(settings);
      return sendJson(res, 200, { settings: publicSettings(settings) });
    }
    if (method === 'GET' && p === '/api/themes') {
      return sendJson(res, 200, { themes: listThemes() });
    }
    if (method === 'POST' && p === '/api/themes') {
      const body = await readJson(req);
      const theme = saveTheme(body);
      return sendJson(res, 201, { theme });
    }
    if (method === 'DELETE' && p.startsWith('/api/themes/')) {
      const id = decodeURIComponent(p.slice('/api/themes/'.length));
      return sendJson(res, 200, deleteTheme(id));
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
});
