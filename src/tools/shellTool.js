/**
 * shell 工具：在工作区内执行命令，危险命令需审批。
 * background=true 时立即返回并托管为后台任务（process_read/process_kill 管理）；
 * 前台命令超时自动转后台（长驻进程如 dev server 不丢失）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { startJob, detachJob } from './processManager.js';

const MAX_OUTPUT = 64 * 1024;

/**
 * 危险命令检测：先按 && / || / ; / | 分段（忽略引号内），再逐段匹配。
 * 覆盖：递归/强制删除（rm -r、rmdir、del /s、Remove-Item）、通配符删除、
 * 格式化/磁盘操作、系统级命令（关机/重启/账户/磁盘分区等）。
 */
const DANGEROUS_PATTERNS = [
  // rm 递归删除（-r / -rf / -fr 等组合）；rm -f 单文件不算
  /\brm\s+-[a-z]*r[a-z]*\b/i,
  // rm 长选项 + 递归组合（2026-08-15 修复：rm --force -r 此前绕过）
  /\brm\s+(?:--[a-z-]+\s+)*-r[a-z]*\b/i,
  // rm 长选项递归（--force 语义等同 -f 单文件，不算危险）
  /\brm\s+--(?:recursive|no-preserve-root)\b/i,
  // rm 通配符删除
  /\brm\b[^\n]*\*/i,
  // Windows 递归删除目录
  /\b(?:rmdir|rd)\s+(?:\/[a-z]*[sq][a-z]*)?/i,
  // del/erase 删除（任何带 /s 递归，或带通配符；支持 /f /q /s 多选项组合）
  /\bdel(?:ete)?\s+(?:\/[a-z]{1,2}\s+)*[^\s]*\*/i,
  /\bdel(?:ete)?\s+(?:\/[a-z]{1,2}\s+)*\/[a-z]*s/i,
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
  // 关机/重启家族补充（2026-08-15 修复：Stop-Computer/poweroff/halt 此前绕过）
  /\b(?:stop-computer|restart-computer|poweroff|halt)\b/i,
  // ==== 审批绕过补充（2026-08-15 审查修复）====
  // erase（del 别名）递归删除
  /\berase\s+(?:\/[a-z]{1,2}\s+)*\/[a-z]*s/i,
  /\berase\s+(?:\/[a-z]{1,2}\s+)*[^\s]*\*/i,
  // PowerShell 编码命令执行（-enc / -EncodedCommand；nc 后接 command 为长选项，否则词边界收尾）
  /\bpowershell(?:\.exe)?\b[^\n]*-e(?:nc(?:odedcommand)?)\b/i,
  // certutil 解码/下载执行
  /\bcertutil\b[^\n]*(?:-decode|-decodehex|-urlcache)/i,
  // 注册表持久化
  /\breg\s+add\b/i,
  // bitsadmin 下载执行
  /\bbitsadmin\b[^\n]*(?:transfer|create)/i,
  // mshta / wmic / rundll32 间接执行
  /\bmshta(?:\.exe)?\b/i,
  /\bwmic(?:\.exe)?\b[^\n]*process\s+call\s+create/i,
  /\brundll32(?:\.exe)?\b/i,
  // PowerShell 表达式执行
  /\b(?:iex|Invoke-Expression)\b/i,
];

/**
 * 跨管道"下载即执行"模式：curl/wget/iwr ... | sh/bash/powershell/iex。
 * 必须在整条命令级检测——segmentCommand 按 | 拆分会把管道关系拆掉（各段单独看都不危险）。
 */
const PIPE_EXEC_PATTERNS = [
  /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n]*\|\s*(?:sh|bash|powershell|pwsh|iex|Invoke-Expression)\b/i,
];

/**
 * 敏感路径访问检测：读取/列出/复制 SSH 密钥、AWS 凭据、
 * 环境文件、本机设置等敏感位置 → 需审批（防数据泄露）。
 * 注意：点目录（.ssh/.aws/.env）不用 \b（点前无词边界会漏检），
 * 用路径定界符 [\w./\\] 边界匹配。
 */
