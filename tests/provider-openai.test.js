import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { OpenAIProvider } from '../src/core/provider.js';

function startServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, () => resolve(s));
  });
}

function url(s) {
  return `http://127.0.0.1:${s.address().port}/v1`;
}

test('openai: complete 解析 content 与 tool_calls', async () => {
  const s = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, 'gpt-test');
      assert.equal(parsed.stream, undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '你好',
                tool_calls: [
                  { id: 't1', type: 'function', function: { name: 'shell', arguments: '{"command":"echo hi"}' } },
                ],
              },
            },
          ],
        })
      );
    });
  });
  try {
    const p = new OpenAIProvider({ baseUrl: url(s), apiKey: 'sk-test', model: 'gpt-test' });
    const r = await p.complete([{ role: 'user', content: 'hi' }], {});
    assert.equal(r.content, '你好');
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.toolCalls[0].name, 'shell');
    assert.deepEqual(r.toolCalls[0].args, { command: 'echo hi' });
  } finally {
    s.close();
  }
});

test('openai: stream 解析 SSE 增量与 tool_calls', async () => {
  const s = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
    res.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}}]}}]}\n\n'
    );
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const p = new OpenAIProvider({ baseUrl: url(s), apiKey: 'sk-test', model: 'gpt-test' });
    const chunks = [];
    for await (const c of p.stream([{ role: 'user', content: 'hi' }], {})) chunks.push(c);
    const text = chunks.filter((c) => c.type === 'text_delta').map((c) => c.delta).join('');
    assert.equal(text, '你好');
    const tc = chunks.find((c) => c.type === 'tool_calls');
    assert.ok(tc);
    assert.equal(tc.toolCalls[0].name, 'list_dir');
    assert.deepEqual(tc.toolCalls[0].args, { path: '.' });
  } finally {
    s.close();
  }
});

test('openai: 非 2xx 响应抛错', async () => {
  const s = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('unauthorized');
  });
  try {
    const p = new OpenAIProvider({ baseUrl: url(s), apiKey: 'bad', model: 'gpt-test' });
    await assert.rejects(() => p.complete([{ role: 'user', content: 'hi' }], {}), /401/);
  } finally {
    s.close();
  }
});
