/**
 * 检索类工具集（2026-08-18 新增，参考主流 agent 工具面补足开发高频能力）：
 * - glob：模式匹配找文件（* / ? / **）
 * - grep：目录内容搜索（正则，跳过构建产物与隐藏目录）
 * - web_fetch：抓取 http(s) URL 文本（截断，15s 超时）
 * 全部路径经沙箱校验（工作区限定，aggressive 允许绝对路径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, SandboxError } from './sandbox.js';
import { isSensitiveAccess } from './shellTool.js';
import { netFetch } from '../core/net.js';

const MAX_GLOB_RESULTS = 200;
const MAX_GREP_RESULTS = 100;
const MAX_GREP_FILE = 1024 * 1024;
const MAX_FETCH_BYTES = 32 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.cache', 'coverage', '.next', '.nuxt', '.workbuddy', '.audit-data']);

/** 私网/回环/链路本地 IP 判定（2026-08-18 二审 SSRF 修复）：拦截元数据与内网地址 */
function isPrivateIp(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  // IPv6 私网/链路本地前缀
  if (/^[fF][cCdD]/.test(h)) return true;
  if (/^(?:169\.254\.|10\.|127\.|192\.168\.)/.test(h)) return true;
  // 172.16.0.0 - 172.31.255.255
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  // 0.0.0.0 / 非法
  if (/^0\.0\.0\.0/.test(h)) return true;
  return false;
}

/** grep 正则守卫：限制长度 + 拒绝高危嵌套量词（ReDoS 缓解，2026-08-18 二审修复） */
const MAX_PATTERN = 200;
function isSafePattern(p) {
  if (p.length > MAX_PATTERN) return false;
  // 连续两层以上嵌套量词（如 (a+)+、(a*)*、(a|a?)+）是 ReDoS 主因
  if (/\([^)]*[+*][^)]*\)[+*]/.test(p)) return false;
  if (/(?:[+*]\s*){2,}/.test(p)) return false;
  return true;
}

function resolvePath(workspaceRoot, ctx, p) {
  if (ctx?.aggressive && path.isAbsolute(p)) return path.resolve(p);
  return resolveSafePath(workspaceRoot, p);
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

/** 简单 glob 匹配：* 任意段内字符，? 单字符，** 跨目录（segment 级） */
function globToRegex(pattern) {
  const segs = pattern.split('/');
  let re = '^';
  let skipSlash = false;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '**') {
      // ** 展开自带尾部斜杠语义（(?:[^/]+/)*），下一段前不再补分隔符
      re += '(?:[^/]+/)*';
      skipSlash = true;
      continue;
    }
    if (i > 0 && !skipSlash) re += '/';
    skipSlash = false;
    re += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  }
  re += '$';
  return new RegExp(re);
}

function walkGlob(dir, rel, base, regex, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (results.length >= MAX_GLOB_RESULTS) return;
    const full = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkGlob(full, relPath, base, regex, results);
    } else if (regex.test(relPath)) {
      results.push(path.join(base, relPath).split(path.sep).join('/'));
    }
  }
}

function walkGrep(dir, rel, regex, results, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (results.length >= MAX_GREP_RESULTS) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkGrep(full, e.name, regex, results, root);
      continue;
    }
    // 只搜文本类扩展名与无扩展名小文件
    const ext = path.extname(e.name).toLowerCase();
    if (!/\.(txt|md|json|js|mjs|cjs|jsx|ts|tsx|css|html|htm|yaml|yml|xml|toml|ini|cfg|conf|py|java|c|cpp|h|hpp|go|rs|rb|php|sh|bat|ps1|sql|env|gitignore|lock|vue|svelte)$/.test(ext) && ext) continue;
    let st;
    try {
      st = fs.statSync(full);
      if (st.size > MAX_GREP_FILE) continue;
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          const line = lines[i].trim();
          results.push(`${path.join(root, relPath).split(path.sep).join('/')}:${i + 1}: ${line.slice(0, 200)}`);
          if (results.length >= MAX_GREP_RESULTS) return;
        }
      }
    } catch {
      // 二进制/无权限文件跳过
    }
  }
}

