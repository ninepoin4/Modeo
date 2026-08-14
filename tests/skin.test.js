// 皮肤取色算法单测（lib/skin.js 纯函数部分，Node 可直接运行）
import test from 'node:test';
import assert from 'node:assert/strict';
import { luminance, rgbToHsl, hslToRgb, extractMainColor, buildSkinTheme } from '../frontend/src/lib/skin.js';

test('skin: luminance 感知亮度', () => {
  assert.ok(luminance([255, 255, 255]) > 0.99);
  assert.ok(luminance([0, 0, 0]) < 0.01);
  // 绿色比蓝色亮（感知加权）
  assert.ok(luminance([0, 255, 0]) > luminance([0, 0, 255]));
});

test('skin: rgbToHsl / hslToRgb 往返', () => {
  for (const rgb of [[30, 80, 200], [235, 210, 180], [10, 10, 10], [255, 255, 255]]) {
    const { h, s, l } = rgbToHsl(rgb);
    const back = hslToRgb(h, s, l);
    assert.ok(Math.abs(back[0] - rgb[0]) <= 1 && Math.abs(back[1] - rgb[1]) <= 1 && Math.abs(back[2] - rgb[2]) <= 1, `${rgb} → ${back}`);
  }
});

test('skin: extractMainColor 取高频彩色，跳过纯白', () => {
  const px = [];
  for (let i = 0; i < 80; i++) px.push([30, 80, 200]); // 蓝色主导
  for (let i = 0; i < 20; i++) px.push([255, 255, 255]); // 白色次要
  const main = extractMainColor(px);
  assert.deepEqual(main, [30, 80, 200]);
  // 纯灰无彩色时返回兜底色
  const gray = extractMainColor([[128, 128, 128], [128, 128, 128]]);
  assert.ok(gray.length === 3);
});

test('skin: buildSkinTheme 深色主色 → dark 主题 + 合法 token + background', () => {
  const t = buildSkinTheme([30, 80, 200], { name: '测试', background: '/themes/skins/ab12cd34.png' });
  assert.equal(t.dark, true);
  assert.equal(t.background, '/themes/skins/ab12cd34.png');
  assert.match(t.id, /^skin-/);
  assert.equal(t.builtin, false);
  const re = /^\d{1,3} \d{1,3} \d{1,3}$/;
  for (const k of Object.keys(t.colors)) assert.match(t.colors[k], re, `token ${k} 非法`);
  // 深色：paper 暗、ink 亮
  assert.ok(luminance(t.colors.paper.split(' ').map(Number)) < 0.3);
  assert.ok(luminance(t.colors.ink.split(' ').map(Number)) > 0.6);
});

test('skin: buildSkinTheme 浅色主色 → light 主题', () => {
  const t = buildSkinTheme([235, 210, 180], { name: '暖' });
  assert.equal(t.dark, false);
  assert.ok(!t.background);
  assert.ok(luminance(t.colors.paper.split(' ').map(Number)) > 0.8);
  assert.ok(luminance(t.colors.ink.split(' ').map(Number)) < 0.3);
});
