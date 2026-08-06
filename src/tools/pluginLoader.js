/**
 * 工具插件加载器：从 plugins/ 目录动态加载 ESM 插件（默认导出单个工具或工具数组）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} dir 插件目录
 * @returns {Promise<{tools: object[], loaded: object[]}>}
 */
export async function loadPlugins(dir) {
  const tools = [];
  const loaded = [];
  if (!fs.existsSync(dir)) return { tools, loaded };
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(mjs|js)$/i.test(f)) continue;
    const file = path.join(dir, f);
    try {
      // 带时间戳 cache-bust，支持热重载
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
      const exported = mod.default;
      const list = Array.isArray(exported) ? exported : exported ? [exported] : [];
      for (const t of list) {
        if (t && typeof t.name === 'string' && typeof t.execute === 'function') {
          tools.push({ source: f, ...t });
          loaded.push({ file: f, tool: t.name });
        } else {
          loaded.push({ file: f, error: `无效工具（缺 name 或 execute）` });
        }
      }
    } catch (err) {
      loaded.push({ file: f, error: err.message || String(err) });
    }
  }
  return { tools, loaded };
}
