const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('maximize-change', (_, val) => cb(val)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onSwitchSite: (cb) => ipcRenderer.on('switch-site', (_, site) => cb(site)),
  setFloatBall: (enabled) => ipcRenderer.send('set-float-ball', enabled),
  showContextMenu: () => ipcRenderer.send('show-context-menu', 'normal'),
  updateSiteOrder: (order) => ipcRenderer.send('update-site-order', order),
  onContextMenuAction: (cb) => ipcRenderer.on('context-menu-action', (_, action) => cb(action))
});
