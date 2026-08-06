/**
 * YAML 子集解析器与规范化输出器。
 * 支持：注释、缩进 map、列表、行内数组/对象、引号、标量、块标量 | 和 >。
 * 不支持：锚点/别名、多文档、复杂流式嵌套。
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line != null ? `第 ${line} 行: ${message}` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') return line.slice(0, i);
    }
  }
  return line;
}

function splitTopLevel(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of s) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === sep && depth === 0) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseScalar(raw) {
  const v = String(raw).trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if (v.startsWith('"')) {
    const inner = v.slice(1, v.endsWith('"') ? -1 : undefined);
    return inner.replace(/\\(["\\nrt])/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
  }
  if (v.startsWith("'")) {
    return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? splitTopLevel(inner).map(parseScalar) : [];
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    const obj = {};
    if (inner) {
      for (const pair of splitTopLevel(inner)) {
        const idx = pair.indexOf(':');
        if (idx < 0) throw new YamlError(`行内对象缺少冒号: ${pair}`);
        safeSet(obj, parseScalar(pair.slice(0, idx)), parseScalar(pair.slice(idx + 1)));
      }
    }
    return obj;
  }
  return v;
}

function countIndent(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

/** 安全赋值：屏蔽原型污染危险键 */
function safeSet(obj, key, value) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
  obj[key] = value;
}

/**
 * 解析 YAML 文本。
 * @param {string} text
 * @returns {object}
 */
export function parseYaml(text) {
  const lines = [];
  const raw = String(text).split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const stripped = stripComment(raw[i]).replace(/\s+$/, '');
    if (!stripped.trim()) continue;
    lines.push({ indent: countIndent(stripped), text: stripped.trim(), lineNo: i + 1 });
  }

  let idx = 0;

  function parseBlock(indent) {
    if (idx >= lines.length) return null;
    const line = lines[idx];
    if (line.indent < indent) return null;
    if (line.text.startsWith('-')) return parseSequence(indent);
    return parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new YamlError(`意外的缩进（第 ${line.lineNo} 行）`, line.lineNo);
      }
      if (line.text.startsWith('-')) throw new YamlError(`此处需要 key: value（第 ${line.lineNo} 行）`, line.lineNo);
      const colon = findColon(line.text);
      if (colon < 0) throw new YamlError(`缺少冒号（第 ${line.lineNo} 行）`, line.lineNo);
      const key = parseScalar(line.text.slice(0, colon));
      const rest = line.text.slice(colon + 1).trim();
      idx++;
      if (rest === '|' || rest === '>') {
        safeSet(obj, key, parseBlockScalar(indent, rest === '>'));
      } else if (rest === '') {
        safeSet(obj, key, parseBlock(line.indent + 2));
      } else {
        safeSet(obj, key, parseScalar(rest));
      }
    }
    return obj;
  }

  function findColon(s) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === ':' && !inSingle && !inDouble) {
        if (i + 1 >= s.length || s[i + 1] === ' ' || s[i + 1] === '\t') return i;
      }
    }
    return -1;
  }

  function parseSequence(indent) {
    const arr = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamlError(`意外的缩进（第 ${line.lineNo} 行）`, line.lineNo);
      if (!line.text.startsWith('-')) break;
      const rest = line.text.slice(1).trim();
      idx++;
      if (rest === '') {
        arr.push(parseBlock(indent + 2));
      } else if (rest.startsWith('-')) {
        const nested = [parseScalar(rest.slice(1).trim())];
        while (idx < lines.length && lines[idx].indent > indent && lines[idx].text.startsWith('-')) {
          nested.push(parseScalar(lines[idx].text.slice(1).trim()));
          idx++;
        }
        arr.push(nested);
      } else {
        const colon = findColon(rest);
        if (colon >= 0 && !rest.startsWith('[') && !rest.startsWith('{') && !rest.startsWith('"') && !rest.startsWith("'")) {
          const item = {};
          const k = parseScalar(rest.slice(0, colon));
          const v = rest.slice(colon + 1).trim();
          safeSet(item, k, v === '' ? parseBlock(indent + 2) : parseScalar(v));
          if (idx < lines.length && lines[idx].indent > indent && !lines[idx].text.startsWith('-')) {
            const cont = parseMap(lines[idx].indent);
            for (const [ck, cv] of Object.entries(cont)) safeSet(item, ck, cv);
          }
          arr.push(item);
        } else {
          arr.push(parseScalar(rest));
        }
      }
    }
    return arr;
  }

  function parseBlockScalar(parentIndent, folded) {
    const out = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent <= parentIndent) break;
      out.push(line.text);
      idx++;
    }
    let s = out.join('\n');
    if (folded) s = s.replace(/\n+/g, '\n');
    return s;
  }

  if (!lines.length) return {};
  const result = parseBlock(lines[0].indent);
  if (idx < lines.length) {
    throw new YamlError(`存在无法解析的内容（第 ${lines[idx].lineNo} 行）`, lines[idx].lineNo);
  }
  return result || {};
}

