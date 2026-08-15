import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// 本测试用 127.0.0.1 起本地服务测 fetchPackJson/fetchMarketIndex；
// pack.js 的 SSRF 防护（isBlockedHost）拒绝回环地址，需显式开逃生口（2026-08-15 修复：
// 此前纯净环境 node --test 3 个用例失败，只有带 MODEO_ALLOW_LOOPBACK=1 才过）。
process.env.MODEO_ALLOW_LOOPBACK = '1';

import {
  buildPack,
  parsePack,
  installPack,
  listPacks,
  savePackFile,
  getPack,
  deletePack,
  PackError,
  PACK_FORMAT,
  fetchPackJson,
  fetchMarketIndex,
  MARKET_INDEX_FORMAT,
} from '../src/characters/pack.js';
import * as manager from '../src/characters/manager.js';

test('pack: buildPack 与 parsePack 往返', () => {
  const c = manager.loadCharacter('example');
  const pack = buildPack([c], { name: '示例包', author: 'test' });
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.formatVersion, 1);
  assert.equal(pack.characters.length, 1);
  const parsed = parsePack(pack);
  assert.equal(parsed[0].id, 'example');
  assert.equal(parsed[0].name, '小默');
});

test('pack: 非法包/非法角色报错', () => {
  assert.throws(() => parsePack({}), PackError);
  assert.throws(() => parsePack({ format: PACK_FORMAT, characters: [] }), PackError);
  assert.throws(() => parsePack({ format: 'other', characters: [{}] }), PackError);
  assert.throws(() => buildPack([{ name: '' }]), PackError);
});

test('pack: installPack 安装新角色并跳过重复', () => {
  const c = manager.loadCharacter('example');
  const r1 = installPack(buildPack([c]));
  assert.deepEqual(r1.skipped, ['example']);
  assert.equal(r1.imported.length, 0);

  const fresh = { id: 'packtest-xyz', name: '包测试', greeting: '你好' };
  const r2 = installPack(buildPack([fresh]));
  assert.deepEqual(r2.imported, ['packtest-xyz']);
  assert.ok(manager.listCharacters().some((x) => x.id === 'packtest-xyz'));
  manager.deleteCharacter('packtest-xyz');
});

test('pack: 本地包保存/列表/读取/删除', () => {
  const c = manager.loadCharacter('wanxia');
  const pack = buildPack([c], { name: '晚霞包' });
  const meta = savePackFile('packtest-wanxia', pack);
  assert.equal(meta.name, '晚霞包');
  assert.equal(meta.characterCount, 1);
  const list = listPacks();
  assert.ok(list.some((p) => p.id === 'packtest-wanxia'));
  const loaded = getPack('packtest-wanxia');
  assert.equal(loaded.characters[0].id, 'wanxia');
  deletePack('packtest-wanxia');
  assert.throws(() => getPack('packtest-wanxia'), PackError);
});

test('pack: 非法包 id 拒绝访问', () => {
  assert.throws(() => getPack('../evil'), PackError);
  assert.throws(() => savePackFile('a/b', {}), PackError);
});

test('pack: fetchPackJson 从 URL 下载并校验', async () => {
  const pack = buildPack([manager.loadCharacter('wanxia')], { name: 'URL包' });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pack));
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const obj = await fetchPackJson(`http://127.0.0.1:${server.address().port}/pack`);
    assert.equal(obj.characters[0].id, 'wanxia');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pack: fetchPackJson 拒绝非法协议与错误状态', async () => {
  await assert.rejects(() => fetchPackJson('file:///etc/passwd'), PackError);
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end('err');
  });
  await new Promise((r) => server.listen(0, r));
  try {
    await assert.rejects(() => fetchPackJson(`http://127.0.0.1:${server.address().port}/x`), /HTTP 500/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pack: fetchMarketIndex 解析有效索引', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        format: MARKET_INDEX_FORMAT,
        version: 1,
        packs: [{ id: 'a', name: 'A 包', author: 't', description: 'd', url: 'https://example.com/p.modeopack.json' }],
      })
    );
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const idx = await fetchMarketIndex(`http://127.0.0.1:${server.address().port}/index`);
    assert.equal(idx.packs.length, 1);
    assert.equal(idx.packs[0].id, 'a');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pack: fetchMarketIndex 拒绝无效索引与非法协议', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ format: 'other', packs: [] }));
  });
  await new Promise((r) => server.listen(0, r));
  try {
    await assert.rejects(() => fetchMarketIndex(`http://127.0.0.1:${server.address().port}/x`), PackError);
  } finally {
    await new Promise((r) => server.close(r));
  }
  await assert.rejects(() => fetchMarketIndex('file:///x'), PackError);
});
