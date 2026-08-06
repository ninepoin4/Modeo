/**
 * 沙箱路径安全：所有文件操作必须限定在工作区内。
 */
import fs from 'node:fs';
import path from 'node:path';

export class SandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SandboxError';
  }
}

function normalize(root) {
  return path.resolve(root);
}

function isWithin(root, target) {
  const r = normalize(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  if (rel === '') return true;
  const win = process.platform === 'win32';
  if (win) {
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }
  return !rel.startsWith('..') && rel !== '..';
}

/**
 * 将请求路径安全解析为工作区内的绝对路径。
 * 任何越界（..、绝对路径指向根外、符号链接逃逸）都抛 SandboxError。
 */
export function resolveSafePath(workspaceRoot, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw new SandboxError('路径不能为空');
  }
  const root = normalize(workspaceRoot);
  const target = path.resolve(root, requestedPath);
  if (!isWithin(root, target)) {
    throw new SandboxError(`路径越界被拒绝: ${requestedPath}`);
  }
  // 符号链接逃逸检测：对已存在的路径做 realpath 校验
  let real = null;
  let probe = target;
  const chain = [];
  while (true) {
    try {
      real = fs.realpathSync(probe);
      break;
    } catch {
      // 目标或部分路径不存在：沿父目录探测
      const parent = path.dirname(probe);
      if (parent === probe) break;
      chain.unshift(path.basename(probe));
      probe = parent;
    }
  }
  if (real && !isWithin(root, real)) {
    throw new SandboxError(`符号链接指向工作区外，已被拒绝: ${requestedPath}`);
  }
  // 若探测到了父目录，把未存在部分拼回去再确认一次
  if (chain.length && real) {
    const reconstructed = path.join(real, ...chain);
    if (!isWithin(root, reconstructed)) {
      throw new SandboxError(`路径越界被拒绝: ${requestedPath}`);
    }
  }
  return target;
}

export { isWithin };
