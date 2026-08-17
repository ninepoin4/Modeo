/**
 * 技能提炼（Hermes skill auto-generation 借鉴，2026-08-17）：
 * 会话结束后由引擎判定触发，用一次轻量 LLM 调用把执行轨迹提炼为技能文档。
 * 任何失败静默（不打断主流程）；自带 15s 超时，不占用会话锁。
 */
import { saveSkill } from '../core/skillStore.js';

const MAX_TRAJ_CHARS = 12000;
const MAX_CONTENT_CHARS = 2000;
const DISTILL_TIMEOUT_MS = 15000;

export function buildDistillPrompt(trajectory) {
  return [
    '你是技能提炼器。从下面的会话执行轨迹中，提炼一份「下次遇到同类任务可直接照做」的可复用技能。',
    '场景是编程任务（工具调用、踩坑、修复、验证流程）。',
    '仅当轨迹具备明确可复用价值（多步骤流程 / 遇到错误并解决 / 特定领域固定套路）时输出技能，否则输出 {"skip": true}。',
    '输出必须是单个 JSON 对象，格式：',
    '{"name": "英文短横线命名（如 vite-deploy）", "triggers": ["用户触发词", "最多 8 个，覆盖用户会说的话"], "content": "中文步骤式正文，200 字以内，含：适用场景 / 关键步骤 / 常见坑与解法"}',
    '要求：name 只含小写字母数字与短横线；content 是纯正文，不要 markdown 代码块；不要输出 JSON 以外的任何内容。',
    '',
    '===== 会话轨迹 =====',
    String(trajectory || '').slice(0, MAX_TRAJ_CHARS),
  ].join('\n');
}

export function parseSkillFromResponse(text) {
  const t = String(text || '').trim();
  let obj = null;
  try {
    obj = JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  if (!obj || obj.skip === true) return null;
  const name = String(obj.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const triggers = Array.isArray(obj.triggers) ? obj.triggers.map(String).filter(Boolean).slice(0, 8) : [];
  const content = String(obj.content || '').trim().slice(0, MAX_CONTENT_CHARS);
  if (!name || !content) return null;
  return { name, triggers, content };
}

/** 会话消息 → 提炼用轨迹文本（工具结果截断防膨胀） */
export function buildTrajectory(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m.role === 'user') out.push(`[用户] ${String(m.content || '').slice(0, 300)}`);
    else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length) {
        out.push(`[助手] 调用工具: ${m.toolCalls.map((tc) => tc.name).join(', ')}`);
      } else {
        out.push(`[助手] ${String(m.content || '').slice(0, 300)}`);
      }
    } else if (m.role === 'tool') {
      out.push(`[工具结果] ${String(m.content || '').slice(0, 400)}`);
    }
  }
  return out.join('\n').slice(0, MAX_TRAJ_CHARS);
}

/**
 * 异步提炼技能。返回保存后的技能对象；任何失败/超时/无价值返回 null（静默）。
 * 超时用 Promise.race 实现（AbortController 对不监听 signal 的 provider 无效）。
 * @param {{provider: object, messages: Array, dataDir: string, sessionId?: string|null}} opts
 */
export async function distillSkill({ provider, messages, dataDir, sessionId = null }) {
  try {
    if (!provider || !dataDir || typeof provider.stream !== 'function') return null;
    const trajectory = buildTrajectory(messages);
    if (trajectory.length < 200) return null; // 轨迹太短，无提炼价值
    const prompt = buildDistillPrompt(trajectory);
    const collect = async () => {
      let text = '';
      for await (const chunk of provider.stream([{ role: 'user', content: prompt }], { temperature: 0.2 })) {
        if (chunk.type === 'text_delta') text += chunk.delta || '';
        if (text.length > 16000) break; // 防御性上限
      }
      return text;
    };
    let timer;
    const text = await Promise.race([
      collect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('技能提炼超时')), DISTILL_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!text.trim()) return null;
    const skill = parseSkillFromResponse(text);
    if (!skill) return null;
    skill.source = sessionId;
    return saveSkill(dataDir, skill);
  } catch {
    return null;
  }
}
