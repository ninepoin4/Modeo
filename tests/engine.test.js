import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentTurn, assembleSystemPrompt } from '../src/runtime/engine.js';
import { loadHarnessConfigs } from '../src/core/harness.js';
import { MockProvider } from '../src/core/provider.js';
import * as approvals from '../src/core/approvals.js';
import { createCodeTools } from '../src/tools/registry.js';
import * as ck from '../src/tools/checkpoints.js';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-engine-data-'));
const store = await import('../src/core/session.js');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnesses = loadHarnessConfigs(path.join(ROOT, 'configs', 'harness'));

let wsRoot;
test.before(() => {
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-engine-'));
  store.resetSessions();
});
test.after(() => {
  fs.rmSync(wsRoot, { recursive: true, force: true });
  store.resetSessions();
});

function makeSession(modeId, characterId = null) {
  return store.createSession({ modeId, characterId });
}

async function collectEvents(opts) {
  const events = [];
  await runAgentTurn({ ...opts, emit: (e) => events.push(e) });
  return events;
}

test('engine: chat 模式 mock 对话返回最终回答并持久化', async () => {
  const session = makeSession('chat');
  session.messages.push({ role: 'user', content: '你好', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'chat');
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  const text = events.filter((e) => e.type === 'text_delta').map((e) => e.delta).join('');
  assert.match(text, /【mock-chat】你好/);
  assert.ok(events.some((e) => e.type === 'done'));
  const reloaded = store.getSession(session.id);
  assert.ok(reloaded.messages.some((m) => m.role === 'assistant' && m.content.includes('【mock-chat】你好')));
});

test('engine: code 模式注入工作区 AGENTS.md 约定', () => {
  fs.writeFileSync(path.join(wsRoot, 'AGENTS.md'), '本仓库使用 TypeScript，禁止 any。');
  const code = harnesses.find((h) => h.id === 'code');
  const prompt = assembleSystemPrompt(code, null, wsRoot);
  assert.match(prompt, /AGENTS.md/);
  assert.match(prompt, /TypeScript/);
  assert.match(prompt, /不可信内容/, 'AGENTS.md 应标注为不可信内容（防提示词注入）');
  const chat = harnesses.find((h) => h.id === 'chat');
  // 2026-08-18：GenUI 提示词始终注入，prompt 不再可能为 null；改测"chat 模式不注入 AGENTS.md"
  const chatPrompt = assembleSystemPrompt(chat, null, wsRoot);
  assert.notEqual(chatPrompt, null, 'GenUI 提示词使 chat 模式 prompt 非空');
  assert.ok(!chatPrompt.includes('AGENTS.md'), 'chat 模式不应注入 AGENTS.md');
  fs.unlinkSync(path.join(wsRoot, 'AGENTS.md'));
});

test('engine: roleplay 多角色阵容渲染（标注当前发言角色）', () => {
  const rp = harnesses.find((h) => h.id === 'roleplay');
  const cast = [
    { id: 'wanxia', name: '晚霞', persona: { personality: '沉稳' } },
    { id: 'example', name: '小默', persona: { personality: '温和' } },
  ];
  const prompt = assembleSystemPrompt(rp, cast, wsRoot, { characterId: 'wanxia' });
  assert.match(prompt, /晚霞/);
  assert.match(prompt, /小默/);
  assert.match(prompt, /当前发言角色：晚霞/);
  assert.match(prompt, /其他在场角色：小默/);
});

test('engine: 写文件前自动创建快照', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'write file please', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  assert.ok(events.some((e) => e.type === 'checkpoint'), '应有 checkpoint 事件');
  assert.ok(fs.existsSync(path.join(wsRoot, 'demo.txt')), '工具应写入文件');
  const list = ck.listCheckpoints(session.id);
  assert.ok(list.length >= 1, '快照应已落盘');
});

test('engine: code 模式触发工具调用并回填结果', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: '请 list files', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  const toolCall = events.find((e) => e.type === 'tool_call');
  assert.ok(toolCall, '应有 tool_call 事件');
  assert.equal(toolCall.toolCall.name, 'list_dir');
  const toolResult = events.find((e) => e.type === 'tool_result');
  assert.ok(toolResult, '应有 tool_result 事件');
  assert.equal(toolResult.result.isError, false);
  const reloaded = store.getSession(session.id);
  assert.ok(reloaded.messages.some((m) => m.role === 'tool' && m.name === 'list_dir'));
});

