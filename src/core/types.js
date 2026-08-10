/**
 * Modeo 共享契约（v0.1）
 * 所有模块以本文件定义的形状为准。
 */

export const MODE_IDS = ['chat', 'code', 'roleplay'];
export const MODE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const DEFAULT_HARNESS_DEFAULTS = {
  systemPrompt: null,
  tools: [],
  defaultModel: 'mock',
  context: { compactAfter: 40, maxIterations: 8 },
  approval: { mode: 'dangerous-only' },
  ui: { showSidebar: false, sidebarKind: 'none', showToolOutput: true },
};

export const APPROVAL_MODES = ['none', 'dangerous-only', 'all'];

export const SSE_EVENTS = {
  TEXT_DELTA: 'text_delta',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  APPROVAL_REQUIRED: 'approval_required',
  DONE: 'done',
  ERROR: 'error',
  MODE_CHANGED: 'mode_changed',
  CHECKPOINT: 'checkpoint',
  CHILD_AGENT_START: 'child_agent_start',
  CHILD_AGENT_END: 'child_agent_end',
};

/** 构造一条消息 */
export function msg(role, content, extra = {}) {
  return { role, content, ...extra };
}

/**
 * 会话消息 → Provider 标准格式（OpenAI Chat Completions）。
 * 会话内部用 toolCalls（驼峰）/toolCallId 存储；发给模型前必须转为 tool_calls / tool_call_id。
 * notice 消息（居中小灰字提示）不发给模型。
 */
export function cleanForProvider(m) {
  if (m.role === 'notice') return null;
  const out = { role: m.role, content: m.content };
  if (m.toolCalls && m.toolCalls.length) {
    out.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}) },
    }));
  }
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

/** 基础校验：harness 配置必须满足的最低要求 */
export function validateHarnessShape(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['harness 必须是对象'];
  if (!cfg.id || typeof cfg.id !== 'string' || !MODE_ID_PATTERN.test(cfg.id)) {
    errors.push('id 必填，且只允许小写字母/数字/下划线/连字符（最长 32）');
  }
  if (!cfg.name || typeof cfg.name !== 'string') errors.push('name 必填');
  if (cfg.id === 'chat' && cfg.systemPrompt !== null && cfg.systemPrompt !== undefined && String(cfg.systemPrompt).trim() !== '') {
    errors.push('chat 模式 systemPrompt 必须为空（零注入承诺）');
  }
  if (!Array.isArray(cfg.tools)) errors.push('tools 必须是数组');
  if (!cfg.defaultModel || typeof cfg.defaultModel !== 'string') errors.push('defaultModel 必填');
  if (cfg.approval && !APPROVAL_MODES.includes(cfg.approval.mode)) errors.push('approval.mode 非法');
  return errors;
}

export function applyHarnessDefaults(cfg) {
  const merged = {
    ...DEFAULT_HARNESS_DEFAULTS,
    ...cfg,
    context: { ...DEFAULT_HARNESS_DEFAULTS.context, ...(cfg?.context || {}) },
    approval: { ...DEFAULT_HARNESS_DEFAULTS.approval, ...(cfg?.approval || {}) },
    ui: { ...DEFAULT_HARNESS_DEFAULTS.ui, ...(cfg?.ui || {}) },
  };
  return merged;
}
