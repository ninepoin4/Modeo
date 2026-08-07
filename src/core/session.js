/**
 * 会话存储：data/sessions/<id>.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function fileOf(id) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(id))) throw new Error('会话 id 非法');
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function createSession({ modeId, characterId = null }) {
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    modeId,
    characterId: characterId || null,
    characters: [],
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    modeLog: [],
    pendingApproval: null,
    worldState: {},
    goal: null,
    lastSummary: null,
    // code 模式权限：standard=一般（审批闸门）/ aggressive=无审批（激进）
    permissionMode: 'standard',
  };
  saveSession(session);
  return session;
}

export function listSessions() {
  const out = [];
  if (!fs.existsSync(SESSIONS_DIR)) return out;
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      out.push({
        id: s.id,
        title: s.title || '新会话',
        modeId: s.modeId,
        characterId: s.characterId || null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    } catch {
      // 跳过损坏文件
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getSession(id) {
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new Error(`会话不存在: ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileOf(session.id), JSON.stringify(session, null, 2), 'utf8');
}

export function resetSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(SESSIONS_DIR, f));
  }
}

export function switchMode(session, modeId, modeName = modeId) {
  if (session.modeId === modeId) return session;
  session.modeLog.push({ at: new Date().toISOString(), from: session.modeId, to: modeId });
  session.modeId = modeId;
  session.messages.push({
    role: 'notice',
    content: `已切换到『${modeName}』模式，系统提示词与工具已变更。`,
    id: randomUUID(),
  });
  saveSession(session);
  return session;
}

/**
 * 切换会话权限模式（仅 code 模式有意义）：
 * standard=一般模式（危险命令/敏感路径需审批）；aggressive=无审批模式（激进，完全放行）。
 * 变更以 notice 记录，前端同步显示。
 */
export function setPermissionMode(session, mode) {
  const next = mode === 'aggressive' ? 'aggressive' : 'standard';
  if (session.permissionMode === next) return session;
  session.permissionMode = next;
  session.messages.push({
    role: 'notice',
    content: next === 'aggressive'
      ? '已切换到无审批模式：agent 可执行任意命令、访问任意文件（激进，风险自负）。'
      : '已切换到一般模式：危险命令与敏感路径访问需审批。',
    id: randomUUID(),
  });
  saveSession(session);
  return session;
}

/**
 * 设置/清除会话目标。目标为非空字符串时注入系统提示词；空值清除。
 * 操作结果以 notice 消息（不发给模型）反馈给用户。
 */
export function setGoal(session, goal) {
  const trimmed = String(goal || '').trim();
  const cleared = !trimmed;
  if (session.goal === (cleared ? null : trimmed)) {
    return session;
  }
  session.goal = cleared ? null : trimmed;
  session.messages.push({
    role: 'notice',
    content: cleared ? '已清除会话目标。' : `已设置会话目标：${trimmed}`,
    id: randomUUID(),
  });
  saveSession(session);
  return session;
}

/**
 * 清空会话消息历史（目标、世界状态、快照保留），追加一条系统提示。
 */
export function clearMessages(session) {
  session.messages = [
    {
      role: 'notice',
      content: '已清空当前会话历史（目标、世界状态与快照保留）。',
      id: randomUUID(),
    },
  ];
  saveSession(session);
  return session;
}

/**
 * 导出会话为可移植 JSON（备份/迁移）。
 */
export function exportSession(id) {
  const s = getSession(id);
  const { id: _id, ...rest } = s;
  return rest;
}

/**
 * 导入会话：校验形状后以新 id 落盘。
 */
export function importSession(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
    throw new Error('会话数据无效：缺少 messages 数组');
  }
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    modeId: ['chat', 'code', 'roleplay'].includes(data.modeId) ? data.modeId : 'chat',
    characterId: typeof data.characterId === 'string' ? data.characterId : null,
    characters: Array.isArray(data.characters) ? data.characters.filter((c) => typeof c === 'string') : [],
    title: data.title || '导入会话',
    createdAt: now,
    updatedAt: now,
    messages: data.messages,
    modeLog: Array.isArray(data.modeLog) ? data.modeLog : [],
    worldState: data.worldState && typeof data.worldState === 'object' && !Array.isArray(data.worldState) ? data.worldState : {},
    goal: typeof data.goal === 'string' ? data.goal : null,
    lastSummary: typeof data.lastSummary === 'string' ? data.lastSummary : null,
    pendingApproval: null,
    permissionMode: data.permissionMode === 'aggressive' ? 'aggressive' : 'standard',
  };
  saveSession(session);
  return session;
}
