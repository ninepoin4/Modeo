import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPlugins } from '../src/tools/pluginLoader.js';

test('pluginLoader: 加载有效插件并执行', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-plugins-'));
  fs.writeFileSync(
    path.join(dir, 'ping.js'),
    'export default { name: "ping", description: "p", parameters: { type: "object", properties: {} }, async execute() { return { output: "pong", isError: false }; } };'
  );
  try {
    const { tools, loaded } = await loadPlugins(dir);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'ping');
    const r = await tools[0].execute({});
    assert.equal(r.output, 'pong');
    assert.equal(loaded.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pluginLoader: 无效插件被记录错误不抛异常', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-plugins-bad-'));
  fs.writeFileSync(path.join(dir, 'noexec.js'), 'export default { name: "x" };');
  fs.writeFileSync(path.join(dir, 'broken.js'), 'export default {');
  try {
    const { tools, loaded } = await loadPlugins(dir);
    assert.equal(tools.length, 0);
    assert.ok(loaded.length >= 2, '应记录两个插件的错误');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
