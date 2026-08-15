/**
 * 子代理（sub-agent）工具：spawn_agent。
 *
 * 设计要点（对齐 Claude Code Task tool / pi-mono subagent 的业界模式）：
 * - 上下文完全隔离：子代理运行在独立消息列表，不写入主会话 messages；
 *   父子之间只有 prompt 字符串一条通道，子代理结果以纯文本返回。
 * - 深度 = 1：子代理工具集剔除 spawn_agent，禁止子代理再派子代理（防无限递归）。
 * - 工具白名单：可选参数 tools 限定子代理可用工具；默认继承当前会话工具集。
 * - 审批继承：子代理内部触发危险命令/敏感路径时，不尝试绕过——立即终止子循环，
 *   把决策交回主代理（主代理可用自身工具执行，走主会话审批）。
 * - 可观测性：emit child_agent_start / tool_call / tool_result / child_agent_end。
 */
import { randomUUID } from 'node:crypto';
import { msg, SSE_EVENTS, cleanForProvider } from '../core/types.js';
import { withToolTimeout } from '../core/exec.js';

/** 子代理工具定义转 OpenAI function 格式 */
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

const DEFAULT_MAX_ITERATIONS = 5;
const MAX_ITERATIONS_LIMIT = 12;
const RESULT_MAX = 8000;

