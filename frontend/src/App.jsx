import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings as SettingsIcon, Eye, Sun, Moon, Plus, FolderDown, Undo2 } from 'lucide-react';
import { api, streamEvents } from './api';
import { cn } from './lib/utils';
import { applyTheme } from './lib/theme';
import { useToast } from './components/ui/toast';
import { ConfirmDialog } from './components/ui/confirm';
import { Button } from './components/ui/button';
import { Tooltip } from './components/ui/tooltip';
import { Spinner } from './components/ui/spinner';
import SessionsSidebar from './components/SessionsSidebar';
import ChatArea from './components/ChatArea';
import CodePanel from './components/CodePanel';
import RoleplaySidebar from './components/RoleplaySidebar';
import SettingsDialog from './components/dialogs/SettingsDialog';
import TransparencyDialog from './components/dialogs/TransparencyDialog';
import ApprovalDialog from './components/dialogs/ApprovalDialog';
import QuestionDialog from './components/dialogs/QuestionDialog';
import CharacterEditorDialog from './components/dialogs/CharacterEditorDialog';
import WorldStateDialog from './components/dialogs/WorldStateDialog';
import CommandPalette from './components/CommandPalette';
import TitleBar from './components/TitleBar';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function ModeTabs({ modes, selected, onSelect }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-card/60 p-1 shadow-paper">
      {modes.map((m) => (
        <button
          key={m.id}
          data-mode={m.id}
          onClick={() => onSelect(m.id)}
          className={cn(
            'relative rounded-full px-4 py-1.5 font-serif-display text-sm transition-colors',
            m.id === selected ? 'text-paper' : 'text-ink-soft hover:text-ink'
          )}
        >
          {m.id === selected && (
            <motion.span
              layoutId="mode-pill"
              className="absolute inset-0 rounded-full bg-ink"
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            />
          )}
          <span className="relative z-10">{m.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const toast = useToast();
  const [modes, setModes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [settings, setSettings] = useState(null);
  const [plugins, setPlugins] = useState([]);
  const [packs, setPacks] = useState([]);
  const [marketPacks, setMarketPacks] = useState([]);

  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [toolLog, setToolLog] = useState([]);
  const [selectedMode, setSelectedMode] = useState('chat');
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [contextTokens, setContextTokens] = useState(null); // 2026-08-18 P1-④：上下文 token 估算显示
  const [pendingApproval, setPendingApproval] = useState(null);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [ready, setReady] = useState(false);
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState(() => {
    const v = localStorage.getItem('modeo-theme') || 'light';
    return v === 'dark' ? 'midnight' : v === 'light' ? 'paper' : v;
  });
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [dialog, setDialog] = useState({ settings: false, transparency: false, characterEditor: null, worldState: false });
  const [confirm, setConfirm] = useState(null);

  const charInputRef = useRef(null);
  const packInputRef = useRef(null);
  const abortRef = useRef(null);
  // 当前活跃会话 id（用于异步回包防串台：done/权限切换的 fetch 回来时若已切会话则丢弃）
  const activeSessionIdRef = useRef(null);
  // 发送防抖（React 批处理窗口内防止双击重复提交）
  const sendingRef = useRef(false);

  const refreshBase = useCallback(async () => {
    // 逐项容错：单项接口失败不拖垮整体初始化（如服务未完全就绪）
    const [m, s, c, st, pl, pk, th] = await Promise.allSettled([
      api.modes(),
      api.sessions(),
      api.characters(),
      api.settings(),
      api.plugins(),
      api.packs(),
      api.themes(),
    ]);
    if (m.status === 'fulfilled') setModes(m.value.modes);
    if (s.status === 'fulfilled') setSessions(s.value.sessions);
    if (c.status === 'fulfilled') setCharacters(c.value.characters);
    if (st.status === 'fulfilled') {
      setSettings(st.value.settings);
      const saved = st.value.settings?.theme;
      if (saved) {
        const mapped = saved === 'dark' ? 'midnight' : saved === 'light' ? 'paper' : saved;
        setThemeId(mapped);
      }
    }
    if (th.status === 'fulfilled') setThemes(th.value.themes || []);
    if (pl.status === 'fulfilled') setPlugins(pl.value.plugins || []);
    if (pk.status === 'fulfilled') setPacks(pk.value.packs || []);
  }, []);

  // 主题回退：themeId 指向的主题不存在（被删除/损坏）时回退到默认主题
  const currentTheme = themes.find((t) => t.id === themeId) || themes[0] || null;
  useEffect(() => {
    if (themes.length && !themes.some((t) => t.id === themeId)) {
      setThemeId(themes[0].id);
    }
  }, [themes, themeId]);

  useEffect(() => {
    const t = currentTheme;
    if (!t) return;
    applyTheme(t);
    localStorage.setItem('modeo-theme', t.id);
  }, [currentTheme, themeId]);

  const setThemeByName = useCallback(
    async (id, { persist = true } = {}) => {
      const mapped = id === 'dark' ? 'midnight' : id === 'light' ? 'paper' : id;
      setThemeId(mapped);
      if (persist) {
        const updated = { ...settings, theme: mapped };
        setSettings(updated);
        await api.saveSettings(updated).catch(() => {});
      }
    },
    [settings]
  );

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cycleTheme = useCallback(async () => {
    if (!themes.length) return;
    const idx = themes.findIndex((t) => t.id === themeId);
    const next = themes[(idx + 1) % themes.length];
    await setThemeByName(next.id);
    toast(`主题：${next.name}`, 'success');
  }, [themes, themeId, setThemeByName, toast]);

  const openSession = useCallback(async (id) => {
    // 中止进行中的流式请求，避免旧会话的 text_delta 污染新会话
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setPendingApproval(null);
    setPendingQuestion(null);
    activeSessionIdRef.current = id;
    const r = await api.session(id);
    if (activeSessionIdRef.current !== id) return; // 期间又切换了会话，丢弃过期回包
    setSession(r.session);
    setMessages(r.session.messages || []);
    setSelectedMode(r.session.modeId);
    setSelectedCharacterId(r.session.characterId || null);
    setToolLog([]);
    setMarketPacks([]);
  }, []);

  const refreshSessions = useCallback(async () => {
    const r = await api.sessions();
    setSessions(r.sessions);
  }, []);

  const handleStreamEvent = useCallback(
    (evt) => {
      if (evt.type === 'text_delta') {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + evt.delta };
          } else {
            next.push({ role: 'assistant', content: evt.delta || '', streaming: true, id: uid() });
          }
          return next;
        });
      } else if (evt.type === 'reasoning_delta') {
        // 思维链（2026-08-18）：累积到当前 streaming 的 assistant 消息 thinking 字段
        // （仅前端 UI 状态，不持久化、不发回模型）
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            next[next.length - 1] = { ...last, thinking: (last.thinking || '') + evt.delta };
          } else {
            next.push({ role: 'assistant', content: '', streaming: true, thinking: evt.delta || '', id: uid() });
          }
          return next;
        });
      } else if (evt.type === 'tool_call') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'tool', toolCall: evt.toolCall }].slice(-300));
        setMessages((prev) => [...prev, { role: 'assistant', content: '', toolCalls: [evt.toolCall], id: uid() }]);
      } else if (evt.type === 'tool_result') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'tool', toolCall: evt.toolCall, result: evt.result }].slice(-300));
      } else if (evt.type === 'checkpoint') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'checkpoint', label: evt.checkpoint?.label || evt.checkpoint?.id }].slice(-300));
      } else if (evt.type === 'child_agent_start') {
        setToolLog((prev) => [
          ...prev,
          { id: uid(), type: 'subagent', state: 'running', description: evt.description, childId: evt.childId, result: '' },
        ].slice(-300));
      } else if (evt.type === 'child_agent_end') {
        // 按 childId 配对：把对应 running 条目标记为完成（保留结果摘要），不新增条目
        setToolLog((prev) =>
          prev.map((e) =>
            e.type === 'subagent' && e.childId === evt.childId
              ? { ...e, state: 'done', result: evt.result || '' }
              : e
          )
        );
      } else if (evt.type === 'approval_required') {
        setPendingApproval({ approvalId: evt.approvalId, summary: evt.summary, toolCall: evt.toolCall });
        setStreaming(false);
      } else if (evt.type === 'question_required') {
        setPendingQuestion({ question: evt.question, options: evt.options || [] });
        setStreaming(false);
      } else if (evt.type === 'done') {
        setStreaming(false);
        if (typeof evt.tokenEstimate === 'number') setContextTokens(evt.tokenEstimate);
        // 2026-08-17 审查修复：兜底清理挂起弹窗（正常流程审批挂起时不会到 done，防御残留）
        setPendingApproval(null);
        setPendingQuestion(null);
        setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
        // done 后同步最终会话状态（后端可能补充标题/摘要），并刷新侧边栏列表
        const doneSessionId = session?.id;
        if (doneSessionId) {
          api.session(doneSessionId).then((r) => {
            // 防串台：期间若已切换到其他会话，丢弃过期回包
            if (activeSessionIdRef.current !== doneSessionId) return;
            setSession(r.session);
            // 2026-08-17 审查修复：tool 结果不渲染进聊天区（F4）——工具输出已在流式
            // 阶段进 toolLog，done 快照若含 role:'tool' 会以助手气泡混入刷屏
            setMessages((prev) => {
              // 2026-08-18：思维链不持久化在服务端——快照替换前把最后一条 assistant 的 thinking 补回
              const lastThink = [...prev].reverse().find((m) => m.role === 'assistant' && m.thinking)?.thinking;
              const snap = (r.session.messages || []).filter((m) => m.role !== 'tool');
              // 2026-08-18 修复"流式完成后闪一下"：快照消息 id 是服务端 randomUUID，
              // 直接整组替换会让虚拟列表 key 全变 → 全部卸载重挂载 → 入场动画重播闪烁。
              // 按索引合并：content 以快照为准（权威/完整），id 与 thinking 保留前端值 → key 稳定零闪动。
              return snap.map((sm, i) => {
                const pm = prev[i];
                return {
                  ...sm,
                  id: pm?.id || sm.id,
                  thinking: pm?.thinking || (i === snap.length - 1 ? lastThink : undefined),
                };
              });
            });
          });
          refreshSessions();
        }
      } else if (evt.type === 'error') {
        setStreaming(false);
        setPendingApproval(null);
        setPendingQuestion(null);
        // 2026-08-18：先移除空占位气泡（"回复中"），再追加错误消息，避免留下空气泡
        setMessages((prev) => [
          ...prev.filter((m) => !(m.pending && !m.content)),
          { role: 'assistant', content: `错误：${evt.message}`, id: uid() },
        ]);
      }
    },
    [session?.id, refreshSessions]
  );

  const sendMessage = useCallback(
    async (content, modelOverride) => {
      // 2026-08-17 审查修复（F3）：无会话时不再静默丢弃输入——明确提示用户先新建会话
      if (!session) {
        toast('请先新建会话再发送消息', 'info');
        return;
      }
      // ref 镜像防抖：React 批处理窗口内连按 Enter 也只会发一次（state 闭包可能读到旧值）
      if (streaming || sendingRef.current) return;
      sendingRef.current = true;
      setStreaming(true);
      setMessages((prev) => [...prev, { role: 'user', content, id: uid() }]);
      // 2026-08-18：立即显示"回复中"占位气泡——真实模型首 token 常需数秒，无占位用户以为卡死
      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true, pending: true, id: uid() }]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // modelOverride：消息级模型切换（pi 模型接力思想），仅本条消息生效
        await streamEvents(
          `/api/sessions/${session.id}/messages`,
          { content, ...(modelOverride ? { model: modelOverride } : {}) },
          handleStreamEvent,
          { signal: controller.signal }
        );
      } catch (e) {
        if (e.name !== 'AbortError') {
          setStreaming(false);
          setMessages((prev) => [...prev, { role: 'assistant', content: `请求失败：${e.message}`, id: uid() }]);
        }
      } finally {
        // 只清理自己的 controller：避免旧流（abort/断流）的 finally 误清新流的停止能力
        if (abortRef.current === controller) abortRef.current = null;
        sendingRef.current = false;
      }
      setStreaming(false);
      // 兜底清除残留 streaming 标记（abort/断流时 done 事件可能未到达）
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    },
    [session, streaming, handleStreamEvent, toast]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 切换 code 会话权限模式；进入无审批模式需显式确认 */
  const togglePermissionMode = useCallback(() => {
    if (!session || session.modeId !== 'code') return;
    if (streaming) {
      toast('消息生成中，暂不可切换权限模式', 'info');
      return;
    }
    const next = session.permissionMode === 'aggressive' ? 'standard' : 'aggressive';
    const apply = async () => {
      try {
        const r = await api.setPermissionMode(session.id, next, next === 'aggressive');
        setSession(r.session);
        setMessages(r.session.messages || []);
        refreshSessions();
        toast(next === 'aggressive' ? '已切换到无审批模式（激进）' : '已切换到一般模式', next === 'aggressive' ? 'error' : 'success');
      } catch (e) {
        toast('切换失败：' + e.message, 'error');
      }
    };
    if (next === 'aggressive') {
      setConfirm({
        title: '切换到无审批模式？',
        description:
          '无审批模式（激进）下，agent 可执行任意命令、读写任意文件，不再弹出审批。仅在可信环境使用，风险自负。',
        danger: true,
        action: apply,
      });
    } else {
      apply();
    }
  }, [session, toast, streaming, refreshSessions]);

  const decideApproval = useCallback(
    async (decision, argsOverride) => {
      const a = pendingApproval;
      if (!a) return;
      setPendingApproval(null);
      // 2026-08-17 审查修复：不再无条件关闭问题弹窗——审批与提问同批挂起时
      // 各自独立处理（F5：decideApproval 只管审批，question 由用户回答/跳过）
      // 审批决策本身失败：关闭弹窗 + 提示（不还原——还原会因 TTL 过期形成"批准→失败→还原"死循环锁死应用）
      try {
        await api.decideApproval(a.approvalId, decision, session.id, argsOverride);
      } catch (e) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `审批操作失败：${e.message}（审批可能已超时，请重新发送消息发起操作）`, id: uid() }]);
        return;
      }
      if (decision === 'deny') {
        // deny 后也 resume：引擎会补写 tool 消息（用户拒绝）并让模型继续回复，
        // 避免 assistant(tool_calls) 孤立导致后续消息 400（历史断裂死锁）
        setStreaming(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          await streamEvents(`/api/sessions/${session.id}/resume`, {}, handleStreamEvent, { signal: controller.signal });
        } catch (e) {
          if (e.name !== 'AbortError') {
            setMessages((prev) => [...prev, { role: 'assistant', content: `恢复失败：${e.message}（可重新发送消息继续）`, id: uid() }]);
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
        setStreaming(false);
        return;
      }
      setStreaming(true);
      // resume 流同样可被停止按钮中断（存入 abortRef）
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamEvents(`/api/sessions/${session.id}/resume`, {}, handleStreamEvent, { signal: controller.signal });
      } catch (e) {
        if (e.name !== 'AbortError') {
          setStreaming(false);
          setMessages((prev) => [...prev, { role: 'assistant', content: `恢复失败：${e.message}（可重新发送消息继续）`, id: uid() }]);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
      setStreaming(false);
    },
    [pendingApproval, session?.id, handleStreamEvent]
  );

  const answerQuestion = useCallback(
    async (answer, skipped = false) => {
      const q = pendingQuestion;
      if (!q) return;
      setPendingQuestion(null);
      try {
        if (skipped) await api.skipQuestion(session.id);
        else await api.answerQuestion(session.id, answer);
      } catch (e) {
        // 2026-08-17 审查修复：不再还原弹窗——404「没有待回答的问题」时还原会死循环锁死应用
        setMessages((prev) => [...prev, { role: 'assistant', content: `回答提交失败：${e.message}（问题可能已失效，请直接发送消息继续）`, id: uid() }]);
        return;
      }
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamEvents(`/api/sessions/${session.id}/resume`, {}, handleStreamEvent, { signal: controller.signal });
      } catch (e) {
        if (e.name !== 'AbortError') {
          setStreaming(false);
          setMessages((prev) => [...prev, { role: 'assistant', content: `恢复失败：${e.message}（可重新发送消息继续）`, id: uid() }]);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
      setStreaming(false);
    },
    [pendingQuestion, session?.id, handleStreamEvent]
  );

  const switchMode = useCallback(
    async (modeId) => {
      if (modeId === selectedMode) return;
      // 中止进行中的流式请求，避免旧流的 text_delta/tool_call 污染新模式会话
      if (streaming) abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setPendingApproval(null);
    setPendingQuestion(null);
      setToolLog([]);
      if (session) {
        const r = await api.switchMode(session.id, modeId);
        activeSessionIdRef.current = session.id; // 模式切换仍是同一会话
        setSession(r.session);
        setMessages(r.session.messages || []);
      }
      refreshSessions();
      setSelectedMode(modeId);
      const m = modes.find((x) => x.id === modeId);
      toast(`已切换到「${m?.name || modeId}」`, 'success');
    },
    [selectedMode, session, modes, toast, streaming, refreshSessions]
  );

  const newSession = useCallback(async () => {
    const body = { modeId: selectedMode };
    if (selectedMode === 'roleplay' && selectedCharacterId) body.characterId = selectedCharacterId;
    const r = await api.createSession(body);
    await refreshSessions();
    await openSession(r.session.id);
  }, [selectedMode, selectedCharacterId, refreshSessions, openSession]);

  const deleteSession = useCallback(
    async (id) => {
      setConfirm({
        title: '删除会话？',
        description: '将删除该会话及其关联快照与基线，此操作不可恢复。',
        danger: true,
        action: async () => {
          try {
            await api.deleteSession(id);
            await refreshSessions();
            if (session?.id === id) {
              // 删除的是当前打开的会话：清空当前状态
              activeSessionIdRef.current = null;
              setSession(null);
              setMessages([]);
              setToolLog([]);
              setPendingApproval(null);
    setPendingQuestion(null);
              setSelectedMode('chat');
              setSelectedCharacterId(null);
            }
            toast('会话已删除', 'success');
          } catch (e) {
            toast('删除失败：' + e.message, 'error');
          }
        },
      });
    },
    [session, refreshSessions, toast, setConfirm]
  );

  const exportCurrentSession = useCallback(() => {
    if (!session) return;
    api.exportSession(session.id).then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `modeo-session-${session.id.slice(0, 8)}.json`;
      a.click();
      toast('会话已导出', 'success');
    });
  }, [session, toast]);

  useEffect(() => {
    const onShortcut = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        newSession();
      } else if (k === ',') {
        e.preventDefault();
        setDialog((d) => ({ ...d, settings: true }));
      } else if (k === 'e') {
        e.preventDefault();
        exportCurrentSession();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [newSession, exportCurrentSession]);

  const importSessionFile = useCallback(
    async (file) => {
      const data = JSON.parse(await file.text());
      const r = await api.importSession(data);
      await refreshSessions();
      await openSession(r.session.id);
    },
    [refreshSessions, openSession]
  );

  const undo = useCallback(async () => {
    if (!session) return;
    const r = await api.checkpoints(session.id);
    if (!r.checkpoints?.length) {
      toast('暂无可恢复的快照', 'info');
      return;
    }
    setConfirm({
      title: '恢复快照',
      description: `将覆盖当前工作区：\n${r.checkpoints[0].label || r.checkpoints[0].id}`,
      danger: true,
      action: async () => {
        await api.restoreCheckpoint(session.id, r.checkpoints[0].id);
        const s = await api.session(session.id);
        setSession(s.session);
        setMessages(s.session.messages || []);
        setToolLog([]);
        toast('已恢复快照', 'success');
      },
    });
  }, [session, toast]);

  const refreshCharacters = useCallback(async () => {
    const r = await api.characters();
    setCharacters(r.characters);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!session) return;
    const r = await api.session(session.id);
    setSession(r.session);
    setMessages(r.session.messages || []);
  }, [session]);

  const handleSlashCommand = useCallback(
    async (commandId, arg) => {
      if (!session) return;
      if (commandId === 'goal') {
        if (!arg) {
          toast('用法：/goal <目标>（留空则清除目标）', 'info');
          return;
        }
        await api.setGoal(session.id, arg);
        await refreshSession();
        toast('已设置会话目标', 'success');
        return;
      }
      if (commandId === 'compress') {
        setConfirm({
          title: '压缩会话历史',
          description:
            '将调用模型把当前对话总结为摘要，历史消息会被替换为「摘要 + 最近几条」。此操作不可撤销，确定继续吗？',
          danger: true,
          action: async () => {
            const r = await api.compress(session.id);
            setSession(r.session);
            setMessages(r.session.messages || []);
            toast(`已压缩：${r.removedCount} 条消息转为摘要`, 'success');
          },
        });
        return;
      }
      if (commandId === 'clear') {
        setConfirm({
          title: '清空会话历史',
          description: '将删除当前会话的全部消息（目标、世界状态与快照保留）。此操作不可恢复，确定继续吗？',
          danger: true,
          action: async () => {
            const r = await api.clearSession(session.id);
            setSession(r.session);
            setMessages(r.session.messages || []);
            toast('已清空会话历史', 'success');
          },
        });
        return;
      }
      if (commandId === 'mode') {
        const target = String(arg || '').toLowerCase();
        const m = modes.find((x) => x.id === target || String(x.name).toLowerCase() === target);
        if (!m) {
          toast(`未找到模式：${arg || '空'}。可用：${modes.map((x) => x.id).join(' / ')}`, 'error');
          return;
        }
        await switchMode(m.id);
        return;
      }
      if (commandId === 'new') {
        await newSession();
        toast('已新建会话', 'success');
        return;
      }
      toast('可用命令：/goal <目标> · /压缩 · /clear · /模式 <id> · /new · /help', 'info', 6000);
    },
    [session, modes, refreshSession, switchMode, newSession, toast]
  );

  const handleUnknownSlash = useCallback(
    (name) => {
      toast(`未知命令 /${name}，输入 /help 查看全部命令`, 'error');
    },
    [toast]
  );

  const castHandlers = {
    add: async (characterId) => {
      if (!session) {
        setSelectedCharacterId(characterId);
        return;
      }
      await api.addCast(session.id, characterId);
      await refreshSession();
    },
    setActive: async (characterId) => {
      if (!session) return;
      await api.setActive(session.id, characterId);
      await refreshSession();
    },
    remove: async (characterId) => {
      if (!session) return;
      await api.removeCast(session.id, characterId);
      await refreshSession();
    },
  };

  const exportPack = useCallback(async () => {
    const data = await api.exportPack('Modeo 角色包');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `modeo-pack-${Date.now()}.modeopack.json`;
    a.click();
  }, []);

  const marketRefresh = useCallback(
    async (url) => {
      if (!url) {
        toast('请先填写市场索引 URL', 'info');
        return;
      }
      const r = await api.marketRefresh(url);
      setMarketPacks(r.index.packs || []);
      const next = { ...settings, marketUrl: url };
      setSettings(next);
      await api.saveSettings(next);
    },
    [settings, toast]
  );

  const marketInstall = useCallback(
    async (pack) => {
      setConfirm({
        title: '安装市场角色包',
        description: `从市场安装「${pack.name}」？`,
        action: async () => {
          await api.marketInstall(pack.url);
          await refreshCharacters();
          toast(`已安装「${pack.name}」`, 'success');
        },
      });
    },
    [refreshCharacters, toast]
  );

  const installPack = useCallback(
    async (packId) => {
      await api.packsImport(packId);
      await refreshCharacters();
      toast('本地角色包安装完成', 'success');
    },
    [refreshCharacters, toast]
  );

  const importCharacterFile = useCallback(
    async (file) => {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isPng =
        bytes.length > 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (isPng) {
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        await api.importCcv3Png(btoa(bin));
      } else {
        await api.importCcv3(new TextDecoder().decode(bytes));
      }
      await refreshCharacters();
    },
    [refreshCharacters]
  );

  const importPackFile = useCallback(
    async (file) => {
      const pack = JSON.parse(await file.text());
      await api.importPack(pack);
      await refreshCharacters();
      const r = await api.packs();
      setPacks(r.packs || []);
    },
    [refreshCharacters]
  );

  useEffect(() => {
    (async () => {
      try {
        await refreshBase();
        const r = await api.sessions();
        if (r.sessions.length) {
          await openSession(r.sessions[0].id);
        } else {
          const c = await api.createSession({ modeId: 'chat' });
          await refreshSessions();
          await openSession(c.session.id);
        }
      } catch (e) {
        toast('初始化失败：' + e.message, 'error');
      } finally {
        setReady(true);
      }
    })();
  }, [refreshBase, openSession, refreshSessions, toast]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          <span className="font-serif-display text-3xl tracking-[0.3em] text-ink">Modeo</span>
          <Spinner />
        </div>
      </div>
    );
  }

  const activeCharacter = session?.characterId ? characters.find((c) => c.id === session.characterId)?.name : null;
  // 皮肤背景图（2026-08-18 改）：直接铺在 App 根容器（视口第一层），聊天区透明后图清晰可见。
  // 遮罩大幅减轻（浅色 0.10 / 深色 0.28），不再有 45% 白雾闷图的问题。
  const skinUrl =
    currentTheme && typeof currentTheme.background === 'string' && currentTheme.background.startsWith('/themes/skins/')
      ? currentTheme.background
      : '';
  const skinBgStyle = skinUrl
    ? {
        backgroundImage: `linear-gradient(${currentTheme.dark ? 'rgba(8,10,14,0.28)' : 'rgba(250,248,244,0.10)'}, ${
          currentTheme.dark ? 'rgba(8,10,14,0.28)' : 'rgba(250,248,244,0.10)'
        }), url("${skinUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }
    : undefined;
  const paletteCommands = [
    { id: 'new', label: '新建会话', hint: 'Ctrl+N', icon: Plus, run: newSession, keywords: '新建 会话 session' },
    ...modes.map((m) => ({
      id: `mode-${m.id}`,
      label: `切换到「${m.name}」`,
      hint: 'Mode',
      icon: undefined,
      run: () => switchMode(m.id),
      keywords: `模式 ${m.name} ${m.id}`,
    })),
    { id: 'settings', label: '打开设置', hint: 'Ctrl+,', icon: SettingsIcon, run: () => setDialog((d) => ({ ...d, settings: true })), keywords: '设置 settings' },
    { id: 'transparency', label: '提示词透明面板', hint: 'T', icon: Eye, run: () => setDialog((d) => ({ ...d, transparency: true })), keywords: '透明 提示词 prompt' },
    { id: 'theme', label: `切换主题（当前：${currentTheme?.name || themeId}）`, hint: 'D', icon: currentTheme?.dark ? Sun : Moon, run: cycleTheme, keywords: '主题 深浅 theme dark light' },
    ...(selectedMode === 'code'
      ? [{ id: 'undo', label: '撤销到最近快照', hint: 'U', icon: Undo2, run: undo, keywords: '撤销 快照 undo' }]
      : []),
    ...(session
      ? [{ id: 'export', label: '导出当前会话', hint: 'Ctrl+E', icon: FolderDown, run: exportCurrentSession, keywords: '导出 会话 export' }]
      : []),
  ];

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-transparent text-ink"
      style={skinBgStyle}
    >
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          currentId={session?.id}
          onOpen={openSession}
          onNew={newSession}
          onImport={importSessionFile}
          onDelete={deleteSession}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur">
          <div className="flex items-center gap-5">
            <span className="font-serif-display text-xl tracking-[0.35em] text-ink">M O D E O</span>
            <ModeTabs modes={modes} selected={selectedMode} onSelect={switchMode} />
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content={`切换主题（当前：${currentTheme?.name || themeId}）`}>
              <Button size="icon" variant="ghost" data-testid="btn-theme" onClick={cycleTheme}>
                {currentTheme?.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </Tooltip>
            <Tooltip content="提示词透明面板">
              <Button size="icon" variant="ghost" data-testid="btn-transparency" onClick={() => setDialog((d) => ({ ...d, transparency: true }))}>
                <Eye className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="设置">
              <Button size="icon" variant="ghost" data-testid="btn-settings" onClick={() => setDialog((d) => ({ ...d, settings: true }))}>
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
          </header>

          <div className="flex min-h-0 flex-1">
          <ChatArea
            session={session}
            messages={messages}
            streaming={streaming}
            characterName={activeCharacter}
            defaultModel={settings?.model}
            models={(settings?.providers || []).find((p) => p.id === settings?.activeProviderId)?.models || []}
            contextTokens={contextTokens}
            onSend={sendMessage}
            onStop={stopStreaming}
            onTransparency={() => setDialog((d) => ({ ...d, transparency: true }))}
            onSlashCommand={handleSlashCommand}
            onUnknownSlash={handleUnknownSlash}
            onPermissionChange={togglePermissionMode}
            />
            <AnimatePresence mode="wait" initial={false}>
              {selectedMode === 'code' && (
                <motion.div
                  key="code-panel"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 18 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <CodePanel toolLog={toolLog} onUndo={undo} />
                </motion.div>
              )}
              {selectedMode === 'roleplay' && (
                <motion.div
                  key="roleplay-panel"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 18 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <RoleplaySidebar
                    characters={characters}
                    session={session}
                    worldState={session?.worldState || {}}
                    packs={packs}
                    marketPacks={marketPacks}
                    onAddToCast={castHandlers.add}
                    onSetActive={castHandlers.setActive}
                    onRemoveCast={castHandlers.remove}
                    onNewCharacter={() => setDialog((d) => ({ ...d, characterEditor: 'new' }))}
                    onEditCharacter={(id) => setDialog((d) => ({ ...d, characterEditor: id }))}
                    onImportCharacter={() => charInputRef.current?.click()}
                    onImportPack={() => packInputRef.current?.click()}
                    onExportPack={exportPack}
                    onInstallPack={installPack}
                    onMarketRefresh={marketRefresh}
                    onInstallMarket={marketInstall}
                    onEditWorldState={() => setDialog((d) => ({ ...d, worldState: true }))}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <input
        ref={charInputRef}
        type="file"
        accept=".json,.png,application/json,image/png"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              await importCharacterFile(f);
            } catch (err) {
              toast('导入失败：' + err.message, 'error');
            }
          }
          e.target.value = '';
        }}
      />
      <input
        ref={packInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              await importPackFile(f);
            } catch (err) {
              toast('导入失败：' + err.message, 'error');
            }
          }
          e.target.value = '';
        }}
      />

      <AnimatePresence>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
        {dialog.settings && (
          <SettingsDialog
            settings={settings}
            modes={modes}
            plugins={plugins}
            themes={themes}
            themeId={themeId}
            onThemeChange={setThemeByName}
            onThemesChanged={async () => {
              const r = await api.themes();
              setThemes(r.themes || []);
            }}
            onSave={(s) => setSettings(s)}
            onClose={() => setDialog((d) => ({ ...d, settings: false }))}
            onModesChanged={async () => {
              const r = await api.modes();
              setModes(r.modes);
            }}
          />
        )}
        {dialog.transparency && session && (
          <TransparencyDialog sessionId={session.id} onClose={() => setDialog((d) => ({ ...d, transparency: false }))} />
        )}
        {dialog.characterEditor !== null && (
          <CharacterEditorDialog
            id={dialog.characterEditor === 'new' ? null : dialog.characterEditor}
            onClose={() => setDialog((d) => ({ ...d, characterEditor: null }))}
            onSaved={async () => {
              await refreshCharacters();
              setDialog((d) => ({ ...d, characterEditor: null }));
            }}
          />
        )}
        {dialog.worldState && (
          <WorldStateDialog
            worldState={session?.worldState || {}}
            onSave={async (updates) => {
              if (session) {
                await api.worldState(session.id, updates);
                await refreshSession();
              }
            }}
            onClear={async () => {
              if (session) {
                await api.clearWorldState(session.id);
                await refreshSession();
              }
            }}
            onClose={() => setDialog((d) => ({ ...d, worldState: false }))}
          />
        )}
        {pendingApproval && <ApprovalDialog approval={pendingApproval} onDecide={decideApproval} />}
        {pendingQuestion && <QuestionDialog question={pendingQuestion} onAnswer={answerQuestion} />}
        {confirm && (
          <ConfirmDialog
            open
            title={confirm.title}
            description={confirm.description}
            danger={confirm.danger}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              const action = confirm.action;
              setConfirm(null);
              try {
                await action();
              } catch (e) {
                toast(e.message || '操作失败', 'error');
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
