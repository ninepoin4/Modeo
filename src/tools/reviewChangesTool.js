/**
 * 变更审查工具：对比当前工作区与最近快照，给出新增/修改/删除清单与行级 diff。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffWorkspace } from './diff.js';
import { listCheckpoints, getCheckpointDir } from './checkpoints.js';

const MAX_OUTPUT = 64 * 1024;

export function createReviewChangesTool() {
  return {
    name: 'review_changes',
    description: '审查自最近快照以来的工作区变更：列出新增/修改/删除的文件并给出行级 diff（无快照时以空基线对比）。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute(args = {}, ctx = {}) {
      const session = ctx.session;
      if (!session) return { output: '错误: 缺少会话上下文，无法定位快照', isError: true };
      const ckpts = listCheckpoints(session.id);
      let baseline = null;
      if (ckpts.length) baseline = path.join(getCheckpointDir(session.id), ckpts[0].id);

      let result;
      if (baseline) {
        result = diffWorkspace(baseline, ctx.workspaceRoot);
      } else {
        // 无快照：以空目录为基线，全部视为新增
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-empty-baseline-'));
        try {
          result = diffWorkspace(empty, ctx.workspaceRoot);
        } finally {
          fs.rmSync(empty, { recursive: true, force: true });
        }
      }

      const s = result.summary;
      const head = `变更审查（相对${ckpts.length ? '最近快照' : '空基线'}）：新增 ${s.added}，修改 ${s.modified}，删除 ${s.removed}；+${s.linesAdded} / -${s.linesRemoved} 行`;
      const body = result.text || '（无变更）';
      return { output: `${head}\n\n${body}`.slice(0, MAX_OUTPUT), isError: false };
    },
  };
}
