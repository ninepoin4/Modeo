/**
 * 后台任务管理工具：process_read / process_kill / process_list。
 * 与 shell 工具的 background=true、超时自动转后台共用同一个进程表。
 */
import { readJob, killJob, listJobs } from './processManager.js';

function wrap(fn) {
  return async (args = {}) => {
    try {
      return await fn(args);
    } catch (err) {
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

export function createProcessTools() {
  return {
    process_read: tool(
      'process_read',
      '读取后台任务输出（shell background=true 或超时自动转后台的任务）。返回累计输出与运行状态；任务结束后返回最终输出。',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: '后台任务 id（如 chat:3，来自 shell 返回的 [后台任务已启动] 或 [已转后台任务]）' },
          since: { type: 'number', description: '可选：只返回新输出（字符位置，一般用不上）' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async ({ id }) => {
        const job = readJob(String(id || '').trim());
        if (!job) return { output: `后台任务不存在：${id}（用 process_list 查看当前会话任务）`, isError: true };
        const status = job.running ? '运行中' : `已结束(exit=${job.exitCode ?? '?'})`;
        // 输出截断：后台任务可能持续产出大量输出（2026-08-18 审查修复）
        const MAX = 32 * 1024;
        const shown = job.output.length > MAX ? job.output.slice(job.output.length - MAX) + `\n…(累计输出 ${job.output.length} 字符，仅显示最近 ${MAX})` : job.output;
        return { output: `[#${job.id}] ${status}\n命令: ${job.command}\n${shown || '（暂无输出）'}`, isError: false };
      }
    ),

    process_kill: tool(
      'process_kill',
      '终止后台任务（含其子进程树）。任务已结束则无操作。',
      {
        type: 'object',
        properties: { id: { type: 'string', description: '后台任务 id' } },
        required: ['id'],
        additionalProperties: false,
      },
      async ({ id }) => {
        const r = killJob(String(id || '').trim());
        if (!r.found) return { output: `后台任务不存在：${id}`, isError: true };
        return { output: r.killed ? `已终止后台任务 ${id}` : `任务 ${id} 已结束，无需终止`, isError: false };
      }
    ),

    process_list: tool(
      'process_list',
      '列出当前会话的全部后台任务（运行中 + 已结束）。',
      { type: 'object', properties: {}, additionalProperties: false },
      async (_a, ctx = {}) => {
        const list = listJobs(ctx.session?.id);
        if (!list.length) return { output: '当前会话没有后台任务。', isError: false };
        const lines = list.map((j) => `[${j.running ? '运行中' : '已结束'}] #${j.id} ${j.command} (${j.started}${j.exitCode != null ? `, exit=${j.exitCode}` : ''})`);
        return { output: lines.join('\n'), isError: false };
      }
    ),
  };
}
