/**
 * Modeo 引擎循环：组装 prompt -> 调用 provider -> 执行工具（审批拦截）-> 循环，直到最终回答。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { msg, SSE_EVENTS } from '../core/types.js';
import { getEffectiveSystemPrompt, renderCharacterPrompt } from '../core/harness.js';
import { createCheckpoint, writeCheckpointMeta } from '../tools/checkpoints.js';

/**
 * 组装最终系统提示词：harness 提示词 + 角色渲染 +（code 模式）工作区 AGENTS.md 约定。
 * 导出以便单独测试。
 */
export function assembleSystemPrompt(harness, character, workspaceRoot, session = null) {
  const cast = Array.isArray(character) ? character : character ? [character] : [];
  let sys;
  if (harness?.id === 'roleplay' && cast.length) {
    const activeId = session?.characterId || cast[0]?.id;
    sys = cast
      .map((c) => {
        const rendered = renderCharacterPrompt(harness, c) || '';
        const isActive = c.id === activeId;
        return isActive
          ? `【当前发言角色：${c.name}，请以该角色身份回应】\n${rendered}`
          : `【其他在场角色：${c.name}】\n${rendered}`;
      })
      .join('\n\n');
  } else {
    sys = getEffectiveSystemPrompt(harness, cast[0] || null) || '';
  }
  if (harness?.id === 'code' && workspaceRoot) {
    const agentsFile = path.join(workspaceRoot, 'AGENTS.md');
    try {
      if (fs.existsSync(agentsFile)) {
        const content = fs.readFileSync(agentsFile, 'utf8').trim();
        if (content) sys = `${sys}\n\n【仓库约定 AGENTS.md】\n${content}`;
      }
    } catch {
      // 读取失败不影响主流程
    }
  }
  if (harness?.id === 'roleplay' && session?.worldState) {
    const entries = Object.entries(session.worldState).filter(
      ([k, v]) => k && typeof v === 'string' && v.trim()
    );
    if (entries.length) {
      const block = entries.map(([k, v]) => `- ${k}: ${v.trim()}`).join('\n');
      sys = `${sys}\n\n【世界状态记忆（剧情中发生的事实进展，回应时必须保持一致）】\n${block}`;
    }
  }
  if (session?.goal && typeof session.goal === 'string' && session.goal.trim()) {
    const goalBlock = `【会话目标】\n${session.goal.trim()}`;
    sys = sys ? `${sys}\n\n${goalBlock}` : goalBlock;
  }
  return sys || null;
}

function cleanForProvider(m) {
  if (m.role === 'notice') return null;
  const out = { role: m.role, content: m.content };
  if (m.toolCalls) out.toolCalls = m.toolCalls;
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  if (m.name) out.name = m.name;
  return out;
}

function openAiToolDefs(tools) {
  return tools
    .filter((t) => t && t.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {}, required: [] },
      },
    }));
}

const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'shell']);

function snapshotBefore(session, workspaceRoot, tc, emit) {
  if (!MUTATING_TOOLS.has(tc.name)) return;
  try {
    const ckpt = createCheckpoint({
      sessionId: session.id,
      workspaceRoot,
      label: `${tc.name} ${JSON.stringify(tc.args)}`.slice(0, 120),
    });
    writeCheckpointMeta(session.id, ckpt.id, { label: ckpt.label, createdAt: ckpt.createdAt });
    emit({ type: SSE_EVENTS.CHECKPOINT, checkpoint: { id: ckpt.id, label: ckpt.label, createdAt: ckpt.createdAt } });
  } catch {
    // 快照失败不阻断执行
  }
}

/**
 * 执行一轮 Agent 对话。
 * opts: { session, harness, character, provider, toolRegistry, approvals,
 *         workspaceRoot, persist(session), emit(event), settings, resume }
 * emit 事件：text_delta / tool_call / tool_result / approval_required / done / error
 */
