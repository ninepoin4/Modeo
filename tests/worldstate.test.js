import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-ws-data-'));
const store = await import('../src/core/session.js');

import { createWorldStateTool } from '../src/tools/worldStateTool.js';
import { createAllTools } from '../src/tools/registry.js';
import { runAgentTurn, assembleSystemPrompt } from '../src/runtime/engine.js';
import { loadHarnessConfigs } from '../src/core/harness.js';
import { MockProvider } from '../src/core/provider.js';
import * as approvals from '../src/core/approvals.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnesses = loadHarnessConfigs(path.join(ROOT, 'configs', 'harness'));

let wsRoot;
test.before(() => {
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-ws-ws-'));
  store.resetSessions();
});
test.after(() => {
  fs.rmSync(wsRoot, { recursive: true, force: true });
  fs.rmSync(process.env.MODEO_DATA_DIR, { recursive: true, force: true });
});

test('worldstate: 创建会话时初始化空对象', () => {
  const s = store.createSession({ modeId: 'roleplay' });
  assert.ok(s.worldState && typeof s.worldState === 'object');
  assert.deepEqual(s.worldState, {});
});

test('worldstate: 单条与批量更新并持久化', async () => {
  const session = store.createSession({ modeId: 'roleplay', characterId: 'wanxia' });
  const tool = createWorldStateTool();
  const ctx = { session, persist: store.saveSession };
  const r1 = await tool.execute({ key: '主角所在城市', value: '长安' }, ctx);
  assert.equal(r1.isError, false);
  assert.match(r1.output, /长安/);
  const r2 = await tool.execute({ updates: { 当前时间: '黄昏', 线索: '玉佩' } }, ctx);
  assert.equal(r2.isError, false);
  const reloaded = store.getSession(session.id);
  assert.deepEqual(reloaded.worldState, { 主角所在城市: '长安', 当前时间: '黄昏', 线索: '玉佩' });
});

test('worldstate: 空值或非法输入报错且不写入', async () => {
  const session = store.createSession({ modeId: 'roleplay' });
  const tool = createWorldStateTool();
  const r1 = await tool.execute({ key: '', value: '' }, { session });
  assert.equal(r1.isError, true);
  const r2 = await tool.execute({ updates: { a: '' } }, { session });
  assert.equal(r2.isError, true);
  assert.deepEqual(session.worldState || {}, {});
});

test('worldstate: 注入系统提示词（roleplay），不影响 chat/code', () => {
  const rp = harnesses.find((h) => h.id === 'roleplay');
  const chat = harnesses.find((h) => h.id === 'chat');
  const code = harnesses.find((h) => h.id === 'code');
  const session = { worldState: { 时间: '黄昏', 地点: '长安' } };
  const p = assembleSystemPrompt(rp, { name: '晚霞' }, null, session);
  assert.match(p, /世界状态记忆/);
  assert.match(p, /黄昏/);
  assert.match(p, /长安/);
  // 2026-08-18：GenUI 提示词始终注入，prompt 不再可能为 null；改测"chat 模式不注入 worldState"
  const chatP = assembleSystemPrompt(chat, null, null, session);
  assert.notEqual(chatP, null, 'GenUI 提示词使 chat 模式 prompt 非空');
  assert.ok(!chatP.includes('世界状态记忆'), 'chat 模式不应注入 worldState');
  const codeP = assembleSystemPrompt(code, null, wsRoot, session);
  assert.ok(!codeP.includes('世界状态记忆'));
});

test('worldstate: mock 触发 update_world_state 并被引擎持久化', async () => {
  const session = store.createSession({ modeId: 'roleplay', characterId: 'wanxia' });
  session.messages.push({ role: 'user', content: '记住主角所在城市是长安', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'roleplay');
  const events = [];
  await runAgentTurn({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createAllTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    emit: (e) => events.push(e),
  });
  const toolCall = events.find((e) => e.type === 'tool_call');
  assert.ok(toolCall, '应有 tool_call 事件');
  assert.equal(toolCall.toolCall.name, 'update_world_state');
  const toolResult = events.find((e) => e.type === 'tool_result');
  assert.ok(toolResult && !toolResult.result.isError, '工具应执行成功');
  const reloaded = store.getSession(session.id);
  assert.equal(reloaded.worldState['主角所在城市'], '长安');
  assert.ok(events.some((e) => e.type === 'done'));
});

test('worldstate: roleplay harness 暴露 update_world_state 工具', () => {
  const rp = harnesses.find((h) => h.id === 'roleplay');
  assert.ok(rp.tools.includes('update_world_state'));
});
