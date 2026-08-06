/**
 * 最小 PNG tEXt 块解析：提取 chara_card_v3 角色卡。
 */
import { importCcv3 } from './ccv3.js';
import { CharacterError } from './manager.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 解析 PNG 的所有 tEXt 块。
 * @returns {Record<string,string>} keyword -> text
 */
export function parsePngTextChunks(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {};
  }
  const out = {};
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) break;
    if (type === 'tEXt') {
      const data = buffer.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = data.subarray(0, nul).toString('latin1');
        const text = data.subarray(nul + 1).toString('latin1');
        out[keyword] = text;
      }
    }
    offset = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }
  return out;
}

/**
 * 从 PNG buffer 导入角色卡。
 */
export function importCharacterCardFromPng(buffer) {
  const chunks = parsePngTextChunks(buffer);
  const raw = chunks['chara_card_v3'];
  if (!raw) throw new CharacterError('PNG 中未找到 chara_card_v3 角色卡');
  let json;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new CharacterError('角色卡 JSON 解码失败');
  }
  return importCcv3(json);
}
