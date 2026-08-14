/**
 * 审批管理器：落盘持久化（服务重启不丢失）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'approvals.json');

function loadAll() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
  } catch {
    return new Map();
  }
}

function persistAll() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(pending), null, 2), 'utf8');
}

const pending = loadAll();

/** 审批有效期（毫秒）：超时未决定视为过期，resume 时拒绝 */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function createApproval({ sessionId, toolCall, summary }) {
  const approval = {
    id: randomUUID(),
    sessionId,
    toolCall,
    summary: summary || `${toolCall.name} ${JSON.stringify(toolCall.args)}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
  };
  pending.set(approval.id, approval);
  persistAll();
  return approval;
}

/** 若审批已超过有效期，标记 expired 并返回 true */
export function isExpired(a) {
  if (a.status !== 'pending' || !a.expiresAt) return false;
  if (Date.now() > new Date(a.expiresAt).getTime()) {
    a.status = 'expired';
    a.decidedAt = new Date().toISOString();
    persistAll();
    return true;
  }
  return false;
}

export function approve(id, sessionId, argsOverride) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  if (sessionId && a.sessionId !== sessionId) throw new Error('审批不属于当前会话');
  if (isExpired(a)) throw new Error('审批已超时，请重新发起操作');
  // 用户可在审批弹窗中编辑工具参数后再批准（pi Steering 思想）：
  // 覆盖 toolCall.args 后，引擎 resume 执行时用新参数
  if (argsOverride && typeof argsOverride === 'object' && !Array.isArray(argsOverride)) {
    a.toolCall = { ...a.toolCall, args: argsOverride };
  }
  a.status = 'approved';
  a.decidedAt = new Date().toISOString();
  persistAll();
  return a;
}

export function deny(id, sessionId) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  if (sessionId && a.sessionId !== sessionId) throw new Error('审批不属于当前会话');
  if (isExpired(a)) throw new Error('审批已超时，请重新发起操作');
  a.status = 'denied';
  a.decidedAt = new Date().toISOString();
  persistAll();
  return a;
}

export function getPending() {
  for (const a of pending.values()) isExpired(a); // 惰性清理过期审批
  return [...pending.values()].filter((a) => a.status === 'pending');
}

export function getApproval(id) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  return a;
}
