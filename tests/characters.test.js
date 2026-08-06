import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCharacter, normalizeCharacter, isValidId } from '../src/characters/schema.js';
import * as manager from '../src/characters/manager.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHARACTER_DIR = path.join(ROOT, 'characters');

function readExample() {
  return fs.readFileSync(path.join(CHARACTER_DIR, 'example.yaml'), 'utf8');
}

test('schema: 合法对象通过校验', () => {
  const r = validateCharacter({
    name: '测试',
    id: 'test-char',
    persona: { personality: 'x' },
    example_messages: [{ user: 'a', assistant: 'b' }],
  });
  assert.equal(r.ok, true);
});

test('schema: 缺 name 报错', () => {
  const r = validateCharacter({ id: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name'));
});

test('schema: id 非法报错', () => {
  const r = validateCharacter({ name: 'x', id: '../../evil' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'id'));
});

test('schema: 类型错误报错', () => {
  const r = validateCharacter({ name: 'x', tags: 'not-array' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'tags'));
});

test('normalizeCharacter: 自动补 id/version/空数组', () => {
  const n = normalizeCharacter({ name: '测试角色' });
  assert.ok(isValidId(n.id));
  assert.equal(n.version, '1.0');
  assert.deepEqual(n.tags, []);
  assert.deepEqual(n.example_messages, []);
  assert.equal(n.persona.personality, '');
});

test('manager: 示例角色保存->列表->读取往返', () => {
  const c = manager.saveCharacter(readExample());
  assert.equal(c.id, 'example');
  assert.equal(c.name, '小默');
  const list = manager.listCharacters();
  assert.ok(list.some((x) => x.id === 'example'));
  const loaded = manager.loadCharacter('example');
  assert.equal(loaded.greeting, c.greeting);
  assert.equal(loaded.example_messages.length, 2);
});

test('manager: 非法 YAML 抛 CharacterError 且错误可读', () => {
  assert.throws(() => manager.saveCharacter('name: x\nbad_line'), manager.CharacterError);
  assert.throws(() => manager.saveCharacter('id: not-valid!!\nname: x'), (e) => {
    assert.ok(e instanceof manager.CharacterError);
    assert.match(e.message, /校验失败/);
    return true;
  });
});

test('manager: 路径穿越 id 被拒绝', () => {
  assert.throws(() => manager.loadCharacter('../../evil'), manager.CharacterError);
  assert.throws(() => manager.deleteCharacter('..\\..\\evil'), manager.CharacterError);
});

test('manager: 删除不存在的角色抛错', () => {
  assert.throws(() => manager.deleteCharacter('does-not-exist-xyz'), manager.CharacterError);
});

test('manager: updateCharacter 更新并保留 id', () => {
  const original = readExample();
  const updated = manager.updateCharacter('example', 'name: 小默改\nid: example\ngreeting: 你好，我是新版小默。');
  assert.equal(updated.id, 'example');
  assert.equal(updated.name, '小默改');
  assert.equal(updated.greeting, '你好，我是新版小默。');
  // 恢复原样
  manager.saveCharacter(original);
});
