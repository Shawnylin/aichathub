const { app, BrowserWindow, session, ipcMain, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const { execSync } = require('child_process');

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

function checkForegroundFullscreen() {
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $src = @"
        using System;
        using System.Runtime.InteropServices;
        public class FS {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr h, out RECT r);
        }
        public struct RECT { public int L,T,R,B; }
"@;
      Add-Type -TypeDefinition $src;
      $r = New-Object RECT;
      [FS]::GetWindowRect([FS]::GetForegroundWindow(), [ref]$r);
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      ($r.L -le 0) -and ($r.T -le 0) -and ($r.R -ge $b.Width) -and ($r.B -ge $b.Height)
    `.replace(/\n/g, ' ');
    const out = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    return out.includes('True');
  } catch { return false; }
}

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
  mainWindow.setIcon(path.join(__dirname, 'assets', 'icon.ico'));

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
  ipcMain.on('app-quit', () => {
    isQuitting = true;
    app.quit();
  });
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

ipcMain.on('float-ball-close', () => {
  floatBallEnabled = false;
  destroyFloatBall();
  if (tray) buildTrayMenu();
});

ipcMain.on('float-ball-context-menu', () => {
  if (!floatBall) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '关闭悬浮窗',
      click: () => {
        floatBallEnabled = false;
        destroyFloatBall();
        if (tray) buildTrayMenu();
      }
    }
  ]);
  menu.popup({ window: floatBall });
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
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
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
      label: floatBallEnabled ? '关闭悬浮窗' : '开启悬浮窗',
      click: () => {
        if (floatBallEnabled) {
          floatBallEnabled = false;
          destroyFloatBall();
        } else {
          floatBallEnabled = true;
          if (mainWindow && !mainWindow.isVisible()) createFloatBall();
        }
        buildTrayMenu();
      }
    },
    { type: 'separator' },
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

  // 全屏检测：前台窗口全屏时隐藏悬浮球
  let fullscreenHidden = false;
  setInterval(() => {
    const fs = checkForegroundFullscreen();
    if (fs && !fullscreenHidden) {
      fullscreenHidden = true;
      destroyFloatBall();
    } else if (!fs && fullscreenHidden) {
      fullscreenHidden = false;
      if (floatBallEnabled && mainWindow && !mainWindow.isVisible()) {
        createFloatBall();
      }
    }
  }, 2000);

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
