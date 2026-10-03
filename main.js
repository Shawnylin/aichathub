const { app, BrowserWindow, session, ipcMain, shell, clipboard, Tray, Menu, nativeImage, screen, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { TaskStore } = require('./main/task-store');
const { registerTaskIpc, trusted } = require('./main/task-ipc');
const { captureMenuItem } = require('./main/task-capture');
const { ComparisonStore } = require('./main/comparison-store');
const { registerComparisonIpc, comparisonMenuItem } = require('./main/comparison-ipc');
const { SiteRegistry } = require('./main/site-registry');
const { guardedIpc, installNavigationGuard } = require('./main/ipc-security');
const { pathToFileURL } = require('node:url');
const FloatballConfig = require('./renderer/floatball-config');
const { NativeFloatballDrag, facingForPosition } = require('./main/floatball-motion');
let siteRegistry;
let comparisonActive=false;

// ======== 日志配置 ========
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('App starting, version:', app.getVersion());

// ======== V8 配置 ========
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

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

// ======== 全屏检测（Windows，异步非阻塞）========
function checkForegroundFullscreen(cb) {
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
  exec(`powershell -NoProfile -Command "${script}"`, {
    encoding: 'utf8', timeout: 2000, windowsHide: true
  }, (err, stdout) => {
    cb(!err && !!stdout && stdout.includes('True'));
  });
}

// ======== 状态变量 ========
let mainWindow = null;
let tray = null;
let floatBall = null;
let isQuitting = false;
let floatBallEnabled = true;
let floatBallPos = null;
let floatBallSettings = FloatballConfig.normalize();
let floatDrag = null;
let floatFacingAt = 0;
let appAccentColor = '#53616d';
let glassTransparency = 20;
let micaEnabled = false;
const WINDOWS_MICA_MIN_BUILD = 22621;
const FLOAT_BALL_SIZE = 120;
const FLOAT_BALL_EDGE_GAP = 12;

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
      if (cfg.floatBallPosition && Number.isFinite(cfg.floatBallPosition.x) && Number.isFinite(cfg.floatBallPosition.y)) {
        floatBallPos = cfg.floatBallPosition;
      }
      if (typeof cfg.floatBallEnabled === 'boolean') floatBallEnabled = cfg.floatBallEnabled;
      floatBallSettings = FloatballConfig.normalize(cfg.floatBallSettings);
      if (typeof cfg.appAccentColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.appAccentColor)) appAccentColor = cfg.appAccentColor;
      if (Number.isFinite(cfg.glassTransparency)) glassTransparency = Math.max(0, Math.min(70, cfg.glassTransparency));
      if (typeof cfg.micaEnabled === 'boolean') micaEnabled = cfg.micaEnabled;
    }
  } catch (e) { log.warn('Failed to load config:', e.message); }
}

