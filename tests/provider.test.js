import test from 'node:test';
import assert from 'node:assert/strict';

import { MockProvider, OpenAIProvider, createProvider } from '../src/core/provider.js';

test('provider: createProvider 默认返回 mock', () => {
  const p = createProvider({});
  assert.ok(p instanceof MockProvider);
});

test('provider: createProvider openai 需要 apiKey', () => {
  assert.ok(createProvider({ provider: 'openai' }) instanceof MockProvider);
  assert.ok(createProvider({ provider: 'openai', apiKey: 'sk-x' }) instanceof OpenAIProvider);
});

test('mock: complete 回显用户消息带模式前缀', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: '你好' }], { modeId: 'chat' });
  assert.equal(r.content, '【mock-chat】你好');
  assert.equal(r.toolCalls, undefined);
});

test('mock: list files 触发 list_dir 工具调用', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: '请 list files' }], { modeId: 'code' });
  assert.equal(r.content, '');
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].name, 'list_dir');
  assert.deepEqual(r.toolCalls[0].args, { path: '.' });
});

test('mock: write file 触发 write_file 工具调用', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: 'write file please' }], { modeId: 'code' });
  assert.equal(r.toolCalls[0].name, 'write_file');
  assert.equal(r.toolCalls[0].args.path, 'demo.txt');
});

test('mock: run tests 触发 run_tests 工具调用', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: 'run tests please' }], { modeId: 'code' });
  assert.equal(r.toolCalls[0].name, 'run_tests');
  assert.deepEqual(r.toolCalls[0].args, {});
});

test('mock: review changes 触发 review_changes 工具调用', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: 'review changes' }], { modeId: 'code' });
  assert.equal(r.toolCalls[0].name, 'review_changes');
  assert.deepEqual(r.toolCalls[0].args, {});
});

test('mock: ping 触发插件工具调用', () => {
  const m = new MockProvider();
  const r = m.complete([{ role: 'user', content: 'ping' }], { modeId: 'custom' });
  assert.equal(r.toolCalls[0].name, 'ping');
  assert.equal(r.toolCalls[0].args.echo, 'hi');
});

test('mock: stream 产出 text_delta', async () => {
  const m = new MockProvider();
  const chunks = [];
  for await (const c of m.stream([{ role: 'user', content: '测试流式' }], { modeId: 'code' })) {
    chunks.push(c);
  }
  const text = chunks.filter((c) => c.type === 'text_delta').map((c) => c.delta).join('');
  assert.equal(text, '【mock-code】测试流式');
});

test('mock: stream 产出 tool_calls', async () => {
  const m = new MockProvider();
  const chunks = [];
  for await (const c of m.stream([{ role: 'user', content: 'list files please' }], { modeId: 'code' })) {
    chunks.push(c);
  }
  const tc = chunks.find((c) => c.type === 'tool_calls');
  assert.ok(tc);
  assert.equal(tc.toolCalls[0].name, 'list_dir');
});
