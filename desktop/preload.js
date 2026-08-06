const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modeoWindow', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('modeo:minimize'),
  toggleMaximize: () => ipcRenderer.send('modeo:toggle-maximize'),
  close: () => ipcRenderer.send('modeo:close'),
  onMaximizedChange: (cb) => {
    ipcRenderer.on('modeo:maximized', (_e, v) => cb(v));
  },
});