function saveConfig(key, value) {
  try {
    let cfg = {};
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg[key] = value;
    const temporary = configPath + '.' + require('node:crypto').randomUUID() + '.tmp';
    const backupTemp = temporary + '.backup';
    try {
      if (fs.existsSync(configPath)) { fs.copyFileSync(configPath, backupTemp); fs.renameSync(backupTemp, configPath + '.backup'); }
      fs.writeFileSync(temporary, JSON.stringify(cfg, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, configPath);
    } finally {
      for (const file of [temporary, backupTemp]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    return true;
  } catch (e) { log.warn('Failed to save config:', e.message); return false; }
}

function getWindowsBuildNumber() {
  if (process.platform !== 'win32') return 0;
  const version = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release();
  const match = String(version).match(/^10\.0\.(\d+)/);
  return match ? Number(match[1]) : 0;
}

function isMicaSupported() {
  return process.platform === 'win32' && getWindowsBuildNumber() >= WINDOWS_MICA_MIN_BUILD;
}

function canApplyMica() {
  return isMicaSupported() && !!mainWindow && !mainWindow.isDestroyed() &&
    typeof mainWindow.setBackgroundMaterial === 'function';
}

function getMicaState() {
  const supported = canApplyMica();
  return {
    supported,
    enabled: supported && micaEnabled,
    reason: supported ? '' : '当前系统不支持此效果（需要 Windows 11 22H2 或更高版本）'
  };
}

function applyMicaMaterial(enabled) {
  if (!canApplyMica()) return false;
  try {
    mainWindow.setBackgroundMaterial(enabled ? 'mica' : 'none');
    micaEnabled = !!enabled;
    return true;
  } catch (error) {
    log.warn('Failed to apply Mica material:', error.message);
    return false;
  }
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
    const filename = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,180).replace(/[. ]+$/g, '') || 'download';
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
  chatglm: '智谱清言',
  grok: 'Grok',
  chatgpt: 'ChatGPT'
};
let SITE_ORDER = ['deepseek', 'yuanbao', 'doubao', 'kimi', 'minimax', 'tongyi', 'chatglm', 'grok', 'chatgpt'];

// ======== 窗口创建 ========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0a0a0a',
    ...(isMicaSupported() ? { backgroundMaterial: micaEnabled ? 'mica' : 'none' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
  });

  installNavigationGuard(mainWindow, siteRegistry, pathToFileURL(path.join(__dirname,'newtab.html')).href,()=>comparisonActive);
  mainWindow.loadFile(path.join(__dirname,'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setIcon(path.join(__dirname, 'assets', 'icon.ico'));

  if (isMicaSupported() && !applyMicaMaterial(micaEnabled)) {
    micaEnabled = false;
    saveConfig('micaEnabled', false);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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

  mainWindow.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: '任务内容尚未保存',
      message: '有未保存的任务内容或正在进行的保存。',
      detail: '返回工作台完成保存，或放弃未保存内容并继续。',
      buttons: ['返回保存', '放弃并继续'], defaultId: 0, cancelId: 0
    });
    if (response === 1) event.preventDefault();
    else isQuitting = false;
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
  const secure = guardedIpc(ipcMain, {getWindow:()=>mainWindow,getFloat:()=>floatBall,indexFile:path.join(__dirname,'index.html'),floatFile:path.join(__dirname,'floatball.html'),validArgs(channel,args) {
    const [a,b,c]=args;
    if(channel==='set-theme') return ['system','light','dark'].includes(a);
    if(channel==='set-floatball-settings') return args.length===1 && FloatballConfig.validPatch(a);
    if(['set-float-ball','set-mica-enabled'].includes(channel)) return typeof a==='boolean';
    if(channel==='set-accent-color') return typeof a==='string' && /^#[0-9a-f]{6}$/i.test(a);
    if(channel==='set-glass-transparency') return Number.isFinite(a) && a>=0 && a<=70;
    if(channel==='update-site-order') return Array.isArray(a) && a.length<=109 && new Set(a).size===a.length && a.every(id=>siteRegistry.sites.has(id));
    if(channel==='open-external') {try {require('./main/comparison-store').safeURL(a);return true;} catch(_){return false;}}
    if(channel==='open-download-file') return typeof a==='string' && downloads.some(d=>d.savePath===a);
    if(['pause-download','resume-download','cancel-download','delete-download','remove-download-record'].includes(channel)) return Number.isSafeInteger(a) && a>0;
    if(channel==='set-permission') return siteRegistry.sites.has(a) && ['media','geolocation','notifications'].includes(b) && typeof c==='boolean';
    if(channel==='float-ball-drag-start') return args.length===2 && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a)<1000000 && Math.abs(b)<1000000;
    if(channel==='show-context-menu') return ['normal','selection'].includes(a) || (a && typeof a==='object' && typeof a.text==='string' && a.text.length<=100001 && typeof a.url==='string' && a.url.length<=8192 && typeof a.title==='string' && a.title.length<=10000 && siteRegistry.sites.has(a.siteId));
    return args.length===0;
  }});
  registerComparisonIpc({ipcMain,dialog,getWindow:()=>mainWindow,indexFile:path.join(__dirname,'index.html'),store:new ComparisonStore(path.join(app.getPath('userData'),'comparison-workspace'))});
  ipcMain.handle('comparison:active',(event,value)=>{
    if(!trusted(event,mainWindow,path.join(__dirname,'index.html')) || typeof value!=='boolean')return false;
    comparisonActive=value;return true;
  });
  ipcMain.handle('sites:sync', async(event,custom)=>{
    if(!trusted(event,mainWindow,path.join(__dirname,'index.html')))return {ok:false,error:'来源无效'};
    try {const value=siteRegistry.sync(custom); saveConfig('customSites',custom); if(tray)buildTrayMenu(); return {ok:true,value};}catch(e){return {ok:false,error:e.message};}
  });
  registerTaskIpc({ ipcMain, dialog, clipboard, shell, getWindow: () => mainWindow,
    store: new TaskStore(path.join(app.getPath('userData'), 'task-workspace')),
    indexFile: path.join(__dirname, 'index.html') });
  // 窗口管理
  secure.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  secure.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    } else if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  secure.on('window-close', () => { if (mainWindow) mainWindow.hide(); });
  secure.on('app-quit', () => {
    isQuitting = true;
    app.quit();
  });
  secure.handle('window-is-maximized', () => mainWindow && mainWindow.isMaximized());
  secure.handle('open-external', (_, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) {}
  });

  // 悬浮球
  secure.on('set-float-ball', (_, enabled) => {
    setFloatBallEnabled(enabled);
  });

  secure.handle('get-float-ball-enabled', () => floatBallEnabled);
  secure.handle('get-floatball-settings', () => getFloatballSettings());
  secure.handle('float-ball-get-settings', () => getFloatballSettings());
  secure.handle('set-floatball-settings', (_, patch) => updateFloatballSettings(patch));

  secure.on('reset-float-ball-position', () => {
    resetFloatBallPosition();
  });

  secure.on('update-site-order', (_, order) => {
    SITE_ORDER = order;
    if (tray) buildTrayMenu();
  });

  secure.on('set-theme', (_, theme) => {
    nativeTheme.themeSource = theme;
  });

  secure.on('set-accent-color', (_, color) => {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return;
    appAccentColor = color;
    saveConfig('appAccentColor', appAccentColor);
    if (floatBall && !floatBall.isDestroyed()) {
      floatBall.webContents.send('float-ball-accent-change', appAccentColor);
    }
    broadcastFloatballSettings();
  });
  secure.on('set-glass-transparency', (event, value) => {
    if (!trusted(event, mainWindow, path.join(__dirname, 'index.html')) || !Number.isFinite(value) || value < 0 || value > 70) return;
    glassTransparency = value;
    saveConfig('glassTransparency', value);
    if (floatBall && !floatBall.isDestroyed()) floatBall.webContents.send('float-ball-glass-change', value);
  });

  // 云母背景材质
  secure.handle('get-mica-state', (event) => {
    if (!trusted(event, mainWindow, path.join(__dirname, 'index.html'))) {
      return { supported: false, enabled: false, reason: '不允许访问窗口材质设置' };
    }
    return getMicaState();
  });

  secure.handle('set-mica-enabled', (event, enabled) => {
    if (!trusted(event, mainWindow, path.join(__dirname, 'index.html'))) {
      return { supported: false, enabled: false, applied: false, reason: '不允许访问窗口材质设置' };
    }
    if (!isMicaSupported()) return { ...getMicaState(), applied: false };

    const applied = applyMicaMaterial(enabled === true);
    if (!applied) {
      return { ...getMicaState(), applied: false, reason: '云母材质暂时无法应用' };
    }
    saveConfig('micaEnabled', micaEnabled);
    return { ...getMicaState(), applied: true };
  });

  secure.on('show-context-menu', (event, action) => {
    if (!trusted(event, mainWindow, path.join(__dirname, 'index.html'))) return;
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

    if (action && typeof action === 'object') {
      menuItems.unshift(captureMenuItem(action, snapshot => wv.send('tasks:capture', snapshot)), { type: 'separator' });
      if(action.comparison === true) menuItems.unshift(comparisonMenuItem(action,snapshot=>wv.send('comparison:capture',snapshot)));
    }

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
  secure.handle('check-for-updates', () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    } else {
      sendUpdateStatus('not-available', { version: app.getVersion(), note: '开发模式' });
    }
    return true;
  });

  secure.handle('download-update', () => {
    autoUpdater.downloadUpdate();
    return true;
  });

  secure.handle('install-update', () => {
    autoUpdater.quitAndInstall();
    return true;
  });

  secure.handle('get-app-version', () => app.getVersion());

  secure.on('open-releases-page', () => {
    shell.openExternal('https://github.com/Shawnylin/aichathub/releases');
  });

  // ======== 悬浮球 IPC ========
  secure.on('float-ball-click', () => {
    if (mainWindow) {
      destroyFloatBall();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('companion-arrival');
    }
  });

  secure.on('float-ball-context-menu', () => {
    if (!floatBall) return;
    const menu = Menu.buildFromTemplate([
      {
        label: '打开 AI Chat Hub',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: '自定义悬浮伙伴…',
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show(); mainWindow.focus();
          mainWindow.webContents.send('open-settings-panel', 'floatball');
        }
      },
      {
        label: '互动模式',
        submenu: [['normal','活力模式'],['low','低精力模式'],['static','静止模式']].map(([mode,label]) => ({
          label, type:'radio', checked:floatBallSettings.mode===mode,
          click:()=>updateFloatballSettings({mode})
        }))
      },
      {
        label: '恢复默认位置',
        click: () => resetFloatBallPosition()
      },
      { type: 'separator' },
      {
        label: '关闭悬浮窗',
        click: () => {
          setFloatBallEnabled(false);
        }
      }
    ]);
    menu.popup({ window: floatBall });
  });

  secure.on('float-ball-drag-start', (_, pointerX, pointerY) => {
    if (!floatBall || floatBall.isDestroyed()) return;
    const [x,y] = floatBall.getPosition();
    floatDrag?.stop();
    floatDrag = new NativeFloatballDrag({
      getCursor: () => screen.getCursorScreenPoint(),
      getAreas: () => screen.getAllDisplays().map(display => display.workArea),
      move: position => {
        if (!floatBall || floatBall.isDestroyed()) { floatDrag?.stop(); return; }
        floatBall.setPosition(position.x,position.y,false); floatBallPos=position;
      },
      changed: () => { if (Date.now()-floatFacingAt>100) sendFloatBallFacing(); }
    });
    floatDrag.start({x,y},{x:pointerX,y:pointerY});
  });

  secure.on('float-ball-drag-end', () => {
    floatDrag?.stop(); floatDrag=null;
    if (!floatBall || floatBall.isDestroyed()) return;
    const [x, y] = floatBall.getPosition();
    floatBallPos = snapFloatBallPosition({ x, y });
    floatBall.setPosition(floatBallPos.x, floatBallPos.y);
    saveConfig('floatBallPosition', floatBallPos);
    sendFloatBallFacing();
  });

  // ======== 下载管理 IPC ========
  secure.handle('get-downloads', () => downloads.slice(0, 50));

  secure.handle('get-download-path', () => downloadPath);

  secure.handle('set-download-path', async () => {
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

  secure.on('open-download-file', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  secure.on('pause-download', (_, id) => {
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

  secure.on('resume-download', (_, id) => {
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

  secure.on('cancel-download', (_, id) => {
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

  secure.on('delete-download', (_, id) => {
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

  secure.on('remove-download-record', (_, id) => {
    downloads = downloads.filter(d => d.id !== id);
  });

  secure.on('clear-downloads', () => {
    downloads = [];
  });

  // ======== 权限管理 IPC ========
  secure.handle('get-permissions', () => permissionConfig);

  secure.handle('set-permission', (_, site, permission, value) => {
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
  floatBallPos = clampFloatBallPosition(floatBallPos || getDefaultFloatBallPosition());
  floatBall = new BrowserWindow({
    width: FLOAT_BALL_SIZE, height: FLOAT_BALL_SIZE,
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
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  const createdBall = floatBall;
  floatBall.webContents.once('did-finish-load', () => {
    if (!createdBall.isDestroyed()) {
      createdBall.webContents.send('float-ball-accent-change', appAccentColor);
      createdBall.webContents.send('float-ball-glass-change', glassTransparency);
      createdBall.webContents.send('float-ball-settings-change', getFloatballSettings());
    }
  });
  floatBall.webContents.on('will-navigate', event => event.preventDefault());
  floatBall.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  floatBall.loadFile(path.join(__dirname, 'floatball.html'));
  floatBall.setAlwaysOnTop(true, 'floating');
  floatBall.on('closed', () => {
    if (floatBall === createdBall) { floatDrag?.stop(); floatDrag=null; floatBall = null; }
  });
}

function destroyFloatBall() {
  floatDrag?.stop(); floatDrag=null;
  if (floatBall) {
    floatBall.close();
    floatBall = null;
  }
}

function getFloatballSettings() {
  return { settings:{...floatBallSettings}, accent:appAccentColor, facing:getFloatBallFacing() };
}
function getFloatBallFacing() {
  const position=floatBallPos || getDefaultFloatBallPosition();
  const {workArea}=screen.getDisplayNearestPoint({x:position.x+FLOAT_BALL_SIZE/2,y:position.y+FLOAT_BALL_SIZE/2});
  return facingForPosition(position,workArea,FLOAT_BALL_SIZE);
}
function sendFloatBallFacing() {
  floatFacingAt=Date.now();
  if(floatBall && !floatBall.isDestroyed())floatBall.webContents.send('float-ball-facing-change',getFloatBallFacing());
}
function broadcastFloatballSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('floatball-settings-change',getFloatballSettings());
  if (floatBall && !floatBall.isDestroyed()) floatBall.webContents.send('float-ball-settings-change',getFloatballSettings());
}
function updateFloatballSettings(patch) {
  if (!FloatballConfig.validPatch(patch)) return {ok:false,error:'设置内容无效'};
  const next=FloatballConfig.normalize({...floatBallSettings,...patch});
  if (!saveConfig('floatBallSettings',next)) return {ok:false,error:'无法保存到本机，请检查配置目录是否可写并重试'};
  floatBallSettings=next; broadcastFloatballSettings();
  return {ok:true,...getFloatballSettings()};
}

function getDefaultFloatBallPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - FLOAT_BALL_SIZE - FLOAT_BALL_EDGE_GAP,
    y: workArea.y + workArea.height - FLOAT_BALL_SIZE - FLOAT_BALL_EDGE_GAP
  };
}

function clampFloatBallPosition(position) {
  const fallback = getDefaultFloatBallPosition();
  const point = {
    x: Number.isFinite(position?.x) ? position.x + FLOAT_BALL_SIZE / 2 : fallback.x + FLOAT_BALL_SIZE / 2,
    y: Number.isFinite(position?.y) ? position.y + FLOAT_BALL_SIZE / 2 : fallback.y + FLOAT_BALL_SIZE / 2
  };
  const { workArea } = screen.getDisplayNearestPoint(point);
  const minX = workArea.x + FLOAT_BALL_EDGE_GAP;
  const maxX = workArea.x + workArea.width - FLOAT_BALL_SIZE - FLOAT_BALL_EDGE_GAP;
  const minY = workArea.y + FLOAT_BALL_EDGE_GAP;
  const maxY = workArea.y + workArea.height - FLOAT_BALL_SIZE - FLOAT_BALL_EDGE_GAP;
  return {
    x: Math.round(Math.min(Math.max(point.x - FLOAT_BALL_SIZE / 2, minX), maxX)),
    y: Math.round(Math.min(Math.max(point.y - FLOAT_BALL_SIZE / 2, minY), maxY))
  };
}

function snapFloatBallPosition(position) {
  const clamped = clampFloatBallPosition(position);
  const { workArea } = screen.getDisplayNearestPoint({
    x: clamped.x + FLOAT_BALL_SIZE / 2,
    y: clamped.y + FLOAT_BALL_SIZE / 2
  });
  const left = workArea.x + FLOAT_BALL_EDGE_GAP;
  const right = workArea.x + workArea.width - FLOAT_BALL_SIZE - FLOAT_BALL_EDGE_GAP;
  return { ...clamped, x: clamped.x + FLOAT_BALL_SIZE / 2 < workArea.x + workArea.width / 2 ? left : right };
}

function resetFloatBallPosition() {
  floatDrag?.stop();floatDrag=null;
  floatBallPos = getDefaultFloatBallPosition();
  saveConfig('floatBallPosition', floatBallPos);
  if (floatBall && !floatBall.isDestroyed()) {
    floatBall.setPosition(floatBallPos.x, floatBallPos.y);
    sendFloatBallFacing();
  }
}

function setFloatBallEnabled(enabled) {
  floatBallEnabled = !!enabled;
  saveConfig('floatBallEnabled', floatBallEnabled);
  if (!floatBallEnabled) {
    destroyFloatBall();
  } else if (mainWindow && !mainWindow.isVisible()) {
    createFloatBall();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('float-ball-enabled-change', floatBallEnabled);
  }
  if (tray) buildTrayMenu();
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
  const siteItems = SITE_ORDER.filter(site => siteRegistry.sites.has(site)).map(site => ({
    label: siteRegistry.sites.get(site).name,
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
          setFloatBallEnabled(false);
        } else {
          setFloatBallEnabled(true);
        }
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
  siteRegistry = new SiteRegistry({session,setupDownload:setupDownloadHandler,permissions:()=>permissionConfig,builtins:Object.fromEntries(Object.entries(SITE_NAMES).map(([id,name])=>[id,{name}]))});
  try { const cfg=JSON.parse(fs.readFileSync(configPath,'utf8')); if(cfg.customSites)siteRegistry.sync(cfg.customSites); } catch(e) { if(e.code!=='ENOENT')log.warn('站点注册读取失败',e.message); }
  registerIpcHandlers();
  createWindow();
  createTray();

  // 启动后静默检查更新
  setTimeout(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    }
  }, 5000);

  // 全屏检测：仅在悬浮球存在时检测（主窗口隐藏时）
  // 异步执行 + 防重入 + 降低轮询频率，避免阻塞主进程事件循环
  let fullscreenHidden = false;
  let fsCheckRunning = false;
  setInterval(() => {
    if (!floatBall || floatBall.isDestroyed() || fsCheckRunning) return;
    fsCheckRunning = true;
    checkForegroundFullscreen((fs) => {
      fsCheckRunning = false;
      if (fs && !fullscreenHidden) {
        fullscreenHidden = true;
        if (floatBall && !floatBall.isDestroyed()) {
          floatBall.webContents.send('float-ball-fade-out');
        }
        log.info('Foreground fullscreen detected, fading out floatball');
      } else if (!fs && fullscreenHidden) {
        fullscreenHidden = false;
        if (floatBall && !floatBall.isDestroyed()) {
          floatBall.webContents.send('float-ball-fade-in');
        }
        log.info('Foreground fullscreen exited, fading in floatball');
      }
    });
  }, 5000);

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
