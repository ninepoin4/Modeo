/**
 * shell 工具：在工作区内执行命令，危险命令需审批。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_OUTPUT = 64 * 1024;

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-z]*r)?[^|&]*\//i,
  /\bdel\s+\/s/i,
  /\brd\s+\/s/i,
  /\bremove-item\b[^\n]*\b-recurse\b/i,
  /\bformat\b/i,
  /\bmkfs/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bnet\s+user\b/i,
  /\bdiskpart\b/i,
  /\bdism\b/i,
  /\bsfc\b/i,
];

function isDangerous(command) {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

function killTree(child) {
  if (!child || child.pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

export function createShellTool(workspaceRoot) {
  return {
    name: 'shell',
    description: '在沙箱工作区内执行 shell 命令。危险命令（删除、格式化、系统级操作）需要审批。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeoutMs: { type: 'number', description: '超时毫秒，默认 30000' },
      },
      required: ['command'],
    },
    async execute(args = {}, ctx = {}) {
      const command = String(args.command || '').trim();
      if (!command) return { output: '缺少 command 参数', isError: true };
      const timeoutMs = Math.min(Number(args.timeoutMs) || 30000, 120000);
      const needsApproval = isDangerous(command);
      // 危险命令预检：未获批准（forceApproved）绝不实际执行
      if (needsApproval && !ctx.forceApproved) {
        return {
          output: `[危险命令，等待审批] ${command}`,
          isError: false,
          needsApproval: true,
        };
      }

      return new Promise((resolve) => {
        const opts = {
          cwd: path.resolve(workspaceRoot),
          env: { ...process.env, ...(ctx.env || {}) },
          windowsHide: true,
        };
        let child;
        if (process.platform === 'win32') {
          child = spawn('cmd.exe', ['/d', '/s', '/c', command], opts);
        } else {
          child = spawn('/bin/sh', ['-c', command], opts);
        }
        let out = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, timeoutMs);

        child.stdout.on('data', (d) => {
          out += d.toString();
          if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT);
        });
        child.stderr.on('data', (d) => {
          out += d.toString();
          if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ output: `命令启动失败: ${err.message}`, isError: true, needsApproval });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (timedOut) {
            resolve({ output: `${out}\n[命令超时，已终止]`, isError: true, exitCode: null, needsApproval });
          } else {
            resolve({ output: out || '（无输出）', exitCode: code, isError: code !== 0, needsApproval });
          }
        });
      });
    },
  };
}

export { isDangerous };
