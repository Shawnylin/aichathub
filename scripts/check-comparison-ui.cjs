// Real application boot, isolated userData/sessionData, only loopback HTTP permitted.
const {
  app,
  BrowserWindow,
  session,
  webContents,
  Menu,
  dialog,
  clipboard,
} = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  http = require("node:http");
const root = path.resolve(__dirname, ".."),
  output = path.join(root, "dist/comparison-ui-check");
fs.mkdirSync(output, { recursive: true });
for (const name of ["failure.txt", "result.json"])
  fs.rmSync(path.join(output, name), { force: true });
const profile = fs.mkdtempSync(path.join(output, "profile-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
fs.writeFileSync(
  path.join(profile, "config.json"),
  JSON.stringify({ floatBallEnabled: false, downloadPath: output }),
);
const errors = [],
  checks = [];
let win,
  server,
  menu,
  trayLabels = [],
  copied = "",
  exportFile = path.join(output, "comparison.md");
clipboard.writeText = (value) => {
  copied = value;
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportFile });
dialog.showMessageBox = async () => ({ response: 1 });
const originalMenu = Menu.buildFromTemplate;
Menu.buildFromTemplate = function (template) {
  if (template.some((x) => x.label === "显示窗口"))
    trayLabels = template.map((x) => x.label);
  if (template.some((x) => x.label === "保存到当前对比")) menu = template;
  const m = originalMenu.call(this, template);
  if (template.some((x) => x.label === "保存到当前对比")) m.popup = () => {};
  return m;
};
const block = (ses) =>
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (r, cb) => cb({ cancel: new URL(r.url).hostname !== "127.0.0.1" }),
  );
