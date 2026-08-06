/**
 * 示例插件：to_upper 工具。
 */
export default {
  name: 'to_upper',
  description: '把输入文本转为大写（插件示例）。',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args = {}) {
    return { output: String(args.text || '').toUpperCase(), isError: false };
  },
};
