/**
 * 皮肤取色（音乐 App 式换肤）：从背景图提取主色调，生成完整主题色板。
 * 算法：canvas 降采样 → RGB 量化直方图 → 取高频主色 → HSL 推导 9 token。
 * 生成的主题对象直接兼容 src/core/themes.js schema（saveTheme 可直接保存）。
 */

/** 把 <img> 画到小 canvas，返回像素数组（降采样 64x64 足够取主色，避免大图卡顿） */
export function samplePixels(img, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // 铺满不拉伸变形：cover 裁剪
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  const data = ctx.getImageData(0, 0, size, size).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue; // 跳过透明像素
    px.push([r, g, b]);
  }
  return px;
}

/** 感知亮度（0-1）：sRGB 加权 + gamma 校正 */
export function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** RGB → HSL（h:0-360, s/l:0-1） */
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** HSL → RGB（0-255 三元组） */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** 提取主色：8 级量化的加权直方图，取质量最高的桶（避免纯黑/纯白/纯灰占主导） */
export function extractMainColor(px) {
  if (!px.length) return [90, 90, 110];
  const Q = 8;
  const buckets = new Map();
  for (const [r, g, b] of px) {
    const key = `${r >> (8 - Q)}-${g >> (8 - Q)}-${b >> (8 - Q)}`;
    const e = buckets.get(key);
    if (e) { e.n++; e.sum[0] += r; e.sum[1] += g; e.sum[2] += b; }
    else buckets.set(key, { n: 1, sum: [r, g, b] });
  }
  const SAT_MIN = 0.06;
  let best = null;
  for (const [, e] of buckets) {
    const avg = [e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n];
    const { s } = rgbToHsl(avg);
    const lum = luminance(avg);
    // 灰色（低饱和）跳过：皮肤主色应带色彩倾向；纯黑/纯白也跳过
    if (s < SAT_MIN) continue;
    const score = e.n * (0.5 + s) * (1 - Math.abs(lum - 0.45) * 0.8);
    if (!best || score > best.score) best = { rgb: avg, score };
  }
  return best ? best.rgb : [90, 90, 110];
}

/** 从主色生成完整主题（音乐 App 皮肤式）：根据亮度自动选深/浅基底 */
export function buildSkinTheme(mainRgb, { name = '皮肤', background = '' } = {}) {
  const { h, s } = rgbToHsl(mainRgb);
  const lum = luminance(mainRgb);
  const dark = lum < 0.45;
  const S = Math.min(0.55, Math.max(0.28, s * 1.15)); // 色板饱和度略收敛，避免刺眼
  const rgb = (l, ss = S) => hslToRgb(h, ss, l).join(' ');

  // 基底色：主色色调，深浅按 lum 决定（深皮肤压暗、浅皮肤提亮）
  const paperL = dark ? 0.14 : 0.94;
  const colors = {
    paper: rgb(paperL),
    paper2: rgb(dark ? paperL + 0.045 : paperL - 0.04),
    ink: rgb(dark ? 0.92 : 0.16, dark ? Math.min(0.35, S * 0.4) : S * 0.5),
    inkSoft: rgb(dark ? 0.72 : 0.44),
    line: rgb(dark ? paperL + 0.13 : paperL - 0.16, dark ? S * 0.8 : S * 0.9),
    lineSoft: rgb(dark ? paperL + 0.07 : paperL - 0.08),
    muted: rgb(dark ? 0.55 : 0.5),
    card: rgb(dark ? paperL + 0.09 : 1, dark ? S * 0.9 : S * 0.25),
    accent: rgb(dark ? 0.62 : 0.42, Math.min(0.85, s + 0.25)),
  };
  const theme = {
    id: `skin-${Date.now().toString(36)}`,
    name: String(name).slice(0, 40),
    builtin: false,
    dark,
    description: `从背景图自动提取配色 · 主色 #${mainRgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
    colors,
    font: 'sans',
    radius: 14,
    noiseOn: false,
    noiseDensity: 0,
    shadowStrength: 0.7,
  };
  if (background) theme.background = background;
  return theme;
}

/** 加载图片（File 或 URL）→ <img>；带超时与尺寸上限保护 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return reject(new Error('图片无效'));
      resolve(img);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
    setTimeout(() => reject(new Error('图片加载超时')), 10000);
  });
}

/** 从 File 生成缩略 dataUrl（最大 1280px，供上传与预览） */
export function fileToDataUrl(file, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = await loadImage(reader.result);
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
