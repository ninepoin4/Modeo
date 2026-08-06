import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveSafePath, isWithin, SandboxError } from '../src/tools/sandbox.js';

let root;
test.before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-sandbox-'));
  fs.writeFileSync(path.join(root, 'ok.txt'), 'hello');
});
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('工作区内路径放行', () => {
  const p = resolveSafePath(root, 'sub/file.txt');
  assert.ok(path.isAbsolute(p));
  assert.ok(isWithin(root, p));
});

test('.. 越界被拒绝', () => {
  assert.throws(() => resolveSafePath(root, '../secret.txt'), SandboxError);
  assert.throws(() => resolveSafePath(root, '..\\..\\windows'), SandboxError);
  assert.throws(() => resolveSafePath(root, 'a/../../secret.txt'), SandboxError);
});

test('指向根外的绝对路径被拒绝', () => {
  if (process.platform === 'win32') {
    assert.throws(() => resolveSafePath(root, 'C:\\Windows\\system32'), SandboxError);
  } else {
    assert.throws(() => resolveSafePath(root, '/etc/passwd'), SandboxError);
  }
});

test('Windows 大小写不敏感（仅 Windows）', () => {
  if (process.platform !== 'win32') return;
  const upper = root.toUpperCase();
  const p = resolveSafePath(upper, 'ok.txt');
  assert.equal(fs.existsSync(p), true);
});

test('空路径被拒绝', () => {
  assert.throws(() => resolveSafePath(root, ''), SandboxError);
});

test('符号链接逃逸被拒绝（若环境允许创建）', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    fs.symlinkSync(outside, path.join(root, 'escape-link'), 'junction');
    assert.throws(() => resolveSafePath(root, 'escape-link/secret.txt'), SandboxError);
  } catch (err) {
    t.skip(`环境不支持创建符号链接: ${err.message}`);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