test('engine: approval=all 时工具调用触发审批，批准后 resume 完成', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'list files', id: 'u1' });
  const base = harnesses.find((h) => h.id === 'code');
  const harness = { ...base, approval: { mode: 'all' } };
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  const approvalEvt = events.find((e) => e.type === 'approval_required');
  assert.ok(approvalEvt, '应有 approval_required 事件');
  assert.ok(session.pendingApproval, '会话应挂起待审批项');

  approvals.approve(session.pendingApproval.approvalId);
  const resumeEvents = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    resume: true,
  });
  assert.ok(resumeEvents.some((e) => e.type === 'tool_result'), 'resume 后应执行工具');
  assert.equal(session.pendingApproval, null);
});

test('engine: 拒绝审批后 resume 不执行工具', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'list files', id: 'u1' });
  const base = harnesses.find((h) => h.id === 'code');
  const harness = { ...base, approval: { mode: 'all' } };
  await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  approvals.deny(session.pendingApproval.approvalId);
  const resumeEvents = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    resume: true,
  });
  assert.ok(!resumeEvents.some((e) => e.type === 'tool_result'), '拒绝后不应执行工具');
  const reloaded = store.getSession(session.id);
  assert.ok(reloaded.messages.some((m) => m.role === 'tool' && /拒绝/.test(m.content)));
});

test('engine: 会话目标注入系统提示词（chat 模式同样生效且可见）', () => {
  const chat = harnesses.find((h) => h.id === 'chat');
  const p1 = assembleSystemPrompt(chat, null, wsRoot, { goal: '修复登录问题' });
  assert.match(p1, /【会话目标】/);
  assert.match(p1, /修复登录问题/);
  const code = harnesses.find((h) => h.id === 'code');
  const p2 = assembleSystemPrompt(code, null, wsRoot, { goal: '重构模块' });
  assert.match(p2, /重构模块/);
  // 2026-08-18：GenUI 提示词始终注入，prompt 不再可能为 null；改测"空 goal 时不注入【会话目标】"
  const chatNoGoal = assembleSystemPrompt(chat, null, wsRoot, { goal: '' });
  assert.notEqual(chatNoGoal, null, 'GenUI 提示词使 chat 模式 prompt 非空');
  assert.ok(!chatNoGoal.includes('【会话目标】'), '空 goal 时不应注入会话目标块');
});

test('engine: notice 消息不会发给模型', async () => {
  const session = makeSession('chat');
  session.messages.push(
    { role: 'notice', content: '已设置会话目标：修复登录', id: 'n1' },
    { role: 'user', content: '你好', id: 'u1' }
  );
  const harness = harnesses.find((h) => h.id === 'chat');
  const spyProvider = {
    async *stream(messages) {
      assert.ok(!messages.some((m) => m.role === 'notice'), 'notice 不应出现在发给模型的消息中');
      yield { type: 'text_delta', delta: 'ok' };
    },
  };
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: spyProvider,
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  assert.ok(events.some((e) => e.type === 'done'));
});

test('engine: 工具管道 pre 钩子改写参数、post 钩子改写结果、abort 拦截', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'write file please', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  // 清理先前测试残留（共用 wsRoot），避免断言误判
  for (const f of ['demo.txt', 'hook.txt']) fs.rmSync(path.join(wsRoot, f), { force: true });
  const seen = [];
  const pipeline = {
    pre: [
      async (_ctx, tc, args) => {
        seen.push(['pre', tc.name, JSON.stringify(args)]);
        // 把 write_file 的 path 改写为 hook.txt
        if (tc.name === 'write_file') return { args: { ...args, path: 'hook.txt' } };
        return null;
      },
    ],
    post: [
      async (_ctx, tc, result) => {
        seen.push(['post', tc.name, result.isError]);
        return { result: { ...result, output: `[audited]${result.output}` } };
      },
    ],
  };
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    toolPipeline: pipeline,
  });
  // pre 钩子改写生效：写的是 hook.txt 而非 demo.txt
  assert.ok(fs.existsSync(path.join(wsRoot, 'hook.txt')), 'pre 钩子改写的路径应被写入');
  assert.ok(!fs.existsSync(path.join(wsRoot, 'demo.txt')), '原路径不应被写入');
  // post 钩子改写生效：tool_result 输出带审计前缀
  const tr = events.find((e) => e.type === 'tool_result');
  assert.match(tr.result.output, /^\[audited\]/);
  // pre/post 均被调用
  assert.ok(seen.some((s) => s[0] === 'pre' && s[1] === 'write_file'));
  assert.ok(seen.some((s) => s[0] === 'post' && s[1] === 'write_file'));
  // 消息落盘也是改写后的输出
  const reloaded = store.getSession(session.id);
  assert.ok(reloaded.messages.some((m) => m.role === 'tool' && m.content.startsWith('[audited]')));
});

