/**
 * 后台任务管理器（长驻终端，P0-② 差距分析第一批）。
 *
 * - 模块级单例：进程表跨工具重建/引擎轮次持久
 * - 按 sessionId 分组，每会话上限 8 个活跃任务
 * - 输出环形缓冲 128KB（防长驻进程输出撑爆内存/上下文）
 * - 提供 start/read/kill/list/cleanupSession
 */
import { spawn } from 'node:child_process';

const jobs = new Map();
let seq = 0;
const MAX_OUT = 128 * 1024;
const MAX_JOBS_PER_SESSION = 8;
const MAX_CMD_SHOW = 120;

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

function pushOut(job, chunk) {
  job.out += chunk;
  if (job.out.length > MAX_OUT) job.out = job.out.slice(job.out.length - MAX_OUT);
}

/** 启动后台任务；返回 job 对象；同会话活跃任务超限抛错 */
export function startJob(sessionId, command, cwd, env = {}) {
  const sid = sessionId || 'global';
  const active = [...jobs.values()].filter((j) => j.sessionId === sid && !j.done);
  if (active.length >= MAX_JOBS_PER_SESSION) {
    throw new Error(`会话后台任务已达上限 ${MAX_JOBS_PER_SESSION} 个，请先用 process_kill 清理`);
  }
  const id = `${sid}:${++seq}`;
  const job = {
    id,
    sessionId: sid,
    command,
    pid: null,
    child: null,
    out: '',
    done: false,
    exitCode: null,
    startTime: Date.now(),
  };
  const opts = {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], opts)
    : spawn('/bin/sh', ['-c', command], opts);
  job.child = child;
  job.pid = child.pid;
  child.stdout?.on('data', (d) => pushOut(job, d.toString()));
  child.stderr?.on('data', (d) => pushOut(job, d.toString()));
  child.on('error', (e) => pushOut(job, `[进程错误] ${e.message}\n`));
  child.on('exit', (code) => {
    job.done = true;
    job.exitCode = code;
  });
  jobs.set(id, job);
  return job;
}

/** 前台命令超时转后台：把已运行的 child 注册进进程表（不再新建进程） */
export function detachJob(sessionId, command, child, initialOut) {
  const sid = sessionId || 'global';
  const active = [...jobs.values()].filter((j) => j.sessionId === sid && !j.done);
  if (active.length >= MAX_JOBS_PER_SESSION) {
    throw new Error(`会话后台任务已达上限 ${MAX_JOBS_PER_SESSION} 个，请先用 process_kill 清理`);
  }
  const id = `${sid}:${++seq}`;
  const job = {
    id,
    sessionId: sid,
    command,
    pid: child.pid,
    child,
    out: initialOut || '',
    done: false,
    exitCode: null,
    startTime: Date.now(),
  };
  child.stdout?.on('data', (d) => pushOut(job, d.toString()));
  child.stderr?.on('data', (d) => pushOut(job, d.toString()));
  child.on('error', (e) => pushOut(job, `[进程错误] ${e.message}\n`));
  child.on('exit', (code) => {
    job.done = true;
    job.exitCode = code;
  });
  jobs.set(id, job);
  return job;
}

/** 读取任务状态与累计输出；不存在返回 null */
export function readJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return {
    id: job.id,
    command: job.command,
    running: !job.done,
    exitCode: job.exitCode,
    output: job.out,
  };
}

/** 终止任务；返回 { found, killed } */
export function killJob(id) {
  const job = jobs.get(id);
  if (!job) return { found: false };
  if (!job.done) killTree(job.child);
  return { found: true, killed: !job.done };
}

/** 列出某会话全部任务（含已结束） */
export function listJobs(sessionId) {
  const sid = sessionId || 'global';
  return [...jobs.values()]
    .filter((j) => j.sessionId === sid)
    .map((j) => ({
      id: j.id,
      command: j.command.length > MAX_CMD_SHOW ? j.command.slice(0, MAX_CMD_SHOW) + '…' : j.command,
      running: !j.done,
      exitCode: j.exitCode,
      started: new Date(j.startTime).toLocaleTimeString('zh-CN', { hour12: false }),
    }));
}

/** 会话清理（删除会话/关闭应用时调用）：杀掉该会话全部存活任务并清空记录 */
export function cleanupSession(sessionId) {
  const sid = sessionId || 'global';
  for (const j of jobs.values()) {
    if (j.sessionId === sid) {
      if (!j.done) killTree(j.child);
      jobs.delete(j.id);
    }
  }
}
