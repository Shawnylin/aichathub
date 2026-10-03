const { trusted } = require("./task-ipc");
function guardedIpc(
  ipcMain,
  { getWindow, getFloat, indexFile, floatFile, validArgs = () => true },
) {
  const allowed = (channel, event, args) =>
    channel.startsWith("float-ball-")
      ? trusted(event, getFloat(), floatFile) && validArgs(channel, args)
      : trusted(event, getWindow(), indexFile) && validArgs(channel, args);
  return {
    on(channel, fn) {
      ipcMain.on(channel, (event, ...args) => {
        if (allowed(channel, event, args)) return fn(event, ...args);
      });
    },
    handle(channel, fn) {
      ipcMain.handle(channel, (event, ...args) =>
        allowed(channel, event, args)
          ? fn(event, ...args)
          : { ok: false, code: "FORBIDDEN" },
      );
    },
  };
}
function installNavigationGuard(
  win,
  registry,
  newtabURL,
  getComparisonActive = () => false,
) {
  const safe = (value) => {
    try {
      const u = new URL(value);
      return (
        (["https:", "http:"].includes(u.protocol) &&
          !u.username &&
          !u.password) ||
        u.href.split("?")[0] === newtabURL
      );
    } catch (_) {
      return false;
    }
  };
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event, prefs, params) => {
    if (
      !safe(params.src) ||
      ![...registry.sites.keys()].some(
        (id) => params.partition === registry.partition(id),
      )
    ) {
      event.preventDefault();
      return;
    }
    // Replace any guest-supplied preload with our isolated state observer.
    prefs.preload = require('path').join(__dirname, 'guest-activity-preload.js');
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
  });
  win.webContents.on("did-attach-webview", (_event, guest) => {
    guest.on("before-input-event", (event, input) => {
      if (!getComparisonActive() || input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      // 只接管工作台自己的快捷键，Ctrl+Enter 留给 AI 网站自己的发送行为。
      if ((input.control && key === "s") || key === "escape") {
        event.preventDefault();
        win.webContents.send("comparison:shortcut", {
          key: input.key,
          ctrlKey: input.control,
        });
      }
    });
    guest.on("will-navigate", (event, url) => {
      if (!safe(url)) event.preventDefault();
    });
    guest.on("will-redirect", (event, url) => {
      if (!safe(url)) event.preventDefault();
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (safe(url))
        win.webContents.send("guest-popup", { guestId: guest.id, url });
      return { action: "deny" };
    });
  });
}
module.exports = { guardedIpc, installNavigationGuard };
