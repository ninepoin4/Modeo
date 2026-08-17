/**
 * 使用偏好统计（MiMo 会话后异步评估的轻量纯统计版，2026-08-17）：
 * 只做零 token 的确定性统计——工具调用频率 + 审批拒绝，
 * 数据存 <dataDir>/preferences.json（原子写），注入 code 模式 systemPrompt。
 * 风格类隐式学习（观察用户改写代码）成本高且误报多，第一版不做，留待后续。
 *
 * 2026-08-17 审查修复：高频工具任务每次工具结果都原子重写整文件是 IO 浪费——
 * 改为内存缓存 + 1s debounce 合并落盘（统计非关键数据，最多丢 1s 增量）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

const FLUSH_DEBOUNCE_MS = 1000;
const _cache = new Map(); // dataDir -> prefs 内存缓存
const _timers = new Map(); // dataDir -> timer

function prefsFile(dataDir) {
  return path.join(dataDir, 'preferences.json');
}

export function getPreferences(dataDir) {
  if (_cache.has(dataDir)) return _cache.get(dataDir);
  try {
    return JSON.parse(fs.readFileSync(prefsFile(dataDir), 'utf8'));
  } catch {
    return { toolUsage: {}, approvals: { rejected: {} }, updatedAt: null };
  }
}

function flush(dataDir) {
  _timers.delete(dataDir);
  const p = _cache.get(dataDir);
  if (!p) return;
  _cache.delete(dataDir);
  try {
    atomicWriteFileSync(prefsFile(dataDir), JSON.stringify(p, null, 2));
  } catch {
    /* 统计写失败不影响主流程 */
  }
}

function scheduleFlush(dataDir) {
  if (_timers.has(dataDir)) return;
  _timers.set(
    dataDir,
    setTimeout(() => flush(dataDir), FLUSH_DEBOUNCE_MS)
  );
}

function mutate(dataDir, fn) {
  if (!dataDir) return;
  const p = getPreferences(dataDir);
  fn(p);
  p.updatedAt = new Date().toISOString();
  _cache.set(dataDir, p);
  scheduleFlush(dataDir);
}

/** 工具调用频率（server 的 emit 包装器在 TOOL_RESULT 事件时调用） */
export function recordToolUsage(dataDir, toolName) {
  if (!dataDir || !toolName) return;
  mutate(dataDir, (p) => {
    p.toolUsage[toolName] = (p.toolUsage[toolName] || 0) + 1;
  });
}

/** 审批拒绝（approvals deny 时调用） */
export function recordApprovalRejection(dataDir, toolName) {
  if (!dataDir) return;
  mutate(dataDir, (p) => {
    p.approvals = p.approvals || { rejected: {} };
    p.approvals.rejected[toolName || 'unknown'] = (p.approvals.rejected[toolName || 'unknown'] || 0) + 1;
  });
}

/** 偏好 → 注入文本（纯统计，无 LLM 调用） */
export function summarizePreferences(prefs) {
  if (!prefs) return null;
  const lines = [];
  const usage = Object.entries(prefs.toolUsage || {}).sort((a, b) => b[1] - a[1]);
  if (usage.length) {
    const top = usage
      .slice(0, 5)
      .map(([k, v]) => `${k}(${v})`)
      .join('、');
    lines.push(`常用工具：${top}`);
  }
  const rejected = Object.entries(prefs.approvals?.rejected || {}).sort((a, b) => b[1] - a[1]);
  for (const [tool, n] of rejected) {
    lines.push(`${tool} 工具近期被拒绝 ${n} 次，优先使用更安全或更具体的方式完成同类操作`);
  }
  return lines.length ? lines.join('；') : null;
}
