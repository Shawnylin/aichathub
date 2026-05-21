const { app, BrowserWindow, session, ipcMain, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let floatBall = null;
let isQuitting = false;
let floatBallEnabled = true;
let floatBallPos = null;

const SITE_NAMES = {
  deepseek: 'DeepSeek',
  yuanbao: '腾讯元宝',
  doubao: '豆包',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  tongyi: '千问'
};
let SITE_ORDER = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax', 'tongyi'];

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

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('hide', () => {
    if (floatBallEnabled) createFloatBall();
  });

  mainWindow.on('show', () => {
    destroyFloatBall();
  });

  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow.hide());
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized());
  ipcMain.handle('open-external', (_, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch(_) {}
  });

  ipcMain.on('set-float-ball', (_, enabled) => {
    floatBallEnabled = enabled;
    if (!enabled) destroyFloatBall();
  });

  ipcMain.on('update-site-order', (_, order) => {
    SITE_ORDER = order;
    if (tray) buildTrayMenu();
  });

  ipcMain.on('show-context-menu', (_, action) => {
    const wv = mainWindow.webContents;
    const menuItems = [
      { label: '返回',     click: () => wv.send('context-menu-action', 'back') },
      { label: '前进',     click: () => wv.send('context-menu-action', 'forward') },
      { label: '刷新',     click: () => wv.send('context-menu-action', 'reload') },
      { type: 'separator' },
      { label: '复制',     click: () => wv.send('context-menu-action', 'copy') },
      { label: '粘贴',     click: () => wv.send('context-menu-action', 'paste') },
      { label: '全选',     click: () => wv.send('context-menu-action', 'selectAll') },
    ];

    if (action === 'selection') {
      menuItems.unshift(
        { label: '复制选中', click: () => wv.send('context-menu-action', 'copy') },
        { type: 'separator' }
      );
    }

    const menu = Menu.buildFromTemplate(menuItems);
    menu.popup({ window: mainWindow });
  });
}

function createFloatBall() {
  if (floatBall) return;
  if (!floatBallPos) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    floatBallPos = { x: width - 116, y: height - 116 };
  }
  floatBall = new BrowserWindow({
    width: 100, height: 100,
    x: floatBallPos.x,
    y: floatBallPos.y,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'floatball-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatBall.loadFile(path.join(__dirname, 'floatball.html'));
  floatBall.setAlwaysOnTop(true, 'floating');
  floatBall.on('closed', () => { floatBall = null; });
}

ipcMain.on('float-ball-click', () => {
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('float-ball-drag', (_, dx, dy) => {
  if (floatBall && Number.isFinite(dx) && Number.isFinite(dy)) {
    const [x, y] = floatBall.getPosition();
    const nx = Math.round(x + dx);
    const ny = Math.round(y + dy);
    floatBall.setPosition(nx, ny);
    floatBallPos = { x: nx, y: ny };
  }
});

function destroyFloatBall() {
  if (floatBall) {
    floatBall.close();
    floatBall = null;
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'logo-32.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('AI Chat Hub');

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  buildTrayMenu();
}

function buildTrayMenu() {
  const siteItems = SITE_ORDER.map(site => ({
    label: SITE_NAMES[site],
    click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('switch-site', site);
      }
    }
  }));

  const contextMenu = Menu.buildFromTemplate([
    ...siteItems,
    { type: 'separator' },
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '完全退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  const sites = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax', 'tongyi'];
  sites.forEach(site => {
    const ses = session.fromPartition(`persist:${site}`);
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['clipboard-sanitized-write', 'clipboard-read'];
      callback(allowed.includes(permission));
    });
  });

  createWindow();
  createTray();

  // 监听悬浮球关闭事件 → 恢复主窗口
  app.on('browser-window-blur', () => {});
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});
