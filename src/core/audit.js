/**
 * 工具执行审计钩子（P0-2 工具管道 post 钩子的默认消费者）。
 * 每次工具执行落一条 append-only 审计日志到 data/audit.log，
 * 供安全审查/排障使用（与 SSE 事件日志用途互补：这里只记工具副作用）。
 */
import fs from 'node:fs';
import path from 'node:path';

export function createAuditHooks(dataDir) {
  const file = path.join(dataDir, 'audit.log');
  const post = [
    async (ctx, tc, result) => {
      try {
        const line = JSON.stringify({
          ts: new Date().toISOString(),
          session: ctx?.session?.id || null,
          tool: tc?.name,
          args: tc?.args,
          isError: !!result?.isError,
          output: typeof result?.output === 'string' ? result.output.slice(0, 500) : undefined,
        });
        fs.mkdirSync(dataDir, { recursive: true });
        fs.appendFileSync(file, `${line}\n`, 'utf8');
      } catch {
        // 审计失败不影响工具执行
      }
      return null;
    },
  ];
  return { pre: [], post };
}
