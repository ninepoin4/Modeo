/**
 * shell 工具：在工作区内执行命令，危险命令需审批。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_OUTPUT = 64 * 1024;

/**
 * 危险命令检测：先按 && / || / ; / | 分段（忽略引号内），再逐段匹配。
 * 覆盖：递归/强制删除（rm -r、rmdir、del /s、Remove-Item）、通配符删除、
 * 格式化/磁盘操作、系统级命令（关机/重启/账户/磁盘分区等）。
 */
const DANGEROUS_PATTERNS = [
  // rm 递归删除（-r / -rf / -fr 等组合）；rm -f 单文件不算
  /\brm\s+-[a-z]*r[a-z]*\b/i,
  // rm 通配符删除
  /\brm\b[^\n]*\*/i,
  // Windows 递归删除目录
  /\b(?:rmdir|rd)\s+(?:\/[a-z]*[sq][a-z]*)?/i,
  // del/erase 删除（任何带 /s 递归，或带通配符；支持 /f /q /s 多选项组合）
  /\bdel(?:ete)?\s+(?:\/[a-z]{1,2}\s+)*[^\s]*\*/i,
  /\bdel(?:ete)?\s+\/[a-z]*s/i,
  // PowerShell 递归/强制删除
  /\bremove-item\b[^\n]*(?:-recurse|-force)/i,
  // 格式化 / 创建文件系统
  /\bformat\s+(?:[a-zA-Z]:|[\/qy])/i,
  /\bmkfs\b/i,
  // 系统级操作
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bnet\s+user\b/i,
  /\bdiskpart\b/i,
  /\bdism\b/i,
  /\bsfc\b/i,
];

/**
 * 敏感路径访问检测：读取/列出/复制 SSH 密钥、AWS 凭据、
 * 环境文件、本机设置等敏感位置 → 需审批（防数据泄露）。
 */
const SENSITIVE_PATH_PATTERNS = [
  /(?:^|[;\s&|])(?:cat|type|more|less|head|tail|print|Get-Content|Copy-Item|cp|scp|curl|wget|Invoke-WebRequest|xcopy|robocopy)[^\n]*\b(?:id_rsa|id_ed25519|id_ecdsa|\.ssh|\.aws|credentials|\.env|\.env\.local|settings\.json|\.gnupg|\.pem|\.key)\b/i,
  /(?:^|[;\s&|])(?:echo|print|Write-Output|Get-Content)[^\n]*\$env:[A-Z_]+(?:KEY|TOKEN|SECRET|PASSWORD)/i,
  /(?:^|[;\s&|])(?:dir|ls|find|Get-ChildItem|tree)[^\n]*\b(?:\.ssh|\.aws|\.gnupg)\b/i,
];

function isSensitiveAccess(command) {
  const segments = segmentCommand(String(command || ''));
  return segments.some((seg) => SENSITIVE_PATH_PATTERNS.some((re) => re.test(seg)));
}

/** 按 && / || / ; / | 拆分命令段（忽略引号内内容） */
function segmentCommand(command) {
  const parts = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of command) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && (ch === '&' || ch === '|' || ch === ';')) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function isDangerous(command) {
  const segments = segmentCommand(String(command || ''));
  return segments.some((seg) => DANGEROUS_PATTERNS.some((re) => re.test(seg)));
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
      const sensitive = !needsApproval && isSensitiveAccess(command);
      // 危险命令/敏感路径预检：无审批模式（aggressive）或已获批准（forceApproved）时放行
      if ((needsApproval || sensitive) && !ctx.forceApproved && !ctx.aggressive) {
        return {
          output: sensitive
            ? `[敏感路径访问，等待审批] ${command}`
            : `[危险命令，等待审批] ${command}`,
          isError: false,
          needsApproval: true,
          approvalReason: sensitive
            ? `shell 将访问敏感路径（密钥/凭据/设置文件）：${command}`
            : `shell 将执行危险命令：${command}`,
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
          resolve({ output: `命令启动失败: ${err.message}`, isError: true, needsApproval: ctx.forceApproved || ctx.aggressive ? false : needsApproval });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          const done = ctx.forceApproved || ctx.aggressive ? false : needsApproval;
          if (timedOut) {
            resolve({ output: `${out}\n[命令超时，已终止]`, isError: true, exitCode: null, needsApproval: done });
          } else {
            resolve({ output: out || '（无输出）', exitCode: code, isError: code !== 0, needsApproval: done });
          }
        });
      });
    },
  };
}

export { isDangerous, isSensitiveAccess };
