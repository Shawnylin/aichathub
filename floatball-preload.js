const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('float', {
  onClick: () => ipcRenderer.send('float-ball-click'),
  onDrag: (dx, dy) => ipcRenderer.send('float-ball-drag', dx, dy),
  showContextMenu: () => ipcRenderer.send('float-ball-context-menu'),
  closeFloat: () => ipcRenderer.send('float-ball-close'),
  onFadeOut: (cb) => ipcRenderer.on('float-ball-fade-out', () => cb()),
  onFadeIn: (cb) => ipcRenderer.on('float-ball-fade-in', () => cb()),
  onSettingsUpdate: (cb) => ipcRenderer.on('apply-floatball-settings', () => cb())
});
