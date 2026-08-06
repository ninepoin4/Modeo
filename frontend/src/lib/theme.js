/**
 * 主题应用：把主题对象（src/core/themes.js schema）映射为根级 CSS 变量。
 */

const FONT_UI = {
  serif: 'SimSun, "NSimSun", "Songti SC", "Source Han Serif SC", "Noto Serif SC", STSong, Georgia, serif',
  sans: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
};

/** 根据主题生成需要写入根元素的 CSS 变量 */
export function themeVars(t) {
  const c = t.colors || {};
  const vars = {
    '--paper': c.paper || '248 246 242',
    '--paper2': c.paper2 || '239 237 232',
    '--ink': c.ink || '20 20 20',
    '--ink-soft': c.inkSoft || '60 58 54',
    '--line': c.line || '216 212 204',
    '--line-soft': c.lineSoft || '230 226 218',
    '--muted': c.muted || '138 133 123',
    '--card': c.card || '255 255 255',
    '--accent': c.accent || (t.dark ? '238 236 232' : '20 20 20'),
    '--radius': `${clamp(t.radius, 4, 24, 16)}px`,
    '--shadow-strength': String(clamp(t.shadowStrength, 0, 1, 1)),
    '--font-ui': FONT_UI[t.font] || FONT_UI.serif,
  };
  // 噪点：开关 + 密度（px 网格）
  const density = clamp(t.noiseDensity, 0, 60, 22);
  if (t.noiseOn && density > 0) {
    const base = t.dark ? '255, 255, 255' : '20, 20, 20';
    vars['--noise'] = `rgba(${base}, ${(density / 220).toFixed(3)})`;
    vars['--noise-bg'] = `${density}px`;
  } else {
    vars['--noise'] = 'transparent';
    vars['--noise-bg'] = '0px';
  }
  return vars;
}

/** 应用主题到 document.documentElement */
export function applyTheme(t) {
  if (!t) return;
  const vars = themeVars(t);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty('background-image', vars['--noise'] === 'transparent' ? 'none' : '');
  document.body.style.backgroundSize = vars['--noise-bg'];
  root.dataset.theme = t.id || '';
  root.classList.toggle('dark', Boolean(t.dark));
}

/** 阴影强度换算（tailwind shadow-paper / shadow-lift 基于此变量） */
export function shadowFor(theme) {
  const s = clamp(theme.shadowStrength, 0, 1, 1);
  const a1 = (0.04 * s).toFixed(3);
  const a2 = (0.06 * s).toFixed(3);
  const a3 = (0.10 * s).toFixed(3);
  return `0 1px 2px rgba(20,20,20,${a1}), 0 8px 24px rgba(20,20,20,${a2})`;
}

function clamp(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

/** 主题预览：给定主题生成一组色板样本（供编辑器/选择器渲染） */
export function swatches(t) {
  const c = t.colors || {};
  return [
    ['纸面', c.paper],
    ['浮层', c.paper2],
    ['文字', c.ink],
    ['弱文字', c.inkSoft],
    ['边框', c.line],
    ['灰字', c.muted],
    ['卡片', c.card],
    ['强调', c.accent],
  ].map(([name, rgb]) => ({ name, rgb: rgb || '0 0 0' }));
}
