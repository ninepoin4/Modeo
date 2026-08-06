import test from 'node:test';
import assert from 'node:assert/strict';
import { compressSession, buildTranscript } from '../src/runtime/compress.js';
import { MockProvider } from '../src/core/provider.js';

function mk(role, content, extra = {}) {
  return { role, content, id: `${role}-${Math.random().toString(36).slice(2)}`, ...extra };
}

function sampleSession() {
  return {
    id: 'test-session',
    messages: [
      mk('user', '你好'),
      mk('assistant', '你好，有什么可以帮你？'),
      mk('user', '写一个文件'),
      mk('assistant', '', { toolCalls: [{ id: 't1', name: 'write_file', args: {} }] }),
      mk('tool', '已写入 demo.txt', { name: 'write_file', toolCallId: 't1' }),
      mk('user', '继续'),
      mk('assistant', '好的'),
      mk('user', '结束'),
      mk('notice', '已设置会话目标'),
    ],
  };
}

test('compress: 消息太少时抛错', async () => {
  const session = { id: 'x', messages: [mk('user', 'a'), mk('assistant', 'b')] };
  await assert.rejects(() => compressSession({ session, provider: new MockProvider() }), /消息太少/);
});

test('compress: 摘要替换历史并保留最近消息', async () => {
  const session = sampleSession();
  const result = await compressSession({ session, provider: new MockProvider() });
  assert.equal(result.removedCount, 4);
  assert.equal(result.recentCount, 3);
  assert.match(result.summary, /【历史摘要】/);
  assert.equal(session.lastSummary, result.summary);
  assert.equal(session.messages[0].role, 'notice');
  assert.equal(session.messages[1].role, 'assistant');
  assert.match(session.messages[1].content, /历史摘要/);
  assert.ok(session.messages.slice(2).every((m) => m.role === 'user' || m.role === 'assistant'));
  assert.ok(!session.messages.some((m) => m.role === 'tool'));
});

test('compress: buildTranscript 过滤 notice 并格式化消息', () => {
  const t = buildTranscript([
    { role: 'notice', content: '系统提示' },
    { role: 'user', content: '你好' },
    { role: 'tool', content: '输出内容', name: 'shell' },
    { role: 'assistant', content: '' },
  ]);
  assert.ok(!t.includes('系统提示'));
  assert.ok(t.includes('[用户] 你好'));
  assert.ok(t.includes('[工具 shell]'));
});

test('compress: 模型未返回摘要时抛错', async () => {
  const session = sampleSession();
  const emptyProvider = {
    complete: async () => ({ content: '   ' }),
  };
  await assert.rejects(() => compressSession({ session, provider: emptyProvider }), /未返回摘要/);
});
