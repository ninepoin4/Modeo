const $ = (id) => document.getElementById(id);

const state = {
  modes: [],
  sessions: [],
  characters: [],
  settings: null,
  currentSessionId: null,
  selectedMode: 'chat',
  selectedCharacterId: null,
  currentCast: [],
  activeCharacterId: null,
  worldState: {},
  pendingApproval: null,
  streaming: false,
};
let streamingBubble = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

async function init() {
  const [modesRes, sessionsRes, charsRes, settingsRes] = await Promise.all([
    api('/api/modes'), api('/api/sessions'), api('/api/characters'), api('/api/settings'),
  ]);
  state.modes = modesRes.modes;
  state.sessions = sessionsRes.sessions;
  state.characters = charsRes.characters;
  state.settings = settingsRes.settings;
  if (state.modes.length) state.selectedMode = state.modes[0].id;
  renderModes(); renderSessions(); renderCharacters(); renderPacks();
  $('marketUrl').value = state.settings.marketUrl || '';
  renderMarket();
  if (state.sessions.length) {
    await openSession(state.sessions[0].id);
  } else {
    await newSession();
  }
}

function renderModes() {
  const tabs = $('modeTabs');
  tabs.innerHTML = '';
  for (const m of state.modes) {
    const b = document.createElement('button');
    b.className = 'mode-tab' + (m.id === state.selectedMode ? ' active' : '');
    b.textContent = m.name;
    b.title = m.description;
    b.onclick = () => switchMode(m.id);
    tabs.appendChild(b);
  }
  updateBanner();
}

function updateBanner() {
  const m = state.modes.find((x) => x.id === state.selectedMode);
  const banner = $('modeBanner');
  banner.textContent = m
    ? `当前模式：${m.name} — ${m.description}${m.id === 'chat' ? '（零注入：无任何前置提示词）' : ''}`
    : '';
  document.querySelector('.layout').className =
    'layout' +
    (state.selectedMode === 'roleplay' ? ' has-characters' : '') +
    (state.selectedMode === 'code' ? ' has-tools' : '');
  $('characterSidebar').classList.toggle('hidden', state.selectedMode !== 'roleplay');
  $('toolPanel').classList.toggle('hidden', state.selectedMode !== 'code');
  if (state.selectedMode === 'roleplay') renderCharacters();
  if (state.selectedMode === 'roleplay') renderMarket();
  if (state.selectedMode === 'roleplay') renderCast();
  if (state.selectedMode === 'roleplay' && state.currentSessionId) renderWorldState();
  if (state.selectedMode === 'code') renderToolLog();
}

function renderSessions() {
  const ul = $('sessionList');
  ul.innerHTML = '';
  for (const s of state.sessions) {
    const li = document.createElement('li');
    li.className = s.id === state.currentSessionId ? 'active' : '';
    li.innerHTML = `${esc(s.title)}<div class="meta">${esc(s.modeId)}${s.characterId ? ' · ' + esc(s.characterId) : ''}</div>`;
    li.onclick = () => openSession(s.id);
    li.oncontextmenu = (e) => {
      e.preventDefault();
      exportSessionFile(s.id);
    };
    ul.appendChild(li);
  }
}

