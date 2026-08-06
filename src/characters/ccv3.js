/**
 * Character Card V3 互转（JSON 形态；PNG 见 png.js）。
 */
import { normalizeCharacter } from './schema.js';

function parseMesExample(mesExample) {
  const blocks = String(mesExample || '').split(/<START>/i).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    let user = '';
    let assistant = '';
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^\{\{\s*user\s*\}\}\s*:\s*(.*)$/i) || line.match(/^\{user\}:\s*(.*)$/i);
      const a = line.match(/^\{\{\s*char\s*\}\}\s*:\s*(.*)$/i) || line.match(/^\{char\}:\s*(.*)$/i);
      if (m) user = (user ? user + '\n' : '') + m[1];
      else if (a) assistant = (assistant ? assistant + '\n' : '') + a[1];
    }
    if (user && assistant) out.push({ user, assistant });
  }
  return out;
}

function buildMesExample(exampleMessages) {
  if (!Array.isArray(exampleMessages) || !exampleMessages.length) return '';
  return exampleMessages
    .map((em) => `<START>\n{{user}}: ${em.user || ''}\n{{char}}: ${em.assistant || ''}`)
    .join('\n');
}

/**
 * CCv3 JSON -> 本项目角色对象。
 */
export function importCcv3(obj) {
  const data = obj?.data || obj;
  if (!data || typeof data !== 'object') {
    throw new Error('CCv3 数据无效：缺少 data 对象');
  }
  const exampleMessages = parseMesExample(data.mes_example);
  const extra = [];
  if (data.system_prompt) extra.push(`系统指示：${data.system_prompt}`);
  if (data.post_history_instructions) extra.push(`后续指示：${data.post_history_instructions}`);
  if (data.creator) extra.push(`作者：${data.creator}`);
  const character = {
    name: data.name || '未命名角色',
    version: String(data.character_version || '1.0'),
    tags: Array.isArray(data.tags) ? data.tags : [],
    description: data.description || '',
    persona: {
      identity: data.name || '',
      background: '',
      personality: data.personality || '',
      speakingStyle: '',
    },
    setting: {
      world: '',
      scenario: data.scenario || '',
    },
    rules: [],
    boundaries: [],
    greeting: data.first_mes || '',
    example_messages: exampleMessages,
    memory_seeds: [],
  };
  if (extra.length) {
    character.description = character.description
      ? `${character.description}\n\n${extra.join('\n')}`
      : extra.join('\n');
  }
  return normalizeCharacter(character);
}

/**
 * 本项目角色对象 -> CCv3 JSON。
 */
export function exportCcv3(character) {
  if (!character || !character.name) throw new Error('角色缺少 name');
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: character.name || '',
      description: character.description || '',
      personality: character.persona?.personality || '',
      scenario: character.setting?.scenario || '',
      first_mes: character.greeting || '',
      mes_example: buildMesExample(character.example_messages),
      system_prompt: character.systemPrompt || character.persona?.identity || '',
      post_history_instructions: '',
      creator: '',
      character_version: character.version || '1.0',
      tags: character.tags || [],
    },
  };
}
