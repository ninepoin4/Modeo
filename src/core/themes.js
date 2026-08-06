/**
 * 主题存储：内置主题（BUILTIN）+ 用户自定义主题（MODEO_DATA_DIR/themes/*.json）。
 * 主题即配置：一份 JSON 描述全部外观 token，前端把 token 映射为 CSS 变量。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
const THEMES_DIR = path.join(DATA_DIR, 'themes');

fs.mkdirSync(THEMES_DIR, { recursive: true });

/** 主题 token 全量键（颜色类） */
const COLOR_KEYS = ['paper', 'paper2', 'ink', 'inkSoft', 'line', 'lineSoft', 'muted', 'card', 'accent'];
const NUM_KEYS = ['radius', 'noiseDensity', 'shadowStrength'];

/** 内置主题：paper / midnight 即现有默认配色，其余为自拟风格 */
const BUILTIN_THEMES = [
  {
    id: 'paper',
    name: '纸张',
    builtin: true,
    dark: false,
    description: '默认浅色 · 米白纸感',
    colors: {
      paper: '248 246 242',
      paper2: '239 237 232',
      ink: '20 20 20',
      inkSoft: '60 58 54',
      line: '216 212 204',
      lineSoft: '230 226 218',
      muted: '138 133 123',
      card: '255 255 255',
      accent: '20 20 20',
    },
    font: 'serif',
    radius: 16,
    noiseOn: true,
    noiseDensity: 22,
    shadowStrength: 1,
  },
  {
    id: 'midnight',
    name: '午夜',
    builtin: true,
    dark: true,
    description: '默认深色 · 墨黑',
    colors: {
      paper: '20 20 20',
      paper2: '30 30 30',
      ink: '238 236 232',
      inkSoft: '205 203 196',
      line: '56 56 56',
      lineSoft: '44 44 44',
      muted: '152 149 142',
      card: '38 38 38',
      accent: '238 236 232',
    },
    font: 'serif',
    radius: 16,
    noiseOn: true,
    noiseDensity: 22,
    shadowStrength: 1,
  },
  {
    id: 'terminal',
    name: '终端绿',
    builtin: true,
    dark: true,
    description: '黑底荧光绿 · 等宽',
    colors: {
      paper: '10 14 10',
      paper2: '18 24 18',
      ink: '178 255 178',
      inkSoft: '130 190 130',
      line: '44 74 44',
      lineSoft: '32 52 32',
      muted: '96 140 96',
      card: '14 20 14',
      accent: '102 255 102',
    },
    font: 'mono',
    radius: 10,
    noiseOn: false,
    noiseDensity: 0,
    shadowStrength: 0.4,
  },
  {
    id: 'parchment',
    name: '羊皮纸',
    builtin: true,
    dark: false,
    description: '暖黄纸感 · 深棕',
    colors: {
      paper: '244 236 220',
      paper2: '236 226 206',
      ink: '66 48 32',
      inkSoft: '110 88 66',
      line: '212 196 168',
      lineSoft: '226 214 192',
      muted: '150 130 105',
      card: '252 248 240',
      accent: '140 90 40',
    },
    font: 'serif',
    radius: 12,
    noiseOn: true,
    noiseDensity: 26,
    shadowStrength: 0.7,
  },
  {
    id: 'arcade',
    name: '复古街机',
    builtin: true,
    dark: true,
    description: '深蓝黑 · 霓虹黄橙',
    colors: {
      paper: '14 16 28',
      paper2: '22 26 42',
      ink: '240 236 220',
      inkSoft: '180 190 205',
      line: '52 62 92',
      lineSoft: '40 48 72',
      muted: '140 150 172',
      card: '26 30 48',
      accent: '255 200 60',
    },
    font: 'mono',
    radius: 8,
    noiseOn: true,
    noiseDensity: 18,
    shadowStrength: 0.8,
  },
  {
    id: 'mono',
    name: '极简灰',
    builtin: true,
    dark: false,
    description: '无噪点 · 扁平灰',
    colors: {
      paper: '244 244 244',
      paper2: '236 236 236',
      ink: '30 30 30',
      inkSoft: '90 90 90',
      line: '214 214 214',
      lineSoft: '226 226 226',
      muted: '150 150 150',
      card: '255 255 255',
      accent: '30 30 30',
    },
    font: 'sans',
    radius: 10,
    noiseOn: false,
    noiseDensity: 0,
    shadowStrength: 0.3,
  },
];

function safeId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

function themeFile(id) {
  return path.join(THEMES_DIR, `${id}.json`);
}

/** 校验并规范化主题对象；返回 { ok, error, theme } */
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '主题必须是对象' };
  const id = safeId(raw.id);
  if (!id) return { ok: false, error: '主题缺少合法 id' };
  const colors = {};
  for (const k of COLOR_KEYS) {
    const v = String(raw.colors?.[k] || '').trim();
    if (k === 'accent') {
      colors[k] = v || '20 20 20';
      continue;
    }
    if (!v || !/^\d{1,3} \d{1,3} \d{1,3}$/.test(v)) return { ok: false, error: `颜色 ${k} 必须是 "R G B" 格式` };
    colors[k] = v;
  }
  const theme = {
    id,
    name: String(raw.name || id).slice(0, 40),
    builtin: false,
    dark: Boolean(raw.dark),
    description: String(raw.description || '').slice(0, 120),
    colors,
    font: ['serif', 'sans', 'mono'].includes(raw.font) ? raw.font : 'serif',
    radius: clampInt(raw.radius, 4, 24, 16),
    noiseOn: raw.noiseOn !== false,
    noiseDensity: clampInt(raw.noiseDensity, 0, 60, 22),
    shadowStrength: clampNum(raw.shadowStrength, 0, 1, 1),
  };
  return { ok: true, theme };
}

function clampInt(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}
function clampNum(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

/** 内置主题 + 用户主题合并列表 */
export function listThemes() {
  const user = [];
  if (fs.existsSync(THEMES_DIR)) {
    for (const f of fs.readdirSync(THEMES_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, f), 'utf8'));
        if (t && t.id) user.push({ ...t, builtin: false });
      } catch {
        // 跳过损坏文件
      }
    }
  }
  return [...BUILTIN_THEMES, ...user];
}

export function getTheme(id) {
  if (!id) return null;
  const builtin = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtin) return builtin;
  const file = themeFile(id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 保存用户主题（内置 id 禁止覆盖，返回冲突提示） */
export function saveTheme(raw) {
  const { ok, error, theme } = normalizeTheme(raw);
  if (!ok) throw new Error(error);
  if (BUILTIN_THEMES.some((t) => t.id === theme.id)) {
    throw new Error(`内置主题 ${theme.id} 不可覆盖，请换一个 id`);
  }
  fs.mkdirSync(THEMES_DIR, { recursive: true });
  fs.writeFileSync(themeFile(theme.id), JSON.stringify(theme, null, 2), 'utf8');
  return theme;
}

/** 删除用户主题；内置主题不可删除 */
export function deleteTheme(id) {
  if (BUILTIN_THEMES.some((t) => t.id === id)) throw new Error('内置主题不可删除');
  const file = themeFile(id);
  if (!fs.existsSync(file)) throw new Error(`主题不存在: ${id}`);
  fs.unlinkSync(file);
  return { deleted: id };
}

export { BUILTIN_THEMES, COLOR_KEYS };
