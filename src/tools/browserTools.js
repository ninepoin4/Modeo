/**
 * 浏览器工具（P2-⑤ 差距分析第三批）：
 * - browser_open：用默认浏览器打开本地页面（前端 dev server 验证）
 * - browser_screenshot：Electron 无头截图本地页面为 PNG（配合 read_image 查看）
 * 安全：URL 白名单仅 localhost/127.0.0.1 的 http(s)，防 SSRF。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function wrap(fn) {
  return async (args = {}) => {
    try {
      return await fn(args);
    } catch (err) {
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

/** 仅允许本地 http(s) URL（dev server 验证场景），防 SSRF */
export function assertLocalWebUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('仅支持 http(s):// URL（如 http://localhost:5173）');
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`URL 不合法: ${url}`);
  }
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (!(h === 'localhost' || h === '127.0.0.1' || h === '::1')) {
    throw new Error(`仅支持本地地址（localhost/127.0.0.1），拒绝访问 ${h}`);
  }
  if (!/^\d+$/.test(u.port || '80') || Number(u.port) > 65535) throw new Error('端口不合法');
  return url;
}

function findElectron() {
  if (process.env.MODEO_ELECTRON) return process.env.MODEO_ELECTRON;
  const dev = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(dev)) return dev;
  // 打包环境：win-unpacked 与 resources 同级
  const pkg = path.join(ROOT, '..', 'Modeo.exe');
  if (fs.existsSync(pkg)) return pkg;
  return null;
}

export function createBrowserTools() {
  return {
    browser_open: tool(
      'browser_open',
      '用系统默认浏览器打开本地网页（前端 dev server 验证用，仅允许 localhost/127.0.0.1）。',
      {
        type: 'object',
        properties: { url: { type: 'string', description: '本地 URL，如 http://localhost:5173' } },
        required: ['url'],
        additionalProperties: false,
      },
      async ({ url }) => {
        const safe = assertLocalWebUrl(String(url || '').trim());
        if (process.platform === 'win32') {
          spawn('cmd.exe', ['/c', 'start', '', safe], { windowsHide: true, detached: true }).unref();
        } else {
          spawn('xdg-open', [safe], { detached: true }).unref();
        }
        return { output: `已在默认浏览器打开 ${safe}`, isError: false };
      }
    ),

    browser_screenshot: tool(
      'browser_screenshot',
      '用 Electron 无头模式截取本地网页为 PNG（1280x800），返回图片路径（可配合 read_image 查看）。需要开发环境有 Electron 或打包版可用。',
      {
        type: 'object',
        properties: {
          url: { type: 'string', description: '本地 URL，如 http://localhost:5173' },
          waitMs: { type: 'number', description: '加载后等待毫秒数（默认 1200，页面有动画可加大）' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async ({ url, waitMs }) => {
        const safe = assertLocalWebUrl(String(url || '').trim());
        const electron = findElectron();
        if (!electron) {
          return { output: '未找到 Electron（开发：modeo/desktop/node_modules/electron；打包版自动探测）。仅 browser_open 可用。', isError: true };
        }
        const shotScript = path.join(ROOT, 'src', 'tools', 'browser-shot.cjs');
        const out = path.join(os.tmpdir(), `modeo-shot-${Date.now()}.png`);
        const wait = Math.max(200, Math.min(15000, Number(waitMs) || 1200));
        const code = await new Promise((resolve) => {
          const child = spawn(electron, [shotScript, safe, out, String(wait)], { windowsHide: true });
          let err = '';
          child.stderr.on('data', (d) => (err += d.toString()));
          child.on('error', (e) => resolve({ err: e.message }));
          child.on('close', (c) => resolve({ code: c, err }));
        });
        if (code.code !== 0 || !fs.existsSync(out)) {
          return { output: `截图失败: ${(code.err || '').slice(0, 300) || '未知错误'}`, isError: true };
        }
        const size = fs.statSync(out).size;
        return { output: `截图已保存: ${out}（${(size / 1024).toFixed(0)}KB，1280x800）\n用 read_image 工具查看图片内容。`, isError: false, imagePath: out };
      }
    ),
  };
}
