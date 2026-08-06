/**
 * 自动跑测试工具：探测项目测试入口并在工作区内执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createShellTool } from './shellTool.js';

/**
 * 探测测试命令。返回 { type:'node'|'shell', command?, label } 或 null。
 */
export function detectTestCommand(workspaceRoot) {
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const scripts = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts || {};
      if (scripts.test) return { type: 'shell', command: 'npm test', label: 'npm test（package.json scripts.test）' };
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

function runNodeTests(workspaceRoot, timeoutMs) {
  return new Promise((resolve) => {
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
      const result =
        detected.type === 'node'
          ? await runNodeTests(workspaceRoot, 90000)
          : await shell.execute(
              { command: detected.command, timeoutMs: 90000 },
              { ...ctx, forceApproved: true }
            );
      return {
        output: `测试命令：${detected.label}\n${result.output}`,
        isError: result.isError,
        needsApproval: false,
      };
    },
  };
}
