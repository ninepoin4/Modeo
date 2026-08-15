/**
 * 工具执行统一裁决（DSH tool-call-timeout 借鉴，2026-08-15）：
 * 工具对象可声明 timeoutMs（默认 120s），超时返回结构化 TOOL_TIMEOUT 结果，
 * 不抛异常不卡死主循环。shell 工具内部已有 killTree 超时，此包装器兜底其他工具
 * （插件/网络工具挂起时结果被丢弃，引擎继续，不占会话锁）。
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 120000;

export function withToolTimeout(toolName, promise, timeoutMs = DEFAULT_TOOL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        output: `工具超时（>${Math.round(timeoutMs / 1000)}s）：${toolName}`,
        isError: true,
        timedOut: true,
      });
    }, timeoutMs);
    Promise.resolve(promise)
      .then((r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ output: `工具执行异常: ${e.message || String(e)}`, isError: true });
      });
  });
}
