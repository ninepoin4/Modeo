/**
 * 示例插件：ping 工具。
 */
export default {
  name: 'ping',
  description: '返回 pong 与当前时间（插件示例）。',
  parameters: { type: 'object', properties: { echo: { type: 'string' } } },
  async execute(args = {}) {
    const echo = args.echo ? ` | echo: ${args.echo}` : '';
    return { output: `pong ${new Date().toISOString()}${echo}`, isError: false };
  },
};
