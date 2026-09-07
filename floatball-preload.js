const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('float', {
  onClick: () => ipcRenderer.send('float-ball-click'),
  onDrag: (dx, dy) => ipcRenderer.send('float-ball-drag', dx, dy),
  onDragEnd: () => ipcRenderer.send('float-ball-drag-end'),
  showContextMenu: () => ipcRenderer.send('float-ball-context-menu'),
  onFadeOut: (cb) => ipcRenderer.on('float-ball-fade-out', () => cb()),
  onFadeIn: (cb) => ipcRenderer.on('float-ball-fade-in', () => cb()),
  onAccentChange: (cb) => ipcRenderer.on('float-ball-accent-change', (_, color) => cb(color)),
  onGlassChange: (cb) => ipcRenderer.on('float-ball-glass-change', (_, value) => cb(value))
});
