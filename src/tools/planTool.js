/**
 * plan 工具（P1-③ 差距分析第二批）：
 * 大任务先规划——模型提交 markdown 执行计划，挂起等待用户批准后才继续执行。
 * 实际挂起逻辑在 engine（复用 pendingQuestion 通道），本文件只提供工具定义。
 * 用户可：批准执行 / 要求修改（模型按反馈更新计划） / 取消。
 */
export function createPlanTool() {
  return {
    name: 'plan',
    description:
      '提交执行计划并等待用户批准。适合大任务（项目审查、重构、多文件实现）：动手前把步骤写成 markdown 计划提交，用户批准后才继续；用户要求修改时按反馈调整计划再提交。小任务不要用。',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: '执行计划（markdown 分步骤：目标/检查项/实施步骤/验证方式）' },
        title: { type: 'string', description: '计划标题（简短，如"重构登录模块计划"）' },
      },
      required: ['plan'],
    },
    execute: async () => ({ output: '计划已提交，等待用户批准。', isError: false }),
  };
}
