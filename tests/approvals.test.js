import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-approvals-data-'));
const approvals = await import('../src/core/approvals.js');
const DATA_DIR = process.env.MODEO_DATA_DIR;

test.after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('approvals: 创建后落盘且可查询', () => {
  const a = approvals.createApproval({
    sessionId: 's1',
    toolCall: { id: 't1', name: 'shell', args: { command: 'del /s C:\\temp' } },
    summary: 'shell 危险命令',
  });
  assert.equal(a.status, 'pending');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'approvals.json')));
  assert.equal(approvals.getApproval(a.id).id, a.id);
  assert.equal(approvals.getPending().length, 1);
});

test('approvals: 批准/拒绝后持久化状态', () => {
  const a = approvals.createApproval({ sessionId: 's1', toolCall: { id: 't2', name: 'x', args: {} }, summary: 'x' });
  approvals.approve(a.id);
  assert.equal(approvals.getApproval(a.id).status, 'approved');
  const b = approvals.createApproval({ sessionId: 's1', toolCall: { id: 't3', name: 'y', args: {} }, summary: 'y' });
  approvals.deny(b.id);
  assert.equal(approvals.getApproval(b.id).status, 'denied');
  assert.ok(!approvals.getPending().some((x) => x.id === a.id));
  assert.ok(!approvals.getPending().some((x) => x.id === b.id));
});

test('approvals: 重启后（重新加载）仍可读取', async () => {
  const a = approvals.createApproval({ sessionId: 's1', toolCall: { id: 't4', name: 'z', args: {} }, summary: 'z' });
  approvals.approve(a.id);
  const reloaded = await import(`../src/core/approvals.js?reload=${Date.now()}`);
  const got = reloaded.getApproval(a.id);
  assert.equal(got.status, 'approved');
  assert.equal(got.summary, 'z');
});

test('approvals: 不存在的审批抛错', () => {
  assert.throws(() => approvals.getApproval('nope'), /不存在/);
  assert.throws(() => approvals.approve('nope'), /不存在/);
});
