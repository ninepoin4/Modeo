/**
 * 语义索引工具（P2-⑧ 差距分析第三批）：find_symbol 定位代码符号定义位置。
 * 轻量 AST：正则扫描常见语言（js/ts/jsx/tsx/py）的函数/类/常量定义，输出 文件:行号。
 * 大型代码库导航效率远高于逐文件 grep 猜测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, SandboxError } from './sandbox.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.cache', '__pycache__', '.next', 'coverage']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py']);
const MAX_FILES = 3000;
const MAX_LINE = 400;

/** 单文件符号提取：返回 [{type, name, line, text}] */
export function extractSymbols(content, ext) {
  const symbols = [];
  const lines = content.split('\n');
  const limit = Math.min(lines.length, MAX_LINE);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    const m =
      ext === '.py'
        ? line.match(/^\s*(?:class|def|async\s+def)\s+([A-Za-z_]\w*)\s*(?:\(|:)/)
        : line.match(
            /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)\s*(?:=|\(|\{|<|extends|implements|:)/ 
          );
    if (m && m[1]) {
      symbols.push({ type: /class/.test(line) ? 'class' : /function|async/.test(line) ? 'function' : /interface|type/.test(line) ? 'type' : 'var', name: m[1], line: i + 1, text: line.trim().slice(0, 120) });
    }
  }
  return symbols;
}

function walk(root, rel = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...walk(root, relPath));
    } else if (CODE_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(relPath);
    }
  }
  return out;
}

function wrap(fn) {
  return async (args = {}, ctx = {}) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      if (err instanceof SandboxError) return { output: `SandboxError: ${err.message}`, isError: true };
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

export function createSymbolTools(workspaceRoot) {
  return {
    find_symbol: tool(
      'find_symbol',
      '在工作区代码文件中查找符号定义（函数/类/变量/接口），返回 文件:行号:定义。可指定 path 限单个文件、name 精确匹配、type 过滤（function/class/var/type）。支持 js/ts/jsx/tsx/py。',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: '限定单个文件（工作区内相对路径）' },
          name: { type: 'string', description: '符号名精确匹配（可选）' },
          type: { type: 'string', description: '类型过滤：function/class/var/type' },
        },
        additionalProperties: false,
      },
      async ({ path: p, name, type } = {}) => {
        const files = [];
        if (p) {
          const abs = resolveSafePath(workspaceRoot, p);
          if (!fs.existsSync(abs)) return { output: `文件不存在: ${p}`, isError: true };
          files.push(path.relative(workspaceRoot, abs).split(path.sep).join('/'));
        } else {
          files.push(...walk(workspaceRoot));
        }
        const hits = [];
        for (const rel of files) {
          const abs = path.join(workspaceRoot, rel.split('/').join(path.sep));
          let content;
          try {
            if (fs.statSync(abs).size > 512 * 1024) continue; // 跳过超大文件
            content = fs.readFileSync(abs, 'utf8');
          } catch {
            continue;
          }
          const ext = path.extname(rel).toLowerCase();
          for (const s of extractSymbols(content, ext)) {
            if (name && s.name !== name) continue;
            if (type && s.type !== type) continue;
            hits.push(`${rel}:${s.line}: [${s.type}] ${s.text}`);
            if (hits.length >= 200) break;
          }
          if (hits.length >= 200) break;
        }
        if (!hits.length) {
          return { output: `未找到符号${name ? ` ${name}` : ''}（扫描 ${files.length} 个代码文件）`, isError: false };
        }
        return { output: `符号 ${name || '全部'}（${hits.length} 处）：\n${hits.join('\n')}`, isError: false };
      }
    ),
  };
}
