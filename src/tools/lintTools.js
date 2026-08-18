/**
 * run_lint 工具（P1-④ 差距分析第二批）：自动探测并运行 lint（npm run lint / eslint）。
 * 与 run_tests 同构：危险脚本审批、工作区限定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createShellTool, isDangerous } from './shellTool.js';
import { isRiskyTestScript } from './runTestsTool.js';

/** 探测 lint 命令；返回 { type:'shell', command, label, script? } 或 null */
export function detectLintCommand(workspaceRoot) {
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const scripts = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts || {};
      if (scripts.lint) {
        return {
          type: 'shell',
          command: 'npm run lint',
          label: 'npm run lint（package.json scripts.lint）',
          script: String(scripts.lint),
        };
      }
    } catch {
      /* 继续探测 */
    }
  }
  const bin = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
  if (fs.existsSync(bin)) {
    return { type: 'shell', command: 'eslint .', label: 'eslint .（node_modules/.bin/eslint）' };
  }
  return null;
}

export function createRunLintTool(workspaceRoot, shellTool) {
  const shell = shellTool || createShellTool(workspaceRoot);
  return {
    name: 'run_lint',
    description: '自动探测并运行代码检查（npm run lint / eslint .），在工作区内执行，返回检查结果。没有 lint 配置时提示。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute(args = {}, ctx = {}) {
      const detected = detectLintCommand(workspaceRoot);
      if (!detected) {
        return {
          output: '未检测到 lint 入口（支持 package.json scripts.lint、node_modules/.bin/eslint）',
          isError: true,
        };
      }
      // 危险脚本审批（与 run_tests 同构）
      if (detected.script && isRiskyTestScript(detected.script)) {
        if (!ctx.forceApproved && !ctx.aggressive) {
          return {
            output: `[危险 lint 脚本，等待审批] npm run lint 将执行：${detected.script}`,
            isError: false,
            needsApproval: true,
            approvalReason: `npm run lint 将执行危险命令：${detected.script}`,
          };
        }
      }
      const result = await shell.execute(
        { command: detected.command, timeoutMs: 90000 },
        { ...ctx, forceApproved: ctx.forceApproved === true }
      );
      return {
        output: `lint 命令：${detected.label}\n${result.output}${result.isError ? '\n\n⚠ 检查发现问题——请修复后重新运行 run_lint 确认通过。' : ''}`,
        isError: result.isError,
        needsApproval: false,
      };
    },
  };
}

export { isDangerous };
