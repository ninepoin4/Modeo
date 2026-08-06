import test from 'node:test';
import assert from 'node:assert/strict';

import { importCcv3, exportCcv3 } from '../src/characters/ccv3.js';
import { parsePngTextChunks, importCharacterCardFromPng } from '../src/characters/png.js';
import { CharacterError } from '../src/characters/manager.js';

const SAMPLE = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '阿青',
    description: '剑客少女',
    personality: '爽朗直接，剑快话也快。',
    scenario: '黄昏的竹林',
    first_mes: '你来了。拔剑吧。',
    mes_example: '<START>\n{{user}}: 你是谁\n{{char}}: 阿青，练剑的。\n<START>\n{{user}}: 为什么在这里\n{{char}}: 等你，也是等一场雨。',
    system_prompt: '',
    post_history_instructions: '',
    creator: 'test',
    character_version: '1.2',
    tags: ['武侠'],
  },
};

test('importCcv3: 核心字段映射', () => {
  const c = importCcv3(SAMPLE);
  assert.equal(c.name, '阿青');
  assert.equal(c.persona.personality, '爽朗直接，剑快话也快。');
  assert.equal(c.setting.scenario, '黄昏的竹林');
  assert.equal(c.greeting, '你来了。拔剑吧。');
  assert.equal(c.version, '1.2');
  assert.deepEqual(c.tags, ['武侠']);
  assert.equal(c.example_messages.length, 2);
  assert.equal(c.example_messages[0].assistant, '阿青，练剑的。');
});

test('importCcv3 -> exportCcv3 -> importCcv3 往返核心字段不丢失', () => {
  const c = importCcv3(SAMPLE);
  const exported = exportCcv3(c);
  assert.equal(exported.spec, 'chara_card_v3');
  assert.equal(exported.spec_version, '3.0');
  const c2 = importCcv3(exported);
  assert.equal(c2.name, '阿青');
  assert.equal(c2.persona.personality, '爽朗直接，剑快话也快。');
  assert.equal(c2.setting.scenario, '黄昏的竹林');
  assert.equal(c2.greeting, '你来了。拔剑吧。');
  assert.equal(c2.example_messages.length, 2);
});

test('exportCcv3: mes_example 生成格式', () => {
  const c = importCcv3(SAMPLE);
  const exported = exportCcv3(c);
  assert.match(exported.data.mes_example, /<START>/);
  assert.match(exported.data.mes_example, /\{\{user\}\}: 你是谁/);
  assert.match(exported.data.mes_example, /\{\{char\}\}: 阿青，练剑的。/);
});

function buildPngWithCard(cardJson) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const text = Buffer.from('chara_card_v3\0' + Buffer.from(JSON.stringify(cardJson)).toString('base64'), 'latin1');
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([sig, chunk('IHDR', ihdrData), chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('png: 手工构造 PNG 可解析出角色卡', () => {
  const png = buildPngWithCard(SAMPLE);
  const chunks = parsePngTextChunks(png);
  assert.ok(chunks['chara_card_v3']);
  const c = importCharacterCardFromPng(png);
  assert.equal(c.name, '阿青');
});

test('png: 签名非法返回空对象/抛错', () => {
  const bad = Buffer.from('not a png at all, just some text');
  assert.deepEqual(parsePngTextChunks(bad), {});
  assert.throws(() => importCharacterCardFromPng(bad), CharacterError);
});