app.on("session-created", block);
app.whenReady().then(() => block(session.defaultSession));
require("../main");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (code) => win.webContents.executeJavaScript(code, true);
const click = (s) => js(`document.querySelector(${JSON.stringify(s)}).click()`);
const fill = (s, value) =>
  js(
    `{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
async function waitFor(code) {
  for (let i = 0; i < 80; i++) {
    if (await js(code)) return;
    await delay(100);
  }
  throw new Error(
    "Timed out: " +
      code +
      "\n" +
      (await js(`document.querySelector('#cmp-feedback')?.textContent`)),
  );
}
const saved = () =>
  waitFor(
    `document.querySelector('#cmp-feedback').textContent==='已保存到本机'`,
  );
const shot = async (name) => {
  await delay(350);
  fs.writeFileSync(
    path.join(output, name + ".png"),
    (await win.webContents.capturePage()).toPNG(),
  );
};
const textClick = (scope, text) =>
  js(
    `[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(n=>n.textContent===${JSON.stringify(text)}).click()`,
  );
app
  .whenReady()
  .then(async () => {
    win = BrowserWindow.getAllWindows()[0];
    win.webContents.on("console-message", (_e, d) => {
      if (
        d.level === "error" &&
        /Uncaught|TypeError|ReferenceError/.test(d.message)
      )
        errors.push(d.message);
    });
    await delay(900);
    await waitFor(`!!window.comparisonWorkbench`);
    await js(
      `window.confirm=()=>true;window.prompt=()=> '关联研究任务';undefined`,
    );
    server = http.createServer((req, res) => {
      if (req.url === "/download") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename=isolated-download.txt",
        });
        res.end("test download");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>离线测试 AI</title></head><body style="font:18px system-ui;padding:24px;background:#eef1f3"><h1>测试 AI · ' +
          req.url +
          '</h1><p id="answer">共同事实：可以保留原始来源。不同建议：先验证，再整理。</p><textarea aria-label="测试输入框" style="width:85%;height:80px" placeholder="手动粘贴提示词"></textarea></body></html>',
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}`;
    await js(
      `document.querySelector('#wv-deepseek').src=${JSON.stringify(url + "/deepseek")};undefined`,
    );
    await delay(400);
    const guestBefore = await js(
      `document.querySelector('#wv-deepseek').getWebContentsId()`,
    );
    await click("#comparison-workspace-button");
    await waitFor(`document.querySelectorAll('.cmp-column').length===2`);
    await saved();
    await js(
      `document.querySelector('#wv-yuanbao').src=${JSON.stringify(url + "/yuanbao")};undefined`,
    );
    await delay(400);
    assert.equal(
      await js(`document.querySelector('#wv-deepseek').getWebContentsId()`),
      guestBefore,
    );
    checks.push("existing webview identity retained");
    assert.equal(
      await js(
        `document.querySelectorAll('#comparison-workbench input, #comparison-workbench textarea').length`,
      ),
      0,
      "对比工作台顶部不再保留任何文本框",
    );
    assert.equal(
      await js(
        `[...document.querySelectorAll('#comparison-workbench header button')].filter(b=>!b.closest('[hidden]')).map(b=>b.textContent).join('|')`,
      ),
      "选择 AI|关闭",
      "顶部只保留标题、状态、选择 AI 与关闭",
    );
    checks.push("comparison workbench reduced to the split view only");
    await shot("comparison-1400x900");
    const rects = await js(
      `[...document.querySelectorAll('webview.cmp-webview')].map(w=>({id:w.id,rect:w.getBoundingClientRect().toJSON(),display:getComputedStyle(w).display}))`,
    );
    assert.equal(rects.filter((r) => r.display !== "none").length, 2);
    assert.ok(rects.every((r) => r.rect.width > 400));
    const first = webContents.fromId(guestBefore);
    assert.equal(first.session, session.fromPartition("persist:deepseek"));
    await first.executeJavaScript(
      `{let r=document.createRange();r.selectNodeContents(document.querySelector('#answer'));getSelection().removeAllRanges();getSelection().addRange(r);}`,
    );
    const point = await first.executeJavaScript(
      `(()=>{const r=document.querySelector('#answer').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+5)};})()`,
    );
    first.sendInputEvent({
      type: "mouseDown",
      ...point,
      button: "right",
      clickCount: 1,
    });
    first.sendInputEvent({
      type: "mouseUp",
      ...point,
      button: "right",
      clickCount: 1,
    });
    for (let i = 0; i < 50 && !menu; i++) await delay(100);
    assert.ok(menu, "real native selection context menu");
    assert.ok(menu.some((i) => i.label === "保存选中文字到任务"));
    const item = menu.find((i) => i.label === "保存到当前对比");
    assert.equal(item.enabled, true);
    item.click();
    await saved();
    const captured = await js(
      `window.comparison.read().then(r=>{const one=r.value.comparisons.find(x=>x.id===r.value.currentId);return one.answers.map(a=>({siteId:a.siteId,text:a.text,url:a.url}));})`,
    );
    assert.equal(captured.length, 1);
    assert.equal(captured[0].siteId, "deepseek");
    assert.ok(captured[0].text.includes("共同事实"));
    assert.equal(captured[0].url, url + "/deepseek");
    checks.push(
      "native selection capture still persists into the local comparison file",
    );
    await js(`document.body.classList.add('dark');undefined`);
    await click("#cmp-select-sites");
    await js(
      `{const ss=document.querySelectorAll('.cmp-chooser select');ss[2].value='doubao';}`,
    );
    await textClick(".cmp-chooser", "应用");
    await waitFor(`document.querySelectorAll('.cmp-column').length===3`);
    await js(
      `document.querySelector('#wv-doubao').src=${JSON.stringify(url + "/doubao")};undefined`,
    );
    await delay(450);
    await shot("comparison-three-dark");
    assert.equal(
      await js(
        `[...document.querySelectorAll('.cmp-webview')].filter(w=>getComputedStyle(w).display!=='none').length`,
      ),
      3,
    );
    win.setSize(1024, 768);
    await delay(300);
    assert.equal(
      await js(
        `[...document.querySelectorAll('.cmp-webview')].filter(w=>getComputedStyle(w).display!=='none').length`,
      ),
      1,
    );
    await shot("comparison-1024x768");
    win.setSize(480, 640);
    await delay(300);
    assert.equal(
      await js(
        `document.querySelector('#comparison-workbench').scrollWidth<=document.querySelector('#comparison-workbench').clientWidth`,
      ),
      true,
    );
    assert.ok(
      await js(
        `[...document.querySelectorAll('.cmp-webview')].find(w=>getComputedStyle(w).display!=='none').getBoundingClientRect().height>150`,
      ),
    );
    await shot("comparison-narrow");
    checks.push("1400 dual/triple, 1024 single-column, 480 narrow viewport");
    await click("#cmp-close");
    await delay(200);
    assert.equal(
      await js(
        `document.querySelector('#wv-yuanbao')===null && document.querySelector('#wv-doubao')===null`,
      ),
      true,
    );
    assert.equal(
      await js(`document.querySelector('#wv-deepseek').getWebContentsId()`),
      guestBefore,
    );
    checks.push("temporary guests released, original guest preserved");
    await win.loadFile(path.join(root, "index.html"));
    await waitFor(`!!window.comparisonWorkbench`);
    await click("#comparison-workspace-button");
    await waitFor(`document.querySelectorAll('.cmp-column').length===3`);
    checks.push("restart restores the three-site split view");
    await click("#cmp-close");
    await click("#settings-btn");
    await delay(150);
    await shot("existing-settings");
    await click("#settings-close");
    await click("#task-workspace-button");
    await waitFor(
      `document.querySelector('#task-workspace').open && document.querySelector('#task-feedback').textContent.includes('本机') && document.querySelector('#task-close').disabled === false`,
    );
    assert.ok(await js(`!!document.querySelector('#task-new')`));
    checks.push("existing settings and task panel operate");
    await click("#task-close");
    await waitFor(`!document.querySelector('#task-workspace').open`);
    win.setSize(1400, 900);
    await click("#add-site-btn");
    await fill("#site-name-input", "自定义 <AI>");
    await fill("#site-url-input", url + "/custom");
    await click("#site-form-submit");
    await waitFor(`!!document.querySelector('webview[id^="wv-custom-"]')`);
    await delay(450);
    const customId = await js(`CUSTOM_SITES[0].id`);
    const customGuest = webContents.fromId(
      await js(
        `document.querySelector('#wv-'+CUSTOM_SITES[0].id).getWebContentsId()`,
      ),
    );
    assert.equal(
      customGuest.session,
      session.fromPartition("persist:" + customId),
    );
    assert.ok(trayLabels.includes("自定义 <AI>"));
    assert.equal(
      await js(`window.app.setPermission(CUSTOM_SITES[0].id,'media',true)`),
      true,
    );
    assert.equal(
      (await js(`window.app.getPermissions()`))[customId].media,
      true,
    );
    customGuest.downloadURL(url + "/download");
    await waitFor(
      `window.app.getDownloads().then(ds=>ds.some(d=>d.state==='completed'))`,
    );
    assert.ok(fs.existsSync(path.join(output, "isolated-download.txt")));
    await click("#comparison-workspace-button");
    await click("#cmp-select-sites");
    await js(
      `{const ss=document.querySelectorAll('.cmp-chooser select');ss[0].value='deepseek';ss[1].value=CUSTOM_SITES[0].id;ss[2].value='';}`,
    );
    await textClick(".cmp-chooser", "应用");
    await delay(250);
    assert.equal(
      await js(
        `document.querySelector('#wv-'+CUSTOM_SITES[0].id).getWebContentsId()`,
      ),
      customGuest.id,
    );
    assert.equal(
      await js(
        `document.querySelectorAll('webview[id="wv-'+CUSTOM_SITES[0].id+'"]').length`,
      ),
      1,
    );
    await click("#cmp-select-sites");
    await js(
      `{const ss=document.querySelectorAll('.cmp-chooser select');ss[1].value=ss[0].value;}`,
    );
    await textClick(".cmp-chooser", "应用");
    assert.ok(
      await js(
        `document.querySelector('.cmp-chooser p').textContent.includes('不同')`,
      ),
    );
    await textClick(".cmp-chooser", "取消");
    const dragPoint = await js(
      `(()=>{const n=document.querySelector('.cmp-grip'),r=n.getBoundingClientRect();const x=Math.round(r.x+r.width/2),y=Math.round(r.y+100);const hit=document.elementFromPoint(x,y);return {x,y,reachable:hit===n,grip:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),display:getComputedStyle(n).display,z:getComputedStyle(n).zIndex},hit:hit?(hit.className||hit.tagName)+'|'+hit.tagName:null,panel:document.querySelector('#comparison-workbench').className,cols:document.querySelectorAll('.cmp-column').length};})()`,
    );
    assert.equal(
      dragPoint.reachable,
      true,
      "Resize grip remains reachable beside the guest surface: " +
        JSON.stringify(dragPoint),
    );
    const dragWidth = await js(
      `document.querySelector('.cmp-column').getBoundingClientRect().width`,
    );
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: dragPoint.x,
      y: dragPoint.y,
      button: "left",
      clickCount: 1,
    });
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: dragPoint.x + 60,
      y: dragPoint.y,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: dragPoint.x + 60,
      y: dragPoint.y,
      button: "left",
      clickCount: 1,
    });
    await delay(200);
    assert.ok(
      (await js(
        `document.querySelector('.cmp-column').getBoundingClientRect().width`,
      )) > dragWidth,
    );
    const beforeWidth = await js(
      `document.querySelector('.cmp-column').getBoundingClientRect().width`,
    );
    await js(
      `document.querySelector('.cmp-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
    );
    await delay(200);
    assert.ok(
      (await js(
        `document.querySelector('.cmp-column').getBoundingClientRect().width`,
      )) > beforeWidth,
    );
    await textClick(".cmp-column", "放大 / 还原");
    await delay(150);
    assert.equal(
      await js(
        `[...document.querySelectorAll('.cmp-webview')].filter(w=>getComputedStyle(w).display!=='none').length`,
      ),
      1,
    );
    await textClick(".cmp-column", "放大 / 还原");
    await js(
      `document.querySelector('.cmp-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
    );
    customGuest.sendInputEvent({
      type: "keyDown",
      keyCode: "S",
      modifiers: ["control"],
    });
    await waitFor(
      `document.querySelector('#cmp-feedback').textContent==='已保存到本机'`,
    );
    await shot("custom-site-comparison");
    checks.push(
      "custom site real form, persistent session, tray, permission, download, duplicate rejection, keyboard width, maximize and guest Ctrl+S shortcut",
    );
    await saved();
    const raw = await js(`window.comparison.read()`);
    const journal = {
      revision: raw.value.revision,
      comparison: structuredClone(
        raw.value.comparisons.find((c) => c.id === raw.value.currentId),
      ),
    };
    journal.comparison.title = "异常退出未写入的草稿";
    await js(
      `localStorage.setItem('aihub-comparison-pending-v1',${JSON.stringify(JSON.stringify(journal))});undefined`,
    );
    await click("#cmp-close");
    await win.loadFile(path.join(root, "index.html"));
    await waitFor(`!!window.comparisonWorkbench`);
    await click("#comparison-workspace-button");
    await waitFor(
      `document.querySelector('#cmp-title').textContent==='异常退出未写入的草稿'`,
    );
    await saved();
    checks.push("emergency journal recovery");
    await click("#cmp-close");
    const primary = path.join(
      profile,
      "comparison-workspace",
      "comparisons.json",
    );
    fs.writeFileSync(primary, "{damaged-ui-test");
    await win.loadFile(path.join(root, "index.html"));
    await waitFor("!!window.comparisonWorkbench");
    await click("#comparison-workspace-button");
    await waitFor(
      `document.querySelector('#cmp-feedback').textContent.includes('原文件未修改')`,
    );
    assert.equal(
      await js(`document.querySelector('#cmp-recovery').hidden`),
      false,
    );
    assert.equal(fs.readFileSync(primary, "utf8"), "{damaged-ui-test");
    await textClick("#cmp-recovery", "恢复备份");
    await waitFor(`document.querySelectorAll('.cmp-column').length>0`);
    assert.ok(
      fs
        .readdirSync(path.dirname(primary))
        .some((name) => name.includes(".preserved-")),
    );
    checks.push(
      "damaged-file UI blocks editing and explicit backup recovery preserves original",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify({ passed: true, checks, profile, errors }, null, 2),
    );
    server.close();
    win.destroy();
    app.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    fs.writeFileSync(path.join(output, "failure.txt"), e.stack);
    if (win && !win.isDestroyed()) await shot("failure");
    server?.close();
    app.exit(1);
  });
