const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('maximize', () => mainWindow.webContents.send('maximize-change', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('maximize-change', false));

  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow.close());
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized());
  ipcMain.handle('open-external', (_, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch(_) {}
  });
}

app.whenReady().then(() => {
  const sites = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax'];
  sites.forEach(site => {
    const ses = session.fromPartition(`persist:${site}`);
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['clipboard-sanitized-write', 'clipboard-read'];
      callback(allowed.includes(permission));
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