function needQuotes(s) {
  return (
    s === '' ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /:\s|\s#|^true$|^false$|^null$|^-?\d+(\.\d+)?$/.test(s) ||
    s.includes('\n')
  );
}

function renderScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (needQuotes(s)) return JSON.stringify(s);
  return s;
}

function linesOfKey(k, v, indent) {
  const pad = ' '.repeat(indent);
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
    return [`${pad}${k}:`, ...linesOf(v, indent + 2)];
  }
  if (Array.isArray(v)) {
    if (!v.length) return [`${pad}${k}: []`];
    return [`${pad}${k}:`, ...linesOf(v, indent + 2)];
  }
  if (v && typeof v === 'object' && !Object.keys(v).length) {
    return [`${pad}${k}: {}`];
  }
  if (typeof v === 'string' && v.includes('\n')) {
    return [`${pad}${k}: |`, ...v.split('\n').map((l) => (l ? ' '.repeat(indent + 2) + l : ''))];
  }
  return [`${pad}${k}: ${renderScalar(v)}`];
}

/** 返回行数组（不 join，方便上层拼接） */
function linesOf(v, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return ['[]'];
    const lines = [];
    for (const item of v) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 1) {
          const val = item[keys[0]];
          if (val && typeof val === 'object' && Object.keys(val).length) {
            lines.push(`${pad}- ${keys[0]}:`);
            lines.push(...linesOf(val, indent + 4));
          } else if (typeof val === 'string' && val.includes('\n')) {
            lines.push(`${pad}- ${keys[0]}: |`);
            lines.push(...val.split('\n').map((l) => (l ? ' '.repeat(indent + 4) + l : '')));
          } else {
            lines.push(`${pad}- ${keys[0]}: ${renderScalar(val)}`);
          }
        } else {
          lines.push(`${pad}-`);
          for (const k of keys) lines.push(...linesOfKey(k, item[k], indent + 2));
        }
      } else {
        if (typeof item === 'string' && item.includes('\n')) {
          lines.push(`${pad}- |`);
          lines.push(...item.split('\n').map((l) => (l ? ' '.repeat(indent + 4) + l : '')));
        } else {
          lines.push(`${pad}- ${renderScalar(item)}`);
        }
      }
    }
    return lines;
  }
  if (v && typeof v === 'object') {
    if (!Object.keys(v).length) return ['{}'];
    const lines = [];
    for (const k of Object.keys(v)) lines.push(...linesOfKey(k, v[k], indent));
    return lines;
  }
  return [renderScalar(v)];
}

/**
 * 输出规范化 YAML（2 空格缩进）。
 */
export function stringifyYaml(obj) {
  if (obj === null || obj === undefined) return 'null\n';
  if (typeof obj !== 'object' || Array.isArray(obj)) return `${renderScalar(obj)}\n`;
  return linesOf(obj, 0).join('\n') + '\n';
}
