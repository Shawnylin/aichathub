const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('float', {
  onClick: () => ipcRenderer.send('float-ball-click'),
  onDrag: (dx, dy) => ipcRenderer.send('float-ball-drag', dx, dy),
  showContextMenu: () => ipcRenderer.send('float-ball-context-menu'),
  closeFloat: () => ipcRenderer.send('float-ball-close')
});