test('engine: 工具管道 pre 钩子 abort 拦截工具', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'write file please', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  fs.rmSync(path.join(wsRoot, 'demo.txt'), { force: true });
  const pipeline = {
    pre: [async () => ({ abort: true, reason: '策略拦截：禁止写文件' })],
    post: [],
  };
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    toolPipeline: pipeline,
  });
  assert.ok(!fs.existsSync(path.join(wsRoot, 'demo.txt')), '被拦截的工具不应执行');
  const tr = events.find((e) => e.type === 'tool_result');
  assert.match(tr.result.output, /策略拦截：禁止写文件/);
});

test('engine: modelOverride 覆盖 settings.model 传给 provider', async () => {
  const session = makeSession('chat');
  session.messages.push({ role: 'user', content: '你好', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'chat');
  let gotModel = null;
  const spyProvider = {
    async *stream(_messages, opts) {
      gotModel = opts.model;
      yield { type: 'text_delta', delta: 'ok' };
    },
  };
  await collectEvents({
    session,
    harness,
    character: null,
    provider: spyProvider,
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: { model: 'default-model' },
    modelOverride: 'override-model',
  });
  assert.equal(gotModel, 'override-model', 'modelOverride 应优先于 settings.model');
});

test('engine: 工具抛异常被隔离，补错误消息不锁死会话', async () => {
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'write file please', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  const boom = {
    name: 'boom_tool',
    execute: async () => {
      throw new Error('插件爆炸');
    },
  };
  // Mock provider 会为 "write file please" 返回 write_file 工具调用；让任意工具名都命中抛错工具
  const fakeRegistry = { get: () => boom };
  const events = await collectEvents({
    session,
    harness: { ...harness, tools: ['boom_tool'] },
    character: null,
    provider: new MockProvider(),
    toolRegistry: fakeRegistry,
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    toolPipeline: { pre: [], post: [] },
  });
  const tr = events.find((e) => e.type === 'tool_result');
  assert.ok(tr, '应有 tool_result 事件');
  assert.match(tr.result.output, /工具执行异常: 插件爆炸/);
  assert.ok(session.messages.some((m) => m.role === 'tool' && m.toolCallId === tr.toolCall.id), 'tool 消息配对完整');
});

test('engine: 超过 compactAfter 自动压缩历史', async () => {
  const session = makeSession('chat');
  for (let i = 0; i < 40; i++) {
    session.messages.push({ role: 'user', content: '第' + i + '条', id: 'u' + i });
    session.messages.push({ role: 'assistant', content: '回复' + i, id: 'a' + i });
  }
  session.messages.push({ role: 'user', content: '总结一下', id: 'u-final' });
  const harness = harnesses.find((h) => h.id === 'chat');
  const events = await collectEvents({
    session,
    harness: { ...harness, context: { ...harness.context, compactAfter: 40 } },
    character: null,
    provider: new MockProvider(),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
  });
  const msgs = store.getSession(session.id).messages;
  assert.ok(msgs.some((m) => m.role === 'assistant' && /【历史摘要】/.test(m.content)), '应生成摘要');
  assert.ok(msgs.some((m) => m.role === 'notice' && /已压缩/.test(m.content)), '应有压缩提示');
  const sig = msgs.filter((m) => m.role !== 'notice');
  assert.ok(sig.length <= 12, '压缩后消息应大幅减少，实际 ' + sig.length);
  assert.ok(events.some((e) => e.type === 'done'));
});
