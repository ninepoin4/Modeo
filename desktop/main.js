/**
 * Modeo 桌面封装：启动内置 Node 服务后以 Electron 窗口加载本地界面。
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

app.setName('Modeo');

const SERVER_PORT = Number(process.env.MODEO_PORT || 8787);
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'modeo') : path.join(__dirname, '..');
const APP_URL = `http://127.0.0.1:${SERVER_PORT}`;

/** 便携/打包模式下，把内置资源首次复制到用户数据目录，保证可读写、可持久化。 */
function seedUserDir(target, source) {
  try {
    if (fs.existsSync(target)) return;
    fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(source)) return;
    for (const f of fs.readdirSync(source)) {
      const src = path.join(source, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(target, f));
    }
  } catch {
    // 种子失败不阻塞启动
  }
}

function serverEnv() {
  const env = { ...process.env, MODEO_PORT: String(SERVER_PORT) };
  if (app.isPackaged) {
    const ud = app.getPath('userData');
    const dataDir = path.join(ud, 'data');
    const wsDir = path.join(ud, 'workspaces', 'default');
    const charDir = path.join(ud, 'characters');
    const packsDir = path.join(ud, 'packs');
    const pluginsDir = path.join(ud, 'plugins');
    seedUserDir(charDir, path.join(SERVER_DIR, 'characters'));
    seedUserDir(packsDir, path.join(SERVER_DIR, 'characters', 'packs'));
    seedUserDir(pluginsDir, path.join(SERVER_DIR, 'plugins'));
    seedUserDir(wsDir, path.join(SERVER_DIR, 'workspaces', 'default'));
    fs.mkdirSync(dataDir, { recursive: true });
    env.MODEO_DATA_DIR = dataDir;
    env.MODEO_WORKSPACE_DIR = wsDir;
    env.MODEO_CHARACTERS_DIR = charDir;
    env.MODEO_PACKS_DIR = packsDir;
    env.MODEO_PLUGINS_DIR = pluginsDir;
  }
  return env;
}

function waitForServer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          // 身份校验（2026-08-15 审查修复）：必须是 Modeo 的 /api/health 响应，
          // 防止端口被恶意进程抢占后加载钓鱼页面骗取 API key
          try {
            const j = JSON.parse(body);
            if (j && j.ok === true && typeof j.modes === 'number') return resolve();
          } catch {
            /* 非 JSON 响应 */
          }
          if (Date.now() - started > timeoutMs) reject(new Error('端口被非 Modeo 服务占用'));
          else setTimeout(tick, 300);
        });
        res.on('error', () => {});
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('等待 Modeo 服务超时'));
        else setTimeout(tick, 300);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

let serverProc = null;
let mainWindow = null;

app.whenReady().then(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...serverEnv(), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    await waitForServer(APP_URL);
  } catch (err) {
    console.error('启动失败:', err.message);
    app.exit(1);
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    title: 'Modeo',
    backgroundColor: '#f8f6f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('maximize', () => mainWindow.webContents.send('modeo:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('modeo:maximized', false));

  if (process.argv.includes('--smoke')) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('MODOE_SMOKE_OK');
      setTimeout(() => app.quit(), 500);
    });
    setTimeout(() => {
      console.log('MODOE_SMOKE_TIMEOUT');
      app.exit(1);
    }, 25000);
  }
});

ipcMain.on('modeo:minimize', () => mainWindow?.minimize());
ipcMain.on('modeo:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('modeo:close', () => mainWindow?.close());

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
  }
});
