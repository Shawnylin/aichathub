const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('maximize-change', (_, val) => cb(val)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
