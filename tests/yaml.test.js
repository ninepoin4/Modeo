import test from 'node:test';
import assert from 'node:assert/strict';

import { parseYaml, stringifyYaml, YamlError } from '../src/core/yaml.js';

test('yaml: 基础 map 与注释', () => {
  const r = parseYaml('# 顶部注释\nname: Modeo # 行尾注释\ndesc: hello');
  assert.deepEqual(r, { name: 'Modeo', desc: 'hello' });
});

test('yaml: 嵌套缩进', () => {
  const r = parseYaml('a:\n  b:\n    c: 1\n  d: x');
  assert.deepEqual(r, { a: { b: { c: 1 }, d: 'x' } });
});

test('yaml: 列表与嵌套列表', () => {
  const r = parseYaml('tools:\n  - list_dir\n  - shell\nnested:\n  - - 1\n    - 2');
  assert.deepEqual(r, { tools: ['list_dir', 'shell'], nested: [[1, 2]] });
});

test('yaml: 行内数组与行内 map', () => {
  const r = parseYaml('tags: [武侠, 客栈]\npersona: {name: 晚霞, age: 30}');
  assert.deepEqual(r, { tags: ['武侠', '客栈'], persona: { name: '晚霞', age: 30 } });
});

test('yaml: 块标量 |', () => {
  const r = parseYaml('prompt: |\n  第一行\n  第二行\nnext: ok');
  assert.equal(r.prompt, '第一行\n第二行');
  assert.equal(r.next, 'ok');
});

test('yaml: 引号字符串与转义', () => {
  const r = parseYaml('a: "hello\\nworld"\nb: \'it\'\'s\'\nc: plain: text');
  assert.equal(r.a, 'hello\nworld');
  assert.equal(r.b, "it's");
  assert.equal(r.c, 'plain: text');
});

test('yaml: 标量类型', () => {
  const r = parseYaml('n: 42\nf: 3.14\nt: true\nf2: false\nnil: null');
  assert.equal(r.n, 42);
  assert.equal(r.f, 3.14);
  assert.equal(r.t, true);
  assert.equal(r.f2, false);
  assert.equal(r.nil, null);
});

test('yaml: 错误带行号', () => {
  assert.throws(() => parseYaml('a: 1\n  b: 2'), YamlError);
  assert.throws(() => parseYaml('no-colon-here'), (e) => {
    assert.ok(e instanceof YamlError);
    assert.match(e.message, /第 1 行/);
    return true;
  });
});

test('yaml: stringify 往返', () => {
  const obj = {
    id: 'x',
    name: '晚霞',
    tags: ['a', 'b'],
    prompt: '第一行\n第二行',
    nested: { a: 1, b: true },
    empty: [],
  };
  const yaml = stringifyYaml(obj);
  const back = parseYaml(yaml);
  assert.deepEqual(back, obj);
});

test('yaml: 危险键（__proto__）不造成原型污染', () => {
  const r = parseYaml('__proto__:\n  polluted: true\nname: ok');
  assert.equal(r.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(r.name, 'ok');
});
