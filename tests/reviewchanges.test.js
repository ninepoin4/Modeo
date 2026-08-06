import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-review-data-'));
const ck = await import('../src/tools/checkpoints.js');
const { createReviewChangesTool } = await import('../src/tools/reviewChangesTool.js');

const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let ws;
test.before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-review-ws-'));
});
test.after(() => {
  fs.rmSync(process.env.MODEO_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

test('review_changes: 相对快照列出新增/修改/删除与 diff', async () => {
  fs.writeFileSync(path.join(ws, 'a.txt'), '第一行\n第二行');
  fs.writeFileSync(path.join(ws, 'b.txt'), '旧内容');
  ck.createCheckpoint({ sessionId: SID, workspaceRoot: ws, label: '基线' });

  fs.writeFileSync(path.join(ws, 'a.txt'), '第一行\n修改行');
  fs.writeFileSync(path.join(ws, 'c.txt'), '新文件');
  fs.unlinkSync(path.join(ws, 'b.txt'));

  const tool = createReviewChangesTool();
  const r = await tool.execute({}, { session: { id: SID }, workspaceRoot: ws });
  assert.equal(r.isError, false);
  assert.match(r.output, /新增 1/);
  assert.match(r.output, /修改 1/);
  assert.match(r.output, /删除 1/);
  assert.match(r.output, /c\.txt/);
  assert.match(r.output, /a\.txt/);
  assert.match(r.output, /b\.txt/);
  assert.match(r.output, /\+修改行/);
  assert.match(r.output, /-第二行/);
});

test('review_changes: 无快照时全部视为新增', async () => {
  const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-review-ws2-'));
  try {
    fs.writeFileSync(path.join(ws2, 'x.txt'), 'hello');
    const tool = createReviewChangesTool();
    const r = await tool.execute({}, { session: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, workspaceRoot: ws2 });
    assert.match(r.output, /新增 1/);
    assert.match(r.output, /x\.txt/);
  } finally {
    fs.rmSync(ws2, { recursive: true, force: true });
  }
});

test('review_changes: 缺少会话上下文报错', async () => {
  const tool = createReviewChangesTool();
  const r = await tool.execute({}, { workspaceRoot: ws });
  assert.equal(r.isError, true);
  assert.match(r.output, /会话/);
});
