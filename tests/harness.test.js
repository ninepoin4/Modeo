import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHarnessConfigs, getEffectiveSystemPrompt, renderCharacterPrompt } from '../src/core/harness.js';
import { loadUserHarnessConfigs } from '../src/core/harness.js';
import { validateHarnessShape } from '../src/core/types.js';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let harnesses;
test.before(() => {
  harnesses = loadHarnessConfigs(path.join(ROOT, 'configs', 'harness'));
});

test('harness: 加载三个模式', () => {
  const ids = harnesses.map((h) => h.id).sort();
  assert.deepEqual(ids, ['chat', 'code', 'roleplay']);
});

test('harness: chat 零注入', () => {
  const chat = harnesses.find((h) => h.id === 'chat');
  assert.equal(chat.systemPrompt, null);
  assert.equal(getEffectiveSystemPrompt(chat), null);
  assert.deepEqual(chat.tools, []);
});

test('harness: code 模式含工具与提示词', () => {
  const code = harnesses.find((h) => h.id === 'code');
  assert.ok(code.systemPrompt.length > 20);
  for (const t of ['list_dir', 'read_file', 'write_file', 'edit_file', 'shell']) {
    assert.ok(code.tools.includes(t), `缺少工具 ${t}`);
  }
  assert.equal(code.approval.mode, 'dangerous-only');
});

test('harness: roleplay 渲染包含角色名与字段', () => {
  const rp = harnesses.find((h) => h.id === 'roleplay');
  assert.equal(rp.ui.sidebarKind, 'characters');
  const character = {
    name: '晚霞',
    description: '客栈掌柜',
    persona: { identity: '掌柜', background: '', personality: '沉稳', speakingStyle: '江湖气' },
    setting: { world: '武侠世界', scenario: '黄昏' },
    rules: ['不主动使用现代词汇'],
    boundaries: [],
    greeting: '客官打尖还是住店？',
    example_messages: [{ user: '你好', assistant: '客官好。' }],
  };
  const prompt = getEffectiveSystemPrompt(rp, character);
  assert.match(prompt, /晚霞/);
  assert.match(prompt, /沉稳/);
  assert.match(prompt, /武侠世界/);
  assert.match(prompt, /客官打尖还是住店/);
  const plain = getEffectiveSystemPrompt(rp, null);
  assert.equal(plain, '');
});

test('harness: 渲染缺失字段不抛错', () => {
  const rp = harnesses.find((h) => h.id === 'roleplay');
  const prompt = renderCharacterPrompt(rp, { name: '只有名字' });
  assert.match(prompt, /只有名字/);
});

test('harness: chat 即使传角色也保持零注入', () => {
  const chat = harnesses.find((h) => h.id === 'chat');
  assert.equal(getEffectiveSystemPrompt(chat, { name: 'x' }), null);
});

test('harness: 用户模式目录加载（损坏文件跳过）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-harness-user-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.yaml'), 'id: my-mode\nname: 我的模式\nsystemPrompt: hi\ntools: []\ndefaultModel: mock\n');
    fs.writeFileSync(path.join(dir, 'bad.yaml'), 'id: 非法!!\nname: x\n');
    const modes = loadUserHarnessConfigs(dir);
    assert.equal(modes.length, 1);
    assert.equal(modes[0].id, 'my-mode');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 2026-08-18 外部审查修复：'none' 拒绝在 server 路由（POST /api/modes），validateHarnessShape
// 保持白名单语义（内置 chat.yaml 用 'none'）；本测试锁死该契约防回归。
test('types: validateHarnessShape 对 approval.mode none 保持白名单兼容（内置 chat 用）', () => {
  const base = { id: 'x-mode', name: 'X', tools: [], defaultModel: 'mock' };
  assert.deepEqual(validateHarnessShape(base), [], '基础配置应通过');
  assert.deepEqual(validateHarnessShape({ ...base, approval: { mode: 'none' } }), [], 'none 应通过白名单（拒绝在 server 路由层）');
  assert.deepEqual(validateHarnessShape({ ...base, approval: { mode: 'dangerous-only' } }), [], 'dangerous-only 应通过');
  assert.deepEqual(validateHarnessShape({ ...base, approval: { mode: 'all' } }), [], 'all 应通过');
  const bad = validateHarnessShape({ ...base, approval: { mode: 'sneaky' } });
  assert.ok(bad.length > 0, '非法 mode 应拒绝');
});
