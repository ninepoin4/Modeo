/**
 * 角色文件管理：characters/<id>.yaml。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, stringifyYaml } from '../core/yaml.js';
import { validateCharacter, normalizeCharacter, isValidId } from './schema.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CHARACTER_DIR = path.join(ROOT, 'characters');

export class CharacterError extends Error {}

fs.mkdirSync(CHARACTER_DIR, { recursive: true });

function charFile(id) {
  if (!isValidId(id)) throw new CharacterError('角色 id 非法，拒绝访问');
  return path.join(CHARACTER_DIR, `${id}.yaml`);
}

export function listCharacters() {
  const out = [];
  if (!fs.existsSync(CHARACTER_DIR)) return out;
  for (const f of fs.readdirSync(CHARACTER_DIR)) {
    if (!f.endsWith('.yaml')) continue;
    const id = f.slice(0, -5);
    try {
      const c = loadCharacter(id);
      out.push({
        id: c.id,
        name: c.name,
        version: c.version,
        tags: c.tags || [],
        description: c.description || '',
      });
    } catch {
      // 跳过损坏文件
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadCharacter(id) {
  const file = charFile(id);
  if (!fs.existsSync(file)) throw new CharacterError(`角色不存在: ${id}`);
  const text = fs.readFileSync(file, 'utf8');
  let obj;
  try {
    obj = parseYaml(text);
  } catch (err) {
    throw new CharacterError(`角色 YAML 解析失败: ${err.message}`);
  }
  const { ok, errors } = validateCharacter(obj);
  if (!ok) {
    throw new CharacterError(`角色校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}`);
  }
  return normalizeCharacter({ ...obj, id });
}

export function saveCharacter(yamlText) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) throw new CharacterError('角色内容为空');
  let obj;
  try {
    obj = parseYaml(yamlText);
  } catch (err) {
    throw new CharacterError(`角色 YAML 解析失败: ${err.message}`);
  }
  const { ok, errors } = validateCharacter(obj);
  if (!ok) {
    throw new CharacterError(`角色校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}`);
  }
  const normalized = normalizeCharacter(obj);
  const file = charFile(normalized.id);
  fs.writeFileSync(file, stringifyYaml(normalized), 'utf8');
  return loadCharacter(normalized.id);
}

export function updateCharacter(id, yamlText) {
  if (!fs.existsSync(charFile(id))) throw new CharacterError(`角色不存在: ${id}`);
  let obj;
  try {
    obj = parseYaml(yamlText);
  } catch (err) {
    throw new CharacterError(`角色 YAML 解析失败: ${err.message}`);
  }
  obj.id = id;
  const { ok, errors } = validateCharacter(obj);
  if (!ok) {
    throw new CharacterError(`角色校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}`);
  }
  const normalized = normalizeCharacter(obj);
  fs.writeFileSync(charFile(id), stringifyYaml(normalized), 'utf8');
  return loadCharacter(id);
}

export function deleteCharacter(id) {
  const file = charFile(id);
  if (!fs.existsSync(file)) throw new CharacterError(`角色不存在: ${id}`);
  fs.unlinkSync(file);
}
