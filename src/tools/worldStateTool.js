/**
 * 世界状态记忆工具：让模型在角色扮演/写作模式中持续更新会话级世界状态。
 * 世界状态作为数据保存在 session.worldState，并在每次组装系统提示词时注入，
 * 从而在长会话中保持事实一致性（不依赖模型上下文窗口）。
 */

function cleanValue(v) {
  return typeof v === 'string' ? v.trim() : v;
}

export function createWorldStateTool() {
  return {
    name: 'update_world_state',
    description:
      '更新当前会话的世界状态记忆（事实键值对，例如关键剧情进展、人物关系、时间地点等）。' +
      '使用 updates 批量更新，或使用 key/value 单条更新；value 不能为空。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '事实名，例如 "主角所在城市"' },
        value: { type: 'string', description: '事实内容，例如 "长安"' },
        updates: {
          type: 'object',
          description: '批量更新，例如 {"主角所在城市":"长安","当前时间":"黄昏"}',
          additionalProperties: { type: 'string' },
        },
      },
    },
    async execute(args = {}, ctx = {}) {
      const session = ctx.session;
      if (!session) {
        return { output: '错误: 缺少会话上下文，无法更新世界状态', isError: true };
      }
      const ws =
        session.worldState && typeof session.worldState === 'object' && !Array.isArray(session.worldState)
          ? { ...session.worldState }
          : {};

      let changed = 0;
      if (args.updates && typeof args.updates === 'object' && !Array.isArray(args.updates)) {
        for (const [k, v] of Object.entries(args.updates)) {
          const cleaned = cleanValue(v);
          if (!k.trim() || cleaned == null || String(cleaned).trim() === '') continue;
          ws[k.trim()] = String(cleaned).trim();
          changed++;
        }
      }
      if (
        typeof args.key === 'string' &&
        args.key.trim() &&
        typeof args.value === 'string' &&
        args.value.trim()
      ) {
        ws[args.key.trim()] = args.value.trim();
        changed++;
      }

      if (!changed) {
        return { output: '没有可更新的世界状态字段（key 与 value 均不能为空）', isError: true };
      }

      session.worldState = ws;
      if (typeof ctx.persist === 'function') ctx.persist(session);
      const lines = Object.entries(ws)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      return {
        output: `已更新世界状态 ${changed} 条（当前共 ${Object.keys(ws).length} 条）：\n${lines}`,
        isError: false,
      };
    },
  };
}
