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

test('shell: 超时自动转后台（2026-08-18 长驻终端）', async () => {
  const st = createShellTool(root);
  const cmd = process.platform === 'win32' ? 'ping -n 20 127.0.0.1 >nul' : 'sleep 20';
  const r = await st.execute({ command: cmd, timeoutMs: 500 }, { session: { id: 'st-timeout' } });
  assert.equal(r.isError, false, '超时应转后台而非报错');
  assert.match(r.output, /已转后台任务/);
  assert.ok(r.backgroundId, '应返回后台 id');
  const { killJob } = await import('../src/tools/processManager.js');
  killJob(r.backgroundId);
});

test('registry: createCodeTools 提供工具与描述（2026-08-18 全能力）', () => {
  const reg = createCodeTools(root);
  assert.deepEqual(reg.list().sort(), [
    'browser_open',
    'browser_screenshot',
    'edit_file',
    'find_symbol',
    'git_checkout',
    'git_commit',
    'git_diff',
    'git_log',
    'git_status',
    'glob',
    'grep',
    'list_dir',
    'process_kill',
    'process_list',
    'process_read',
    'read_file',
    'read_image',
    'review_changes',
    'run_lint',
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


// 2026-08-18 Git 工具集（P0-① 差距分析第一批）
test('git: status/diff/log/commit/checkout 全链路', async () => {
  const { createGitTools } = await import('../src/tools/gitTools.js');
  const { execFile } = await import('node:child_process');
  const git = (args) => new Promise((r) => execFile('git', args, r));
  // 建临时 git 仓库
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-git-'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b1\n');
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'sub', 'c.txt'), 'c1\n');
  await git(['init', '-q', repo]);
  await git(['-C', repo, 'config', 'user.email', 't@t']);
  await git(['-C', repo, 'config', 'user.name', 't']);
  await git(['-C', repo, 'add', '-A']);
  await git(['-C', repo, 'commit', '-qm', 'init']);
  const g = createGitTools(repo);
  // status 干净
  let r = await g.git_status.execute({});
  assert.ok(r.output.includes('（无输出）') || !r.isError, '干净仓库 status 应无错误: ' + r.output);
  // 改文件 → status/diff
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v2\n');
  r = await g.git_status.execute({});
  assert.ok(r.output.includes('a.txt'), 'status 应显示 a.txt');
  r = await g.git_diff.execute({});
  assert.ok(r.output.includes('v2') || r.output.includes('+v2') || r.output.includes('v2'), 'diff 应包含新内容: ' + r.output);
  // 单文件 diff
  r = await g.git_diff.execute({ path: 'a.txt' });
  assert.ok(!r.isError && r.output.includes('v2'), '单文件 diff 应工作');
  // 越界路径拒绝
  r = await g.git_diff.execute({ path: '..\\outside.txt' });
  assert.ok(r.isError && /SandboxError/.test(r.output), '越界路径应拒绝: ' + r.output);
  // log
  r = await g.git_log.execute({ n: 5 });
  assert.ok(r.output.includes('init'), 'log 应显示 init 提交');
  // commit
  r = await g.git_commit.execute({ message: 'update a' });
  assert.ok(!r.isError && r.output.includes('update a'), 'commit 应成功: ' + r.output);
  r = await g.git_status.execute({});
  assert.ok(r.output.includes('（无输出）') || !r.isError, 'commit 后应干净');
  // 新文件 commit 指定 paths
  fs.writeFileSync(path.join(repo, 'sub', 'new.txt'), 'n\n');
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');
  r = await g.git_commit.execute({ message: 'add new', paths: ['sub/new.txt'] });
  assert.ok(!r.isError, 'paths commit 应成功: ' + r.output);
  r = await g.git_status.execute({});
  assert.ok(r.output.includes('untracked.txt'), '未指定 paths 的文件应保持未提交');
  // checkout 恢复
  fs.writeFileSync(path.join(repo, 'sub', 'new.txt'), 'broken\n');
  r = await g.git_checkout.execute({ path: 'sub/new.txt' });
  assert.ok(!r.isError, 'checkout 应成功: ' + r.output);
  assert.equal(fs.readFileSync(path.join(repo, 'sub', 'new.txt'), 'utf8').trim(), 'n', '文件应恢复');
  // checkout 不存在/未跟踪文件
  r = await g.git_checkout.execute({ path: 'untracked.txt' });
  assert.ok(r.isError, '未跟踪文件 checkout 应报错');
  // 非 git 仓库友好提示
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-nogit-'));
  const g2 = createGitTools(plain);
  r = await g2.git_status.execute({});
  assert.ok(r.output.includes('不是 git 仓库'), '非仓库应友好提示: ' + r.output);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
});


// 2026-08-18 长驻终端（P0-② 差距分析第一批）
test('process: 后台任务 start/read/list/kill/cleanup/上限', async () => {
  const pm = await import('../src/tools/processManager.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-proc-'));
  // 1. start + read（短命令，等待结束；cmd 原生 echo 避免引号语义差异）
  const job = pm.startJob('s1', 'echo hello-from-bg', tmp);
  await new Promise((r) => setTimeout(r, 600));
  const rd = pm.readJob(job.id);
  assert.ok(rd, '任务应存在');
  assert.ok(rd.output.includes('hello-from-bg'), 'read 应包含输出: ' + rd.output);
  assert.equal(rd.running, false, '短命令应已结束');
  // 2. list 按 session 过滤
  const lst = pm.listJobs('s1');
  assert.ok(lst.some((j) => j.id === job.id), 's1 列表应含任务');
  assert.equal(pm.listJobs('other-session').length, 0, '其他会话应为空');
  // 3. kill 运行中的任务（用长驻 node 进程）
  const long = pm.startJob('s1', 'node -e setInterval(()=>{},1000)', tmp);
  const k = pm.killJob(long.id);
  assert.equal(k.found, true, '任务应存在');
  assert.equal(k.killed, true, '运行中的任务应被终止');
  // 4. cleanupSession 终止会话全部任务
  const j2 = pm.startJob('s1', 'node -e setInterval(()=>{},1000)', tmp);
  pm.cleanupSession('s1');
  await new Promise((r) => setTimeout(r, 300));
  const r2 = pm.readJob(j2.id);
  assert.ok(r2 === null || !r2.running, 'cleanup 后任务应终止（记录被移除或进程已停）');
  // 5. 每会话上限 8
  for (let i = 0; i < 8; i++) pm.startJob('s2', 'node -e setInterval(()=>{},1000)', tmp);
  assert.throws(() => pm.startJob('s2', 'echo x', tmp), /上限/, '超过上限应抛错');
  pm.cleanupSession('s2');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('process: shell background=true 返回任务 id 且可读输出', async () => {
  const { createShellTool } = await import('../src/tools/shellTool.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-bg-'));
  const st = createShellTool(tmp);
  const r = await st.execute({ command: 'echo bg-ok', background: true }, { session: { id: 'sb' } });
  assert.ok(r.backgroundId, '应返回 backgroundId: ' + JSON.stringify(r));
  assert.ok(r.output.includes('[后台任务已启动]'), '输出应提示后台启动');
  await new Promise((res) => setTimeout(res, 600));
  const { readJob } = await import('../src/tools/processManager.js');
  const rd = readJob(r.backgroundId);
  assert.ok(rd && rd.output.includes('bg-ok'), '后台输出应可读: ' + (rd && rd.output));
  const { killJob } = await import('../src/tools/processManager.js');
  killJob(r.backgroundId);
  fs.rmSync(tmp, { recursive: true, force: true });
});


// 2026-08-18 MCP 协议（P2-⑦）——stdio mock server 端到端
test('mcp: stdio 服务器 listTools/callTool', async () => {
  const mockPath = path.join(os.tmpdir(), 'modeo-mcp-mock-' + Date.now() + '.cjs');
  fs.writeFileSync(
    mockPath,
    `const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'mock', version: '1' } } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echo text' }, { name: 'add', description: 'add two numbers' }] } }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const { name, arguments: a } = msg.params;
    let text = '';
    if (name === 'echo') text = a.text;
    else if (name === 'add') text = String(Number(a.a) + Number(a.b));
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } }) + '\\n');
  }
});`
  );
  const { getMcpClient } = await import('../src/tools/mcpClient.js');
  const c = await getMcpClient({ id: 'mock', command: process.execPath, args: [mockPath] });
  const tools = await c.listTools();
  assert.ok(tools.some((t) => t.name === 'echo' && t.name === 'add') || tools.length === 2, '应列出 2 个工具: ' + JSON.stringify(tools));
  const r1 = await c.callTool('echo', { text: 'hello-mcp' });
  assert.ok(r1.text.includes('hello-mcp'), 'echo 调用应返回: ' + r1.text);
  const r2 = await c.callTool('add', { a: 3, b: 4 });
  assert.equal(r2.text.trim(), '7', 'add 应返回 7');
  await c.close();
  fs.rmSync(mockPath, { force: true });
});

// 2026-08-18 图像多模态（P2-⑥）
test('image: read_image 读取 PNG 返回 data URL，非图片拒绝', async () => {
  const { createImageTools } = await import('../src/tools/imageTools.js');
  // 生成 1x1 红色 PNG
  const b64png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = path.join(root, 'pixel.png');
  fs.writeFileSync(img, Buffer.from(b64png, 'base64'));
  const it = createImageTools(root);
  const r = await it.read_image.execute({ path: 'pixel.png' });
  assert.ok(!r.isError, 'PNG 应可读: ' + r.output.slice(0, 80));
  assert.ok(r.image && r.image.startsWith('data:image/png;base64,'), '应返回 data URL');
  const r2 = await it.read_image.execute({ path: 'some.txt' });
  assert.ok(r2.isError, '非图片应拒绝');
  // 越界
  const r3 = await it.read_image.execute({ path: '..\\secret.png' });
  assert.ok(r3.isError && /SandboxError/.test(r3.output), '越界应拒绝');
});

// 2026-08-18 语义索引（P2-⑧）
test('symbol: find_symbol 定位函数/类定义', async () => {
  const { createSymbolTools } = await import('../src/tools/symbolTools.js');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'app.js'),
    `export function main() {
  console.log(1);
}
class User {
  constructor() {}
}
const helper = () => {};
`
  );
  const st = createSymbolTools(root);
  const r = await st.find_symbol.execute({ name: 'main' });
  assert.ok(r.output.includes('main'), '应找到 main: ' + r.output);
  assert.ok(r.output.includes(':1:') || r.output.includes(':1'), '应含行号');
  const r2 = await st.find_symbol.execute({ name: 'User' });
  assert.ok(r2.output.includes('User'), '应找到 User');
  const r3 = await st.find_symbol.execute({ name: '不存在xyz' });
  assert.ok(r3.output.includes('未找到'), '未找到应提示');
});

