import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectTestCommand, createRunTestsTool } from '../src/tools/runTestsTool.js';
import { createShellTool } from '../src/tools/shellTool.js';

let ws;
test.before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-runtests-'));
});
test.after(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

test('run_tests: 无测试入口返回 null 探测', () => {
  assert.equal(detectTestCommand(ws), null);
});

test('run_tests: tests/*.test.js 命中 node --test', () => {
  fs.mkdirSync(path.join(ws, 'tests'));
  fs.writeFileSync(
    path.join(ws, 'tests', 'pass.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1, 1));\n"
  );
  const d = detectTestCommand(ws);
  assert.ok(d);
  assert.equal(d.type, 'node');
  assert.match(d.label, /node --test/);
});

test('run_tests: 执行 node --test 并返回结果', async () => {
  const tool = createRunTestsTool(ws, createShellTool(ws));
  const r = await tool.execute({}, {});
  assert.equal(r.isError, false);
  assert.match(r.output, /测试命令/);
  assert.match(r.output, /pass|通过/i);
});

test('run_tests: 失败测试返回 isError', async () => {
  fs.writeFileSync(
    path.join(ws, 'tests', 'fail.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('bad', () => assert.equal(1, 2));\n"
  );
  const tool = createRunTestsTool(ws, createShellTool(ws));
  const r = await tool.execute({}, {});
  assert.equal(r.isError, true);
  assert.match(r.output, /测试命令/);
});
