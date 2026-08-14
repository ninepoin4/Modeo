/**
 * 会话事件日志（P1-1，dsh append-only 日志思想的轻量版）。
 * 每个会话一条 append-only JSONL：data/sessions-events/<id>.jsonl。
 * 记录低频高价值事件（tool_call / tool_result / approval / checkpoint / done / error / user_message），
 * 不记 text_delta 高频增量，避免阻塞事件循环。
 * 用途：崩溃后排障轨迹（"最后发生了什么"）+ 审计；不做完整事件溯源重建。
 */
import fs from 'node:fs';
import path from 'node:path';

function eventsDir(dataDir) {
  return path.join(dataDir, 'sessions-events');
}

function fileOf(dataDir, sessionId) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(sessionId))) return null;
  return path.join(eventsDir(dataDir), `${sessionId}.jsonl`);
}

/** 追加一条会话事件（写失败静默，不影响主流程） */
export function appendSessionEvent(dataDir, sessionId, evt) {
  if (!dataDir || !sessionId || !evt) return;
  // text_delta 是高频增量（真实模型每秒数十个），同步写盘会拖慢流式输出——只记低频高价值事件
  if (evt.type === 'text_delta') return;
  const file = fileOf(dataDir, sessionId);
  if (!file) return;
  try {
    fs.mkdirSync(eventsDir(dataDir), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...evt })}\n`, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 读取某会话的事件日志（供轨迹视图/排障） */
export function getSessionEvents(dataDir, sessionId) {
  const file = fileOf(dataDir, sessionId);
  if (!file || !fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // 跳过损坏行
    }
  }
  return out;
}

/** 删除会话时清理事件日志 */
export function deleteSessionEvents(dataDir, sessionId) {
  const file = fileOf(dataDir, sessionId);
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 忽略
  }
}

/**
 * 启动时扫描：找出"有事件日志但没有对应会话文件"的孤儿日志（会话文件损坏/被删），返回 id 列表。
 */
export function findOrphanEvents(dataDir, existingSessionIds) {
  const dir = eventsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const ids = new Set(existingSessionIds || []);
  const orphans = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const id = f.slice(0, -'.jsonl'.length);
    if (!ids.has(id)) orphans.push(id);
  }
  return orphans;
}
