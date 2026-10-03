// 校验：侧栏底部四个入口的图标规格与收起/展开对齐，以及对比页的减法结果。
// 使用独立临时 userData，不接触正式配置与登录数据；网络请求全部阻断。
const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", "icon-ui-check");
fs.mkdirSync(output, { recursive: true });
for (const name of ["failure.txt", "result.json"])
  fs.rmSync(path.join(output, name), { force: true });
app.setPath("userData", path.join(output, "profile"));
// 与其它界面检查一致：本机 GPU 子进程可能起不来，改用软件合成。
// 在受限容器里如果报 ERR_FAILED 打不开 index.html，可在命令行额外加 --no-sandbox。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-gpu-sandbox");
let win, shot;
const errors = [];
const checks = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  app.on("session-created", (ses) =>
    ses.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (_, cb) => cb({ cancel: true }),
    ),
  );
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_, cb) => cb({ cancel: true }),
  );
  await session.defaultSession.clearStorageData();
  const responses = {
    "get-downloads": [],
    "get-permissions": {},
    "get-download-path": "Downloads",
    "get-float-ball-enabled": true,
    "get-app-version": require("../package.json").version,
    "window-is-maximized": false,
    "comparison:read": {
      ok: true,
      value: { revision: 1, currentId: "", comparisons: [] },
    },
    "comparison:save": {
      ok: true,
      value: { revision: 2, currentId: "", comparisons: [] },
    },
    "comparison:active": true,
  };
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  for (const match of preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g))
    ipcMain.handle(match[1], () => responses[match[1]] ?? true);
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(root, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (_event, details) => {
    if (
      details.level === "error" &&
      !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(details.message)
    )
      errors.push(details.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (s) => js(`document.querySelector(${JSON.stringify(s)}).click()`);
  shot = async (name) => {
    await delay(320);
    fs.writeFileSync(
      path.join(output, name + ".png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  const metrics = () =>
    js(`[...document.querySelectorAll('.sidebar-footer > button')].map(b=>{
      const r=b.getBoundingClientRect(), svg=b.querySelector('svg.sf-icon'), sr=svg.getBoundingClientRect();
      const label=b.querySelector('.sf-label');
      return {
        label:label?label.textContent:null,
        labelDisplay:label?getComputedStyle(label).display:null,
        w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y),
        iconW:Math.round(sr.width), iconH:Math.round(sr.height),
        iconStroke:getComputedStyle(svg).strokeWidth,
        iconFill:getComputedStyle(svg).fill,
        dx:Math.round((sr.x+sr.width/2)-(r.x+r.width/2)),
        dy:Math.round((sr.y+sr.height/2)-(r.y+r.height/2))
      };
    })`);

  await win.loadFile(path.join(root, "index.html"));
  win.showInactive();
  await delay(800);

  // The header and footer must share actual rendered metrics, not only SVG attributes.
  const unifiedMetrics = () => js(`['#collapse-btn', '.sidebar-footer > button'].flatMap(selector =>
    [...document.querySelectorAll(selector)].map(button => {
      const svg=button.querySelector('.sf-icon'), r=svg.getBoundingClientRect(), b=button.getBoundingClientRect();
      const style=getComputedStyle(svg), box=svg.getBBox(), control=getComputedStyle(button);
      return {id:button.id,w:r.width,h:r.height,stroke:style.strokeWidth,fill:style.fill,
        cap:style.strokeLinecap,join:style.strokeLinejoin,color:style.color,
        buttonH:b.height,radius:control.borderRadius,border:control.borderWidth,
        dy:(r.y+r.height/2)-(b.y+b.height/2),glyphW:box.width,glyphH:box.height};
    }))`);
  for (const m of await unifiedMetrics()) {
    assert.equal(m.w,18,m.id+' icon width');assert.equal(m.h,18,m.id+' icon height');
    assert.equal(m.stroke,'1.6px',m.id+' stroke');assert.equal(m.fill,'none',m.id+' fill');
    assert.equal(m.cap,'round');assert.equal(m.join,'round');assert.equal(m.buttonH,34);
    assert.equal(m.radius,'8px');assert.ok(parseFloat(m.border)>0&&parseFloat(m.border)<=1);assert.ok(Math.abs(m.dy)<.1);
    assert.ok(m.glyphW>=16&&m.glyphW<=19,m.id+' silhouette width: '+m.glyphW);
    assert.ok(m.glyphH>=16&&m.glyphH<=19,m.id+' silhouette height: '+m.glyphH);
  }
  assert.equal(new Set((await unifiedMetrics()).map(m=>m.color)).size,1,'all five icons share foreground color');
  assert.equal(new Set((await unifiedMetrics()).map(m=>m.border)).size,1,'all five controls share border width at current DPI');
  checks.push('collapse and four footer icons: same 18px size, 1.6 stroke, color, 34px controls and balanced silhouettes');

  // ---- 展开态 ----
  const open = await metrics();
  assert.equal(open.length, 4, "侧栏底部应有 4 个入口");
  assert.deepEqual(
    open.map((m) => m.label),
    ["对比", "任务", "设置", "下载"],
  );
  for (const m of open) {
    assert.equal(m.iconW, 18, m.label + " 图标宽度");
    assert.equal(m.iconH, 18, m.label + " 图标高度");
    assert.equal(m.iconStroke, "1.6px", m.label + " 描边宽度");
    assert.equal(m.iconFill, "none", m.label + " 应为线性图标");
    assert.notEqual(m.labelDisplay, "none", m.label + " 展开态应显示文字");
    assert.equal(m.h, 34, m.label + " 高度");
  }
  assert.equal(open[0].w, open[1].w, "同一行两个入口等宽");
  assert.equal(open[2].w, open[3].w, "同一行两个入口等宽");
  assert.equal(open[0].y, open[1].y, "第一行水平对齐");
  assert.equal(open[2].y, open[3].y, "第二行水平对齐");
  assert.ok(open[2].y > open[0].y, "应为 2×2 网格");
  assert.equal(open[0].x, open[2].x, "两列左边缘对齐");
  assert.equal(open[1].x, open[3].x, "两列左边缘对齐");
  checks.push("expanded sidebar footer: 2x2 grid, 34px rows, 18px/1.6 line icons");
  await shot("sidebar-expanded");

  // ---- 收起态 ----
  await click("#collapse-btn");
  await delay(400);
  const closed = await metrics();
  assert.equal((await unifiedMetrics()).length,5);
  for (const m of await unifiedMetrics()) {
    assert.equal(m.w,18);assert.equal(m.h,18);assert.equal(m.buttonH,34);assert.equal(m.stroke,'1.6px');
  }
  assert.equal(closed.length, 4);
  for (const m of closed) {
    assert.equal(m.w, 34, m.label + " 收起态宽度");
    assert.equal(m.h, 34, m.label + " 收起态高度");
    assert.equal(m.iconW, 18, m.label + " 收起态图标宽度");
    assert.equal(m.iconH, 18, m.label + " 收起态图标高度");
    assert.equal(m.iconStroke, "1.6px", m.label + " 收起态描边宽度");
    assert.equal(m.labelDisplay, "none", m.label + " 收起态应隐藏文字");
    assert.equal(m.dx, 0, m.label + " 图标应水平居中");
    assert.equal(m.dy, 0, m.label + " 图标应垂直居中");
  }
  assert.equal(
    new Set(closed.map((m) => m.x)).size,
    1,
    "收起态四个入口左边缘应完全对齐",
  );
  assert.equal(closed[0].x, closed[3].x, "首尾入口对齐");
  checks.push("collapsed sidebar footer: four 34x34 squares, icons centered and aligned");
  await shot("sidebar-collapsed");

  // ---- 收起态：侧栏内各类元素的水平中心应完全一致 ----
  const centers = await js(`(()=>{
    const side=document.querySelector('#sidebar').getBoundingClientRect();
    const pick=(sel)=>{
      for(const n of document.querySelectorAll(sel)){
        const r=n.getBoundingClientRect();
        if(r.width>0&&r.height>0) return Math.round(r.x+r.width/2-side.x);
      }
      return null;
    };
    return {
      sidebarWidth:Math.round(side.width),
      collapse:pick('#collapse-btn'),
      addSite:pick('.section-add-btn'),
      favicon:pick('.tab-item .favicon, .tab-item .favicon-placeholder'),
      footer:pick('.sidebar-footer > button')
    };
  })()`);
  assert.equal(
    new Set([centers.collapse, centers.addSite, centers.favicon, centers.footer]).size,
    1,
    "收起态侧栏元素应共用同一水平中心：" + JSON.stringify(centers),
  );
  assert.equal(
    centers.collapse,
    Math.round(centers.sidebarWidth / 2),
    "中心应与侧栏中线重合：" + JSON.stringify(centers),
  );
  checks.push(
    "collapsed sidebar: header, section, favicon and footer share one vertical axis",
  );

  // ---- 对比页减法 ----
  await click("#collapse-btn");
  await delay(300);
  await click("#comparison-workspace-button");
  await delay(900);
  assert.equal(
    await js(
      `document.querySelectorAll('#comparison-workbench input, #comparison-workbench textarea, #comparison-workbench select').length`,
    ),
    0,
    "对比页顶部不应残留任何输入控件",
  );
  assert.equal(
    await js(
      `[...document.querySelectorAll('#comparison-workbench header button')].filter(b=>!b.closest('[hidden]')).map(b=>b.textContent).join('|')`,
    ),
    "选择 AI|关闭",
    "对比页顶部只保留选择 AI 与关闭",
  );
  assert.equal(
    await js(`document.querySelector('#cmp-feedback').textContent`),
    "已保存到本机",
  );
  assert.ok(
    (await js(`document.querySelectorAll('.cmp-column').length`)) >= 2,
    "应渲染 2～3 栏分屏对比",
  );
  assert.equal(
    await js(
      `document.querySelector('#comparison-workbench').scrollWidth<=document.querySelector('#comparison-workbench').clientWidth`,
    ),
    true,
    "对比页不应出现横向溢出",
  );
  checks.push("comparison workbench: split view only, no top inputs");
  await shot("comparison-reduced");

  // ---- 窄窗口：未聚焦的栏折叠成标题条，点击即可切换（取代原来的站点标签行） ----
  win.setSize(900, 700);
  await delay(500);
  const narrow = await js(`({
    collapsed: document.querySelectorAll('.cmp-column.cmp-collapsed-col').length,
    visible: [...document.querySelectorAll('.cmp-webview')].filter(w=>getComputedStyle(w).display!=='none').length,
    strips: [...document.querySelectorAll('.cmp-collapsed-col .cmp-col-name')].map(b=>b.textContent)
  })`);
  assert.equal(narrow.visible, 1, "窄窗口只显示一栏");
  assert.equal(narrow.collapsed, 1, "另一栏应折叠成标题条");
  assert.deepEqual(narrow.strips, ["腾讯元宝"]);
  assert.equal(
    await js(
      `document.querySelector('#comparison-workbench').scrollWidth<=document.querySelector('#comparison-workbench').clientWidth`,
    ),
    true,
    "窄窗口不应横向溢出",
  );
  await shot("comparison-narrow");
  await js(
    `[...document.querySelectorAll('.cmp-collapsed-col .cmp-col-name')][0].click()`,
  );
  await delay(400);
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.cmp-collapsed-col .cmp-col-name')].map(b=>b.textContent)`,
    ),
    ["DeepSeek"],
    "点击标题条应切换聚焦栏",
  );
  assert.equal(
    await js(
      `[...document.querySelectorAll('.cmp-webview')].filter(w=>getComputedStyle(w).display!=='none').length`,
    ),
    1,
  );
  checks.push(
    "narrow window collapses the unfocused column into a clickable title strip",
  );
  await shot("comparison-narrow-switched");

  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify({ passed: true, checks, errors }, null, 2),
  );
  win.destroy();
  app.exit(0);
})
  .catch(async (e) => {
    console.error(e);
    fs.writeFileSync(path.join(output, "failure.txt"), e.stack);
    if (win && !win.isDestroyed()) await shot("failure");
    app.exit(1);
  });
