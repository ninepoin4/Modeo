/**
 * 自进化系统单测：技能存储 / 技能提炼 / 偏好统计 / engine 触发与注入。
 * 2026-08-17 新增。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  saveSkill,
  getSkill,
  listSkills,
  deleteSkill,
  matchSkills,
  recordSkillUsage,
  skillsToPromptText,
} from '../src/core/skillStore.js';
import { buildDistillPrompt, parseSkillFromResponse, buildTrajectory, distillSkill } from '../src/runtime/distill.js';
import { recordToolUsage, recordApprovalRejection, summarizePreferences, getPreferences } from '../src/core/preferences.js';
import { runAgentTurn, assembleSystemPrompt } from '../src/runtime/engine.js';
import { loadHarnessConfigs } from '../src/core/harness.js';
import * as approvals from '../src/core/approvals.js';
import { createCodeTools } from '../src/tools/registry.js';
import * as store from '../src/core/session.js';

process.env.MODEO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-selfevolve-data-'));
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnesses = loadHarnessConfigs(path.join(ROOT, 'configs', 'harness'));
let wsRoot;

test.before(() => {
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-selfevolve-ws-'));
  store.resetSessions();
});
test.after(() => {
  fs.rmSync(wsRoot, { recursive: true, force: true });
  store.resetSessions();
});

function tmpData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modeo-skill-'));
}

function makeSession(modeId) {
  return store.createSession({ modeId });
}

// ===== skillStore =====

test('skillStore: 保存/读取/列表/删除 往返', () => {
  const data = tmpData();
  const skill = saveSkill(data, { name: 'vite-deploy', triggers: ['部署', 'deploy'], content: '步骤一\n步骤二' });
  assert.equal(skill.name, 'vite-deploy');
  assert.equal(skill.score, 0.5);
  assert.equal(skill.status, 'active');
  const got = getSkill(data, 'vite-deploy');
  assert.equal(got.content, '步骤一\n步骤二');
  assert.deepEqual(got.triggers, ['部署', 'deploy']);
  assert.equal(listSkills(data).length, 1);
  // 非法名拒绝
  assert.throws(() => saveSkill(data, { name: '../evil', content: 'x' }));
  deleteSkill(data, 'vite-deploy');
  assert.equal(getSkill(data, 'vite-deploy'), null);
  fs.rmSync(data, { recursive: true, force: true });
});

test('skillStore: 关键词匹配（大小写不敏感，active 才匹配）', () => {
  const data = tmpData();
  saveSkill(data, { name: 'vite-deploy', triggers: ['部署', 'deploy', '构建'], content: 'x' });
  assert.equal(matchSkills(data, '帮我部署一下前端').length, 1);
  assert.equal(matchSkills(data, 'DEPLOY NOW').length, 1);
  assert.equal(matchSkills(data, '写个排序算法').length, 0);
  // archived 不匹配
  const s = getSkill(data, 'vite-deploy');
  s.status = 'archived';
  saveSkill(data, s);
  assert.equal(matchSkills(data, '部署').length, 0);
  fs.rmSync(data, { recursive: true, force: true });
});

test('skillStore: 质量门控——失败率高自动归档', () => {
  const data = tmpData();
  saveSkill(data, { name: 'bad-skill', triggers: ['x'], content: 'y' });
  for (let i = 0; i < 3; i++) recordSkillUsage(data, 'bad-skill', false);
  const s = getSkill(data, 'bad-skill');
  assert.equal(s.usage, 3);
  assert.equal(s.score, 0);
  assert.equal(s.status, 'archived');
  assert.equal(listSkills(data).filter((x) => x.status === 'active').length, 0);
  fs.rmSync(data, { recursive: true, force: true });
});

test('skillStore: 质量门控——正常使用保持 active 且分数上升', () => {
  const data = tmpData();
  saveSkill(data, { name: 'good-skill', triggers: ['x'], content: 'y' });
  recordSkillUsage(data, 'good-skill', true);
  recordSkillUsage(data, 'good-skill', true);
  recordSkillUsage(data, 'good-skill', true);
  const s = getSkill(data, 'good-skill');
  assert.equal(s.score, 1);
  assert.equal(s.status, 'active');
  fs.rmSync(data, { recursive: true, force: true });
});

test('skillStore: skillsToPromptText 截断 content', () => {
  const text = skillsToPromptText([{ name: 'a', triggers: ['b', 'c'], content: '很长的内容'.repeat(100) }]);
  assert.match(text, /已沉淀技能/);
  assert.ok(text.length < 400);
});

// ===== distill =====

test('distill: parseSkillFromResponse 各形态', () => {
  const ok = parseSkillFromResponse('{"name": "vite-deploy", "triggers": ["部署", "deploy"], "content": "步骤"}');
  assert.equal(ok.name, 'vite-deploy');
  assert.deepEqual(ok.triggers, ['部署', 'deploy']);
  // 模型夹带说明文字 → 提取花括号 JSON
  const wrapped = parseSkillFromResponse('好的，以下是技能：\n{"name": "a-b", "triggers": ["t"], "content": "c"}\n希望有帮助');
  assert.equal(wrapped.name, 'a-b');
  // skip
  assert.equal(parseSkillFromResponse('{"skip": true}'), null);
  // 非法
  assert.equal(parseSkillFromResponse('随便聊聊'), null);
  assert.equal(parseSkillFromResponse('{"name": "", "content": "x"}'), null);
  // name 全为非法字符（中文）→ 清洗后为空 → 返回 null（正确行为）
  assert.equal(parseSkillFromResponse('{"name": "部署 流程", "triggers": ["部署"], "content": "c"}'), null);
});

test('distill: buildDistillPrompt 与 buildTrajectory 截断', () => {
  const p = buildDistillPrompt('[用户] hi');
  assert.match(p, /技能提炼器/);
  assert.match(p, /skip/);
  const msgs = [
    { role: 'user', content: '帮我写个工具' },
    { role: 'assistant', toolCalls: [{ name: 'write_file' }, { name: 'shell' }] },
    { role: 'tool', content: 'OK' },
  ];
  const traj = buildTrajectory(msgs);
  assert.match(traj, /调用工具: write_file, shell/);
  assert.match(traj, /\[工具结果\] OK/);
  const long = buildTrajectory([{ role: 'user', content: 'x'.repeat(50000) }]);
  assert.ok(long.length <= 12000);
});

test('distill: 真实提炼（provider 返回技能 JSON）保存到 skills/', async () => {
  const data = tmpData();
  const provider = {
    async *stream(messages) {
      const last = messages[messages.length - 1];
      assert.match(last.content, /技能提炼器/);
      yield { type: 'text_delta', delta: JSON.stringify({ name: 'distilled-1', triggers: ['构建'], content: '先测后构' }) };
    },
  };
  const skill = await distillSkill({
    provider,
    messages: [
      { role: 'user', content: '帮我做一个包含多个步骤的完整任务，涉及文件读写、命令执行和测试验证的流程，最后还要汇报结果。这是一个典型的项目初始化流程，需要先了解目录结构，再编写核心代码，然后补充测试用例，最后运行测试确认全部通过。如果遇到依赖问题还需要修复。整个流程做完之后要总结改动并汇报。' },
      { role: 'assistant', toolCalls: [{ name: 'list_dir' }, { name: 'read_file' }] },
      { role: 'tool', content: '目录结构：src/ 与 tests/，入口文件 src/index.js，测试文件在 tests/ 下，还有 package.json 配置了测试脚本' },
      { role: 'assistant', toolCalls: [{ name: 'write_file' }, { name: 'shell' }] },
      { role: 'tool', content: '文件已写入，测试命令执行成功，全部用例通过，任务完成。改动清单：新增 src/index.js、tests/unit.test.js，无破坏性变更' },
    ],
    dataDir: data,
    sessionId: 's-1',
  });
  assert.equal(skill.name, 'distilled-1');
  assert.equal(skill.source, 's-1');
  assert.ok(fs.existsSync(path.join(data, 'skills', 'distilled-1.md')));
  // 轨迹太短不提炼
  const none = await distillSkill({ provider, messages: [{ role: 'user', content: 'hi' }], dataDir: data });
  assert.equal(none, null);
  fs.rmSync(data, { recursive: true, force: true });
});

test('distill: 提炼失败/超时静默不抛', async () => {
  const data = tmpData();
  const boom = {
    async *stream() {
      throw new Error('API 挂了');
    },
  };
  const r = await distillSkill({ provider: boom, messages: [{ role: 'user', content: 'x'.repeat(300) }], dataDir: data });
  assert.equal(r, null);
  const hang = {
    async *stream() {
      await new Promise((r) => setTimeout(r, 60000)); // 永不结束（15s 超时应打断）
    },
  };
  const start = Date.now();
  const r2 = await distillSkill({ provider: hang, messages: [{ role: 'user', content: 'x'.repeat(300) }], dataDir: data });
  assert.equal(r2, null);
  assert.ok(Date.now() - start < 30000, '超时应打断');
  fs.rmSync(data, { recursive: true, force: true });
});

// ===== preferences =====

test('preferences: 工具频率与审批拒绝统计 → 注入文案', () => {
  const data = tmpData();
  recordToolUsage(data, 'shell');
  recordToolUsage(data, 'shell');
  recordToolUsage(data, 'read_file');
  recordApprovalRejection(data, 'shell');
  recordApprovalRejection(data, 'shell');
  const prefs = getPreferences(data);
  assert.equal(prefs.toolUsage.shell, 2);
  assert.equal(prefs.approvals.rejected.shell, 2);
  const text = summarizePreferences(prefs);
  assert.match(text, /shell\(2\)/);
  assert.match(text, /shell 工具近期被拒绝 2 次/);
  fs.rmSync(data, { recursive: true, force: true });
});

test('preferences: 空数据返回 null 文案', () => {
  const data = tmpData();
  assert.equal(summarizePreferences(getPreferences(data)), null);
  fs.rmSync(data, { recursive: true, force: true });
});

// ===== engine 集成 =====

/** 前 N 轮返回工具调用，之后回答；若收到技能提炼请求返回技能 JSON */
class SelfEvolveProvider {
  constructor(toolsLeft = 5) {
    this.toolsLeft = toolsLeft;
  }
  async *stream(messages) {
    const last = messages[messages.length - 1];
    if (last.role === 'user' && last.content.includes('技能提炼器')) {
      yield {
        type: 'text_delta',
        delta: JSON.stringify({ name: 'multi-tool-flow', triggers: ['多步', 'multi'], content: '步骤：1. 写文件 2. 验证 3. 汇报' }),
      };
      return;
    }
    if (this.toolsLeft > 0) {
      this.toolsLeft--;
      yield { type: 'tool_calls', toolCalls: [{ id: `t${this.toolsLeft}`, name: 'write_file', args: { path: 'f.txt', content: 'x' } }] };
      return;
    }
    const text = '完成';
    for (const c of text) yield { type: 'text_delta', delta: c };
  }
}