export async function runAgentTurn(opts) {
  const {
    session,
    harness,
    character,
    characters,
    provider,
    toolRegistry,
    approvals,
    workspaceRoot,
    persist,
    emit,
    settings = {},
    resume = false,
  } = opts;

  const cast = characters && characters.length ? characters : character ? [character] : [];
  let systemPrompt = assembleSystemPrompt(harness, cast, workspaceRoot, session);
  const approvalMode = harness.approval?.mode || 'dangerous-only';
  const maxIterations = harness.context?.maxIterations || 8;
  const tools = (harness.tools || []).map((name) => toolRegistry.get(name)).filter(Boolean);

  try {
    // 先重建 provider 视角的消息列表
    let messages = session.messages.map(cleanForProvider).filter(Boolean);
    if (systemPrompt) messages = [msg('system', systemPrompt), ...messages];

    // resume：处理被审批挂起的工具调用
    if (resume && session.pendingApproval) {
      const pending = session.pendingApproval;
      const approval = approvals.getApproval(pending.approvalId);
      if (!approval) throw new Error('审批记录不存在，请重新发送消息');

      if (approval.status === 'approved') {
        const tool = toolRegistry.get(pending.toolCall.name);
        snapshotBefore(session, workspaceRoot, pending.toolCall, emit);
        const ctx = { workspaceRoot, approvals, forceApproved: true, session, persist };
        const result = tool
          ? await tool.execute(pending.toolCall.args, ctx)
          : { output: `未知工具: ${pending.toolCall.name}`, isError: true };
        emit({ type: SSE_EVENTS.TOOL_RESULT, toolCall: pending.toolCall, result });
        session.messages.push(
          msg('assistant', '', { id: randomUUID(), toolCalls: [pending.toolCall] }),
          msg('tool', result.output, { id: randomUUID(), toolCallId: pending.toolCall.id, name: pending.toolCall.name })
        );
      } else if (approval.status === 'denied') {
        session.messages.push(
          msg('tool', '用户拒绝了此操作，请改用其他方式或说明原因。', {
            id: randomUUID(),
            toolCallId: pending.toolCall.id,
            name: pending.toolCall.name,
          })
        );
      }
      session.pendingApproval = null;
      persist(session);
      systemPrompt = assembleSystemPrompt(harness, cast, workspaceRoot, session);
      messages = session.messages.map(cleanForProvider).filter(Boolean);
      if (systemPrompt) messages = [msg('system', systemPrompt), ...messages];
    }

    for (let i = 0; i < maxIterations; i++) {
      let content = '';
      let toolCalls = null;
      const stream = provider.stream(messages, {
        model: harness.defaultModel || settings.model || 'mock',
        modeId: harness.id,
        tools: openAiToolDefs(tools),
        temperature: settings.temperature ?? 0.7,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          content += chunk.delta || '';
          emit({ type: SSE_EVENTS.TEXT_DELTA, delta: chunk.delta || '' });
        } else if (chunk.type === 'tool_calls' && Array.isArray(chunk.toolCalls)) {
          toolCalls = chunk.toolCalls;
        } else if (chunk.type === 'error') {
          throw new Error(chunk.message || '模型调用出错');
        }
      }

      if (toolCalls && toolCalls.length) {
        const assistantMsg = msg('assistant', content || '', {
          id: randomUUID(),
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id || randomUUID(),
            name: tc.name,
            args: tc.args || {},
          })),
        });
        session.messages.push(assistantMsg);
        persist(session);
        emit({ type: SSE_EVENTS.TOOL_CALL, toolCall: assistantMsg.toolCalls[0] });

        let blocked = false;
        for (const tc of assistantMsg.toolCalls) {
          const tool = toolRegistry.get(tc.name);
          if (!tool) {
            const r = { output: `未知工具: ${tc.name}`, isError: true };
            session.messages.push(msg('tool', r.output, { id: randomUUID(), toolCallId: tc.id, name: tc.name }));
            emit({ type: SSE_EVENTS.TOOL_RESULT, toolCall: tc, result: r });
            continue;
          }
          const ctx = { workspaceRoot, approvals, session, persist };
          // 先判定是否需审批：all 模式任何工具都先审批；dangerous-only 模式由工具预检（危险命令不实际执行）
          let needsApproval = approvalMode === 'all';
          let result = null;
          if (!needsApproval) {
            // 变更型工具在预检执行前先打快照（撤销点）
            snapshotBefore(session, workspaceRoot, tc, emit);
            result = await tool.execute(tc.args, ctx);
            needsApproval = approvalMode === 'dangerous-only' && result.needsApproval === true;
          }
          if (needsApproval) {
            const approval = approvals.createApproval({
              sessionId: session.id,
              toolCall: tc,
              summary: `${tc.name} ${JSON.stringify(tc.args)}`,
            });
            session.pendingApproval = { approvalId: approval.id, toolCall: tc };
            persist(session);
            emit({
              type: SSE_EVENTS.APPROVAL_REQUIRED,
              approvalId: approval.id,
              toolCall: tc,
              summary: approval.summary,
            });
            blocked = true;
            break;
          }
          session.messages.push(msg('tool', result.output, { id: randomUUID(), toolCallId: tc.id, name: tc.name }));
          emit({ type: SSE_EVENTS.TOOL_RESULT, toolCall: tc, result });
        }
        persist(session);
        if (blocked) return { status: 'waiting_approval' };
        systemPrompt = assembleSystemPrompt(harness, cast, workspaceRoot, session);
        messages = session.messages.map(cleanForProvider).filter(Boolean);
        if (systemPrompt) messages = [msg('system', systemPrompt), ...messages];
        continue;
      }

      // 最终回答
      const finalMsg = msg('assistant', content, { id: randomUUID() });
      session.messages.push(finalMsg);
      session.updatedAt = new Date().toISOString();
      persist(session);
      emit({ type: SSE_EVENTS.DONE, messageId: finalMsg.id });
      return { status: 'done', messageId: finalMsg.id };
    }

    emit({ type: SSE_EVENTS.DONE, messageId: null, truncated: true });
    return { status: 'truncated' };
  } catch (err) {
    emit({ type: SSE_EVENTS.ERROR, message: err.message || String(err) });
    return { status: 'error', message: err.message || String(err) };
  }
}