// 2026-08-18 浏览器工具（P2-⑤）URL 白名单
test('browser: assertLocalWebUrl 白名单', async () => {
  const { assertLocalWebUrl } = await import('../src/tools/browserTools.js');
  assert.equal(assertLocalWebUrl('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(assertLocalWebUrl('http://127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  assert.throws(() => assertLocalWebUrl('https://example.com'), /仅支持本地/);
  assert.throws(() => assertLocalWebUrl('http://192.168.1.1'), /仅支持本地/);
  assert.throws(() => assertLocalWebUrl('file:///etc/passwd'), /仅支持/);
  assert.throws(() => assertLocalWebUrl('javascript:alert(1)'), /仅支持/);
});

// 2026-08-18 长驻终端已覆盖；补 shell background 已在 process 测试。plan/run_lint 由 registry 覆盖。


// 2026-08-18 二审安全修复回归（SSRF / ReDoS / read_image 敏感门禁）
test('web_fetch: 拦截私网/回环/链路本地地址（SSRF）', async () => {
  const { createSearchTools } = await import('../src/tools/searchTools.js');
  const t = createSearchTools(root);
  const blocked = [
    'http://127.0.0.1:8080/x',
    'http://localhost:5173',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/a',
    'http://192.168.1.1/b',
    'http://172.16.0.5/c',
    'http://172.31.255.254/d',
  ];
  for (const u of blocked) {
    const r = await t.web_fetch.execute({ url: u });
    assert.ok(r.isError, '应拒绝 ' + u + ': ' + r.output);
  }
  // 公网放行到错误响应（域名合法但抓取失败——证明未被我方拦截逻辑拦掉）
  const r = await t.web_fetch.execute({ url: 'http://example.com' });
  assert.ok(r.isError && !/拒绝访问内网/.test(r.output), '公网地址不应被 SSRF 拦截');
});

test('grep: 拒绝过长正则与嵌套量词（ReDoS 缓解）', async () => {
  const { createSearchTools } = await import('../src/tools/searchTools.js');
  const t = createSearchTools(root);
  fs.writeFileSync(path.join(root, 'x.txt'), 'hello\nworld');
  const r1 = await t.grep.execute({ pattern: 'a'.repeat(300) });
  assert.ok(r1.isError && /不安全|过长/.test(r1.output), '过长正则应拒绝: ' + r1.output);
  const r2 = await t.grep.execute({ pattern: '(a+)+b' });
  assert.ok(r2.isError && /嵌套量词/.test(r2.output), '嵌套量词应拒绝: ' + r2.output);
  const r3 = await t.grep.execute({ pattern: 'hello' });
  assert.ok(!r3.isError && r3.output.includes('hello'), '正常正则应工作');
});

test('read_image: 敏感路径需审批（对齐 fileTools）', async () => {
  const { createImageTools } = await import('../src/tools/imageTools.js');
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.mkdirSync(path.join(root, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ssh', 'key.png'), Buffer.from(b64, 'base64'));
  const t = createImageTools(root);
  const r = await t.read_image.execute({ path: '.ssh/key.png' }, { session: { id: 's' } });
  assert.ok(r.needsApproval === true, '敏感路径应 needsApproval: ' + JSON.stringify(r));
  const r2 = await t.read_image.execute({ path: '.ssh/key.png' }, { session: { id: 's' }, forceApproved: true });
  assert.ok(!r2.needsApproval && !r2.isError, 'forceApproved 应放行: ' + r2.output.slice(0, 60));
});
