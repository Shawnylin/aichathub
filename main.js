const { app, BrowserWindow, session, ipcMain, shell, Tray, Menu, nativeImage, screen, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// ======== 日志配置 ========
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('App starting, version:', app.getVersion());

// ======== V8 配置 ========
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

// ======== 禁用硬件加速（解决某些 Windows 系统 GPU 兼容问题）=======
app.disableHardwareAcceleration();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ======== 全屏检测（Windows）========
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
          [DllImport("user32.dll")]
          public static extern int GetWindowLong(IntPtr h, int nIndex);
          public const int GWL_STYLE = -16;
        }
        public struct RECT { public int L,T,R,B; }
"@;
      Add-Type -TypeDefinition $src;
      $r = New-Object RECT;
      $hwnd = [FS]::GetForegroundWindow();
      $ok = [FS]::GetWindowRect($hwnd, [ref]$r);
      if (-not $ok) { $false } else {
        $screen = [System.Windows.Forms.Screen]::FromHandle($hwnd);
        $b = $screen.Bounds;
        $ww = $r.R - $r.L;
        $wh = $r.B - $r.T;
        $sw = $b.Width;
        $sh = $b.Height;
        $coversFull = ($r.L -le $b.X) -and ($r.T -le $b.Y) -and ($r.R -ge ($b.X + $sw)) -and ($r.B -ge ($b.Y + $sh));
        if ($coversFull) { $true } else {
          $style = [FS]::GetWindowLong($hwnd, -16);
          $noCaption = ($style -band 0xC00000) -eq 0;
          $coversMost = ($ww -ge ($sw - 4)) -and ($wh -ge ($sh - 4));
          $noCaption -and $coversMost
        }
      }
    `.replace(/\n/g, ' ');
    const out = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    return out.includes('True');
  } catch { return false; }
}

// ======== 状态变量 ========
let mainWindow = null;
let tray = null;
let floatBall = null;
let isQuitting = false;
let floatBallEnabled = true;
let floatBallPos = null;

// ======== 下载管理 ========
let downloads = [];
let downloadIdCounter = 0;
let downloadPath = app.getPath('downloads');
const downloadItems = new Map(); // id -> Electron.DownloadItem
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.downloadPath) downloadPath = cfg.downloadPath;
    }
  } catch (e) { log.warn('Failed to load config:', e.message); }
}

function saveConfig(key, value) {
  try {
    let cfg = {};
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg[key] = value;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch (e) { log.warn('Failed to save config:', e.message); }
}

loadConfig();

// ======== 权限管理 ========
let permissionConfig = {};

function loadPermissionConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.permissions) permissionConfig = cfg.permissions;
    }
  } catch (e) { log.warn('Failed to load permissions:', e.message); }
}

loadPermissionConfig();

function sendDownloadUpdate(dl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-update', dl);
  }
}

function setupDownloadHandler(ses) {
  ses.on('will-download', (event, item) => {
    const id = ++downloadIdCounter;
    const filename = item.getFilename();
    let savePath = path.join(downloadPath, filename);

    // 处理重名文件
    let counter = 1;
    while (fs.existsSync(savePath)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      savePath = path.join(downloadPath, `${base} (${counter})${ext}`);
      counter++;
    }

    item.setSavePath(savePath);
    downloadItems.set(id, item);

    const dl = {
      id, filename, savePath,
      state: 'downloading',
      progress: 0,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      startTime: Date.now(),
      justAdded: true // 标记为新加入，触发入场动画
    };

    downloads.unshift(dl);
    if (downloads.length > 100) downloads.length = 100;
    sendDownloadUpdate(dl);
    log.info('Download started:', filename);

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        if (item.isPaused()) return; // 暂停时主进程不主动更新，等待 resume
        dl.receivedBytes = item.getReceivedBytes();
        dl.totalBytes = item.getTotalBytes();
        dl.progress = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
        dl.state = 'downloading';
        dl.justAdded = false;
      } else if (state === 'interrupted') {
        dl.state = 'interrupted';
      }
      sendDownloadUpdate(dl);
    });

    item.once('done', (event, state) => {
      downloadItems.delete(id);
      if (state === 'completed') {
        dl.state = 'completed';
        dl.progress = 100;
        dl.receivedBytes = dl.totalBytes;
        log.info('Download completed:', filename);
      } else if (state === 'cancelled') {
        dl.state = 'cancelled';
        log.info('Download cancelled:', filename);
        // 删除已下载的部分文件
        try { if (fs.existsSync(savePath)) fs.unlinkSync(savePath); } catch (_) {}
      } else {
        dl.state = 'failed';
        log.warn('Download failed:', filename, state);
      }
      sendDownloadUpdate(dl);
    });
  });
}

// ======== 站点配置 ========
const SITE_NAMES = {
  deepseek: 'DeepSeek',
  yuanbao: '腾讯元宝',
  doubao: '豆包',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  tongyi: '千问',
  chatglm: '智谱清言'
};
let SITE_ORDER = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax', 'tongyi', 'chatglm'];

// ======== 窗口创建 ========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
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

  // 使用 file:// URL 而非 loadFile（Electron 42 在某些 Windows 版本上 loadFile 会挂起）
  mainWindow.loadURL(`file:///${__dirname.replace(/\\/g, '/')}/index.html`);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setIcon(path.join(__dirname, 'assets', 'icon.ico'));

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    const levelMap = { 0:'verbose', 1:'info', 2:'warning', 3:'error' };
    log.info(`[renderer:${levelMap[level] || '?'}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error(`[renderer] process gone: ${details.reason}`);
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.error('[renderer] unresponsive');
  });

  const bounds = mainWindow.getBounds();
  log.info(`Window created: ${bounds.width}x${bounds.height} at (${bounds.x},${bounds.y})`);

  // 自动打开 DevTools（开发模式）
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 强制立即显示
  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('maximize-change', true);
  });
  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('maximize-change', false);
  });
  mainWindow.on('enter-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('maximize-change', true);
  });
  mainWindow.on('leave-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('maximize-change', false);
  });

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ======== IPC 注册（仅执行一次）========
function registerIpcHandlers() {
  // 窗口管理
  ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    } else if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('app-quit', () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle('window-is-maximized', () => mainWindow && mainWindow.isMaximized());
  ipcMain.handle('open-external', (_, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) {}
  });

  // 悬浮球
  ipcMain.on('set-float-ball', (_, enabled) => {
    floatBallEnabled = enabled;
    if (!enabled) destroyFloatBall();
  });

  ipcMain.on('update-site-order', (_, order) => {
    SITE_ORDER = order;
    if (tray) buildTrayMenu();
  });

  ipcMain.on('update-floatball-settings', () => {
    if (floatBall && !floatBall.isDestroyed()) {
      floatBall.webContents.send('apply-floatball-settings');
    }
  });

  ipcMain.on('set-theme', (_, theme) => {
    nativeTheme.themeSource = theme;
  });

  ipcMain.on('show-context-menu', (_, action) => {
    if (!mainWindow) return;
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

  // ======== 自动更新 IPC ========
  ipcMain.handle('check-for-updates', () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    } else {
      sendUpdateStatus('not-available', { version: app.getVersion(), note: '开发模式' });
    }
    return true;
  });

  ipcMain.handle('download-update', () => {
    if (!app.isPackaged) {
      sendUpdateStatus('error', '开发模式无法下载更新');
      return false;
    }
    try {
      autoUpdater.downloadUpdate();
      return true;
    } catch (e) {
      log.error('downloadUpdate error:', e.message);
      sendUpdateStatus('error', e.message);
      return false;
    }
  });

  ipcMain.handle('install-update', () => {
    try {
      autoUpdater.quitAndInstall();
      return true;
    } catch (e) {
      log.error('installUpdate error:', e.message);
      return false;
    }
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.on('open-releases-page', () => {
    shell.openExternal('https://github.com/Shawnylin/aichathub/releases');
  });

  // ======== 悬浮球 IPC ========
  ipcMain.on('float-ball-click', () => {
    if (mainWindow) {
      destroyFloatBall();
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

  // ======== 下载管理 IPC ========
  ipcMain.handle('get-downloads', () => downloads.slice(0, 50));

  ipcMain.handle('get-download-path', () => downloadPath);

  ipcMain.handle('set-download-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择下载目录',
      defaultPath: downloadPath,
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      downloadPath = result.filePaths[0];
      saveConfig('downloadPath', downloadPath);
      log.info('Download path changed to:', downloadPath);
      return downloadPath;
    }
    return null;
  });

  ipcMain.on('open-download-file', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.on('pause-download', (_, id) => {
    const item = downloadItems.get(id);
    if (item && !item.isPaused()) {
      try {
        item.pause();
        const dl = downloads.find(d => d.id === id);
        if (dl) {
          dl.state = 'paused';
          sendDownloadUpdate(dl);
        }
        log.info('Download paused:', id);
      } catch (e) { log.warn('Pause failed:', e.message); }
    }
  });

  ipcMain.on('resume-download', (_, id) => {
    const item = downloadItems.get(id);
    if (item && item.isPaused()) {
      try {
        item.resume();
        const dl = downloads.find(d => d.id === id);
        if (dl) {
          dl.state = 'downloading';
          sendDownloadUpdate(dl);
        }
        log.info('Download resumed:', id);
      } catch (e) { log.warn('Resume failed:', e.message); }
    }
  });

  ipcMain.on('cancel-download', (_, id) => {
    const item = downloadItems.get(id);
    if (item) {
      try {
        item.cancel();
        const dl = downloads.find(d => d.id === id);
        if (dl) {
          dl.state = 'cancelled';
          sendDownloadUpdate(dl);
        }
        log.info('Download cancelled:', id);
      } catch (e) { log.warn('Cancel failed:', e.message); }
    }
  });

  ipcMain.on('delete-download', (_, id) => {
    const dl = downloads.find(d => d.id === id);
    if (dl && dl.state === 'completed' && fs.existsSync(dl.savePath)) {
      try {
        fs.unlinkSync(dl.savePath);
        log.info('Download file deleted:', dl.filename);
      } catch (e) { log.warn('Delete file failed:', e.message); }
    }
    if (dl) {
      dl.state = dl.state === 'completed' ? 'deleted' : dl.state;
      sendDownloadUpdate(dl);
    }
  });

  ipcMain.on('remove-download-record', (_, id) => {
    downloads = downloads.filter(d => d.id !== id);
  });

  ipcMain.on('clear-downloads', () => {
    downloads = [];
  });

  // ======== 权限管理 IPC ========
  ipcMain.handle('get-permissions', () => permissionConfig);

  ipcMain.handle('set-permission', (_, site, permission, value) => {
    if (!permissionConfig[site]) permissionConfig[site] = {};
    permissionConfig[site][permission] = value;
    saveConfig('permissions', permissionConfig);
    return true;
  });
}

// ======== 自动更新配置 ========
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'Shawnylin',
  repo: 'aichathub',
});

function sendUpdateStatus(status, data) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('update-status', status, data);
    }
  });
}

autoUpdater.on('checking-for-update', () => {
  log.info('Checking for update...');
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  sendUpdateStatus('available', info);
});

autoUpdater.on('update-not-available', (info) => {
  log.info('Update not available');
  sendUpdateStatus('not-available', info);
});

autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus('downloading', {
    percent: Math.round(progress.percent),
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total
  });
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded');
  sendUpdateStatus('downloaded', info);
});

autoUpdater.on('error', (err) => {
  log.error('Update error:', err.message);
  sendUpdateStatus('error', err.message);
});

// ======== 悬浮球 ========
function createFloatBall() {
  if (floatBall) return;
  if (!floatBallPos) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    floatBallPos = { x: width - 196, y: height - 196 };
  }
  floatBall = new BrowserWindow({
    width: 180, height: 180,
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

function destroyFloatBall() {
  if (floatBall) {
    floatBall.close();
    floatBall = null;
  }
}

// ======== 系统托盘 ========
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

// ======== 启动 ========
app.whenReady().then(() => {
  const sites = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax', 'tongyi', 'chatglm'];
  sites.forEach(site => {
    const ses = session.fromPartition(`persist:${site}`);
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['clipboard-sanitized-write', 'clipboard-read'];
      if (allowed.includes(permission)) {
        callback(true);
        return;
      }
      const perms = permissionConfig[site] || {};
      if (permission === 'media') {
        callback(!!perms.media);
      } else if (permission === 'geolocation') {
        callback(!!perms.geolocation);
      } else {
        callback(false);
      }
    });
    setupDownloadHandler(ses);
  });

  registerIpcHandlers();
  createWindow();
  createTray();

  // 启动后静默检查更新
  setTimeout(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    }
  }, 5000);

  // 全屏检测：仅在悬浮球存在时检测（主窗口隐藏时），降低轮询频率
  let fullscreenHidden = false;
  setInterval(() => {
    if (!floatBall || floatBall.isDestroyed()) return;
    const fs = checkForegroundFullscreen();
    if (fs && !fullscreenHidden) {
      fullscreenHidden = true;
      floatBall.webContents.send('float-ball-fade-out');
      log.info('Foreground fullscreen detected, fading out floatball');
    } else if (!fs && fullscreenHidden) {
      fullscreenHidden = false;
      if (floatBall && !floatBall.isDestroyed()) {
        floatBall.webContents.send('float-ball-fade-in');
      }
      log.info('Foreground fullscreen exited, fading in floatball');
    }
  }, 3000);

  log.info('App ready');
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
