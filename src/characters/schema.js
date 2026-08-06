/**
 * 角色 YAML 的 schema 定义与校验。
 */

export const CHARACTER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
    name: { type: 'string' },
    version: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    persona: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        background: { type: 'string' },
        personality: { type: 'string' },
        speakingStyle: { type: 'string' },
      },
    },
    setting: {
      type: 'object',
      properties: {
        world: { type: 'string' },
        scenario: { type: 'string' },
      },
    },
    rules: { type: 'array', items: { type: 'string' } },
    boundaries: { type: 'array', items: { type: 'string' } },
    example_messages: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          assistant: { type: 'string' },
        },
        required: ['user', 'assistant'],
      },
    },
    greeting: { type: 'string' },
    memory_seeds: { type: 'array', items: { type: 'string' } },
    systemPrompt: { type: 'string' },
  },
  required: ['name'],
};

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isStr(v) {
  return typeof v === 'string';
}

function isStrArray(v) {
  return Array.isArray(v) && v.every(isStr);
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验角色对象。
 * @returns {{ ok: boolean, errors: Array<{field:string,message:string}> }}
 */
export function validateCharacter(obj) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: [{ field: '$', message: '角色必须是对象' }] };

  if (obj.id !== undefined && obj.id !== null && !ID_PATTERN.test(String(obj.id))) {
    errors.push({ field: 'id', message: 'id 只允许小写字母、数字、下划线和连字符，且以字母或数字开头（最长 64 字符）' });
  }
  if (!isStr(obj.name) || !obj.name.trim()) {
    errors.push({ field: 'name', message: 'name 必填且不能为空' });
  }
  if (obj.version !== undefined && obj.version !== null && !isStr(obj.version)) {
    errors.push({ field: 'version', message: 'version 必须是字符串' });
  }
  if (obj.tags !== undefined && !isStrArray(obj.tags)) {
    errors.push({ field: 'tags', message: 'tags 必须是字符串数组' });
  }
  if (obj.description !== undefined && !isStr(obj.description)) {
    errors.push({ field: 'description', message: 'description 必须是字符串' });
  }
  if (obj.persona !== undefined) {
    if (!isObj(obj.persona)) {
      errors.push({ field: 'persona', message: 'persona 必须是对象' });
    } else {
      for (const k of ['identity', 'background', 'personality', 'speakingStyle']) {
        if (obj.persona[k] !== undefined && !isStr(obj.persona[k])) {
          errors.push({ field: `persona.${k}`, message: `persona.${k} 必须是字符串` });
        }
      }
    }
  }
  if (obj.setting !== undefined) {
    if (!isObj(obj.setting)) {
      errors.push({ field: 'setting', message: 'setting 必须是对象' });
    } else {
      for (const k of ['world', 'scenario']) {
        if (obj.setting[k] !== undefined && !isStr(obj.setting[k])) {
          errors.push({ field: `setting.${k}`, message: `setting.${k} 必须是字符串` });
        }
      }
    }
  }
  if (obj.rules !== undefined && !isStrArray(obj.rules)) {
    errors.push({ field: 'rules', message: 'rules 必须是字符串数组' });
  }
  if (obj.boundaries !== undefined && !isStrArray(obj.boundaries)) {
    errors.push({ field: 'boundaries', message: 'boundaries 必须是字符串数组' });
  }
  if (obj.memory_seeds !== undefined && !isStrArray(obj.memory_seeds)) {
    errors.push({ field: 'memory_seeds', message: 'memory_seeds 必须是字符串数组' });
  }
  if (obj.example_messages !== undefined) {
    if (!Array.isArray(obj.example_messages) || obj.example_messages.length > 10) {
      errors.push({ field: 'example_messages', message: 'example_messages 必须是数组，且最多 10 条' });
    } else {
      obj.example_messages.forEach((em, i) => {
        if (!isObj(em) || !isStr(em.user) || !isStr(em.assistant)) {
          errors.push({ field: `example_messages[${i}]`, message: '每条示例消息必须包含 user 和 assistant 字符串' });
        }
      });
    }
  }
  if (obj.greeting !== undefined && !isStr(obj.greeting)) {
    errors.push({ field: 'greeting', message: 'greeting 必须是字符串' });
  }
  return { ok: errors.length === 0, errors };
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(6, '0').slice(0, 6);
}

/**
 * 补齐缺省字段（id、version、空数组等），不改变合法字段。
 */
export function normalizeCharacter(obj) {
  const out = { ...obj };
  if (!out.id) {
    const name = String(out.name || '').trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    out.id = /^[a-z0-9]/.test(slug) ? slug.slice(0, 64) : `char-${simpleHash(name || 'character')}`;
  }
  out.version = out.version || '1.0';
  out.tags = out.tags || [];
  out.rules = out.rules || [];
  out.boundaries = out.boundaries || [];
  out.memory_seeds = out.memory_seeds || [];
  out.example_messages = out.example_messages || [];
  out.persona = { identity: '', background: '', personality: '', speakingStyle: '', ...(out.persona || {}) };
  out.setting = { world: '', scenario: '', ...(out.setting || {}) };
  return out;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}
