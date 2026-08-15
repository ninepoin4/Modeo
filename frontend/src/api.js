const BASE = '';

async function request(path, { method = 'GET', body, accept } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accept) headers['Accept'] = accept;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

export const api = {
  health: () => request('/api/health'),
  modes: () => request('/api/modes'),
  mode: (id) => request(`/api/modes/${id}`),
  createMode: (config) => request('/api/modes', { method: 'POST', body: { config } }),
  updateMode: (id, config) => request(`/api/modes/${id}`, { method: 'PUT', body: { config } }),
  deleteMode: (id) => request(`/api/modes/${id}`, { method: 'DELETE' }),
  plugins: () => request('/api/plugins'),
  reloadPlugins: () => request('/api/plugins/reload', { method: 'POST' }),
  sessions: () => request('/api/sessions'),
  createSession: (body) => request('/api/sessions', { method: 'POST', body }),
  importSession: (session) => request('/api/sessions/import', { method: 'POST', body: { session } }),
  session: (id) => request(`/api/sessions/${id}`),
  deleteSession: (id) => request(`/api/sessions/${id}`, { method: 'DELETE' }),
  exportSession: (id) => request(`/api/sessions/${id}/export`),
  switchMode: (id, modeId) => request(`/api/sessions/${id}/switch-mode`, { method: 'POST', body: { modeId } }),
  setGoal: (id, goal) => request(`/api/sessions/${id}/goal`, { method: 'PUT', body: { goal } }),
  setPermissionMode: (id, mode, confirm) => request(`/api/sessions/${id}/permission-mode`, { method: 'PUT', body: { mode, confirm } }),
  compress: (id) => request(`/api/sessions/${id}/compress`, { method: 'POST' }),
  clearSession: (id) => request(`/api/sessions/${id}/clear`, { method: 'POST' }),
  addCast: (id, characterId) => request(`/api/sessions/${id}/characters`, { method: 'POST', body: { characterId } }),
  removeCast: (id, characterId) => request(`/api/sessions/${id}/characters/${characterId}`, { method: 'DELETE' }),
  setActive: (id, characterId) => request(`/api/sessions/${id}/active-character`, { method: 'POST', body: { characterId } }),
  worldState: (id, updates) => request(`/api/sessions/${id}/world-state`, { method: 'PUT', body: { updates } }),
  clearWorldState: (id) => request(`/api/sessions/${id}/world-state`, { method: 'DELETE' }),
  checkpoints: (id) => request(`/api/sessions/${id}/checkpoints`),
  restoreCheckpoint: (id, checkpointId) =>
    request(`/api/sessions/${id}/checkpoints/restore`, { method: 'POST', body: { checkpointId } }),
  prompt: (id) => request(`/api/prompt/${id}`),
  characters: () => request('/api/characters'),
  character: (id) => request(`/api/characters/${id}`),
  parse: (yaml) => request('/api/characters/parse', { method: 'POST', body: { yaml } }),
  stringify: (data) => request('/api/characters/stringify', { method: 'POST', body: { data } }),
  saveCharacter: (yaml, id) =>
    id ? request(`/api/characters/${id}`, { method: 'PUT', body: { yaml } }) : request('/api/characters', { method: 'POST', body: { yaml } }),
  deleteCharacter: (id) => request(`/api/characters/${id}`, { method: 'DELETE' }),
  exportCharacterCcv3: (id) => request(`/api/characters/${id}/export-ccv3`),
  importCcv3: (json) => request('/api/characters/import-ccv3', { method: 'POST', body: { json } }),
  importCcv3Png: (pngBase64) => request('/api/characters/import-ccv3', { method: 'POST', body: { pngBase64 } }),
  exportPack: (name) => request('/api/characters/export-pack', { method: 'POST', body: { name } }),
  importPack: (pack) => request('/api/characters/import-pack', { method: 'POST', body: { pack } }),
  importPackUrl: (url) => request('/api/characters/import-pack-url', { method: 'POST', body: { url } }),
  marketRefresh: (url) => request('/api/characters/market/refresh', { method: 'POST', body: { url } }),
  marketInstall: (url) => request('/api/characters/market/install', { method: 'POST', body: { url } }),
  packs: () => request('/api/characters/packs'),
  packsImport: (packId) => request('/api/characters/packs/import', { method: 'POST', body: { packId } }),
  packsSave: (id, pack) => request('/api/characters/packs/save', { method: 'POST', body: { id, pack } }),
  packsDelete: (id) => request(`/api/characters/packs/${id}`, { method: 'DELETE' }),
  approvals: () => request('/api/approvals/pending'),
  decideApproval: (id, decision, sessionId, args) => request(`/api/approvals/${id}`, { method: 'POST', body: { decision, sessionId, args } }),
  answerQuestion: (id, answer) => request(`/api/sessions/${id}/answer-question`, { method: 'POST', body: { answer } }),
  skipQuestion: (id) => request(`/api/sessions/${id}/answer-question`, { method: 'POST', body: { skipped: true } }),
  settings: () => request('/api/settings'),
  saveSettings: (settings) => request('/api/settings', { method: 'POST', body: settings }),
  themes: () => request('/api/themes'),
  saveTheme: (theme) => request('/api/themes', { method: 'POST', body: theme }),
  deleteTheme: (id) => request(`/api/themes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadThemeBackground: (dataUrl) => request('/api/themes/background', { method: 'POST', body: { dataUrl } }),
  uploadFile: (name, data) => request('/api/uploads', { method: 'POST', body: { name, data } }),
};

/** 读取 SSE 流，逐事件回调 */
export async function streamEvents(path, body, onEvent, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || '请求失败');
  }
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
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed */
      }
    }
  }
}
