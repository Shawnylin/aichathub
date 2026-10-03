const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('float', {
  getSettings: () => ipcRenderer.invoke('float-ball-get-settings'),
  onSettingsChange: cb => ipcRenderer.on('float-ball-settings-change', (_, value) => cb(value)),
  onClick: () => ipcRenderer.send('float-ball-click'),
  onDragStart: (x, y) => ipcRenderer.send('float-ball-drag-start', x, y),
  onFacingChange: cb => ipcRenderer.on('float-ball-facing-change', (_, value) => cb(value)),
  onDragEnd: () => ipcRenderer.send('float-ball-drag-end'),
  showContextMenu: () => ipcRenderer.send('float-ball-context-menu'),
  onFadeOut: (cb) => ipcRenderer.on('float-ball-fade-out', () => cb()),
  onFadeIn: (cb) => ipcRenderer.on('float-ball-fade-in', () => cb()),
  onAccentChange: (cb) => ipcRenderer.on('float-ball-accent-change', (_, color) => cb(color)),
  onGlassChange: (cb) => ipcRenderer.on('float-ball-glass-change', (_, value) => cb(value))
});
