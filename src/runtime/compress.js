/**
 * 会话压缩：调用模型把历史对话总结为摘要，替换为「摘要 + 最近若干条」。
 * notice 消息不参与摘要，也不发给模型。
 */
import { randomUUID } from 'node:crypto';
import { msg } from '../core/types.js';

export const SUMMARY_SYSTEM = `你是 Modeo 的会话摘要助手。请把用户提供的对话压缩成一份简洁的中文摘要，要求：
1. 保留：用户的真实需求与目标、已经确定的结论、关键决定、重要的代码/文件/数据事实、尚未完成的事项。
2. 剔除：寒暄、重复内容、工具执行的琐碎细节。
3. 输出 150-350 字，直接给出摘要正文，不要输出其他解释。`;

const MAX_TRANSCRIPT = 80000;

function formatMessage(m) {
  if (m.role === 'user') return `[用户] ${m.content || ''}`;
  if (m.role === 'assistant') {
    const calls = (m.toolCalls || []).map((tc) => tc.name).filter(Boolean).join('、');
    return `[助手] ${m.content || ''}${calls ? `（调用工具：${calls}）` : ''}`;
  }
  if (m.role === 'tool') {
    const preview = String(m.content || '').replace(/\s+/g, ' ').slice(0, 300);
    return `[工具 ${m.name || '?'}] ${preview}`;
  }
  return '';
}

export function buildTranscript(messages) {
  return messages
    .filter((m) => m.role !== 'notice')
    .map(formatMessage)
    .filter(Boolean)
    .join('\n');
}

/**
 * 压缩会话。直接修改 session.messages 与 session.lastSummary，不负责落盘。
 * opts: { model, minMessages, keepLast }
 */
export async function compressSession({ session, provider, opts = {} }) {
  const all = Array.isArray(session.messages) ? session.messages : [];
  const significant = all.filter((m) => m.role !== 'notice');
  const MIN = opts.minMessages ?? 6;
  if (significant.length < MIN) {
    throw new Error(`消息太少（${significant.length} 条），至少需要 ${MIN} 条才值得压缩`);
  }
  const keepLast = Math.min(opts.keepLast ?? 4, significant.length - 1);
  const toSummarize = significant.slice(0, significant.length - keepLast);
  const recent = significant
    .slice(significant.length - keepLast)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content || '',
      id: m.id || randomUUID(),
      ...(m.role === 'assistant' ? {} : { toolCalls: undefined }),
    }));

  const transcript = buildTranscript(toSummarize).slice(0, MAX_TRANSCRIPT);
  const result = await provider.complete(
    [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: `需要压缩的对话：\n\n${transcript}` },
    ],
    { model: opts.model, temperature: 0.3, task: 'summarize' }
  );
  const raw = String(result.content || '').trim();
  if (!raw) throw new Error('模型未返回摘要，压缩失败');
  const summary = raw.startsWith('【历史摘要】') ? raw : `【历史摘要】\n${raw}`;

  session.messages = [
    msg('notice', `已压缩 ${toSummarize.length} 条消息为历史摘要，保留最近 ${recent.length} 条。`, {
      id: randomUUID(),
    }),
    msg('assistant', summary, { id: randomUUID() }),
    ...recent.map((m) => (m.toolCalls === undefined ? { role: m.role, content: m.content, id: m.id } : m)),
  ];
  session.lastSummary = summary;
  session.updatedAt = new Date().toISOString();
  return { summary, removedCount: toSummarize.length, recentCount: recent.length };
}
