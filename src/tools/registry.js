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
  const defs = [
    fileTools.list_dir,
    fileTools.read_file,
    fileTools.write_file,
    fileTools.edit_file,
    shellTool,
    runTests,
    reviewChanges,
    // 2026-08-18 检索类工具（参考主流 agent 工具面补足开发高频能力）
    searchTools.glob,
    searchTools.grep,
    searchTools.web_fetch,
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
  return createToolRegistry([
    ...code.list().map((name) => code.get(name)),
    world,
    agents.spawn_agent,
    createAskUserTool(),
    ...extraTools,
  ]);
}
