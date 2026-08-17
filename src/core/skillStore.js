/**
 * 技能存储（Hermes self-evolving skills 借鉴，2026-08-17）：
 * 任务完成后提炼的可复用技能沉淀为 <dataDir>/skills/<name>.md，
 * frontmatter 为单行 JSON（不依赖 YAML 子集解析器），正文为 Markdown 步骤。
 * 纯文件 + 关键词匹配，零依赖，不引入全文搜索。
 *
 * 质量门控（Hermes 已知局限的护栏）：usage/failures 计数 → score；
 * 失败率超阈值或长期未用自动 archive（不再注入），用户可随时删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const STALE_DAYS = 90;

function skillsDir(dataDir) {
  return path.join(dataDir, 'skills');
}

function skillFile(dataDir, name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  return path.join(skillsDir(dataDir), `${name}.md`);
}

function defaultMeta(name) {
  return {
    name,
    triggers: [],
    usage: 0,
    failures: 0,
    score: 0.5,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
    source: null,
  };
}

function serialize(skill) {
  const { content, ...meta } = skill;
  return `---\n${JSON.stringify(meta)}\n---\n\n${typeof content === 'string' ? content : ''}\n`;
}

function parseSkillFile(text) {
  const m = /^---\n(\{[\s\S]*?\})\n---\n?([\s\S]*)$/.exec(String(text || ''));
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    return { ...meta, content: (m[2] || '').trim() };
  } catch {
    return null;
  }
}

/** 列出全部技能（active 在前，按 score 降序） */
export function listSkills(dataDir) {
  const dir = skillsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const s = parseSkillFile(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s) out.push(s);
    } catch {
      /* 损坏技能跳过 */
    }
  }
  return out.sort((a, b) => (b.status === 'active') - (a.status === 'active') || (b.score || 0) - (a.score || 0));
}

/** 仅 active 技能 */
export function listActiveSkills(dataDir) {
  return listSkills(dataDir).filter((s) => s.status !== 'archived');
}

export function getSkill(dataDir, name) {
  const file = skillFile(dataDir, name);
  if (!file || !fs.existsSync(file)) return null;
  return parseSkillFile(fs.readFileSync(file, 'utf8'));
}

export function saveSkill(dataDir, skill) {
  if (!skill || !NAME_RE.test(String(skill.name || ''))) throw new Error('技能名称无效');
  const merged = { ...defaultMeta(skill.name), ...skill, name: skill.name, updatedAt: new Date().toISOString() };
  fs.mkdirSync(skillsDir(dataDir), { recursive: true });
  const file = skillFile(dataDir, skill.name);
  atomicWriteFileSync(file, serialize(merged));
  return merged;
}

export function deleteSkill(dataDir, name) {
  const file = skillFile(dataDir, name);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

/** 关键词匹配：任一 trigger 出现在输入文本中（大小写不敏感）即命中 */
export function matchSkills(dataDir, text) {
  const t = String(text || '').toLowerCase();
  if (!t) return [];
  return listActiveSkills(dataDir).filter(
    (s) => Array.isArray(s.triggers) && s.triggers.some((k) => k && t.includes(String(k).toLowerCase()))
  );
}

/**
 * 质量门控：调用后登记结果。
 * - usage/failures → score = max(0, 1 - failures/usage*2)
 * - 用过 ≥3 次且 score < 0.3 → archive（低质量沉淀不注入）
 * - 超过 90 天未使用 → archive（陈旧技能不注入）
 */
export function recordSkillUsage(dataDir, name, ok) {
  const s = getSkill(dataDir, name);
  if (!s) return null;
  s.usage = (s.usage || 0) + 1;
  if (!ok) s.failures = (s.failures || 0) + 1;
  s.score = s.usage > 0 ? Math.max(0, 1 - (s.failures / s.usage) * 2) : 0.5;
  s.lastUsedAt = new Date().toISOString();
  s.updatedAt = s.lastUsedAt;
  const stale = !s.lastUsedAt || Date.now() - new Date(s.lastUsedAt).getTime() > STALE_DAYS * 864e5;
  if ((s.usage >= 3 && s.score < 0.3) || (stale && s.usage > 0)) s.status = 'archived';
  const file = skillFile(dataDir, s.name);
  if (file) atomicWriteFileSync(file, serialize(s));
  return s;
}

/** 技能注入 systemPrompt 的文本（截断 content，防上下文膨胀） */
export function skillsToPromptText(skills) {
  if (!skills || !skills.length) return null;
  const lines = skills.map((s) => {
    const triggers = Array.isArray(s.triggers) && s.triggers.length ? `（触发词：${s.triggers.slice(0, 5).join(' / ')}）` : '';
    return `- ${s.name}${triggers}：${String(s.content || '').slice(0, 160)}`;
  });
  return `【已沉淀技能（来自历史任务的经验，仅作参考；与当前项目冲突时以当前项目为准；如发现技能过时请忽略）】\n${lines.join('\n')}`;
}
