// Run with Electron. Uses a fresh profile and real task IPC/store, blocks external requests.
const { app, BrowserWindow, ipcMain, session, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { TaskStore } = require('../main/task-store');
const { registerTaskIpc } = require('../main/task-ipc');
const { captureMenuItem } = require('../main/task-capture');
const http = require('node:http');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'dist/task-ui-check');
fs.mkdirSync(output, { recursive: true });
for (const name of ['result.json', 'failure.txt']) fs.rmSync(path.join(output, name), { force: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
let server;
app.whenReady().then(async () => {
  const block = ses => ses.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (request, cb) => cb({ cancel: !request.url.startsWith('http://127.0.0.1:') }));
  block(session.defaultSession); app.on('session-created', block);
  const store = new TaskStore(path.join(profile, 'task-workspace'));
  let copied = '', opened = '', capturedMenu = null;
  registerTaskIpc({ ipcMain, dialog: { showMessageBox: async () => ({ response: 0 }) }, clipboard: { writeText: value => { copied = value; } }, shell: { openExternal: async url => { opened = url; } }, getWindow: () => win, store, indexFile: path.join(root, 'index.html') });
  ipcMain.on('show-context-menu', (_, snapshot) => { capturedMenu = captureMenuItem(snapshot, value => win.webContents.send('tasks:capture', value)); });
  const responses = { 'get-downloads': [], 'get-permissions': {}, 'get-download-path': 'Downloads', 'get-float-ball-enabled': true, 'get-app-version': '1.4.1', 'window-is-maximized': false };
  for (const match of fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) {
    if (!match[1].startsWith('tasks:')) ipcMain.handle(match[1], () => responses[match[1]] ?? true);
  }
  win = new BrowserWindow({ width: 1280, height: 820, show: false, frame: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error' && /Uncaught|TypeError|ReferenceError/.test(details.message)) errors.push(details.message);
  });
  const js = code => win.webContents.executeJavaScript(code, true);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const textClick = label => js(`[...document.querySelectorAll('#task-workspace button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  const fill = (selector, value) => js(`{const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true}));}`);
  async function waitFor(code) {
    for (let count = 0; count < 60; count++) { if (await js(code)) return; await delay(100); }
    throw new Error('Timed out: ' + code + '\n' + await js(`JSON.stringify({feedback:document.querySelector('#task-feedback')?.textContent,active:document.activeElement?.id,navOpen:document.querySelector('#nav-capsule')?.classList.contains('is-open'),buttons:[...document.querySelectorAll('#nav-capsule button')].map(n=>({id:n.id,disabled:n.disabled}))})`));
  }
  const saved = () => waitFor(`document.querySelector('#task-feedback').textContent === '已保存到本机'`);
  const shot = async name => { await delay(350); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await win.loadFile(path.join(root, 'index.html')); win.showInactive(); await delay(500);
  await click('#task-workspace-button');
  await waitFor(`document.querySelector('#task-new').disabled === false`);
  await shot('empty');
  await click('#task-new'); await fill('#task-title', '产品介绍文案'); await fill('#task-goal', '为第一次使用的用户说明产品价值，避免空泛术语。'); await click('#task-save'); await saved();
  await textClick('＋ 添加材料');
  await fill('#material-title', '第一轮讨论 · 用户痛点');
  const note = '不同 AI 的回答散落在各个平台。\n需要保存任务目标，整理有价值的回答，并保留自己的思考。\n<script>window.__unsafe = true</script>';
  await fill('#material-text', note); await click('#task-save'); await saved();
  assert.equal(await js(`document.querySelector('.task-material-text').textContent`), note);
  assert.equal(await js(`window.__unsafe === undefined`), true);
  await shot('workspace-light');
  await js(`document.body.classList.add('dark')`); await shot('workspace-dark');
  await textClick('编辑'); await fill('#material-text', '修订后的材料，保留中文与换行。\n第二行。'); await click('#task-save'); await saved();
  await textClick('删除'); await saved();
  assert.equal(await js(`document.querySelectorAll('.task-material').length`), 0);
  await textClick('已删除材料（1）'); await textClick('恢复材料'); await saved(); await textClick('返回材料');
  assert.equal(await js(`document.querySelectorAll('.task-material').length`), 1);
  await textClick('归档'); await saved(); assert.equal((await store.read()).tasks[0].status, 'archived');
  await textClick('取消归档'); await saved();
  await textClick('移入回收站'); await saved();
  await js(`document.querySelector('#task-filter').value='deleted'; document.querySelector('#task-filter').dispatchEvent(new Event('change'))`);
  await click('.task-list-item'); await textClick('恢复任务'); await saved();
  await textClick('编辑任务'); await fill('#task-goal', '尚未保存的草稿');
  await click('#task-close'); await click('#task-workspace-button');
  assert.equal(await js(`document.querySelector('#task-goal').value`), '尚未保存的草稿');
  await js(`window.confirm = () => false; undefined`); await click('#task-new');
  assert.equal(await js(`document.querySelector('#task-goal').value`), '尚未保存的草稿');
  await js(`window.confirm = () => true; undefined`); await textClick('取消');
  await fill('#task-search', '修订后的材料');
  assert.equal(await js(`document.querySelectorAll('.task-list-item').length`), 1);
  await fill('#task-search', '找不到的内容');
  assert.equal(await js(`document.querySelectorAll('.task-list-item').length`), 0);
  await fill('#task-search', '');
  win.setSize(480, 640); await shot('workspace-narrow');
  assert.equal(await js(`document.querySelector('#task-workspace').scrollWidth <= document.querySelector('#task-workspace').clientWidth`), true);
  await click('#task-close'); await win.loadFile(path.join(root, 'index.html')); await click('#task-workspace-button');
  await waitFor(`document.querySelectorAll('.task-list-item').length === 1`); await click('.task-list-item');
  assert.equal(await js(`document.querySelector('.task-material-text').textContent`), '修订后的材料，保留中文与换行。\n第二行。');
  // Force the actual primary-file replacement to fail, then verify that the editor survives and retry succeeds.
  const realIo = store.io;
  store.io = { ...realIo, rename: async (from, to) => { if (to === store.file) throw Object.assign(new Error('test failure'), { code: 'EACCES' }); return realIo.rename(from, to); } };
  await textClick('编辑任务'); await fill('#task-title', '保存失败后重试'); await click('#task-save');
  await waitFor(`document.querySelector('#task-feedback').classList.contains('task-error')`);
  assert.equal(await js(`document.querySelector('#task-title').value`), '保存失败后重试');
  assert.equal((await store.read()).tasks[0].title, '产品介绍文案');
  store.io = realIo; await click('#task-save'); await saved();
  assert.equal((await new TaskStore(store.directory).read()).tasks[0].title, '保存失败后重试');
  await textClick('复制正文'); await waitFor(`document.querySelector('#task-feedback').textContent.includes('已复制')`);
  assert.equal(copied, '修订后的材料，保留中文与换行。\n第二行。');
  await textClick('复制任务资料'); await delay(100); assert.ok(copied.includes('任务：保存失败后重试'));
  await click('#task-close'); win.setSize(1280, 820);
  await click('#settings-btn'); await click('[data-theme="light"]'); await shot('settings-light');
  assert.equal(await js(`document.querySelectorAll('.theme-preview').length`), 3);
  await click('[data-theme="dark"]'); await shot('settings-dark'); await click('#settings-close');
  server = http.createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<html><head><title>测试 AI 的回答</title></head><body><p id="answer" style="font-size:20px;margin:20px">一段值得保存的回答：任务让资料不再散落。</p></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sourceUrl = `http://127.0.0.1:${server.address().port}/conversation/1`;
  async function captureSelection() {
    capturedMenu = null;
    await js(`document.querySelector('#wv-deepseek').src = ${JSON.stringify(sourceUrl)}; undefined`);
    const guestId = await js(`document.querySelector('#wv-deepseek').getWebContentsId()`);
    const guest = webContents.fromId(guestId);
    await delay(700);
    await guest.executeJavaScript(`{const range = document.createRange(); range.selectNodeContents(document.querySelector('#answer')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);}`);
    guest.sendInputEvent({ type: 'mouseDown', x: 35, y: 35, button: 'right', clickCount: 1 });
    guest.sendInputEvent({ type: 'mouseUp', x: 35, y: 35, button: 'right', clickCount: 1 });
    for (let i = 0; i < 40 && !capturedMenu; i++) await delay(100);
    assert.ok(capturedMenu?.enabled, 'Actual webview selection should produce an enabled capture menu');
    capturedMenu.click();
  }
  await captureSelection();
  await waitFor(`document.querySelectorAll('.task-material').length === 2`);
  assert.equal((await store.read()).tasks[0].materials[0].source.url, sourceUrl);
  assert.equal((await store.read()).tasks[0].materials[0].source.siteId, 'deepseek');
  await session.fromPartition('persist:deepseek').cookies.set({ url: sourceUrl, name: 'source_session', value: 'original' });
  await click('#task-close');
  await js(`switchSite('doubao'); undefined`);
  await click('#task-workspace-button');
  await textClick('打开来源'); await delay(800);
  assert.equal(opened, '');
  assert.equal(await js(`document.querySelector('#task-workspace').open`), false);
  // The source tab is created on demand; wait for its first navigation to commit before reading it back.
  await waitFor(`document.querySelector('webview.visible').getURL() === ${JSON.stringify(sourceUrl)}`);
  const sourceGuest = webContents.fromId(await js(`document.querySelector('webview.visible').getWebContentsId()`));
  assert.equal(sourceGuest.session, session.fromPartition('persist:deepseek'));
  assert.equal(
    sourceGuest.getURL(),
    sourceUrl,
    'visible webview: ' +
      (await js(
        `JSON.stringify([...document.querySelectorAll('webview')].map(w=>({id:w.id,visible:w.classList.contains('visible'),partition:w.getAttribute('partition'),src:w.getAttribute('src')})))`,
      )),
  );
  assert.ok((await sourceGuest.executeJavaScript('document.cookie')).includes('source_session=original'));
  assert.equal(await js(`document.querySelector('#navbar') === null`), true);
  const bounds = () => js(`JSON.stringify(document.querySelector('#webview-container').getBoundingClientRect().toJSON())`);
  const initialBounds = await bounds();
  win.focus();
  const hover = async selector => {
    const point = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type:'mouseMove', ...point }); await delay(350);
  };
  assert.equal(await js(`document.querySelector('#nav-reveal') === null`), true);
  await hover('.site-nav-trigger');
  await waitFor(`document.querySelector('#nav-capsule').classList.contains('is-open')`);
  assert.equal(await bounds(), initialBounds); await shot('navigation-capsule');
  const bridge = await js(`(()=>{const r=document.querySelector('#nav-hover-region').getBoundingClientRect();return {x:Math.round(r.x+24),y:Math.round(r.y+5)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove', ...bridge}); await delay(450);
  assert.equal(await js(`document.querySelector('#nav-capsule').classList.contains('is-open')`), true);
  await hover('#nav-refresh');
  assert.equal(await js(`document.querySelector('#nav-capsule').classList.contains('is-open')`), true);
  await js(`window.__navLeaveAt=0; window.__navClosedAfter=0; document.querySelector('#nav-hover-region').addEventListener('pointerleave',()=>window.__navLeaveAt=performance.now()); new MutationObserver(()=>{if(!document.querySelector('#nav-capsule').classList.contains('is-open'))window.__navClosedAfter=performance.now()-window.__navLeaveAt}).observe(document.querySelector('#nav-capsule'),{attributes:true,attributeFilter:['class']}); undefined`);
  win.webContents.sendInputEvent({type:'mouseMove',x:700,y:400});
  win.webContents.sendInputEvent({type:'mouseMove', ...bridge});
  await hover('#nav-refresh'); await delay(350);
  assert.equal(await js(`document.querySelector('#nav-capsule').classList.contains('is-open')`), true);
  win.webContents.sendInputEvent({type:'mouseMove',x:700,y:400}); await delay(550);
  assert.equal(await js(`document.querySelector('#nav-capsule').classList.contains('is-open')`), false);
  assert.ok(await js(`window.__navClosedAfter >= 300`), 'Closing waits for the grace period');
  await click('.site-nav-trigger');
  assert.equal(await js(`document.querySelector('#nav-capsule').classList.contains('is-open')`), true);
  await js(`document.querySelector('.site-nav-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
  await waitFor(`document.activeElement.id === 'nav-refresh'`);
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await hover('#url-reveal');
  await waitFor(`document.querySelector('#url-capsule').classList.contains('is-open')`);
  assert.equal(await bounds(), initialBounds); await shot('address-capsule');
  await click('#url-reveal');
  assert.equal(await js(`document.activeElement.id`), 'url-bar');
  await js(`document.querySelector('#url-bar').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'l',ctrlKey:true,bubbles:true}))`);
  assert.equal(await js(`document.activeElement.id`), 'url-bar');
  await js(`document.activeElement.blur()`);
  await click('#url-reveal'); await fill('#url-bar', sourceUrl + '?next=1');
  await js(`document.querySelector('#url-bar').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await delay(600); assert.equal(sourceGuest.getURL(), sourceUrl + '?next=1');
  await click('.site-nav-trigger'); await click('#nav-back'); await delay(500);
  assert.equal(sourceGuest.getURL(), sourceUrl);
  await click('#nav-fwd'); await delay(500); assert.equal(sourceGuest.getURL(), sourceUrl + '?next=1');
  await sourceGuest.executeJavaScript('window.navigationRefreshProbe = true');
  await click('#nav-refresh'); await delay(500);
  assert.equal(await sourceGuest.executeJavaScript('window.navigationRefreshProbe === undefined'), true);
  await js(`document.activeElement.blur()`);
  await click('#settings-btn'); await fill('#glass-transparency', '50');
  assert.equal(await js(`document.documentElement.style.getPropertyValue('--glass-alpha')`), '0.5');
  await js(`document.querySelector('#glass-settings').scrollIntoView()`); await shot('glass-settings');
  await click('#settings-close');
  await click('#task-workspace-button');
  await shot('captured-answer');
  await click('#task-close');
  await win.loadFile(path.join(root, 'index.html')); await delay(500);
  assert.equal(await js(`document.querySelector('#glass-transparency').value`), '50');
  await captureSelection();
  await waitFor(`!!document.querySelector('#capture-task-title')`);
  await shot('capture-choose-task');
  await fill('#capture-task-title', '新任务自动收集'); await click('#capture-save'); await saved();
  assert.equal((await store.read()).tasks.length, 2);
  assert.equal((await store.read()).tasks[0].materials[0].text, '一段值得保存的回答：任务让资料不再散落。');
  await textClick('复制任务资料'); await delay(100); assert.ok(copied.includes(sourceUrl));
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['real task IPC', 'create/edit task', 'manual materials', 'safe text rendering', 'archive/restore', 'task and material trash', 'draft on close', 'discard cancellation', 'material search', '480px layout', 'reload persistence', 'write failure and retry', 'promoted beta settings', 'native webview selection capture', 'automatic source capture', 'capture task chooser', 'copy material and task bundle', 'open source'], profile }, null, 2));
  server.close(); win.destroy(); app.quit();
}).catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); server?.close(); win?.destroy(); app.exit(1); });