async function collectEvents(opts) {
  const events = [];
  await runAgentTurn({ ...opts, emit: (e) => events.push(e) });
  return events;
}

test('engine: code 模式 ≥5 次工具调用 → done 后自动沉淀技能', async () => {
  const data = tmpData();
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: '帮我做多步任务', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  const events = await collectEvents({
    session,
    harness,
    character: null,
    provider: new SelfEvolveProvider(5),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    dataDir: data,
  });
  assert.ok(events.some((e) => e.type === 'done'));
  const skill = getSkill(data, 'multi-tool-flow');
  assert.ok(skill, '应自动沉淀技能');
  assert.match(skill.content, /写文件/);
  fs.rmSync(data, { recursive: true, force: true });
});

test('engine: 工具调用少且无错误 → 不沉淀', async () => {
  const data = tmpData();
  const session = makeSession('code');
  session.messages.push({ role: 'user', content: 'write file please', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'code');
  // MockProvider 只会触发一次 write_file 后进入截断/或循环——改用一次工具就收尾的 provider
  const oneShot = {
    toolsLeft: 1,
    async *stream(messages) {
      if (this.toolsLeft > 0) {
        this.toolsLeft--;
        yield { type: 'tool_calls', toolCalls: [{ id: 't1', name: 'write_file', args: { path: 'a.txt', content: 'x' } }] };
        return;
      }
      const last = messages[messages.length - 1];
      const text = last.role === 'user' && last.content.includes('技能提炼器') ? '{"skip": true}' : '好';
      yield { type: 'text_delta', delta: text };
    },
  };
  await collectEvents({
    session,
    harness,
    character: null,
    provider: oneShot,
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    dataDir: data,
  });
  assert.equal(listSkills(data).length, 0, '工具调用 1 次不应沉淀');
  fs.rmSync(data, { recursive: true, force: true });
});

test('engine: chat 模式不触发沉淀（即使多工具）', async () => {
  const data = tmpData();
  const session = makeSession('chat');
  session.messages.push({ role: 'user', content: '你好', id: 'u1' });
  const harness = harnesses.find((h) => h.id === 'chat');
  await collectEvents({
    session,
    harness,
    character: null,
    provider: new SelfEvolveProvider(5),
    toolRegistry: createCodeTools(wsRoot),
    approvals,
    workspaceRoot: wsRoot,
    persist: store.saveSession,
    settings: {},
    dataDir: data,
  });
  assert.equal(listSkills(data).length, 0, 'chat 模式不应沉淀');
  fs.rmSync(data, { recursive: true, force: true });
});

test('engine: assembleSystemPrompt 注入已匹配技能与偏好', () => {
  const data = tmpData();
  saveSkill(data, { name: 'deploy-flow', triggers: ['部署'], content: '先构建再推送' });
  const skills = matchSkills(data, '帮我部署到服务器');
  assert.equal(skills.length, 1);
  const harness = harnesses.find((h) => h.id === 'code');
  const prompt = assembleSystemPrompt(harness, [], wsRoot, null, 'dangerous-only', {
    skills,
    prefsText: '常用工具：shell(3)',
  });
  assert.match(prompt, /已沉淀技能/);
  assert.match(prompt, /deploy-flow/);
  assert.match(prompt, /使用偏好/);
  assert.match(prompt, /shell\(3\)/);
  fs.rmSync(data, { recursive: true, force: true });
});

test('engine: assembleSystemPrompt 无技能/偏好时不注入', () => {
  const harness = harnesses.find((h) => h.id === 'code');
  const prompt = assembleSystemPrompt(harness, [], wsRoot, null, 'dangerous-only', {});
  assert.ok(!prompt.includes('已沉淀技能'));
  assert.ok(!prompt.includes('使用偏好'));
});
