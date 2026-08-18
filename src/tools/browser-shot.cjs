// Electron 无头截图脚本（browser_screenshot 工具调用，CommonJS）
// 用法: electron.exe browser-shot.cjs <url> <out.png> [waitMs]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 1200);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { offscreen: false, sandbox: true },
  });
  try {
    await win.loadURL(url, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, Math.max(200, Math.min(15000, waitMs))));
    const img = await win.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log('OK ' + out);
    app.exit(0);
  } catch (e) {
    console.error('ERR ' + e.message);
    app.exit(1);
  }
});
