/**
 * Provider 抽象：Mock（离线演示/测试）与 OpenAI 兼容 API。
 */
import { netFetch } from './net.js';

/** 单次模型请求超时（毫秒）：防止模型端挂起导致 SSE 永挂、会话锁被长期占用 */
const REQUEST_TIMEOUT_MS = 120000;

export class MockProvider {
  constructor(settings = {}) {
    this.id = 'mock';
    this.name = 'Mock（离线演示）';
    this.settings = settings;
  }

  complete(messages, opts = {}) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const last = messages[messages.length - 1];
    const modeId = opts.modeId || 'chat';
    if (opts.task === 'summarize') {
      return {
        content: '【历史摘要】对话要点已压缩：记录了用户的主题、已确定的结论与尚未完成的事项。',
      };
    }
    if (last?.role === 'tool') {
      const preview = String(last.content || '').slice(0, 120);
      return { content: `【mock-${modeId}】工具执行完毕，结果摘要：${preview}` };
    }
    if (lastUser && /(?:list files|list_dir)/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [{ id: 'mock-1', name: 'list_dir', args: { path: '.' } }],
      };
    }
    if (modeId === 'roleplay' && lastUser) {
      const remember = lastUser.content.match(/记住\s*(.+?)\s*(?:是|为|变成)\s*(.+)/);
      if (remember) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'mock-ws-1',
              name: 'update_world_state',
              args: { key: remember[1].trim(), value: remember[2].trim() },
            },
          ],
        };
      }
    }
    if (lastUser && /write file/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [{ id: 'mock-2', name: 'write_file', args: { path: 'demo.txt', content: 'hello' } }],
      };
    }
    if (lastUser && /run tests/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [{ id: 'mock-3', name: 'run_tests', args: {} }],
      };
    }
    if (lastUser && /review changes/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [{ id: 'mock-4', name: 'review_changes', args: {} }],
      };
    }
    if (lastUser && /(?:subagent|子代理|派.*任务|spawn)/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'mock-sa-1',
            name: 'spawn_agent',
            args: {
              description: '探索工作区',
              prompt: '用 list_dir 和 read_file 查看工作区根目录结构，返回：顶层目录清单、每个目录的用途推测、关键入口文件。',
            },
          },
        ],
      };
    }
    if (lastUser && /ping/i.test(lastUser.content)) {
      return {
        content: '',
        toolCalls: [{ id: 'mock-5', name: 'ping', args: { echo: 'hi' } }],
      };
    }
    const text = lastUser ? `【mock-${modeId}】${lastUser.content}` : `【mock-${modeId}】你好，我是离线演示助手。`;
    return { content: text };
  }

  async *stream(messages, opts = {}) {
    const result = this.complete(messages, opts);
    if (result.toolCalls && result.toolCalls.length) {
      yield { type: 'tool_calls', toolCalls: result.toolCalls };
      return;
    }
    const text = result.content;
    const step = 8;
    for (let i = 0; i < text.length; i += step) {
      yield { type: 'text_delta', delta: text.slice(i, i + step) };
    }
  }
}

export class OpenAIProvider {
  constructor(settings = {}) {
    this.id = 'openai';
    this.name = 'OpenAI 兼容 API';
    // 兼容用户粘贴完整端点（.../chat/completions）或仅服务根地址
    this.baseUrl = String(settings.baseUrl || 'https://api.openai.com/v1')
      .replace(/\/+$/, '')
      .replace(/\/chat\/completions$/i, '');
    this.apiKey = settings.apiKey || '';
    this.model = settings.model || 'gpt-4o-mini';
  }

  async #request(messages, opts) {
    const body = {
      model: opts.model || this.model,
      messages,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.tools && opts.tools.length) body.tools = opts.tools;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await netFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(messages, opts = {}) {
    const res = await this.#request(messages, opts);
    const data = JSON.parse(await res.text());
    const m = data.choices?.[0]?.message || {};
    return {
      content: m.content || '',
      // 思维链（2026-08-18）：非流式响应里 DeepSeek 风格 reasoning_content / OpenAI 风格 reasoning
      thinking: m.reasoning_content || m.reasoning || '',
      toolCalls: (m.tool_calls || []).map((tc) => {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          args = {};
        }
        return { id: tc.id, name: tc.function?.name, args };
      }),
    };
  }

  async *stream(messages, opts = {}) {
    const body = {
      model: opts.model || this.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    };
    if (opts.tools && opts.tools.length) body.tools = opts.tools;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // 合并外部停止信号（客户端停止按钮）与内部超时
    const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
    let res;
    try {
      res = await netFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let toolCalls = [];
    let textDeltaCount = 0;
    // 响应体空闲超时（2026-08-15 修复：原先只有响应头前超时，模型中途挂起会无限占用 SSE 与会话锁）
    const IDLE_TIMEOUT_MS = 60000;
    let idleTimer = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    resetIdle();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = json.choices?.[0]?.delta || {};
        if (delta.content) {
          textDeltaCount++;
          yield { type: 'text_delta', delta: delta.content };
        }
        // 思维链（2026-08-18）：DeepSeek 风格 reasoning_content / OpenAI o1 风格 reasoning
        const reason = delta.reasoning_content ?? delta.reasoning;
        if (typeof reason === 'string' && reason) {
          yield { type: 'reasoning_delta', delta: reason };
        }
        for (const tc of delta.tool_calls || []) {
          const existing = toolCalls.find((x) => x.index === tc.index);
          if (!existing) {
            toolCalls.push({
              index: tc.index ?? toolCalls.length,
              id: tc.id || '',
              name: tc.function?.name || '',
              args: tc.function?.arguments || '',
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }
        }
      }
    }
    if (toolCalls.length) {
      yield {
        type: 'tool_calls',
        toolCalls: toolCalls.map((tc) => {
          let args = {};
          try {
            args = JSON.parse(tc.args || '{}');
          } catch {
            args = {};
          }
          return { id: tc.id || `tc-${tc.index}`, name: tc.name, args };
        }),
      };
    }
    // 空流自动降级（2026-08-18）：部分上游（如 cun.ai 中转站）对同一 key 短时间内的
    // 连续 stream 请求从第二次起返回 HTTP 200 但空流（0 个 text_delta，无 [DONE] 异常）。
    // 检测到空流且无工具调用 → 用非流式 complete() 兜底重试一次，保证用户拿到回复。
    if (textDeltaCount === 0 && toolCalls.length === 0) {
      try {
        const fb = await this.complete(messages, opts);
        if (fb.thinking) yield { type: 'reasoning_delta', delta: fb.thinking };
        if (fb.content) yield { type: 'text_delta', delta: fb.content };
        if (fb.toolCalls?.length) yield { type: 'tool_calls', toolCalls: fb.toolCalls };
      } catch {
        /* 兜底也失败则保持空（引擎会以空内容结束本轮） */
      }
    }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }
}

export function createProvider(settings) {
  if (settings?.provider === 'openai' && settings.apiKey) {
    return new OpenAIProvider(settings);
  }
  return new MockProvider(settings);
}