export function createSearchTools(workspaceRoot) {
  return {
    glob: tool(
      'glob',
      '按模式匹配查找工作区内的文件路径（支持 * 任意字符、? 单字符、** 跨目录，如 "src/**/*.js"）。适合替代 shell 列目录找文件。',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 模式，如 **/*.js 或 src/**/*.test.js' },
          path: { type: 'string', description: '起始目录，默认工作区根' },
        },
        required: ['pattern'],
      },
      async ({ pattern, path: p = '.' } = {}, ctx = {}) => {
        if (!pattern || typeof pattern !== 'string') return { output: '缺少 pattern 参数', isError: true };
        const dir = resolvePath(workspaceRoot, ctx, p);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { output: `目录不存在: ${p}`, isError: true };
        const results = [];
        const regex = globToRegex(pattern);
        walkGlob(dir, '', p === '.' ? '' : String(p).replace(/[\\/]+$/, ''), regex, results);
        if (!results.length) return { output: `没有匹配 "${pattern}" 的文件`, isError: false };
        const out = results.slice(0, MAX_GLOB_RESULTS).join('\n');
        return { output: results.length > MAX_GLOB_RESULTS ? `${out}\n…（共 ${results.length} 个，仅显示前 ${MAX_GLOB_RESULTS}）` : out, isError: false };
      }
    ),
    grep: tool(
      'grep',
      '在工作区内搜索文本内容（正则匹配，默认大小写不敏感，自动跳过 node_modules/.git/dist 等目录）。输出 文件:行号:内容。',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式，如 "TODO|FIXME" 或 "export function"' },
          path: { type: 'string', description: '起始目录，默认工作区根' },
          caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
        },
        required: ['pattern'],
      },
      async ({ pattern, path: p = '.', caseSensitive = false } = {}, ctx = {}) => {
        if (!pattern || typeof pattern !== 'string') return { output: '缺少 pattern 参数', isError: true };
        if (!isSafePattern(pattern)) return { output: `正则不安全或过长（>${MAX_PATTERN} 字符，或含嵌套量词）——请简化表达式`, isError: true };
        const dir = resolvePath(workspaceRoot, ctx, p);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { output: `目录不存在: ${p}`, isError: true };
        let regex;
        try {
          regex = new RegExp(pattern, caseSensitive ? '' : 'i');
        } catch (e) {
          return { output: `正则无效: ${e.message}`, isError: true };
        }
        const results = [];
        walkGrep(dir, '', regex, results, p === '.' ? '' : String(p).replace(/[\\/]+$/, ''));
        if (!results.length) return { output: `没有匹配 "${pattern}" 的内容`, isError: false };
        const out = results.slice(0, MAX_GREP_RESULTS).join('\n');
        return { output: results.length > MAX_GREP_RESULTS ? `${out}\n…（共 ${results.length} 条，仅显示前 ${MAX_GREP_RESULTS}）` : out, isError: false };
      }
    ),
    web_fetch: tool(
      'web_fetch',
      '抓取 http(s) 网页/文档内容为纯文本（仅 GET，自动截断 32KB）。用于查阅在线文档、README、API 说明。',
      {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL' },
        },
        required: ['url'],
      },
      async ({ url } = {}) => {
        if (!url || !/^https?:\/\//i.test(url)) return { output: 'url 必须是 http(s) 链接', isError: true };
        // 2026-08-18 二审 SSRF 修复：拦截私网/回环/链路本地（云元数据 169.254.169.254 等），
        // 防止模型被网页内容诱导抓取内网资源
        let hostname = '';
        try {
          hostname = new URL(url).hostname;
        } catch {
          return { output: 'url 不合法', isError: true };
        }
        if (isPrivateIp(hostname)) {
          return { output: `拒绝访问内网/回环地址 ${hostname}（防 SSRF）`, isError: true };
        }
        try {
          const res = await netFetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) return { output: `HTTP ${res.status}`, isError: true };
          const buf = Buffer.from(await res.arrayBuffer());
          const truncated = buf.length > MAX_FETCH_BYTES;
          const text = buf.subarray(0, MAX_FETCH_BYTES).toString('utf8');
          // 去 HTML 标签的轻量提取
          const clean = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          return { output: truncated ? `${clean}\n…（内容已截断到 ${MAX_FETCH_BYTES} 字节）` : clean, isError: false };
        } catch (e) {
          return { output: `抓取失败: ${e.message || String(e)}`, isError: true };
        }
      }
    ),
  };
}
