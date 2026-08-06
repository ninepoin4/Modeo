/**
 * Modeo 桌面封装：启动内置 Node 服务后以 Electron 窗口加载本地界面。
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const SERVER_PORT = Number(process.env.MODEO_PORT || 8787);
const SERVER_DIR = path.join(__dirname, '..');
const APP_URL = `http://127.0.0.1:${SERVER_PORT}`;

function waitForServer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
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
  serverProc = spawn('node', ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, MODEO_PORT: String(SERVER_PORT) },
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
