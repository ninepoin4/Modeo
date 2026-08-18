/**
 * 文件工具：list_dir / read_file / write_file / edit_file（全部沙箱限定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, SandboxError } from './sandbox.js';
import { isSensitiveAccess } from './shellTool.js';

const MAX_READ = 2 * 1024 * 1024;

/**
 * 路径解析：一般模式走沙箱校验；无审批模式（aggressive）允许任意绝对路径，
 * 相对路径仍相对 workspaceRoot（保持默认语义）。
 */
function resolvePath(workspaceRoot, ctx, p) {
  if (ctx?.aggressive && path.isAbsolute(p)) return path.resolve(p);
  return resolveSafePath(workspaceRoot, p);
}

/**
 * 敏感文件门禁：命中敏感路径（.env/.ssh/凭据等）且非无审批模式 → 需审批。
 * 返回 { blocked, reason }；blocked 时上层返回 needsApproval。
 */
function sensitiveCheck(workspaceRoot, ctx, p) {
  if (ctx?.aggressive || ctx?.forceApproved) return { blocked: false };
  const target = path.isAbsolute(p) ? p : path.join(workspaceRoot, p);
  const seg = `cat ${target}`;
  if (isSensitiveAccess(seg)) {
    return { blocked: true, reason: `访问敏感文件需审批：${p}` };
  }
  return { blocked: false };
}

function wrap(fn) {
  return async (args = {}, ctx = {}) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      if (err instanceof SandboxError) {
        return { output: `SandboxError: ${err.message}`, isError: true };
      }
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

export function createFileTools(workspaceRoot) {
  return {
    list_dir: tool(
      'list_dir',
      '列出工作区内目录的内容',
      { type: 'object', properties: { path: { type: 'string' } } },
      async ({ path: p = '.' } = {}, ctx = {}) => {
        // 2026-08-18 外部审查修复：与 read/write/edit 对齐——敏感路径（.ssh/.aws/.gnupg 等）
        // 列目录也走审批（此前仅 shell 侧拦截，文件工具侧漏）
        const gate = sensitiveCheck(workspaceRoot, ctx, p);
        if (gate.blocked) {
          return { output: `[敏感路径访问，等待审批] ${p}`, isError: false, needsApproval: true, approvalReason: gate.reason };
        }
        const dir = resolvePath(workspaceRoot, ctx, p);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? '[dir] ' : '[file]'} ${e.name}`);
        return { output: lines.join('\n') || '（空目录）', isError: false };
      }
    ),
    read_file: tool(
      'read_file',
      '读取工作区内文本文件（utf8，上限 2MB）',
      { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async ({ path: p } = {}, ctx = {}) => {
        if (!p) return { output: '缺少 path 参数', isError: true };
        const gate = sensitiveCheck(workspaceRoot, ctx, p);
        if (gate.blocked) {
          return { output: `[敏感文件访问，等待审批] ${p}`, isError: false, needsApproval: true, approvalReason: gate.reason };
        }
        const file = resolvePath(workspaceRoot, ctx, p);
        const st = fs.statSync(file);
        if (st.size > MAX_READ) {
          return { output: `文件过大（${st.size} 字节，上限 ${MAX_READ}）`, isError: true };
        }
        const content = fs.readFileSync(file, 'utf8');
        return { output: content, isError: false };
      }
    ),
    write_file: tool(
      'write_file',
      '写入工作区内文件（自动创建父目录）',
      { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async ({ path: p, content } = {}, ctx = {}) => {
        if (!p) return { output: '缺少 path 参数', isError: true };
        if (typeof content !== 'string') return { output: 'content 必须是字符串', isError: true };
        const gate = sensitiveCheck(workspaceRoot, ctx, p);
        if (gate.blocked) {
          return { output: `[敏感文件访问，等待审批] ${p}`, isError: false, needsApproval: true, approvalReason: gate.reason };
        }
        const file = resolvePath(workspaceRoot, ctx, p);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
        return { output: `已写入 ${p}（${Buffer.byteLength(content)} 字节）`, isError: false };
      }
    ),
    edit_file: tool(
      'edit_file',
      '精确替换文件中唯一出现的一段文本',
      { type: 'object', properties: { path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' } }, required: ['path', 'oldString', 'newString'] },
      async ({ path: p, oldString, newString } = {}, ctx = {}) => {
        if (!p || typeof oldString !== 'string' || typeof newString !== 'string') {
          return { output: '需要 path、oldString、newString 参数', isError: true };
        }
        const gate = sensitiveCheck(workspaceRoot, ctx, p);
        if (gate.blocked) {
          return { output: `[敏感文件访问，等待审批] ${p}`, isError: false, needsApproval: true, approvalReason: gate.reason };
        }
        const file = resolvePath(workspaceRoot, ctx, p);
        const content = fs.readFileSync(file, 'utf8');
        const count = content.split(oldString).length - 1;
        if (count === 0) return { output: 'oldString 未在文件中找到', isError: true };
        if (count > 1) return { output: `oldString 出现 ${count} 次，请提供更精确的匹配`, isError: true };
        const updated = content.replace(oldString, newString);
        fs.writeFileSync(file, updated, 'utf8');
        return { output: `已编辑 ${p}`, isError: false };
      }
    ),
  };
}