async function exportSessionFile(id) {
  try {
    const data = await api(`/api/sessions/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `modeo-session-${id.slice(0, 8)}.json`;
    a.click();
  } catch (e) {
    alert('导出失败：' + e.message);
  }
}

async function importSessionFile() {
  const file = $('sessionFile').files[0];
  if (!file) return;
  try {
    const session = JSON.parse(await file.text());
    const res = await api('/api/sessions/import', { method: 'POST', body: JSON.stringify({ session }) });
    state.sessions.unshift({ id: res.session.id, title: res.session.title, modeId: res.session.modeId, characterId: res.session.characterId });
    renderSessions();
    await openSession(res.session.id);
  } catch (e) {
    alert('导入失败：' + e.message);
  }
  $('sessionFile').value = '';
}

function renderCharacters() {
  const ul = $('characterList');
  ul.innerHTML = '';
  for (const c of state.characters) {
    const li = document.createElement('li');
    li.className = c.id === state.selectedCharacterId ? 'active' : '';
    li.innerHTML = `${esc(c.name)}<div class="meta">${esc(c.id)}${c.tags && c.tags.length ? ' · ' + esc(c.tags.join(', ')) : ''}</div>`;
    li.onclick = () => {
      if (state.selectedMode === 'roleplay' && state.currentSessionId) {
        addToCast(c.id);
      } else {
        state.selectedCharacterId = c.id;
        renderCharacters();
      }
    };
    li.oncontextmenu = (e) => {
      e.preventDefault();
      openCharacterEditor(c.id);
    };
    ul.appendChild(li);
  }
  $('characterBadge').classList.toggle('hidden', !state.selectedCharacterId);
  if (state.selectedCharacterId) {
    const c = state.characters.find((x) => x.id === state.selectedCharacterId);
    $('characterBadge').textContent = `当前角色：${c ? c.name : state.selectedCharacterId}（右键角色可编辑/导出）`;
  }
}

async function renderPacks() {
  const ul = $('packsList');
  let packs = [];
  try {
    const res = await api('/api/characters/packs');
    packs = res.packs || [];
  } catch {
    packs = [];
  }
  ul.innerHTML = '';
  if (!packs.length) {
    const li = document.createElement('li');
    li.textContent = '（暂无本地角色包）';
    ul.appendChild(li);
    return;
  }
  for (const p of packs) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(p.name)}<div class="meta">${p.characterCount} 个角色${p.author ? ' · ' + esc(p.author) : ''}</div>`;
    const btn = document.createElement('button');
    btn.className = 'small-btn';
    btn.textContent = '安装';
    btn.onclick = async () => installPack(p.id);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function exportPack() {
  try {
    const data = await api('/api/characters/export-pack', { method: 'POST', body: JSON.stringify({ name: 'Modeo 角色包' }) });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `modeo-pack-${Date.now()}.modeopack.json`;
    a.click();
  } catch (e) {
    alert('导出失败：' + e.message);
  }
}

async function importPackFile() {
  const file = $('packFile').files[0];
  if (!file) return;
  try {
    const pack = JSON.parse(await file.text());
    const res = await api('/api/characters/import-pack', { method: 'POST', body: JSON.stringify({ pack }) });
    const r = res.result;
    alert(`安装完成：新增 ${r.imported.length}，跳过 ${r.skipped.length}`);
    state.characters = (await api('/api/characters')).characters;
    renderCharacters();
    renderPacks();
  } catch (e) {
    alert('导入失败：' + e.message);
  }
  $('packFile').value = '';
}

async function installPack(packId) {
  try {
    const res = await api('/api/characters/packs/import', { method: 'POST', body: JSON.stringify({ packId }) });
    const r = res.result;
    alert(`安装完成：新增 ${r.imported.length}，跳过 ${r.skipped.length}`);
    state.characters = (await api('/api/characters')).characters;
    renderCharacters();
  } catch (e) {
    alert('安装失败：' + e.message);
  }
}

async function refreshMarket() {
  const url = $('marketUrl').value.trim();
  if (!url) {
    alert('请先填写市场索引 URL');
    return;
  }
  try {
    const res = await api('/api/characters/market/refresh', { method: 'POST', body: JSON.stringify({ url }) });
    state.marketPacks = res.index.packs || [];
    renderMarket();
    state.settings.marketUrl = url;
    await api('/api/settings', { method: 'POST', body: JSON.stringify(state.settings) });
  } catch (e) {
    alert('刷新失败：' + e.message);
  }
}

async function installMarketPack(pack) {
  if (!confirm(`从市场安装「${pack.name}」？`)) return;
  try {
    const res = await api('/api/characters/market/install', { method: 'POST', body: JSON.stringify({ url: pack.url }) });
    const r = res.result;
    alert(`安装完成：新增 ${r.imported.length}，跳过 ${r.skipped.length}`);
    state.characters = (await api('/api/characters')).characters;
    renderCharacters();
  } catch (e) {
    alert('安装失败：' + e.message);
  }
}

function renderMarket() {
  const ul = $('marketList');
  ul.innerHTML = '';
  const packs = state.marketPacks || [];
  if (!packs.length) {
    const li = document.createElement('li');
    li.textContent = '（输入索引 URL 后点刷新）';
    ul.appendChild(li);
    return;
  }
  for (const p of packs) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(p.name)}<div class="meta">${p.author ? esc(p.author) + ' · ' : ''}${esc(p.description || '')}</div>`;
    const btn = document.createElement('button');
    btn.className = 'small-btn';
    btn.textContent = '安装';
    btn.onclick = () => installMarketPack(p);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function openSession(id) {
  const { session } = await api(`/api/sessions/${id}`);
  state.currentSessionId = session.id;
  state.selectedMode = session.modeId;
  if (session.characterId) state.selectedCharacterId = session.characterId;
  state.currentCast = session.characters || [];
  state.activeCharacterId = session.characterId;
  state.worldState = session.worldState || {};
  renderModes(); renderSessions(); renderMessages(session.messages); renderToolLog(session.messages);
  renderWorldState();
  renderCast();
}

function renderCast() {
  const ul = $('castList');
  if (!ul) return;
  ul.innerHTML = '';
  const ids = state.currentCast || [];
  if (!ids.length) {
    const li = document.createElement('li');
    li.textContent = '（点击上方角色加入阵容）';
    ul.appendChild(li);
    $('characterBadge').classList.add('hidden');
    return;
  }
  const names = new Map((state.characters || []).map((c) => [c.id, c.name]));
  for (const cid of ids) {
    const li = document.createElement('li');
    const active = cid === state.activeCharacterId;
    li.className = active ? 'active' : '';
    li.innerHTML = `${esc(names.get(cid) || cid)}<div class="meta">${active ? '当前发言' : '在场'}</div>`;
    li.onclick = () => setActiveCharacter(cid);
    const rm = document.createElement('button');
    rm.className = 'small-btn';
    rm.textContent = '×';
    rm.onclick = async (e) => {
      e.stopPropagation();
      await removeFromCast(cid);
    };
    li.appendChild(rm);
    ul.appendChild(li);
  }
  const activeName = names.get(state.activeCharacterId) || state.activeCharacterId;
  $('characterBadge').classList.remove('hidden');
  $('characterBadge').textContent = `当前角色：${activeName}`;
}

async function addToCast(characterId) {
  try {
    const res = await api(`/api/sessions/${state.currentSessionId}/characters`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    });
    state.currentCast = res.session.characters || [];
    state.activeCharacterId = res.session.characterId;
    renderCast();
  } catch (e) {
    alert('添加失败：' + e.message);
  }
}

async function setActiveCharacter(characterId) {
  try {
    const res = await api(`/api/sessions/${state.currentSessionId}/active-character`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    });
    state.activeCharacterId = res.session.characterId;
    renderCast();
  } catch (e) {
    alert('切换失败：' + e.message);
  }
}

async function removeFromCast(characterId) {
  try {
    const res = await api(`/api/sessions/${state.currentSessionId}/characters/${characterId}`, { method: 'DELETE' });
    state.currentCast = res.session.characters || [];
    state.activeCharacterId = res.session.characterId;
    renderCast();
  } catch (e) {
    alert('移除失败：' + e.message);
  }
}

function renderWorldState() {
  const box = $('worldStateList');
  if (!box) return;
  const ws = state.worldState || {};
  const entries = Object.entries(ws).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) {
    box.textContent = '（空）';
    return;
  }
  box.innerHTML = '';
  for (const [k, v] of entries) {
    const row = document.createElement('div');
    row.className = 'ws-row';
    row.innerHTML = `<span class="ws-key">${esc(k)}</span><span class="ws-val">${esc(v)}</span>`;
    box.appendChild(row);
  }
}

async function refreshWorldState() {
  if (!state.currentSessionId) return;
  const { session } = await api(`/api/sessions/${state.currentSessionId}`);
  state.worldState = session.worldState || {};
  renderWorldState();
}

async function openWorldStateEditor() {
  if (!state.currentSessionId) return;
  const root = $('modalRoot');
  const ws = state.worldState || {};
  root.innerHTML = `
    <div class="modal">
      <h3>世界状态记忆</h3>
      <p class="muted">以 JSON 对象维护：{"事实名": "事实内容"}。保存后会自动注入角色扮演的系统提示词，模型在剧情中可持续更新它。</p>
      <textarea id="wsJson" spellcheck="false">${esc(JSON.stringify(ws, null, 2))}</textarea>
      <div id="wsError" class="error-box"></div>
      <div class="modal-actions">
        <button class="btn danger" id="btnWsClear">清空</button>
        <button class="btn" id="btnWsCancel">取消</button>
        <button class="btn primary" id="btnWsSave">保存</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  $('btnWsCancel').onclick = () => root.classList.add('hidden');
  $('btnWsSave').onclick = async () => {
    const err = $('wsError');
    err.textContent = '';
    let parsed;
    try {
      parsed = JSON.parse($('wsJson').value || '{}');
    } catch (e) {
      err.textContent = 'JSON 解析失败：' + e.message;
      return;
    }
    try {
      const { session } = await api(`/api/sessions/${state.currentSessionId}/world-state`, {
        method: 'PUT',
        body: JSON.stringify({ worldState: parsed }),
      });
      state.worldState = session.worldState || {};
      renderWorldState();
      root.classList.add('hidden');
    } catch (e) {
      err.textContent = e.message;
    }
  };
  $('btnWsClear').onclick = async () => {
    const { session } = await api(`/api/sessions/${state.currentSessionId}/world-state`, { method: 'DELETE' });
    state.worldState = session.worldState || {};
    renderWorldState();
    root.classList.add('hidden');
  };
}

async function newSession() {
  const body = { modeId: state.selectedMode };
  if (state.selectedMode === 'roleplay' && state.selectedCharacterId) body.characterId = state.selectedCharacterId;
  const { session } = await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
  state.sessions.unshift({ id: session.id, title: session.title, modeId: session.modeId, characterId: session.characterId });
  await openSession(session.id);
  renderSessions();
}

async function switchMode(modeId) {
  if (modeId === state.selectedMode) return;
  if (state.currentSessionId) {
    const { session } = await api(`/api/sessions/${state.currentSessionId}/switch-mode`, {
      method: 'POST', body: JSON.stringify({ modeId }),
    });
    state.selectedMode = session.modeId;
    const idx = state.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) state.sessions[idx] = { id: session.id, title: session.title, modeId: session.modeId, characterId: session.characterId };
    renderMessages(session.messages); renderToolLog(session.messages);
  } else {
    state.selectedMode = modeId;
  }
  renderModes(); renderSessions();
}

function renderMessages(messages) {
  const box = $('messages');
  box.innerHTML = '';
  for (const m of messages || []) appendMessage(m);
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m) {
  const box = $('messages');
  if (m.role === 'tool') return; // 工具消息进入工具面板
  const div = document.createElement('div');
  div.className = `msg ${m.role}`;
  div.dataset.id = m.id || '';
  div.textContent = m.content || '';
  if (m.toolCalls && m.toolCalls.length) {
    const chips = document.createElement('div');
    for (const tc of m.toolCalls) {
      const span = document.createElement('span');
      span.className = 'tool-chip';
      span.textContent = `工具：${tc.name}`;
      chips.appendChild(span);
    }
    div.appendChild(chips);
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function renderToolLog(messages) {
  const log = $('toolLog');
  log.innerHTML = '';
  // 从会话消息中恢复工具活动：assistant.toolCalls 与 tool 消息配对
  const pending = new Map();
  for (const m of messages || []) {
    if (m.role === 'assistant' && Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls) {
        pending.set(tc.id || tc.name, { tc, result: null });
      }
    } else if (m.role === 'tool') {
      const key = m.toolCallId || m.name;
      const rec = pending.get(key);
      if (rec) {
        rec.result = { output: m.content, isError: false };
      } else {
        pending.set(key, { tc: { id: key, name: m.name || 'tool', args: {} }, result: { output: m.content, isError: false } });
      }
    }
  }
  for (const { tc, result } of pending.values()) addToolEntry(tc, result);
}

function addToolEntry(tc, result) {
  const log = $('toolLog');
  const entry = document.createElement('div');
  entry.className = 'tool-entry';
  const args = tc.args ? JSON.stringify(tc.args) : '';
  entry.innerHTML = `
    <div class="t-name">${esc(tc.name)}${result && result.isError ? '（错误）' : ''}</div>
    ${args ? `<div class="t-args">${esc(args)}</div>` : ''}
    ${result ? `<div class="t-out">${esc((result.output || '').slice(0, 6000))}</div>` : ''}
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function addCheckpointEntry(ckpt) {
  const log = $('toolLog');
  const entry = document.createElement('div');
  entry.className = 'tool-entry';
  entry.innerHTML = `<div class="t-name">✓ 已创建快照</div><div class="t-args">${esc(ckpt.label || ckpt.id)}</div>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

async function restoreCheckpoint() {
  if (!state.currentSessionId) return;
  const { checkpoints } = await api(`/api/sessions/${state.currentSessionId}/checkpoints`);
  if (!checkpoints.length) {
    alert('暂无可恢复的快照');
    return;
  }
  const latest = checkpoints[0];
  if (!confirm(`恢复最近快照？\n${latest.label || latest.id}\n当前工作区改动将被覆盖。`)) return;
  const { session } = await api(`/api/sessions/${state.currentSessionId}/checkpoints/restore`, {
    method: 'POST',
    body: JSON.stringify({ checkpointId: latest.id }),
  });
  renderMessages(session.messages);
  $('toolLog').innerHTML = '';
}

async function openDiff() {
  if (!state.currentSessionId) return;
  const root = $('modalRoot');
  let d;
  try {
    d = await api(`/api/sessions/${state.currentSessionId}/diff`);
  } catch (err) {
    root.innerHTML = `
      <div class="modal">
        <h3>改动审查</h3>
        <p>获取改动失败：${esc(err.message)}</p>
        <div class="modal-actions"><button class="btn" id="btnClose">关闭</button></div>
      </div>`;
    root.classList.remove('hidden');
    $('btnClose').onclick = () => root.classList.add('hidden');
    return;
  }
  const s = d.summary;
  const body = d.diffText
    ? d.diffText.split('\n').map((l) => {
        let cls = '';
        if (l.startsWith('+++') || l.startsWith('---')) cls = 'diff-meta';
        else if (l.startsWith('+')) cls = 'diff-add';
        else if (l.startsWith('-')) cls = 'diff-del';
        return `<div class="diff-line ${cls}">${esc(l)}</div>`;
      }).join('')
    : '<div class="diff-empty">（工作区与会话起点一致，无改动）</div>';
  root.innerHTML = `
    <div class="modal modal-wide">
      <h3>改动审查（相对会话基线）</h3>
      <div class="diff-summary">
        新增 ${s.added} 个文件 · 删除 ${s.removed} 个文件 · 修改 ${s.modified} 个文件 · +${s.linesAdded} / −${s.linesRemoved} 行
      </div>
      <div class="diff-view">${body}</div>
      <div class="modal-actions">
        <button class="btn danger" id="btnRestoreStart">还原到会话起点</button>
        <button class="btn primary" id="btnCloseDiff">关闭</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  $('btnCloseDiff').onclick = () => root.classList.add('hidden');
  $('btnRestoreStart').onclick = restoreToBaseline;
}

async function restoreToBaseline() {
  if (!state.currentSessionId) return;
  const root = $('modalRoot');
  const { checkpoints } = await api(`/api/sessions/${state.currentSessionId}/checkpoints`);
  if (!checkpoints.length) {
    root.classList.add('hidden');
    alert('暂无可还原的快照（尚无改动发生）。');
    return;
  }
  const oldest = checkpoints[checkpoints.length - 1];
  if (!confirm(`将工作区还原到会话起点（最旧快照）？\n当前所有改动都会被覆盖。`)) return;
  const { session } = await api(`/api/sessions/${state.currentSessionId}/checkpoints/restore`, {
    method: 'POST',
    body: JSON.stringify({ checkpointId: oldest.id }),
  });
  root.classList.add('hidden');
  renderMessages(session.messages);
  $('toolLog').innerHTML = '';
}

async function sendMessage(content) {
  if (!state.currentSessionId || state.streaming) return;
  state.streaming = true;
  $('btnSend').disabled = true;
  appendMessage({ role: 'user', content });
  const res = await fetch(`/api/sessions/${state.currentSessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    appendMessage({ role: 'assistant', content: '请求失败：' + text });
    state.streaming = false;
    $('btnSend').disabled = false;
    return;
  }
  let bubble = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      handleStreamEvent(evt, () => bubble);
      if (evt.type === 'done' && bubble) bubble.classList.remove('streaming');
    }
  }
  state.streaming = false;
  $('btnSend').disabled = false;
  refreshSessions();
  refreshWorldState();
}

function handleStreamEvent(evt, getBubble) {
  switch (evt.type) {
    case 'session': {
      const idx = state.sessions.findIndex((s) => s.id === evt.session.id);
      if (idx >= 0) state.sessions[idx] = { id: evt.session.id, title: evt.session.title, modeId: evt.session.modeId, characterId: evt.session.characterId };
      break;
    }
    case 'text_delta': {
      if (!streamingBubble || !streamingBubble.parentNode) {
        streamingBubble = appendMessage({ role: 'assistant', content: '' });
        streamingBubble.classList.add('streaming');
      }
      streamingBubble.textContent += evt.delta;
      const box = $('messages');
      box.scrollTop = box.scrollHeight;
      break;
    }
    case 'tool_call':
      addToolEntry(evt.toolCall, null);
      break;
    case 'tool_result':
      addToolEntry(evt.toolCall, evt.result);
      break;
    case 'checkpoint':
      addCheckpointEntry(evt.checkpoint);
      break;
    case 'approval_required':
      state.pendingApproval = evt;
      streamingBubble = null;
      showApprovalModal(evt);
      break;
    case 'done':
      if (streamingBubble) streamingBubble.classList.remove('streaming');
      streamingBubble = null;
      break;
    case 'error':
      streamingBubble = null;
      appendMessage({ role: 'assistant', content: '错误：' + evt.message });
      break;
  }
}

function showApprovalModal(evt) {
  const root = $('modalRoot');
  root.innerHTML = `
    <div class="modal">
      <h3>需要审批</h3>
      <p>Code 模式检测到危险操作，请确认是否允许执行：</p>
      <div class="approval-summary">${esc(evt.summary)}</div>
      <div class="modal-actions">
        <button class="btn danger" id="btnDeny">拒绝</button>
        <button class="btn primary" id="btnApprove">批准</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  $('btnApprove').onclick = () => resolveApproval('approve');
  $('btnDeny').onclick = () => resolveApproval('deny');
}

async function resolveApproval(decision) {
  const root = $('modalRoot');
  root.classList.add('hidden');
  const a = state.pendingApproval;
  state.pendingApproval = null;
  await api(`/api/approvals/${a.approvalId}`, { method: 'POST', body: JSON.stringify({ decision }) });
  if (decision === 'deny') {
    appendMessage({ role: 'assistant', content: '已拒绝该操作。' });
    return;
  }
  state.streaming = true;
  $('btnSend').disabled = true;
  const res = await fetch(`/api/sessions/${state.currentSessionId}/resume`, { method: 'POST', headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) {
    const text = await res.text();
    appendMessage({ role: 'assistant', content: '恢复失败：' + text });
    state.streaming = false;
    $('btnSend').disabled = false;
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  streamingBubble = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      handleStreamEvent(evt, () => streamingBubble);
    }
  }
  state.streaming = false;
  $('btnSend').disabled = false;
  refreshWorldState();
}

async function refreshSessions() {
  const { sessions } = await api('/api/sessions');
  state.sessions = sessions;
  renderSessions();
}

const CHARACTER_TEMPLATE = `id: my-character
name: 新角色
version: "1.0"
tags: []
description: 一段简短介绍
persona:
  identity: 你是谁
  background: 背景故事
  personality: 性格
  speakingStyle: 说话风格
setting:
  world: 世界观
  scenario: 当前场景
rules: []
boundaries: []
greeting: 开场白
example_messages: []
memory_seeds: []
`;

const CHAR_FIELDS = [
  { key: 'id', label: 'ID', type: 'text', hint: '小写字母/数字/下划线/连字符，可留空自动生成' },
  { key: 'name', label: '名称 *', type: 'text' },
  { key: 'version', label: '版本', type: 'text', hint: '例如 1.0' },
  { key: 'tags', label: '标签', type: 'lines', hint: '每行一个' },
  { key: 'description', label: '简介', type: 'textarea' },
  { key: 'persona.identity', label: '身份', type: 'textarea' },
  { key: 'persona.background', label: '背景', type: 'textarea' },
  { key: 'persona.personality', label: '性格', type: 'textarea' },
  { key: 'persona.speakingStyle', label: '说话风格', type: 'textarea' },
  { key: 'setting.world', label: '世界观', type: 'textarea' },
  { key: 'setting.scenario', label: '当前场景', type: 'textarea' },
  { key: 'rules', label: '行为规则', type: 'lines', hint: '每行一条' },
  { key: 'boundaries', label: '内容边界', type: 'lines', hint: '每行一条' },
  { key: 'greeting', label: '开场白', type: 'textarea' },
  { key: 'memory_seeds', label: '初始记忆', type: 'lines', hint: '每行一条' },
  { key: 'example_messages', label: '对话示例', type: 'json', hint: '[{"user":"提问","assistant":"回答"}]' },
];

let charEditorState = { id: null, view: 'source', yaml: '', form: null };

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? '' : acc[k]), obj);
}

function setPath(obj, dotted, val) {
  const keys = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = val;
  return obj;
}

function charToForm(data) {
  const form = {};
  for (const f of CHAR_FIELDS) {
    const v = getPath(data || {}, f.key);
    if (f.type === 'lines') form[f.key] = Array.isArray(v) ? v.join('\n') : '';
    else if (f.type === 'json') form[f.key] = v ? JSON.stringify(v, null, 2) : '';
    else form[f.key] = v == null ? '' : String(v);
  }
  return form;
}

function formToChar(form) {
  const data = {};
  for (const f of CHAR_FIELDS) {
    const raw = form[f.key] == null ? '' : String(form[f.key]).trim();
    if (f.type === 'lines') {
      setPath(data, f.key, raw ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);
    } else if (f.type === 'json') {
      let arr;
      try {
        arr = JSON.parse(raw || '[]');
      } catch (e) {
        throw new Error(`「${f.label}」不是合法 JSON：${e.message}`);
      }
      setPath(data, f.key, arr);
    } else {
      if (f.key === 'id' && !raw) {
        // 留空 id 由服务端自动生成
      } else {
        setPath(data, f.key, raw);
      }
    }
  }
  return data;
}

function charFormHtml(form) {
  let html = '';
  for (const f of CHAR_FIELDS) {
    if (charEditorState.id && f.key === 'id') continue; // 编辑时 id 是身份标识，不可改
    const idAttr = 'fld_' + f.key.replace(/\./g, '_');
    const v = form[f.key] || '';
    let ctl;
    if (f.type === 'textarea' || f.type === 'lines') ctl = `<textarea id="${idAttr}" rows="3" spellcheck="false">${esc(v)}</textarea>`;
    else if (f.type === 'json') ctl = `<textarea id="${idAttr}" rows="4" spellcheck="false">${esc(v)}</textarea>`;
    else ctl = `<input id="${idAttr}" value="${esc(v)}" />`;
    html += `<label>${esc(f.label)}${f.hint ? `<small> · ${esc(f.hint)}</small>` : ''}</label>${ctl}`;
  }
  return html;
}

function readCharForm() {
  const form = charEditorState.form || {};
  for (const f of CHAR_FIELDS) {
    const el = $('fld_' + f.key.replace(/\./g, '_'));
    if (el) form[f.key] = el.value;
  }
  return form;
}

async function switchCharView(view) {
  const st = charEditorState;
  if (st.view === view) return;
  const errEl = $('charError');
  if (view === 'form') {
    try {
      const { data } = await api('/api/characters/parse', {
        method: 'POST', body: JSON.stringify({ yaml: $('charYaml').value }),
      });
      st.form = charToForm(data);
      errEl.textContent = '';
    } catch (e) {
      errEl.textContent = '源码不是合法 YAML，无法切换到表单视图：' + e.message;
      return;
    }
  } else {
    try {
      const data = formToChar(readCharForm());
      const { yaml } = await api('/api/characters/stringify', {
        method: 'POST', body: JSON.stringify({ data }),
      });
      $('charYaml').value = yaml;
      errEl.textContent = '';
    } catch (e) {
      errEl.textContent = '表单数据无法转换：' + e.message;
      return;
    }
  }
  st.view = view;
  $('tabForm').classList.toggle('active', view === 'form');
  $('tabSource').classList.toggle('active', view === 'source');
  $('charFormPane').classList.toggle('hidden', view !== 'form');
  $('charSourcePane').classList.toggle('hidden', view !== 'source');
  if (view === 'form') $('charFormPane').innerHTML = charFormHtml(st.form || {});
}

async function openCharacterEditor(id = null) {
  const root = $('modalRoot');
  let yaml = CHARACTER_TEMPLATE;
  if (id) {
    const res = await api(`/api/characters/${id}`);
    yaml = res.yaml;
  }
  charEditorState = { id, view: 'source', yaml, form: null };
  root.innerHTML = `
    <div class="modal modal-wide">
      <h3>${id ? '编辑角色：' + esc(id) : '新建角色'}</h3>
      <div class="tabs">
        <button class="tab-btn" id="tabForm">表单</button>
        <button class="tab-btn active" id="tabSource">源码</button>
      </div>
      <div id="charFormPane" class="pane hidden"></div>
      <div id="charSourcePane" class="pane">
        <textarea id="charYaml" spellcheck="false">${esc(yaml)}</textarea>
      </div>
      <div id="charError" class="error-box"></div>
      <div class="modal-actions">
        ${id ? `<button class="btn danger" id="btnExport">导出 CCv3</button>` : ''}
        ${id ? `<button class="btn danger" id="btnDelete">删除</button>` : ''}
        <button class="btn" id="btnCancel">取消</button>
        <button class="btn primary" id="btnSave">保存</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  $('tabForm').onclick = () => switchCharView('form');
  $('tabSource').onclick = () => switchCharView('source');
  $('btnCancel').onclick = () => root.classList.add('hidden');
  $('btnSave').onclick = async () => {
    const err = $('charError');
    err.textContent = '';
    try {
      let yamlText;
      if (charEditorState.view === 'form') {
        const data = formToChar(readCharForm());
        yamlText = (await api('/api/characters/stringify', {
          method: 'POST', body: JSON.stringify({ data }),
        })).yaml;
      } else {
        yamlText = $('charYaml').value;
      }
      const saved = await api(id ? `/api/characters/${id}` : '/api/characters', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({ yaml: yamlText }),
      });
      state.characters = (await api('/api/characters')).characters;
      state.selectedCharacterId = saved.character.id;
      renderCharacters();
      root.classList.add('hidden');
    } catch (e) {
      err.textContent = e.message;
    }
  };
  if (id) {
    $('btnDelete').onclick = async () => {
      if (!confirm('确认删除该角色？')) return;
      await api(`/api/characters/${id}`, { method: 'DELETE' });
      state.characters = (await api('/api/characters')).characters;
      if (state.selectedCharacterId === id) state.selectedCharacterId = null;
      renderCharacters();
      root.classList.add('hidden');
    };
    $('btnExport').onclick = async () => {
      const data = await api(`/api/characters/${id}/export-ccv3`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}.ccv3.json`;
      a.click();
    };
  }
}

async function importCharacter() {
  const file = $('importFile').files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isPng = bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  let body;
  if (isPng) {
    body = { pngBase64: btoa(String.fromCharCode(...bytes)) };
  } else {
    body = { json: new TextDecoder().decode(bytes) };
  }
  try {
    const { character } = await api('/api/characters/import-ccv3', { method: 'POST', body: JSON.stringify(body) });
    state.characters = (await api('/api/characters')).characters;
    state.selectedCharacterId = character.id;
    renderCharacters();
    alert(`导入成功：${character.name}`);
  } catch (e) {
    alert('导入失败：' + e.message);
  }
  $('importFile').value = '';
}

async function openSettings() {
  const root = $('modalRoot');
  const s = state.settings;
  root.innerHTML = `
    <div class="modal">
      <h3>设置</h3>
      <label>模型提供商</label>
      <select id="setProvider">
        <option value="mock" ${s.provider === 'mock' ? 'selected' : ''}>Mock（离线演示）</option>
        <option value="openai" ${s.provider === 'openai' ? 'selected' : ''}>OpenAI 兼容 API</option>
      </select>
      <label>Base URL</label>
      <input id="setBaseUrl" value="${esc(s.baseUrl)}" />
      <label>API Key</label>
      <input id="setApiKey" type="password" value="${esc(s.apiKey)}" />
      <label>模型</label>
      <input id="setModel" value="${esc(s.model)}" />
      <label>Temperature</label>
      <input id="setTemp" type="number" step="0.1" min="0" max="2" value="${esc(s.temperature)}" />
      <label>角色市场索引 URL（可选）</label>
      <input id="setMarketUrl" placeholder="https://example.com/market.json" value="${esc(s.marketUrl || '')}" />
      <label>自定义模式（YAML harness 配置）</label>
      <div id="customModeList"></div>
      <textarea id="customModeYaml" spellcheck="false" placeholder="id: my-mode&#10;name: 我的模式&#10;systemPrompt: |&#10;  你的系统提示词&#10;tools: []&#10;defaultModel: mock"></textarea>
      <button class="btn primary" id="btnCreateMode">新建模式</button>
      <div class="modal-actions">
        <button class="btn" id="btnCancel">取消</button>
        <button class="btn primary" id="btnSave">保存</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  $('btnCancel').onclick = () => root.classList.add('hidden');
  $('btnSave').onclick = async () => {
    const settings = {
      provider: $('setProvider').value,
      baseUrl: $('setBaseUrl').value,
      apiKey: $('setApiKey').value,
      model: $('setModel').value,
      temperature: Number($('setTemp').value),
      marketUrl: $('setMarketUrl').value.trim(),
    };
    const res = await api('/api/settings', { method: 'POST', body: JSON.stringify(settings) });
    state.settings = res.settings;
    $('marketUrl').value = res.settings.marketUrl || '';
    root.classList.add('hidden');
  };
  renderCustomModeList();
  $('btnCreateMode').onclick = async () => {
    const yaml = $('customModeYaml').value;
    if (!yaml.trim()) return;
    try {
      await api('/api/modes', { method: 'POST', body: JSON.stringify({ config: yaml }) });
      await refreshModes();
      $('customModeYaml').value = '';
      renderCustomModeList();
    } catch (e) {
      alert('创建失败：' + e.message);
    }
  };
}

async function refreshModes() {
  const res = await api('/api/modes');
  state.modes = res.modes;
  renderModes();
}

function renderCustomModeList() {
  const box = $('customModeList');
  if (!box) return;
  const custom = (state.modes || []).filter((m) => !['chat', 'code', 'roleplay'].includes(m.id));
  box.innerHTML = '';
  if (!custom.length) {
    box.innerHTML = '<div class="sidebar-hint">（暂无自定义模式，填写上方 YAML 新建）</div>';
    return;
  }
  for (const m of custom) {
    const row = document.createElement('div');
    row.className = 'approval-summary';
    row.innerHTML = `<b>${esc(m.name)}</b> <span style="color:var(--muted)">${esc(m.id)}</span>`;
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '删除';
    del.onclick = async () => {
      if (!confirm(`确认删除自定义模式「${m.name}」？`)) return;
      try {
        await api(`/api/modes/${m.id}`, { method: 'DELETE' });
        await refreshModes();
        renderCustomModeList();
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    };
    row.appendChild(del);
    box.appendChild(row);
  }
}

async function openTransparency() {
  if (!state.currentSessionId) return;
  const root = $('modalRoot');
  const d = await api(`/api/prompt/${state.currentSessionId}`);
  const sys = d.systemPrompt === null || d.systemPrompt === ''
    ? '（无 — 零注入模式）'
    : d.systemPrompt;
  root.innerHTML = `
    <div class="modal">
      <h3>提示词透明面板</h3>
      <label>会话</label>
      <div>${esc(d.sessionId)} · ${esc(d.modeName)}</div>
      <label>系统提示词</label>
      <pre>${esc(sys)}</pre>
      <label>启用工具</label>
      <div>${d.tools.length ? esc(d.tools.join(', ')) : '（无工具）'}</div>
      <label>模型 / 消息数</label>
      <div>${esc(d.model)} · ${d.messageCount} 条</div>
      <label>实际发送的消息结构</label>
      <pre>${esc(JSON.stringify(d.messages, null, 2))}</pre>
      <div class="modal-actions"><button class="btn" id="btnClose">关闭</button></div>
    </div>`;
  root.classList.remove('hidden');
  $('btnClose').onclick = () => root.classList.add('hidden');
}

$('btnNewSession').onclick = newSession;
$('btnImportSession').onclick = () => $('sessionFile').click();
$('sessionFile').onchange = importSessionFile;
$('btnNewCharacter').onclick = () => openCharacterEditor();
$('btnImportCharacter').onclick = () => $('importFile').click();
$('btnExportPack').onclick = exportPack;
$('btnImportPack').onclick = () => $('packFile').click();
$('packFile').onchange = importPackFile;
$('btnMarketRefresh').onclick = refreshMarket;
$('importFile').onchange = importCharacter;
$('btnSettings').onclick = openSettings;
$('btnTransparency').onclick = openTransparency;
$('btnUndo').onclick = restoreCheckpoint;
$('btnDiff').onclick = openDiff;
$('btnEditWorldState').onclick = openWorldStateEditor;
$('composer').onsubmit = (e) => {
  e.preventDefault();
  const v = $('input').value.trim();
  if (!v) return;
  $('input').value = '';
  sendMessage(v);
};
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});

init().catch((e) => {
  $('modeBanner').textContent = '初始化失败：' + e.message;
});
