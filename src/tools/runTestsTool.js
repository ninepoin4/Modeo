/**
 * 自动跑测试工具：探测项目测试入口并在工作区内执行。
 * 安全：npm test 的 scripts.test 内容先过危险检测，危险脚本必须走审批；
 * 探测结果支持注入 testScript 字段供检测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createShellTool, isDangerous } from './shellTool.js';

/**
 * test 脚本风险检测：isDangerous（rm/format 等）+ 间接执行任意脚本文件/编码绕过。
 * 仅用于 run_tests 的 scripts.test（该字段本就是任意命令入口），不污染全局 shell 审批。
 */
export function isRiskyTestScript(script) {
  if (isDangerous(script)) return true;
  return /(?:\bnode\s+(?!-)[\w./\\-]+\.js\b|\b(?:python|python3|bash|sh|powershell|pwsh|cmd)\s+[\w./\\-]+\.(?:py|ps1|sh|cmd|bat|exe)\b|powershell\s+-(?:enc|encodedcommand)\b|base64\s+-d\b|curl\s+[^\s]+\s*\|\s*(?:sh|bash)\b)/i.test(
    script
  );
}

/**
 * 探测测试命令。返回 { type:'node'|'shell', command?, label, testScript? } 或 null。
 */
export function detectTestCommand(workspaceRoot) {
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const scripts = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts || {};
      if (scripts.test) {
        return {
          type: 'shell',
          command: 'npm test',
          label: 'npm test（package.json scripts.test）',
          testScript: String(scripts.test),
        };
      }
    } catch {
      /* 解析失败则继续探测 */
    }
  }
  const testsDir = path.join(workspaceRoot, 'tests');
  if (fs.existsSync(testsDir) && fs.readdirSync(testsDir).some((f) => f.endsWith('.test.js'))) {
    return { type: 'node', label: 'node --test（tests/*.test.js）' };
  }
  if (
    fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(workspaceRoot, 'pytest.ini')) ||
    (fs.existsSync(testsDir) && fs.readdirSync(testsDir).some((f) => f.startsWith('test_') && f.endsWith('.py')))
  ) {
    return { type: 'shell', command: 'python -m pytest -q', label: 'pytest' };
  }
  return null;
}

function runNodeTests(workspaceRoot, timeoutMs) {  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // 避免被外层测试运行器误判为递归
    const child = spawn(process.execPath || 'node', ['--test'], {
      cwd: workspaceRoot,
      env,
      windowsHide: true,
    });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ output: `测试启动失败: ${err.message}`, isError: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ output: out || '（无输出）', exitCode: code, isError: timedOut || code !== 0 });
    });
  });
}

/**
 * @param {string} workspaceRoot
 * @param {{execute: Function}} [shellTool] 可注入，便于测试
 */
export function createRunTestsTool(workspaceRoot, shellTool) {
  const shell = shellTool || createShellTool(workspaceRoot);
  return {
    name: 'run_tests',
    description: '自动探测并运行项目测试（npm test / node --test / pytest），在工作区内执行，返回测试结果。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute(args = {}, ctx = {}) {
      const detected = detectTestCommand(workspaceRoot);
      if (!detected) {
        return {
          output: '未检测到测试入口（支持 package.json scripts.test、tests/*.test.js、pytest）',
          isError: true,
        };
      }
      // 安全闸门：npm test 的 scripts.test 是任意命令，命中危险/间接执行模式必须先审批
      // 无审批模式（aggressive）直接放行；已批准（forceApproved）也放行
      if (detected.type === 'shell' && detected.testScript && isRiskyTestScript(detected.testScript)) {
        if (!ctx.forceApproved && !ctx.aggressive) {
          return {
            output: `[危险测试脚本，等待审批] npm test 将执行：${detected.testScript}`,
            isError: false,
            needsApproval: true,
            approvalReason: `npm test 将执行危险命令：${detected.testScript}`,
          };
        }
      }
      // forceApproved 仅在用户批准后由引擎 resume 传入；此时才真正执行
      const result =
        detected.type === 'node'
          ? await runNodeTests(workspaceRoot, 90000)
          : await shell.execute(
              { command: detected.command, timeoutMs: 90000 },
              { ...ctx, forceApproved: ctx.forceApproved === true }
            );
      return {
        output: `测试命令：${detected.label}\n${result.output}`,
        isError: result.isError,
        needsApproval: false,
      };
    },
  };
}