export function createAgentTools() {
  const spawnAgent = {
    name: 'spawn_agent',
    description:
      '启动一个子代理（sub-agent）在独立上下文中执行子任务，完成后返回精炼结论。' +
      '适合：分析大型代码库的局部、独立模块审查、需要聚焦上下文不污染主会话的探索任务。' +
      '子代理看不到主会话历史，所有必要上下文必须写进 prompt。子代理不能再启动子代理。' +
      '若子代理遇到需要审批的危险操作会中止并说明，由你接手处理。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            '给子代理的完整任务简报：背景、目标、范围（文件路径）、期望输出格式。' +
            '子代理看不到主会话历史，必要上下文必须写在这里。',
        },
        description: {
          type: 'string',
          description: '简短标签，用于界面显示（如「审查登录模块」「统计工具使用」）。',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：子代理可用工具白名单，默认继承当前会话工具集。',
        },
        maxIterations: {
          type: 'number',
          description: '可选：子代理最大循环轮数（默认 5，上限 12）。',
        },
      },
      required: ['prompt'],
    },
    async execute(args = {}, ctx = {}) {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return { output: '缺少 prompt 参数', isError: true };
      const description = String(args.description || '子代理').slice(0, 40);
      const maxIterations = Math.min(Math.max(Number(args.maxIterations) || DEFAULT_MAX_ITERATIONS, 1), MAX_ITERATIONS_LIMIT);
      const { provider, toolRegistry, workspaceRoot, approvals, session, persist, aggressive, harness, settings, emit, signal } = ctx;
      if (!provider || !toolRegistry) {
        return { output: '子代理执行环境缺失（provider/toolRegistry）', isError: true };
      }

      // 工具集：继承父工具，剔除 spawn_agent（深度=1），支持白名单
      const all = toolRegistry.list().map((n) => toolRegistry.get(n)).filter(Boolean);
      let childTools = all.filter((t) => t.name !== 'spawn_agent');
      if (Array.isArray(args.tools) && args.tools.length) {
        const want = new Set(args.tools.map((n) => String(n)).filter((n) => n && n !== 'spawn_agent'));
        childTools = childTools.filter((t) => want.has(t.name));
      }
      if (!childTools.length) {
        return { output: '子代理无可用工具（工具白名单为空或全部被禁用）', isError: true };
      }

      const childId = randomUUID();
      emit?.({ type: SSE_EVENTS.CHILD_AGENT_START, childId, description });

      // 子系统提示：独立、聚焦、约束行为
      const sysPrompt = [
        '你是 Modeo 的子代理，在独立上下文中执行被分配的子任务。',
        '规则：',
        `1. 只完成当前任务，不做任务之外的事。可用工具：${childTools.map((t) => t.name).join(', ')}。`,
        '2. 需要信息时用工具读取工作区文件或执行命令；所有结论必须来自工具结果，不得编造。',
        '3. 遇到需要审批的危险命令或敏感路径访问时，立即停止并如实说明原因（不要尝试绕过审批）。',
        '4. 任务完成后返回精炼的中文结论：做了什么、关键发现、产出文件。正文不超过 300 字。',
        '5. 结论中不要复述规则或思考过程。',
      ].join('\n');

      const messages = [msg('system', sysPrompt), msg('user', prompt)];
      let collected = ''; // 最近一轮流式文本（超限/中止时兜底）
      let blocked = null; // 权限不足时的说明
      // 审批策略继承：approval.mode='all' 时子代理不承载审批流程——任何工具调用都终止交回主代理；
      // 'dangerous-only' 时由工具自身预检（needsApproval → 终止），保持与主代理一致。
      const approvalMode = harness?.approval?.mode || 'dangerous-only';
      const childCtx = { workspaceRoot, approvals, session, persist, aggressive, approvalMode, emit, signal };

      try {
        for (let i = 0; i < maxIterations; i++) {
          if (signal?.aborted) {
            // 停止信号（客户端停止/断开）：提前结束，不继续调模型
            emit?.({ type: SSE_EVENTS.CHILD_AGENT_END, childId, description, result: '[子代理因停止信号中止]' });
            return { output: '[子代理因停止信号中止]', isError: false };
          }
          let content = '';
          let toolCalls = null;
          const stream = provider.stream(messages.map(cleanForProvider).filter(Boolean), {
            model: settings?.model || harness?.defaultModel || 'mock',
            modeId: harness?.id || 'code',
            tools: openAiToolDefs(childTools),
            temperature: settings?.temperature ?? 0.7,
            signal,
          });
          for await (const chunk of stream) {
            if (chunk.type === 'text_delta') {
              content += chunk.delta || '';
            } else if (chunk.type === 'tool_calls' && Array.isArray(chunk.toolCalls)) {
              toolCalls = chunk.toolCalls;
            } else if (chunk.type === 'error') {
              throw new Error(chunk.message || '模型调用出错');
            }
          }
          collected = content;

          if (toolCalls && toolCalls.length) {
            const assistantMsg = msg('assistant', content || '', {
              toolCalls: toolCalls.map((tc) => ({ id: tc.id || randomUUID(), name: tc.name, args: tc.args || {} })),
            });
            messages.push(assistantMsg);
            let needStop = false;
            for (const tc of assistantMsg.toolCalls) {
              const tool = childTools.find((t) => t.name === tc.name);
              if (!tool) {
                messages.push(msg('tool', `未知工具: ${tc.name}`, { toolCallId: tc.id, name: tc.name }));
                continue;
              }
              emit?.({ type: SSE_EVENTS.TOOL_CALL, toolCall: tc, childId });
              // 'all' 审批模式：子代理不承载审批 UI，任何工具调用直接终止交回主代理
              if (approvalMode === 'all') {
                blocked = '当前会话要求所有工具调用需人工审批，子代理不支持审批流程，已中止执行';
                messages.push(msg('tool', `[子代理终止：${blocked}]`, { toolCallId: tc.id, name: tc.name }));
                emit?.({
                  type: SSE_EVENTS.TOOL_RESULT,
                  toolCall: tc,
                  result: { output: `[子代理终止：${blocked}]`, isError: false },
                  childId,
                });
                needStop = true;
                break;
              }
              // 工具异常隔离（2026-08-15 修复：与主循环一致，插件工具抛错不中断子代理循环）
              // + 每工具超时统一裁决
              let result;
              try {
                result = await withToolTimeout(tc.name, tool.execute(tc.args, childCtx), tool.timeoutMs);
              } catch (err) {
                result = { output: `工具执行异常: ${err.message || String(err)}`, isError: true };
              }
              if (result.needsApproval) {
                // 子代理权限不足：立即终止，把决策交回主代理
                blocked = result.approvalReason || result.output || '需要审批的操作';
                messages.push(msg('tool', `[子代理终止：${blocked}]`, { toolCallId: tc.id, name: tc.name }));
                emit?.({
                  type: SSE_EVENTS.TOOL_RESULT,
                  toolCall: tc,
                  result: { output: `[子代理终止：${blocked}]`, isError: false },
                  childId,
                });
                needStop = true;
                break;
              }
              messages.push(msg('tool', result.output || '（无输出）', { toolCallId: tc.id, name: tc.name }));
              emit?.({ type: SSE_EVENTS.TOOL_RESULT, toolCall: tc, result, childId });
            }
            if (needStop) break;
            continue;
          }

          // 子代理完成：最终回答即结果
          const finalText = content.trim() || '（子代理无输出）';
          const output = blocked
            ? `[子代理在任务中触发安全审批并中止]\n${blocked}\n\n子代理已完成的输出：\n${finalText}`
            : finalText;
          emit?.({ type: SSE_EVENTS.CHILD_AGENT_END, childId, description, result: output });
          return { output: output.slice(0, RESULT_MAX), isError: false };
        }

        // 超过 maxIterations 未收敛
        const tail = collected.trim() || '（无输出）';
        const output = blocked
          ? `[子代理在任务中触发安全审批并中止]\n${blocked}\n\n子代理已完成的输出：\n${tail}`
          : `[子代理达到最大轮数 ${maxIterations} 次未收敛]\n${tail}`;
        emit?.({ type: SSE_EVENTS.CHILD_AGENT_END, childId, description, result: output });
        return { output: output.slice(0, RESULT_MAX), isError: false };
      } catch (err) {
        const output = `[子代理执行出错] ${err.message || String(err)}`;
        emit?.({ type: SSE_EVENTS.CHILD_AGENT_END, childId, description, result: output });
        return { output, isError: true };
      }
    },
  };

  return { spawn_agent: spawnAgent };
}
