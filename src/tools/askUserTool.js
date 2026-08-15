/**
 * ask_user 工具（DSH ask-user 借鉴，2026-08-15）：
 * 模型中途向用户提出结构化问题并阻塞等待回答（必要时给选项）。
 * 实际挂起/回答逻辑在 engine（pendingQuestion + resume），本文件只提供
 * 工具定义供模型可见；execute 为占位（正常路径 engine 拦截，不会执行到）。
 */
export function createAskUserTool() {
  return {
    name: 'ask_user',
    description:
      '向用户提出一个问题并等待回答（可提供选项）。当你需要用户决策（选方案/确认关键信息/选择方向）时使用，不要把它写进正文干等。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问的问题（简洁明确）' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '可选答案列表（最多 8 个），用户可点选或自行输入',
        },
      },
      required: ['question'],
    },
    execute: async () => ({ output: '已向用户提问，等待回答。', isError: false }),
  };
}
