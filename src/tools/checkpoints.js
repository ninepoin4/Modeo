/**
 * 工作区快照（undo/checkpoint）：在变更前保存工作区状态，可恢复。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const MAX_PER_SESSION = 20;
/** 单会话快照总大小上限（超过则从最旧开始删除） */
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

function getDataDir() {
  return process.env.MODEO_DATA_DIR ? path.resolve(process.env.MODEO_DATA_DIR) : path.join(ROOT, 'data');
}

function getWorkspacesRoot() {
  return process.env.MODEO_WORKSPACES_ROOT ? path.resolve(process.env.MODEO_WORKSPACES_ROOT) : path.join(ROOT, 'workspaces');
}

function sessionDir(sessionId) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(sessionId))) throw new Error('会话 id 非法');
  return path.join(getDataDir(), 'checkpoints', sessionId);
}

/** 会话快照目录（供其他模块定位基线） */
export function getCheckpointDir(sessionId) {
  return sessionDir(sessionId);
}

function checkpointPath(sessionId, checkpointId) {
  const dir = sessionDir(sessionId);
  const target = path.resolve(dir, String(checkpointId));
  // 分隔符边界：防止 /checkpoints/<a>/../<b> 或前缀同名目录穿越
  if (target !== dir && !target.startsWith(dir + path.sep)) throw new Error('快照 id 非法');
  return target;
}

function baselineDir(sessionId) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(sessionId))) throw new Error('会话 id 非法');
  return path.join(getDataDir(), 'baselines', sessionId);
}

function prune(sessionId) {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of entries.slice(MAX_PER_SESSION)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  // 大小上限：从最旧开始删，直到低于阈值（至少保留一个）
  // entries 为降序（最新在前），remaining 尾部即最旧
  const remaining = entries.slice(0, Math.min(MAX_PER_SESSION, entries.length));
  while (dirSize(dir) > MAX_TOTAL_BYTES && remaining.length > 1) {
    const oldest = remaining.pop();
    if (!oldest) break;
    fs.rmSync(path.join(dir, oldest), { recursive: true, force: true });
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n++;
  }
  return n;
}

/**
 * 保存当前工作区快照。
 * @returns {{id:string, label:string, createdAt:string, fileCount:number}}
 */
export function createCheckpoint({ sessionId, workspaceRoot, label = '自动快照' }) {
  if (!fs.existsSync(workspaceRoot)) throw new Error('工作区不存在');
  const dir = sessionDir(sessionId);
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const target = path.join(dir, id);
  fs.mkdirSync(target, { recursive: true });
  // 复制工作区全部文件（保留目录结构）
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    fs.cpSync(path.join(workspaceRoot, entry.name), path.join(target, entry.name), { recursive: true });
  }
  prune(sessionId);
  return {
    id,
    label,
    createdAt: new Date().toISOString(),
    fileCount: countFiles(target),
  };
}

export function listCheckpoints(sessionId) {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const meta = path.join(dir, e.name, '.meta.json');
      let label = '快照';
      let createdAt = '';
      try {
        const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
        label = m.label || label;
        createdAt = m.createdAt || '';
      } catch {
        /* ignore */
      }
      return { id: e.name, label, createdAt, fileCount: countFiles(path.join(dir, e.name)) };
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** 判断工作区是否允许被快照恢复清空/还原（防误删任意目录） */
function isAllowedWorkspace(workspaceRoot) {
  const resolved = path.resolve(String(workspaceRoot || ''));
  // 标准情况：必须是 workspaces 根目录下的子目录（根自身不允许——避免清空全部子工作区）
  const wsRoot = path.resolve(getWorkspacesRoot());
  if (resolved.startsWith(wsRoot + path.sep)) return true;
  // 自定义工作区（MODEO_WORKSPACE_DIR）：允许精确等于它
  if (process.env.MODEO_WORKSPACE_DIR && resolved === path.resolve(process.env.MODEO_WORKSPACE_DIR)) return true;
  return false;
}

/**
 * 恢复指定快照：清空工作区并还原快照内容。
 * @returns {{restoredFiles:number}}
 */
export function restoreCheckpoint({ sessionId, checkpointId, workspaceRoot }) {
  // 安全约束：只允许清空项目 workspaces 下（或自定义工作区目录）的工作区
  if (!isAllowedWorkspace(workspaceRoot)) throw new Error('工作区路径非法');
  const src = checkpointPath(sessionId, checkpointId);
  if (!fs.existsSync(src)) throw new Error('快照不存在');
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.meta.json') continue;
    fs.cpSync(path.join(src, entry.name), path.join(workspaceRoot, entry.name), { recursive: true });
  }
  return { restoredFiles: countFiles(workspaceRoot) };
}

/**
 * 为快照补写元数据（标签/时间）。
 */
export function writeCheckpointMeta(sessionId, checkpointId, meta) {
  const target = checkpointPath(sessionId, checkpointId);
  if (!fs.existsSync(target)) throw new Error('快照不存在');
  fs.writeFileSync(path.join(target, '.meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * 会话基线：Code 模式首次使用工作区时的状态，用于 diff 审查。
 * 已存在则跳过；不存在则复制工作区当前内容。
 * @returns {{created:boolean, fileCount:number, dir:string}}
 */
export function ensureBaseline(sessionId, workspaceRoot) {
  if (!fs.existsSync(workspaceRoot)) throw new Error('工作区不存在');
  const dir = baselineDir(sessionId);
  if (fs.existsSync(dir)) {
    return { created: false, fileCount: countFiles(dir), dir };
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    fs.cpSync(path.join(workspaceRoot, entry.name), path.join(dir, entry.name), { recursive: true });
  }
  return { created: true, fileCount: countFiles(dir), dir };
}

/**
 * 获取会话基线目录；不存在则返回 null。
 */
export function getBaselineDir(sessionId) {
  const dir = baselineDir(sessionId);
  return fs.existsSync(dir) ? dir : null;
}
