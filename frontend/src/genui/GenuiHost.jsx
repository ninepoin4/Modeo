/**
 * GenUI 宿主集成层（Modeo 原生嵌入）
 *
 * 提供两条链路：
 * 1. GenuiHostProvider —— 注入 sessionId + action 发送回调（内部转成
 *    GenuiActionContext，组件树直接消费）
 * 2. GenuiFence —— Markdown 管道识别 ```dsh-ui 围栏后调用，
 *    把围栏正文交给 dsh-genui 渲染核心（renderGenuiFence）渲染成交互组件
 *
 * action 回环：用户点击带 action 的组件 → GenuiActionHandler(action, payload)
 * → onSend(`[genui-action] ...`) 经 Modeo 现有消息管道回模型 → 模型用 dsh-ui
 * 更新界面。
 */
import { createContext, useContext, useMemo } from 'react';
import { GenuiActionContext } from '../genui/action-context.ts';
import { renderGenuiFence } from '../genui/fence-render.tsx';

const GenuiHostContext = createContext({ sessionId: null, sendAction: null });

export function GenuiHostProvider({ sessionId, sendAction, children }) {
  return (
    <GenuiHostContext.Provider value={{ sessionId, sendAction }}>
      <GenuiActionContext.Provider value={sendAction ?? undefined}>{children}</GenuiActionContext.Provider>
    </GenuiHostContext.Provider>
  );
}

/** 由 raw 内容生成稳定源标识（流式期随内容变化不持久化，完成后稳定可持久化） */
function contentSourceId(raw) {
  let h = 5381;
  const s = raw;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `genui:${h.toString(36)}`;
}

/** 渲染一个 ```dsh-ui 围栏（供 Markdown 管道调用） */
export function GenuiFence({ raw }) {
  const { sessionId } = useContext(GenuiHostContext);
  const context = useMemo(
    () => (sessionId ? { sessionId, source: { id: contentSourceId(raw), order: [0, 0, 0] } } : undefined),
    [sessionId, raw]
  );
  return renderGenuiFence(raw, undefined, context);
}
