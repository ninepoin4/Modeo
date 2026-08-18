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

test('registry: createCodeTools 提供工具与描述（2026-08-18 含检索类）', () => {
  const reg = createCodeTools(root);
  assert.deepEqual(reg.list().sort(), [
    'edit_file',
    'glob',
    'grep',
    'list_dir',
    'read_file',
    'review_changes',
    'run_tests',
    'shell',
    'web_fetch',
    'write_file',
  ]);
  const desc = reg.descriptions();
  assert.ok(desc.every((d) => d.name && d.description));
});

// 2026-08-18 检索类工具
test('search: glob 匹配工作区文件（* ? **）', async () => {
  const { createSearchTools } = await import('../src/tools/searchTools.js');
  const t = createSearchTools(root);
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.js'), 'x');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'x');
  fs.writeFileSync(path.join(root, 'src', 'deep', 'util.js'), 'x');
  const g1 = await t.glob.execute({ pattern: '**/*.js' });
  const names = g1.output.split('\n').map((s) => s.split('/').pop()).sort();
  assert.deepEqual(names, ['app.js', 'index.js', 'util.js']);
  const g2 = await t.glob.execute({ pattern: 'src/*.js' });
  assert.ok(g2.output.includes('app.js') && !g2.output.includes('deep'), '单层 * 不跨目录');
  const g3 = await t.glob.execute({ pattern: '**/*.js', path: '..' });
  assert.equal(g3.isError, true, '沙箱越界应拒绝');
});

test('search: grep 内容搜索（正则/大小写/跳过构建产物）', async () => {
  const { createSearchTools } = await import('../src/tools/searchTools.js');
  const t = createSearchTools(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), '// TODO: fix me\nconst x = 1;\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'skip.js'), '// TODO: should be skipped\n');
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'const App = () => <div>hi</div>;\n');
  const r1 = await t.grep.execute({ pattern: 'TODO' });
  assert.ok(r1.output.includes('app.js'), '应命中 src/app.js');
  assert.ok(!r1.output.includes('node_modules'), '应跳过 node_modules');
  const r2 = await t.grep.execute({ pattern: 'TODO', path: 'src' });
  assert.ok(r2.output.includes('app.js'));
  const r3 = await t.grep.execute({ pattern: '[' });
  assert.equal(r3.isError, true, '非法正则应报错');
  const r4 = await t.grep.execute({ pattern: 'APP', caseSensitive: true });
  assert.ok(!r4.output.includes('app.js'), '大小写敏感不应命中小写 app');
});

test('search: web_fetch 协议白名单与失败处理', async () => {
  const { createSearchTools } = await import('../src/tools/searchTools.js');
  const t = createSearchTools(root);
  const w1 = await t.web_fetch.execute({ url: 'file:///etc/passwd' });
  assert.equal(w1.isError, true, 'file:// 应拒绝');
  const w2 = await t.web_fetch.execute({ url: 'javascript:alert(1)' });
  assert.equal(w2.isError, true, 'javascript: 应拒绝');
  const w3 = await t.web_fetch.execute({ url: 'http://127.0.0.1:1/nope' });
  assert.equal(w3.isError, true, '连不上的地址应报错');
});
