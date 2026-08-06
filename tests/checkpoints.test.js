import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-ckpt-data-'));
process.env.MODEO_WORKSPACES_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-ckpt-wsroot-'));
const ck = await import('../src/tools/checkpoints.js');

const DATA_DIR = process.env.MODEO_DATA_DIR;
const WS_ROOT = path.join(process.env.MODEO_WORKSPACES_ROOT, 'default');
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test.before(() => {
  fs.mkdirSync(path.join(WS_ROOT, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(WS_ROOT, 'a.txt'), 'v1');
  fs.writeFileSync(path.join(WS_ROOT, 'sub', 'b.txt'), 'b1');
});

test.after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.MODEO_WORKSPACES_ROOT, { recursive: true, force: true });
});

test('checkpoint: 创建快照、修改后恢复', () => {
  const snap = ck.createCheckpoint({ sessionId: SID, workspaceRoot: WS_ROOT, label: '测试快照' });
  assert.ok(snap.id);
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'checkpoints', SID, snap.id)));
  // 修改工作区
  fs.writeFileSync(path.join(WS_ROOT, 'a.txt'), 'v2');
  fs.writeFileSync(path.join(WS_ROOT, 'new.txt'), 'new');
  const restored = ck.restoreCheckpoint({ sessionId: SID, checkpointId: snap.id, workspaceRoot: WS_ROOT });
  assert.ok(restored.restoredFiles >= 2);
  assert.equal(fs.readFileSync(path.join(WS_ROOT, 'a.txt'), 'utf8'), 'v1');
  assert.ok(!fs.existsSync(path.join(WS_ROOT, 'new.txt')));
});

test('checkpoint: 列表按时间倒序且含标签', () => {
  ck.createCheckpoint({ sessionId: SID, workspaceRoot: WS_ROOT, label: '快照B' });
  ck.writeCheckpointMeta(SID, ck.listCheckpoints(SID)[0].id, { label: '快照B', createdAt: new Date().toISOString() });
  const list = ck.listCheckpoints(SID);
  assert.ok(list.length >= 2);
  assert.ok(list.some((c) => c.label === '快照B'));
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].id >= list[i].id);
});

test('checkpoint: 非法会话/快照 id 拒绝', () => {
  assert.throws(() => ck.listCheckpoints('../../evil'), /非法/);
  assert.throws(() => ck.restoreCheckpoint({ sessionId: SID, checkpointId: '../x', workspaceRoot: WS_ROOT }), /非法/);
});

test('checkpoint: 工作区路径越界拒绝恢复', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-outside-ws-'));
  assert.throws(
    () => ck.restoreCheckpoint({ sessionId: SID, checkpointId: 'x', workspaceRoot: outside }),
    /非法/
  );
  fs.rmSync(outside, { recursive: true, force: true });
});