const SENSITIVE_PATH_PATTERNS = [
  // 读取/复制类命令 + 敏感路径 token（点目录/凭据文件）
  // 注意：\.pem/\.key 不走此规则——它们带点，前一个字符若非分隔符会漏检（如 `cat app.pem`），
  // 已拆分为下方独立规则（匹配任意文件名结尾的 .pem/.key）。
  // 2026-08-17 审查修复：移除 `settings\.json`——它是常见业务文件名（项目自带 settings.json
  // 会被无差别触发审批），且不含凭据；真正敏感的凭据文件由 .env/id_rsa/.ssh/.aws 等覆盖。
  /(?:^|[;\s&|])(?:cat|type|more|less|head|tail|print|Get-Content|Copy-Item|cp|scp|curl|wget|Invoke-WebRequest|xcopy|robocopy)[^\n]*(?:[\s./\\]|^)(?:id_rsa|id_ed25519|id_ecdsa|\.ssh|\.aws|credentials|\.env|\.gnupg)\b/i,
  // 私钥/证书文件：任意文件名以 .pem / .key 结尾（app.pem、x.key、server.key 等）
  /(?:^|[;\s&|])(?:cat|type|more|less|head|tail|print|Get-Content|Copy-Item|cp|scp|curl|wget|Invoke-WebRequest|xcopy|robocopy)[^\n]*\.(?:pem|key)\b/i,
  // 环境变量泄漏（Windows $env: / Unix $VAR）
  // 2026-08-17 审查修复：`[A-Za-z_]+` 贪婪会吃掉变量名导致 `$TOKEN` 漏报（+ 后必须跟
  // KEY/TOKEN 等后缀且边界在末尾），且 `$env:` 冒号不匹配——改为 `[A-Za-z_]*` 允许
  // 变量名仅由敏感后缀组成，并补 `env:` 前缀分支。
  /(?:^|[;\s&|])(?:echo|print|Write-Output|env|printenv|Get-Content)[^\n]*\$(?:env:)?[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b/i,
  // 列出敏感目录
  /(?:^|[;\s&|])(?:dir|ls|find|Get-ChildItem|tree)[^\n]*(?:[\s./\\]|^)\.(?:ssh|aws|gnupg)\b/i,
];

function isSensitiveAccess(command) {
  const segments = segmentCommand(stripQuotes(command));
  return segments.some((seg) => SENSITIVE_PATH_PATTERNS.some((re) => re.test(seg)));
}

/** 剥离引号后检测（2026-08-15 修复：cat ".env" 等引号包裹敏感路径此前漏检） */
function stripQuotes(s) {
  return String(s || '').replace(/["']/g, '');
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
  const cmd = stripQuotes(command);
  // 跨管道"下载即执行"必须在整条命令级检测（分段会拆掉管道关系）
  if (PIPE_EXEC_PATTERNS.some((re) => re.test(cmd))) return true;
  const segments = segmentCommand(cmd);
  if (segments.some((seg) => DANGEROUS_PATTERNS.some((re) => re.test(seg)))) return true;
  // 2026-08-18 外部审查修复：递归列目录 + 删除类命令的管道/链式组合——
  // 各段单独看都不危险（Remove-Item 无 -recurse/-force 旗标），组合后等于递归删除。
  if (hasRecursiveDeletePipe(segments)) return true;
  return false;
}

/** 递归列出段（find 默认递归；gci/dir/ls 需递归旗标） */
function isRecursiveListSeg(seg) {
  if (/\bfind\b/i.test(seg)) return true;
  if (/\b(?:get-childitem|gci)\b[^\n]*(?:-r\b|-recurse\b)/i.test(seg)) return true;
  if (/\b(?:dir|ls)\b[^\n]*\/(?:[a-z]*s\b)/i.test(seg)) return true; // dir /s
  if (/\bls\b[^\n]*-R\b/i.test(seg)) return true; // ls -R
  return false;
}

/** 删除类命令段 */
function isDeleteSeg(seg) {
  return /\b(?:remove-item|rm|del|erase|rd|rmdir|unlink)\b/i.test(seg);
}

/** 递归列目录段后接删除类段 = 递归删除（2026-08-18 外部审查绕过样本修复） */
function hasRecursiveDeletePipe(segments) {
  let sawRecurseList = false;
  for (const seg of segments) {
    if (isRecursiveListSeg(seg)) sawRecurseList = true;
    if (sawRecurseList && isDeleteSeg(seg)) return true;
  }
  return false;
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
    description: '在沙箱工作区内执行 shell 命令（Windows 环境为 cmd.exe，Unix 环境为 /bin/sh）。Windows 下没有 pwd/ls/cat/rm/cp/mv 等 Unix 命令：当前目录用 cd（不带参数），列目录用 dir，查看文件用 type，删除用 del，复制用 copy，移动用 move。危险命令（删除、格式化、系统级操作）需要审批。',
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

      // 2026-08-18 长驻终端：background=true 托管为后台任务，立即返回
      if (args.background === true) {
        try {
          const job = startJob(ctx.session?.id, command, path.resolve(workspaceRoot), ctx.env || {});
          return {
            output: `[后台任务已启动] id=${job.id} pid=${job.pid}\n命令: ${command}\n用 process_read 读取输出、process_kill 终止、process_list 查看全部任务。`,
            isError: false,
            backgroundId: job.id,
          };
        } catch (e) {
          return { output: `错误: ${e.message}`, isError: true };
        }
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
        let detached = false;
        const timer = setTimeout(() => {
          timedOut = true;
          // 2026-08-18 长驻终端：超时不再杀进程，自动转后台（dev server 类长驻进程不丢失）
          let jobId = null;
          try {
            const job = detachJob(ctx.session?.id, command, child, out);
            jobId = job.id;
            detached = true;
          } catch (e) {
            killTree(child);
          }
          resolve({
            output: `${out}\n[命令超过 ${timeoutMs}ms${jobId ? `，已转后台任务 ${jobId}——进程继续运行，用 process_read ${jobId} 读取后续输出` : '，进程表满已终止'}]`,
            isError: false,
            backgroundId: jobId,
          });
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
          if (detached) return; // 已转后台任务，由进程表接管
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
