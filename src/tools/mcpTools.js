/**
 * MCP 工具（P2-⑦ 差距分析第三批）：mcp_list_tools / mcp_call。
 * MCP 服务器配置来自 settings.mcpServers：[{ id, name, command, args, url, headers }]
 * 设置页「MCP 服务器」JSON 区编辑，或直接写 settings.json。
 */
import { getMcpClient, McpError } from './mcpClient.js';

function wrap(fn) {
  return async (args = {}, ctx = {}) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      if (err instanceof McpError) return { output: `MCP 错误: ${err.message}`, isError: true };
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

function findServer(servers, id) {
  const list = Array.isArray(servers) ? servers : [];
  const s = list.find((x) => x.id === id && x.enabled !== false);
  if (!s) {
    const ids = list.map((x) => x.id).join(', ');
    throw new McpError(`MCP 服务器 ${id} 未配置或未启用${ids ? `（已配置：${ids}）` : '（settings.mcpServers 为空，请在设置页配置）'}`);
  }
  return s;
}

export function createMcpTools() {
  return {
    mcp_list_tools: tool(
      'mcp_list_tools',
      '列出指定 MCP 服务器提供的工具。服务器需先在设置页「MCP 服务器」配置（stdio 用 command+args，HTTP 用 url）。',
      {
        type: 'object',
        properties: { serverId: { type: 'string', description: 'MCP 服务器 id（settings.mcpServers 中配置）' } },
        required: ['serverId'],
        additionalProperties: false,
      },
      async ({ serverId }, ctx = {}) => {
        const s = findServer(ctx.settings?.mcpServers, serverId);
        const c = await getMcpClient(s);
        const tools = await c.listTools();
        if (!tools.length) return { output: `服务器 ${serverId} 无工具`, isError: false };
        return {
          output: `MCP 服务器 ${serverId}（${tools.length} 个工具）：\n${tools.map((t) => `- ${t.name}: ${(t.description || '').slice(0, 120)}`).join('\n')}`,
          isError: false,
        };
      }
    ),

    mcp_call: tool(
      'mcp_call',
      '调用 MCP 服务器的工具。先 mcp_list_tools 查看可用工具与用途，再用正确的参数调用。',
      {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'MCP 服务器 id' },
          tool: { type: 'string', description: '工具名' },
          args: { type: 'object', description: '工具参数（JSON 对象）' },
        },
        required: ['serverId', 'tool'],
        additionalProperties: false,
      },
      async ({ serverId, tool: toolName, args }, ctx = {}) => {
        const s = findServer(ctx.settings?.mcpServers, serverId);
        const c = await getMcpClient(s);
        const r = await c.callTool(toolName, args || {});
        // 输出截断：MCP 结果可能极大，撑爆上下文（2026-08-18 审查修复）
        const MAX = 32 * 1024;
        let out = r.text.length > MAX ? r.text.slice(0, MAX) + `\n…(输出 ${r.text.length} 字符，已截断到 ${MAX})` : r.text;
        if (r.structured && typeof r.structured === 'object') {
          const j = JSON.stringify(r.structured, null, 2);
          out += `\n\n结构化结果:\n${j.slice(0, 3000)}`;
        }
        return { output: out, isError: !!r.isError };
      }
    ),
  };
}
