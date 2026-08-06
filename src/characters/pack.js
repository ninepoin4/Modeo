/**
 * 角色包（可分享的打包格式）：打包、解析、本地包目录管理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyYaml } from '../core/yaml.js';
import { validateCharacter, normalizeCharacter } from './schema.js';
import * as manager from './manager.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PACKS_DIR = path.join(ROOT, 'characters', 'packs');

export const PACK_FORMAT = 'modeo-character-pack';
export const PACK_FORMAT_VERSION = 1;
export const MARKET_INDEX_FORMAT = 'modeo-market-index';

export class PackError extends Error {}

function packFile(id) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(String(id))) throw new PackError('包 id 非法（仅允许字母数字下划线连字符）');
  return path.join(PACKS_DIR, `${id}.modeopack.json`);
}

/**
 * 打包角色列表为可分享的角色包对象。
 */
export function buildPack(characters, { name = '角色包', author = '' } = {}) {
  if (!Array.isArray(characters) || !characters.length) throw new PackError('角色包至少需要一个角色');
  const items = [];
  for (const c of characters) {
    const { ok, errors } = validateCharacter(c);
    if (!ok) {
      throw new PackError(`角色 ${c?.name || c?.id || '?'} 校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}`);
    }
    items.push(normalizeCharacter(c));
  }
  return {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    name,
    author,
    createdAt: new Date().toISOString(),
    characters: items,
  };
}

/**
 * 解析并校验角色包，返回角色对象数组。
 */
export function parsePack(obj) {
  if (!obj || typeof obj !== 'object') throw new PackError('角色包必须是对象');
  if (obj.format !== PACK_FORMAT) throw new PackError(`不支持的包格式: ${obj.format}`);
  if (!Array.isArray(obj.characters) || !obj.characters.length) throw new PackError('角色包缺少 characters 数组');
  return obj.characters.map((c, i) => {
    const { ok, errors } = validateCharacter(c);
    if (!ok) {
      throw new PackError(`角色包第 ${i + 1} 个角色校验失败: ${errors.map((e) => `${e.field}: ${e.message}`).join('；')}`);
    }
    return normalizeCharacter(c);
  });
}

/**
 * 安装角色包到本地角色目录。
 * @returns {{imported:string[], skipped:string[]}}
 */
export function installPack(obj, { overwrite = false } = {}) {
  const characters = parsePack(obj);
  const imported = [];
  const skipped = [];
  for (const c of characters) {
    try {
      manager.loadCharacter(c.id);
      if (!overwrite) {
        skipped.push(c.id);
        continue;
      }
      manager.updateCharacter(c.id, stringifyYaml(c));
    } catch (err) {
      if (err instanceof manager.CharacterError && /不存在/.test(err.message)) {
        manager.saveCharacter(stringifyYaml(c));
      } else if (!(err instanceof manager.CharacterError)) {
        throw err;
      } else {
        skipped.push(c.id);
        continue;
      }
    }
    imported.push(c.id);
  }
  return { imported, skipped };
}

export function listPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(PACKS_DIR)) {
    if (!f.endsWith('.modeopack.json')) continue;
    const id = f.slice(0, -'.modeopack.json'.length);
    try {
      const pack = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8'));
      out.push({
        id,
        name: pack.name || id,
        author: pack.author || '',
        characterCount: Array.isArray(pack.characters) ? pack.characters.length : 0,
        createdAt: pack.createdAt || '',
      });
    } catch {
      // 跳过损坏包
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getPack(id) {
  const file = packFile(id);
  if (!fs.existsSync(file)) throw new PackError(`角色包不存在: ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function savePackFile(id, packObj) {
  const file = packFile(id);
  fs.mkdirSync(PACKS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packObj, null, 2), 'utf8');
  return { id, name: packObj.name || id, characterCount: packObj.characters?.length || 0 };
}

export function deletePack(id) {
  const file = packFile(id);
  if (!fs.existsSync(file)) throw new PackError(`角色包不存在: ${id}`);
  fs.unlinkSync(file);
}

async function downloadJson(url, { timeoutMs = 10000, maxBytes = 5 * 1024 * 1024 } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new PackError('仅支持 http/https 地址');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new PackError(`下载失败 HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new PackError('角色包过大');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new PackError('角色包过大');
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      throw new PackError('角色包 JSON 解析失败');
    }
  } catch (err) {
    if (err instanceof PackError) throw err;
    if (err && err.name === 'AbortError') throw new PackError('下载超时');
    throw new PackError(`下载失败: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 URL 下载并校验角色包（在线分享的第一步）。
 */
export async function fetchPackJson(url, opts) {
  const obj = await downloadJson(url, opts);
  parsePack(obj); // 提前校验
  return obj;
}

/**
 * 从 URL 下载并校验市场索引。
 * 索引格式：{ format:'modeo-market-index', version:1, packs:[{id,name,author,description,url}] }
 */
export async function fetchMarketIndex(url, { timeoutMs = 10000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const obj = await downloadJson(url, { timeoutMs, maxBytes });
  if (!obj || obj.format !== MARKET_INDEX_FORMAT || !Array.isArray(obj.packs)) {
    throw new PackError('市场索引格式无效');
  }
  const packs = [];
  for (const p of obj.packs) {
    if (!p || typeof p.id !== 'string' || typeof p.url !== 'string' || !/^https?:\/\//i.test(p.url)) {
      throw new PackError(`市场索引第 ${packs.length + 1} 项无效（需要 id 与 http/https url）`);
    }
    packs.push({
      id: p.id,
      name: p.name || p.id,
      author: p.author || '',
      description: p.description || '',
      url: p.url,
    });
  }
  return { format: MARKET_INDEX_FORMAT, version: obj.version || 1, packs };
}
