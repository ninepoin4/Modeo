/**
 * Git 工具集：git_status / git_diff / git_log / git_commit / git_checkout
 *
 * 安全设计：
 * - 全部通过 execFile 调用 git（参数数组传递，无 shell 注入面），cwd 锁定工作区
 * - 路径参数一律经 resolveSafePath 沙箱校验，且只允许工作区内
 * - git_checkout 只支持 `-- <path>`（恢复单个文件），拒绝分支切换 / reset / force
 * - 输出截断 32KB，防止大 diff/log 撑爆上下文
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveSafePath, SandboxError } from './sandbox.js';

const MAX_OUTPUT = 32 * 1024;

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

/** 执行 git 命令；返回 stdout/stderr 截断文本，非零退出码置 isError */
function runGit(cwd, args, maxOut = MAX_OUTPUT) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      const out = (stdout || '').toString();
      const errTxt = (stderr || '').toString();
      if (err) {
        const msg = errTxt.trim() || out.trim() || err.message;
        // 非 git 仓库给友好提示
        if (/not a git repository|不是 git 仓库/i.test(msg)) {
          return resolve({ output: '工作区不是 git 仓库（缺少 .git）。要使用 git 工具需先在项目根执行 git init。', isError: true });
        }
        return resolve({ output: `git ${args[0]} 失败: ${msg.slice(0, 500)}`, isError: true });
      }
      const text = out || errTxt;
      const clipped = text.length > maxOut ? text.slice(0, maxOut) + `\n…(输出 ${text.length} 字符，已截断到 ${maxOut})` : text;
      return resolve({ output: clipped.trim() || '（无输出）', isError: false });
    });
  });
}

/** 工作区内文件路径解析：返回相对工作区根的 posix 路径（供 git add/checkout 用） */
function relPathInWorkspace(workspaceRoot, ctx, p) {
  const abs = ctx?.aggressive && path.isAbsolute(p)
    ? path.resolve(p)
    : resolveSafePath(workspaceRoot, p);
  if (ctx?.aggressive && path.isAbsolute(p)) {
    // aggressive 模式允许绝对路径，但仍限定在工作区内
    const rel = path.relative(workspaceRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SandboxError('git 工具仅支持工作区内的路径');
    }
  }
  const rel = path.relative(workspaceRoot, abs).split(path.sep).join('/');
  if (rel.startsWith('..')) throw new SandboxError('路径超出工作区');
  return rel;
}

export function createGitTools(workspaceRoot) {
  return {
    git_status: tool(
      'git_status',
      '查看工作区 git 状态（变更文件列表、未跟踪文件、暂存区）。工作区必须已初始化 git。',
      { type: 'object', properties: {}, additionalProperties: false },
      async () => runGit(workspaceRoot, ['status', '--short'])
    ),

    git_diff: tool(
      'git_diff',
      '查看文件或整个工作区的 git 差异。可指定 path（工作区内相对路径）查看单个文件 diff；staged=true 查看已暂存差异。',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区内相对路径，如 src/app.js' },
          staged: { type: 'boolean', description: '查看已暂存（staged）差异' },
        },
        additionalProperties: false,
      },
      async ({ path: p, staged } = {}) => {
        const args = ['diff'];
        if (staged) args.push('--cached');
        args.push('--stat');
        if (p) {
          const rel = relPathInWorkspace(workspaceRoot, {}, p);
          const stat = await runGit(workspaceRoot, [...args, '--', rel]);
          if (stat.isError) return stat;
          const full = await runGit(workspaceRoot, ['diff', ...(staged ? ['--cached'] : []), '--', rel]);
          return full.isError ? full : { output: `${stat.output}\n\n${full.output}`, isError: false };
        }
        const stat = await runGit(workspaceRoot, args);
        if (stat.isError) return stat;
        if (stat.output.includes('（无输出）') || !/\d+ file/.test(stat.output)) {
          return { output: '工作区没有未提交的差异。', isError: false };
        }
        const full = await runGit(workspaceRoot, ['diff', ...(staged ? ['--cached'] : [])]);
        return full.isError ? full : { output: `${stat.output}\n\n${full.output}`, isError: false };
      }
    ),

    git_log: tool(
      'git_log',
      '查看提交历史（默认最近 20 条：哈希/作者/日期/标题）。n 指定条数（1-100）。',
      {
        type: 'object',
        properties: { n: { type: 'number', description: '条数，默认 20，最大 100' } },
        additionalProperties: false,
      },
      async ({ n } = {}) => {
        const count = Math.max(1, Math.min(100, Number(n) || 20));
        return runGit(workspaceRoot, ['log', `-${count}`, '--pretty=format:%h %ad %an %s', '--date=format:%m-%d %H:%M']);
      }
    ),

    git_commit: tool(
      'git_commit',
      '提交变更：先 git add（可指定 paths，默认全部工作区变更），再 git commit。message 必填。提交前建议先用 git_diff 确认改动内容。',
      {
        type: 'object',
        properties: {
          message: { type: 'string', description: '提交信息' },
          paths: { type: 'array', items: { type: 'string' }, description: '只提交这些文件（工作区内相对路径），默认全部' },
        },
        required: ['message'],
        additionalProperties: false,
      },
      async ({ message, paths } = {}) => {
        if (!message || !String(message).trim()) return { output: '错误: message 必填', isError: true };
        const msg = String(message).trim().slice(0, 2000);
        let addArgs;
        if (Array.isArray(paths) && paths.length) {
          const rels = paths.map((p) => relPathInWorkspace(workspaceRoot, {}, p));
          addArgs = ['add', '--', ...rels];
        } else {
          addArgs = ['add', '-A'];
        }
        const add = await runGit(workspaceRoot, addArgs);
        if (add.isError) return add;
        const cm = await runGit(workspaceRoot, ['commit', '-m', msg], 8 * 1024);
        if (cm.isError) {
          if (/nothing to commit|no changes added|没有要提交/i.test(cm.output)) {
            return { output: '没有可提交的变更（工作区干净）。', isError: false };
          }
          return cm;
        }
        const log = await runGit(workspaceRoot, ['log', '-1', '--pretty=format:%h %s']);
        return { output: `提交成功：${log.output}\n${cm.output}`, isError: false };
      }
    ),

    git_checkout: tool(
      'git_checkout',
      '恢复工作区内单个文件到 HEAD（丢弃该文件的未提交修改）。只允许恢复文件，禁止分支切换/reset 等危险操作。',
      {
        type: 'object',
        properties: { path: { type: 'string', description: '工作区内相对路径，如 src/app.js' } },
        required: ['path'],
        additionalProperties: false,
      },
      async ({ path: p } = {}) => {
        if (!p) return { output: '错误: path 必填', isError: true };
        const rel = relPathInWorkspace(workspaceRoot, {}, p);
        const r = await runGit(workspaceRoot, ['checkout', '--', rel]);
        if (r.isError && /pathspec|did not match|does not have/.test(r.output)) {
          return { output: `git checkout 失败：文件 ${rel} 不在版本控制中（未跟踪或不存在）。`, isError: true };
        }
        return r;
      }
    ),
  };
}
