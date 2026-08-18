/**
 * 工具注册表：统一管理工具定义与描述。
 */
import { createFileTools } from './fileTools.js';
import { createShellTool } from './shellTool.js';
import { createWorldStateTool } from './worldStateTool.js';
import { createRunTestsTool } from './runTestsTool.js';
import { createReviewChangesTool } from './reviewChangesTool.js';
import { createAgentTools } from './agentTools.js';
import { createAskUserTool } from './askUserTool.js';
import { createSearchTools } from './searchTools.js';
import { createGitTools } from './gitTools.js';
import { createProcessTools } from './processTools.js';
import { createPlanTool } from './planTool.js';
import { createRunLintTool } from './lintTools.js';
import { createBrowserTools } from './browserTools.js';
import { createImageTools } from './imageTools.js';
import { createSymbolTools } from './symbolTools.js';
import { createMcpTools } from './mcpTools.js';

export function createToolRegistry(toolDefs) {
  const map = new Map();
  for (const t of toolDefs) {
    if (t && t.name) map.set(t.name, t);
  }
  return {
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    list: () => [...map.keys()],
    descriptions: () =>
      [...map.values()].map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {}, required: [] },
      })),
  };
}

export function createCodeTools(workspaceRoot) {
  const fileTools = createFileTools(workspaceRoot);
  const shellTool = createShellTool(workspaceRoot);
  const runTests = createRunTestsTool(workspaceRoot, shellTool);
  const reviewChanges = createReviewChangesTool();
  const searchTools = createSearchTools(workspaceRoot);
  const gitTools = createGitTools(workspaceRoot);
  const processTools = createProcessTools();
  const lintTool = createRunLintTool(workspaceRoot);
  const browserTools = createBrowserTools();
  const imageTools = createImageTools(workspaceRoot);
  const symbolTools = createSymbolTools(workspaceRoot);
  const defs = [
    fileTools.list_dir,
    fileTools.read_file,
    fileTools.write_file,
    fileTools.edit_file,
    shellTool,
    runTests,
    lintTool,
    reviewChanges,
    // 2026-08-18 浏览器工具（P2-⑤ 前端 dev server 验证）
    browserTools.browser_open,
    browserTools.browser_screenshot,
    // 2026-08-18 图像多模态（P2-⑥）
    imageTools.read_image,
    // 2026-08-18 语义索引（P2-⑧ 符号导航）
    symbolTools.find_symbol,
    // 2026-08-18 检索类工具（参考主流 agent 工具面补足开发高频能力）
    searchTools.glob,
    searchTools.grep,
    searchTools.web_fetch,
    // 2026-08-18 Git 工具集（P0-① 差距分析第一批）
    gitTools.git_status,
    gitTools.git_diff,
    gitTools.git_log,
    gitTools.git_commit,
    gitTools.git_checkout,
    // 2026-08-18 长驻终端（P0-② 差距分析第一批）
    processTools.process_read,
    processTools.process_kill,
    processTools.process_list,
  ];
  return createToolRegistry(defs);
}

/**
 * 全量工具注册表：Code 工具 + 世界状态工具 + 子代理工具 + 插件工具。
 * 暴露给模型哪些工具由各 harness 的 tools 列表决定，注册表本身包含全部实现。
 */
export function createAllTools(workspaceRoot, extraTools = []) {
  const code = createCodeTools(workspaceRoot);
  const world = createWorldStateTool();
  const agents = createAgentTools();
  const mcp = createMcpTools();
  return createToolRegistry([
    ...code.list().map((name) => code.get(name)),
    world,
    agents.spawn_agent,
    createAskUserTool(),
    createPlanTool(),
    // 2026-08-18 MCP 协议（P2-⑦，全 harness 可用）
    mcp.mcp_list_tools,
    mcp.mcp_call,
    ...extraTools,
  ]);
}
