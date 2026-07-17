const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  quit: () => ipcRenderer.send('app-quit'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('maximize-change', (_, val) => cb(val)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onSwitchSite: (cb) => ipcRenderer.on('switch-site', (_, site) => cb(site)),
  setFloatBall: (enabled) => ipcRenderer.send('set-float-ball', enabled),
  showContextMenu: () => ipcRenderer.send('show-context-menu', 'normal'),
  updateSiteOrder: (order) => ipcRenderer.send('update-site-order', order),
  updateFloatballSettings: () => ipcRenderer.send('update-floatball-settings'),
  onContextMenuAction: (cb) => ipcRenderer.on('context-menu-action', (_, action) => cb(action)),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),

  // ======== 版本更新 API ========
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  openReleasesPage: () => ipcRenderer.send('open-releases-page'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, status, info) => cb(status, info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_, progress) => cb(progress)),

  // ======== 下载管理 API ========
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  setDownloadPath: () => ipcRenderer.invoke('set-download-path'),
  openDownloadFile: (filePath) => ipcRenderer.send('open-download-file', filePath),
  pauseDownload: (id) => ipcRenderer.send('pause-download', id),
  resumeDownload: (id) => ipcRenderer.send('resume-download', id),
  cancelDownload: (id) => ipcRenderer.send('cancel-download', id),
  deleteDownload: (id) => ipcRenderer.send('delete-download', id),
  removeDownloadRecord: (id) => ipcRenderer.send('remove-download-record', id),
  clearDownloads: () => ipcRenderer.send('clear-downloads'),
  onDownloadUpdate: (cb) => ipcRenderer.on('download-update', (_, dl) => cb(dl)),

  // ======== 权限管理 API ========
  getPermissions: () => ipcRenderer.invoke('get-permissions'),
  setPermission: (site, permission, value) => ipcRenderer.invoke('set-permission', site, permission, value),
});
