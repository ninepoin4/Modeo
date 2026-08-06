import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { diffLines, unifiedDiffText, diffWorkspace } from '../src/tools/diff.js';
import { ensureBaseline, getBaselineDir } from '../src/tools/checkpoints.js';

let ws;
let base;
test.before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-diff-ws-'));
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-diff-base-'));
});
test.after(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(base, { recursive: true, force: true });
});

test('diffLines: 相同内容全为 same', () => {
  const a = ['a', 'b', 'c'];
  const ops = diffLines(a, [...a]);
  assert.ok(ops.every((o) => o.type === 'same'));
  assert.equal(ops.length, 3);
});

test('diffLines: 纯新增/纯删除', () => {
  const add = diffLines([], ['x', 'y']);
  assert.deepEqual(add, [
    { type: 'add', text: 'x' },
    { type: 'add', text: 'y' },
  ]);
  const del = diffLines(['x', 'y'], []);
  assert.deepEqual(del, [
    { type: 'del', text: 'x' },
    { type: 'del', text: 'y' },
  ]);
});

test('diffLines: 中间修改', () => {
  const a = ['1', '2', '3', '4'];
  const b = ['1', 'X', '3', '4'];
  const ops = diffLines(a, b);
  assert.deepEqual(
    ops.map((o) => `${o.type}:${o.text}`),
    ['same:1', 'del:2', 'add:X', 'same:3', 'same:4']
  );
});

test('diffLines: 大差异回退为整体替换且结果正确', () => {
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
  const ops = diffLines(a, b);
  assert.equal(ops.filter((o) => o.type === 'del').length, 3000);
  assert.equal(ops.filter((o) => o.type === 'add').length, 3000);
});

test('unifiedDiffText: 头与逐行前缀', () => {
  const text = unifiedDiffText('f.txt', ['a', 'b'], ['a', 'c']);
  const lines = text.split('\n');
  assert.equal(lines[0], '--- a/f.txt');
  assert.equal(lines[1], '+++ b/f.txt');
  assert.ok(lines.includes(' a'));
  assert.ok(lines.includes('-b'));
  assert.ok(lines.includes('+c'));
});

test('diffWorkspace: 新增/修改/删除统计与文本', () => {
  fs.mkdirSync(path.join(base, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(base, 'keep.txt'), 'same\n', 'utf8');
  fs.writeFileSync(path.join(base, 'mod.txt'), 'old line\n', 'utf8');
  fs.writeFileSync(path.join(base, 'gone.txt'), 'bye\n', 'utf8');
  fs.writeFileSync(path.join(base, 'sub', 'nested.txt'), 'n\n', 'utf8');

  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'keep.txt'), 'same\n', 'utf8');
  fs.writeFileSync(path.join(ws, 'mod.txt'), 'new line\n', 'utf8');
  fs.writeFileSync(path.join(ws, 'new.txt'), 'hello\n', 'utf8');
  fs.writeFileSync(path.join(ws, 'sub', 'nested.txt'), 'n\n', 'utf8');

  const r = diffWorkspace(base, ws);
  assert.equal(r.summary.added, 1);
  assert.equal(r.summary.removed, 1);
  assert.equal(r.summary.modified, 1);
  // 'hello\n' / 'bye\n' 各拆为 2 行（含末尾空行），mod.txt 为 +1/-1
  assert.equal(r.summary.linesAdded, 3);
  assert.equal(r.summary.linesRemoved, 3);
  const statuses = Object.fromEntries(r.files.map((f) => [f.path, f.status]));
  assert.equal(statuses['new.txt'], 'added');
  assert.equal(statuses['gone.txt'], 'removed');
  assert.equal(statuses['mod.txt'], 'modified');
  assert.equal(statuses['keep.txt'], undefined);
  assert.match(r.text, /--- a\/mod\.txt/);
  assert.match(r.text, /\+new line/);
});

test('diffWorkspace: 排除 node_modules 与 .git', () => {
  fs.mkdirSync(path.join(base, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(base, 'node_modules', 'big.js'), 'x\n', 'utf8');
  fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'node_modules', 'big.js'), 'y\n', 'utf8');
  const r = diffWorkspace(base, ws);
  assert.ok(!r.files.some((f) => f.path.startsWith('node_modules')));
});

test('ensureBaseline: 创建一次、幂等、可被 diffWorkspace 使用', () => {
  const sessionId = '0a0b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d';
  fs.mkdirSync(path.join(ws, 'proj'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'proj', 'a.txt'), '1\n', 'utf8');
  const first = ensureBaseline(sessionId, path.join(ws, 'proj'));
  assert.equal(first.created, true);
  assert.equal(first.fileCount, 1);
  const second = ensureBaseline(sessionId, path.join(ws, 'proj'));
  assert.equal(second.created, false);
  assert.ok(getBaselineDir(sessionId));
  // 基线应代表创建时的内容
  fs.writeFileSync(path.join(ws, 'proj', 'b.txt'), '2\n', 'utf8');
  const r = diffWorkspace(getBaselineDir(sessionId), path.join(ws, 'proj'));
  assert.equal(r.summary.added, 1);
  fs.rmSync(getBaselineDir(sessionId), { recursive: true, force: true });
});
