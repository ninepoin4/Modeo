import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings as SettingsIcon, Eye, Sun, Moon, Plus, FolderDown, Undo2 } from 'lucide-react';
import { api, streamEvents } from './api';
import { cn } from './lib/utils';
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
  const [pendingApproval, setPendingApproval] = useState(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('modeo-theme') || 'light');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [dialog, setDialog] = useState({ settings: false, transparency: false, characterEditor: null, worldState: false });
  const [confirm, setConfirm] = useState(null);

  const charInputRef = useRef(null);
  const packInputRef = useRef(null);
  const abortRef = useRef(null);

  const refreshBase = useCallback(async () => {
    const [m, s, c, st, pl, pk] = await Promise.all([
      api.modes(),
      api.sessions(),
      api.characters(),
      api.settings(),
      api.plugins(),
      api.packs(),
    ]);
    setModes(m.modes);
    setSessions(s.sessions);
    setCharacters(c.characters);
    setSettings(st.settings);
    if (st.settings?.theme) setTheme(st.settings.theme);
    setPlugins(pl.plugins || []);
    setPacks(pk.packs || []);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('modeo-theme', theme);
  }, [theme]);

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

  const toggleTheme = useCallback(async () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      const updated = { ...settings, theme: next };
      setSettings(updated);
      api.saveSettings(updated).catch(() => {});
      return next;
    });
  }, [settings]);

  const openSession = useCallback(async (id) => {
    const r = await api.session(id);
    setSession(r.session);
    setMessages(r.session.messages || []);
    setSelectedMode(r.session.modeId);
    if (r.session.characterId) setSelectedCharacterId(r.session.characterId);
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
      } else if (evt.type === 'tool_call') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'tool', toolCall: evt.toolCall }]);
        setMessages((prev) => [...prev, { role: 'assistant', content: '', toolCalls: [evt.toolCall], id: uid() }]);
      } else if (evt.type === 'tool_result') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'tool', toolCall: evt.toolCall, result: evt.result }]);
      } else if (evt.type === 'checkpoint') {
        setToolLog((prev) => [...prev, { id: uid(), type: 'checkpoint', label: evt.checkpoint?.label || evt.checkpoint?.id }]);
      } else if (evt.type === 'approval_required') {
        setPendingApproval({ approvalId: evt.approvalId, summary: evt.summary });
        setStreaming(false);
      } else if (evt.type === 'done') {
        setStreaming(false);
        setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
        api.session(session?.id).then((r) => {
          setSession(r.session);
          setMessages(r.session.messages || []);
        });
      } else if (evt.type === 'error') {
        setStreaming(false);
        setMessages((prev) => [...prev, { role: 'assistant', content: `错误：${evt.message}`, id: uid() }]);
      }
    },
    [session?.id]
  );

  const sendMessage = useCallback(
    async (content) => {
      if (!session || streaming) return;
      setStreaming(true);
      setMessages((prev) => [...prev, { role: 'user', content, id: uid() }]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamEvents(`/api/sessions/${session.id}/messages`, { content }, handleStreamEvent, { signal: controller.signal });
      } catch (e) {
        if (e.name !== 'AbortError') {
          setStreaming(false);
          setMessages((prev) => [...prev, { role: 'assistant', content: `请求失败：${e.message}`, id: uid() }]);
        }
      } finally {
        abortRef.current = null;
      }
      setStreaming(false);
      if (session) {
        api.session(session.id).then((r) => {
          setSession(r.session);
          setMessages(r.session.messages || []);
        });
      }
    },
    [session, streaming, handleStreamEvent]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const decideApproval = useCallback(
    async (decision) => {
      const a = pendingApproval;
      setPendingApproval(null);
      await api.decideApproval(a.approvalId, decision);
      if (decision === 'deny') {
        setMessages((prev) => [...prev, { role: 'assistant', content: '已拒绝该操作。', id: uid() }]);
        return;
      }
      setStreaming(true);
      try {
        await streamEvents(`/api/sessions/${session.id}/resume`, {}, handleStreamEvent);
      } catch (e) {
        setStreaming(false);
        setMessages((prev) => [...prev, { role: 'assistant', content: `恢复失败：${e.message}`, id: uid() }]);
      }
    },
    [pendingApproval, session?.id, handleStreamEvent]
  );

  const switchMode = useCallback(
    async (modeId) => {
      if (modeId === selectedMode) return;
      if (session) {
        const r = await api.switchMode(session.id, modeId);
        setSession(r.session);
        setMessages(r.session.messages || []);
      }
      setSelectedMode(modeId);
    },
    [selectedMode, session]
  );

  const newSession = useCallback(async () => {
    const body = { modeId: selectedMode };
    if (selectedMode === 'roleplay' && selectedCharacterId) body.characterId = selectedCharacterId;
    const r = await api.createSession(body);
    await refreshSessions();
    await openSession(r.session.id);
  }, [selectedMode, selectedCharacterId, refreshSessions, openSession]);

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
        toast(`已切换到「${m.name}」`, 'success');
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
    { id: 'theme', label: `切换主题（当前：${theme === 'dark' ? '深色' : '浅色'}）`, hint: 'D', icon: theme === 'dark' ? Sun : Moon, run: toggleTheme, keywords: '主题 深浅 theme dark light' },
    ...(selectedMode === 'code'
      ? [{ id: 'undo', label: '撤销到最近快照', hint: 'U', icon: Undo2, run: undo, keywords: '撤销 快照 undo' }]
      : []),
    ...(session
      ? [{ id: 'export', label: '导出当前会话', hint: 'Ctrl+E', icon: FolderDown, run: exportCurrentSession, keywords: '导出 会话 export' }]
      : []),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paper text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          currentId={session?.id}
          onOpen={openSession}
          onNew={newSession}
          onImport={importSessionFile}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur">
          <div className="flex items-center gap-5">
            <span className="font-serif-display text-xl tracking-[0.35em] text-ink">M O D E O</span>
            <ModeTabs modes={modes} selected={selectedMode} onSelect={switchMode} />
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content={theme === 'dark' ? '切换到浅色' : '切换到深色'}>
              <Button size="icon" variant="ghost" data-testid="btn-theme" onClick={toggleTheme}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
            onSend={sendMessage}
            onStop={stopStreaming}
            onTransparency={() => setDialog((d) => ({ ...d, transparency: true }))}
            onSlashCommand={handleSlashCommand}
            onUnknownSlash={handleUnknownSlash}
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
