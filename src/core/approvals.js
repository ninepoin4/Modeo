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

export function createApproval({ sessionId, toolCall, summary }) {
  const approval = {
    id: randomUUID(),
    sessionId,
    toolCall,
    summary: summary || `${toolCall.name} ${JSON.stringify(toolCall.args)}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  pending.set(approval.id, approval);
  persistAll();
  return approval;
}

export function approve(id) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  a.status = 'approved';
  a.decidedAt = new Date().toISOString();
  persistAll();
  return a;
}

export function deny(id) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  a.status = 'denied';
  a.decidedAt = new Date().toISOString();
  persistAll();
  return a;
}

export function getPending() {
  return [...pending.values()].filter((a) => a.status === 'pending');
}

export function getApproval(id) {
  const a = pending.get(id);
  if (!a) throw new Error('审批不存在');
  return a;
}
