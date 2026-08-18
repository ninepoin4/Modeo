/**
 * 图像工具（P2-⑥ 差距分析第三批）：read_image 读取工作区内图片为 base64。
 * 多模态模型可直接看图；文本模型看到的是 data URL（提示模型告知用户需多模态支持）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, SandboxError } from './sandbox.js';
import { isSensitiveAccess } from './shellTool.js';

const MAX_IMAGE = 4 * 1024 * 1024; // 4MB（base64 后约 5.3MB）
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function wrap(fn) {
  return async (args = {}, ctx = {}) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      if (err instanceof SandboxError) return { output: `SandboxError: ${err.message}`, isError: true };
      return { output: `错误: ${err.message || String(err)}`, isError: true };
    }
  };
}

function tool(name, description, parameters, fn) {
  return { name, description, parameters, execute: wrap(fn) };
}

export function createImageTools(workspaceRoot) {
  return {
    read_image: tool(
      'read_image',
      '读取工作区内的图片文件并转为 base64（PNG/JPG/GIF/WebP，≤4MB）。多模态模型可直接看图内容；若当前模型不支持视觉，会收到 data URL 文本。',
      {
        type: 'object',
        properties: { path: { type: 'string', description: '工作区内图片相对路径' } },
        required: ['path'],
        additionalProperties: false,
      },
      async ({ path: p } = {}, ctx = {}) => {
        if (!p) return { output: '错误: path 必填', isError: true };
        const abs = ctx?.aggressive && path.isAbsolute(p) ? path.resolve(p) : resolveSafePath(workspaceRoot, p);
        const ext = path.extname(abs).toLowerCase();
        if (!IMG_EXT.has(ext)) {
          return { output: `不支持的图片类型: ${ext || '无扩展名'}（支持 png/jpg/jpeg/gif/webp/bmp）`, isError: true };
        }
        if (!fs.existsSync(abs)) return { output: `文件不存在: ${p}`, isError: true };
        // 2026-08-18 二审修复：read_image 补敏感路径门禁（对齐 read_file/write_file/edit_file）——
        // 此前无 sensitiveCheck，可无审批读取 .env/.ssh 等
        if (!ctx?.aggressive && !ctx?.forceApproved) {
          const seg = `cat ${abs}`;
          if (isSensitiveAccess(seg)) {
            return {
              output: `[敏感路径访问，等待审批] 图片 ${p}`,
              isError: false,
              needsApproval: true,
              approvalReason: `read_image 将访问敏感路径（密钥/凭据/设置文件）：${p}`,
            };
          }
        }
        const stat = fs.statSync(abs);
        if (stat.size > MAX_IMAGE) {
          return { output: `图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > 4MB 上限）`, isError: true };
        }
        const buf = fs.readFileSync(abs);
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[ext];
        const b64 = buf.toString('base64');
        return {
          output: `图片 ${p}（${(stat.size / 1024).toFixed(0)}KB）已读取为 data URL：\ndata:${mime};base64,${b64}\n（多模态模型可识别图中内容；文本模型将看到以上编码）`,
          isError: false,
          image: `data:${mime};base64,${b64}`,
        };
      }
    ),
  };
}
