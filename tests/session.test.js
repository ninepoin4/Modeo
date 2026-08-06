import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../src/core/session.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SESSIONS_DIR = path.join(ROOT, 'data', 'sessions');

test.beforeEach(() => {
  store.resetSessions();
});

test.after(() => {
  store.resetSessions();
});

test('session: 创建/列表/持久化往返', () => {
  const s = store.createSession({ modeId: 'chat' });
  assert.ok(s.id);
  assert.equal(s.modeId, 'chat');
  assert.ok(fs.existsSync(path.join(SESSIONS_DIR, `${s.id}.json`)));
  const list = store.listSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, s.id);
  const loaded = store.getSession(s.id);
  assert.equal(loaded.modeId, 'chat');
});

test('session: 带角色创建', () => {
  const s = store.createSession({ modeId: 'roleplay', characterId: 'wanxia' });
  assert.equal(s.characterId, 'wanxia');
});

test('session: switchMode 更新模式、追加提示、记录日志', () => {
  const s = store.createSession({ modeId: 'chat' });
  const updated = store.switchMode(s, 'code', 'Code');
  assert.equal(updated.modeId, 'code');
  assert.equal(updated.modeLog.length, 1);
  assert.equal(updated.modeLog[0].from, 'chat');
  assert.equal(updated.modeLog[0].to, 'code');
  const last = updated.messages[updated.messages.length - 1];
  assert.equal(last.role, 'notice');
  assert.match(last.content, /Code/);
  const reloaded = store.getSession(s.id);
  assert.equal(reloaded.modeId, 'code');
  assert.equal(reloaded.modeLog.length, 1);
});

test('session: 非法 id 拒绝访问', () => {
  assert.throws(() => store.getSession('../../evil'), /非法/);
});

test('session: resetSessions 清空', () => {
  store.createSession({ modeId: 'chat' });
  store.resetSessions();
  assert.equal(store.listSessions().length, 0);
});

test('session: 导出/导入往返', () => {
  const s = store.createSession({ modeId: 'roleplay', characterId: 'wanxia' });
  s.messages.push({ role: 'user', content: '你好', id: 'u1' });
  store.switchMode(s, 'code', 'Code');
  const exported = store.exportSession(s.id);
  assert.equal(exported.modeId, 'code');
  assert.equal(exported.messages.length, 2); // 用户消息 + 切换提示
  const imported = store.importSession(exported);
  assert.notEqual(imported.id, s.id);
  assert.equal(imported.modeId, 'code');
  assert.equal(imported.messages.length, exported.messages.length);
  assert.equal(imported.characterId, 'wanxia');
  const reloaded = store.getSession(imported.id);
  assert.equal(reloaded.title, imported.title);
});

test('session: 多角色阵容随导出/导入保留', () => {
  const s = store.createSession({ modeId: 'roleplay', characterId: 'wanxia' });
  s.characters = ['wanxia', 'example'];
  store.saveSession(s);
  const exported = store.exportSession(s.id);
  assert.deepEqual(exported.characters, ['wanxia', 'example']);
  const imported = store.importSession(exported);
  assert.deepEqual(imported.characters, ['wanxia', 'example']);
});

test('session: 导入非法数据抛错', () => {
  assert.throws(() => store.importSession({}), /messages/);
  assert.throws(() => store.importSession(null), /messages/);
});

test('session: 新会话包含 goal 与 lastSummary 字段', () => {
  const s = store.createSession({ modeId: 'chat' });
  assert.equal(s.goal, null);
  assert.equal(s.lastSummary, null);
});

test('session: setGoal 设置/清除目标并追加 notice 消息', () => {
  const s = store.createSession({ modeId: 'chat' });
  store.setGoal(s, '  修复登录问题  ');
  assert.equal(s.goal, '修复登录问题');
  const notice = s.messages[s.messages.length - 1];
  assert.equal(notice.role, 'notice');
  assert.match(notice.content, /修复登录问题/);
  const reloaded = store.getSession(s.id);
  assert.equal(reloaded.goal, '修复登录问题');

  store.setGoal(s, '');
  assert.equal(s.goal, null);
  assert.match(s.messages[s.messages.length - 1].content, /已清除/);
});

test('session: clearMessages 清空历史但保留目标与快照语义', () => {
  const s = store.createSession({ modeId: 'code' });
  s.messages.push({ role: 'user', content: '写点代码', id: 'u1' });
  store.setGoal(s, '完成任务');
  store.clearMessages(s);
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].role, 'notice');
  assert.equal(s.goal, '完成任务');
});

test('session: 导入/导出保留 goal 与 lastSummary', () => {
  const s = store.createSession({ modeId: 'chat' });
  store.setGoal(s, '迁移数据库');
  s.lastSummary = '【历史摘要】已完成迁移方案设计。';
  store.saveSession(s);
  const exported = store.exportSession(s.id);
  assert.equal(exported.goal, '迁移数据库');
  assert.match(exported.lastSummary, /历史摘要/);
  const imported = store.importSession(exported);
  assert.equal(imported.goal, '迁移数据库');
  assert.match(imported.lastSummary, /历史摘要/);
});
