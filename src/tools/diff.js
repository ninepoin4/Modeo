/**
 * 工作区 diff 工具：纯 JS 行级 diff（零依赖）。
 * 用于 Code 模式的"改动审查"：对比当前工作区与会话基线，展示变更。
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXCLUDE = new Set(['node_modules', '.git', '.hg', '.svn']);

/**
 * 行级 diff（共同前缀/后缀裁剪 + LCS）。
 * @param {string[]} a 旧行数组
 * @param {string[]} b 新行数组
 * @returns {{type:'same'|'add'|'del', text:string}[]}
 */
export function diffLines(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  const pa = a.slice(p);
  const pb = b.slice(p);
  let s = 0;
  while (s < pa.length && s < pb.length && pa[pa.length - 1 - s] === pb[pb.length - 1 - s]) s++;
  const midA = pa.slice(0, pa.length - s);
  const midB = pb.slice(0, pb.length - s);

  let midOps;
  if (midA.length * midB.length > 4_000_000) {
    // 大差异回退：整体替换
    midOps = [
      ...midA.map((t) => ({ type: 'del', text: t })),
      ...midB.map((t) => ({ type: 'add', text: t })),
    ];
  } else {
    midOps = lcsOps(midA, midB);
  }

  const prefix = a.slice(0, p).map((t) => ({ type: 'same', text: t }));
  const suffix = b.slice(b.length - s).map((t) => ({ type: 'same', text: t }));
  return [...prefix, ...midOps, ...suffix];
}

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j] });
    j++;
  }
  return ops;
}

/**
 * 生成简易 unified diff 文本（---/+++ 头 + 逐行前缀）。
 * @param {string} relPath
 * @param {string[]} aLines
 * @param {string[]} bLines
 */
export function unifiedDiffText(relPath, aLines, bLines) {
  const ops = diffLines(aLines, bLines);
  const body = ops
    .map((op) => `${op.type === 'same' ? ' ' : op.type === 'add' ? '+' : '-'}${op.text}`)
    .join('\n');
  return `--- a/${relPath}\n+++ b/${relPath}\n${body}`;
}

function splitLines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n');
}

function walk(dir, rel = '', out = [], exclude = DEFAULT_EXCLUDE) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (exclude.has(entry.name)) continue;
      walk(path.join(dir, entry.name), relPath, out, exclude);
    } else {
      out.push(relPath);
    }
  }
  return out;
}

/**
 * 对比工作区与会话基线，生成结构化变更清单与文本。
 * @param {string} baselineDir 基线目录
 * @param {string} workspaceRoot 当前工作区
 * @returns {{summary:{added:number,removed:number,modified:number}, files:{path:string,status:string,linesAdded:number,linesRemoved:number,diff:string|null}[], text:string}}
 */
export function diffWorkspace(baselineDir, workspaceRoot) {
  const baseFiles = fs.existsSync(baselineDir) ? walk(baselineDir) : [];
  const workFiles = fs.existsSync(workspaceRoot) ? walk(workspaceRoot) : [];
  const baseSet = new Set(baseFiles);
  const workSet = new Set(workFiles);

  const files = [];
  for (const f of baseSet) {
    if (!workSet.has(f)) {
      const aLines = splitLines(fs.readFileSync(path.join(baselineDir, ...f.split('/')), 'utf8'));
      files.push({ path: f, status: 'removed', linesAdded: 0, linesRemoved: aLines.length, diff: `--- a/${f}\n+++ b/${f}\n${aLines.map((l) => `-${l}`).join('\n')}` });
    }
  }
  for (const f of workSet) {
    const bLines = splitLines(fs.readFileSync(path.join(workspaceRoot, ...f.split('/')), 'utf8'));
    if (!baseSet.has(f)) {
      files.push({ path: f, status: 'added', linesAdded: bLines.length, linesRemoved: 0, diff: `--- a/${f}\n+++ b/${f}\n${bLines.map((l) => `+${l}`).join('\n')}` });
      continue;
    }
    const aLines = splitLines(fs.readFileSync(path.join(baselineDir, ...f.split('/')), 'utf8'));
    if (aLines.join('\n') === bLines.join('\n')) continue;
    const ops = diffLines(aLines, bLines);
    const added = ops.filter((o) => o.type === 'add').length;
    const removed = ops.filter((o) => o.type === 'del').length;
    files.push({ path: f, status: 'modified', linesAdded: added, linesRemoved: removed, diff: unifiedDiffText(f, aLines, bLines) });
  }

  files.sort((x, y) => x.path.localeCompare(y.path));
  const summary = {
    added: files.filter((f) => f.status === 'added').length,
    removed: files.filter((f) => f.status === 'removed').length,
    modified: files.filter((f) => f.status === 'modified').length,
    linesAdded: files.reduce((acc, f) => acc + f.linesAdded, 0),
    linesRemoved: files.reduce((acc, f) => acc + f.linesRemoved, 0),
  };
  const text = files.map((f) => f.diff).join('\n');
  return { summary, files, text };
}
