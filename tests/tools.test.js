import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCodeTools } from '../src/tools/registry.js';
import { createFileTools } from '../src/tools/fileTools.js';
import { createShellTool, isDangerous } from '../src/tools/shellTool.js';

let root;
test.before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-tools-'));
});
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('fileTools: write/read/list/edit 往返', async () => {
  const ft = createFileTools(root);
  const w = await ft.write_file.execute({ path: 'a/b.txt', content: 'hello world' });
  assert.equal(w.isError, false);
  const r = await ft.read_file.execute({ path: 'a/b.txt' });
  assert.equal(r.output, 'hello world');
  const l = await ft.list_dir.execute({ path: '.' });
  assert.match(l.output, /a/);
  const e = await ft.edit_file.execute({ path: 'a/b.txt', oldString: 'hello', newString: 'goodbye' });
  assert.equal(e.isError, false);
  const r2 = await ft.read_file.execute({ path: 'a/b.txt' });
  assert.equal(r2.output, 'goodbye world');
});

test('fileTools: edit_file 0 次/多次匹配报错', async () => {
  const ft = createFileTools(root);
  await ft.write_file.execute({ path: 'edit.txt', content: 'x y x' });
  const miss = await ft.edit_file.execute({ path: 'edit.txt', oldString: 'zzz', newString: 'q' });
  assert.equal(miss.isError, true);
  const multi = await ft.edit_file.execute({ path: 'edit.txt', oldString: 'x', newString: 'q' });
  assert.equal(multi.isError, true);
});

test('fileTools: 越界写入被拒绝', async () => {
  const ft = createFileTools(root);
  const r = await ft.write_file.execute({ path: '../evil.txt', content: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.output, /SandboxError/);
});

test('shell: echo 成功', async () => {
  const st = createShellTool(root);
  const r = await st.execute({ command: 'echo hello' });
  assert.equal(r.isError, false);
  assert.match(r.output, /hello/);
  assert.equal(r.needsApproval, false);
});

test('shell: 危险命令需审批', async () => {
  const st = createShellTool(root);
  const r1 = await st.execute({ command: 'del /s /q C:\\temp' });
  assert.equal(r1.needsApproval, true);
  assert.match(r1.output, /等待审批/);
  const r2 = await st.execute({ command: 'rm -rf /' });
  assert.equal(r2.needsApproval, true);
  assert.equal(isDangerous('echo safe'), false);
  // 审批通过（forceApproved）后真正执行
  const r3 = await st.execute({ command: 'rm -rf C:\\modeo-nonexistent-dir-xyz' }, { forceApproved: true });
  assert.notEqual(r3.needsApproval, true);
  assert.ok(r3.output.length > 0);
});

// 2026-08-18 外部审查修复：递归列目录 + 删除类命令的管道组合（各段单独看都不危险）
test('shell: 递归列表 + 删除的管道组合需审批（绕过样本回归）', async () => {
  const st = createShellTool(root);
  const bypassSamples = [
    'Get-ChildItem -Recurse -Filter *.tmp | Remove-Item',
    'Get-ChildItem -Recurse | Remove-Item',
    'dir /s /b | Remove-Item',
    'find . | xargs rm',
    'ls -R | rm -f {}',
    'Get-ChildItem -Recurse; Remove-Item',
  ];
  for (const cmd of bypassSamples) {
    assert.equal(isDangerous(cmd), true, `应拦截：${cmd}`);
    const r = await st.execute({ command: cmd });
    assert.equal(r.needsApproval, true, `执行应请求审批：${cmd}`);
  }
  // 不误伤：递归列出但无删除段 / 删除但无递归列出
  assert.equal(isDangerous('Get-ChildItem -Recurse | Select-Object Name'), false);
  assert.equal(isDangerous('dir /s /b | findstr .tmp'), false);
  assert.equal(isDangerous('Remove-Item -Path C:/Windows/x.txt'), false);
});

test('shell: 超时返回 isError', async () => {
  const st = createShellTool(root);
  const cmd = process.platform === 'win32' ? 'ping -n 20 127.0.0.1 >nul' : 'sleep 20';
  const r = await st.execute({ command: cmd, timeoutMs: 500 });
  assert.equal(r.isError, true);
  assert.match(r.output, /超时/);
});

test('registry: createCodeTools 提供五个工具与描述', () => {
  const reg = createCodeTools(root);
  assert.deepEqual(reg.list().sort(), [
    'edit_file',
    'list_dir',
    'read_file',
    'review_changes',
    'run_tests',
    'shell',
    'write_file',
  ]);
  const desc = reg.descriptions();
  assert.ok(desc.every((d) => d.name && d.description));
});
