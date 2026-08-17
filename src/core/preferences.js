/**
 * 使用偏好统计（MiMo 会话后异步评估的轻量纯统计版，2026-08-17）：
 * 只做零 token 的确定性统计——工具调用频率 + 审批拒绝，
 * 数据存 <dataDir>/preferences.json（原子写），注入 code 模式 systemPrompt。
 * 风格类隐式学习（观察用户改写代码）成本高且误报多，第一版不做，留待后续。
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

function prefsFile(dataDir) {
  return path.join(dataDir, 'preferences.json');
}

export function getPreferences(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(dataDir), 'utf8'));
  } catch {
    return { toolUsage: {}, approvals: { rejected: {} }, updatedAt: null };
  }
}

function savePrefs(dataDir, prefs) {
  prefs.updatedAt = new Date().toISOString();
  atomicWriteFileSync(prefsFile(dataDir), JSON.stringify(prefs, null, 2));
}

/** 工具调用频率（server 的 emit 包装器在 TOOL_RESULT 事件时调用） */
export function recordToolUsage(dataDir, toolName) {
  if (!dataDir || !toolName) return;
  const p = getPreferences(dataDir);
  p.toolUsage[toolName] = (p.toolUsage[toolName] || 0) + 1;
  savePrefs(dataDir, p);
}

/** 审批拒绝（approvals deny 时调用） */
export function recordApprovalRejection(dataDir, toolName) {
  if (!dataDir) return;
  const p = getPreferences(dataDir);
  p.approvals = p.approvals || { rejected: {} };
  p.approvals.rejected[toolName || 'unknown'] = (p.approvals.rejected[toolName || 'unknown'] || 0) + 1;
  savePrefs(dataDir, p);
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
