/**
 * Harness 配置：加载、校验、渲染系统提示词。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.js';
import { validateHarnessShape, applyHarnessDefaults } from './types.js';

export function loadHarnessConfigs(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.yaml')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const cfg = parseYaml(text);
    const errors = validateHarnessShape(cfg);
    if (errors.length) {
      throw new Error(`harness 配置 ${f} 校验失败: ${errors.join('；')}`);
    }
    out.push(applyHarnessDefaults(cfg));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 加载用户自定义模式目录（损坏文件跳过，不阻断启动）。
 */
export function loadUserHarnessConfigs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.yaml')) continue;
    try {
      const cfg = parseYaml(fs.readFileSync(path.join(dir, f), 'utf8'));
      const errors = validateHarnessShape(cfg);
      if (errors.length) continue;
      out.push(applyHarnessDefaults(cfg));
    } catch {
      // 跳过损坏文件
    }
  }
  return out;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? '' : acc[k]), obj);
}

function renderArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return '（无）';
  return arr.map((x) => `- ${x}`).join('\n');
}

function renderExamples(ems) {
  if (!Array.isArray(ems) || !ems.length) return '（无）';
  return ems.map((em, i) => `示例 ${i + 1}:\n用户：${em.user}\n角色：${em.assistant}`).join('\n\n');
}

export const DEFAULT_CHARACTER_TEMPLATE = `你是角色「{{name}}」。
{{description}}
身份：{{persona.identity}}
背景：{{persona.background}}
性格：{{persona.personality}}
说话风格：{{persona.speakingStyle}}
世界观：{{setting.world}}
当前场景：{{setting.scenario}}
行为规则：
{{rules}}
内容边界：
{{boundaries}}
开场白：{{greeting}}
对话示例：
{{example_messages}}
始终以角色身份回应，保持人设一致。`;

/**
 * 用模板渲染角色对象（{{field}} 或 {{a.b}} 点路径）。
 */
export function renderCharacterPrompt(harness, character) {
  if (!character) return '';
  const template = harness?.characterPromptTemplate || DEFAULT_CHARACTER_TEMPLATE;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, dotted) => {
    if (dotted === 'rules') return renderArray(character.rules);
    if (dotted === 'boundaries') return renderArray(character.boundaries);
    if (dotted === 'memory_seeds') return renderArray(character.memory_seeds);
    if (dotted === 'example_messages') return renderExamples(character.example_messages);
    const v = getPath(character, dotted);
    return v == null ? '' : String(v);
  });
}

/**
 * 计算最终系统提示词。chat 模式恒为 null（零注入）。
 */
export function getEffectiveSystemPrompt(harness, character = null) {
  if (!harness) return null;
  if (harness.id === 'chat') return null;
  const base = harness.systemPrompt || '';
  if (harness.id === 'roleplay' && character) {
    const rendered = renderCharacterPrompt(harness, character);
    return rendered ? (base ? `${base}\n\n${rendered}` : rendered) : base;
  }
  return base;
}
