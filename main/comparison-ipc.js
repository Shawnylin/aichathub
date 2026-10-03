const { trusted } = require("./task-ipc");
const { safeURL } = require("./comparison-store");
const { sourceSnapshot } = require("./task-capture");
function comparisonMenuItem(value, send) {
  const snapshot = sourceSnapshot(value);
  if (
    snapshot &&
    typeof value.prompt === "string" &&
    value.prompt.length <= 100000 &&
    typeof value.comparisonId === "string" &&
    value.comparisonId.length <= 64
  ) {
    snapshot.prompt = value.prompt;
    snapshot.comparisonId = value.comparisonId;
  }
  let safe = false;
  try {
    safe = !!snapshot && !!safeURL(snapshot.source.url);
  } catch (_) {}
  return {
    label: "保存到当前对比",
    enabled: safe,
    click: () => {
      if (safe) send(snapshot);
    },
  };
}
function registerComparisonIpc({
  ipcMain,
  getWindow,
  indexFile,
  store,
  dialog,
}) {
  for (const [channel, fn] of Object.entries({
    read: () => store.read(),
    save: (request) => store.change(request),
    recover: async () =>
      (
        await dialog.showMessageBox(getWindow(), {
          message: "恢复上次对比备份？当前文件将另存保留。",
          buttons: ["取消", "恢复"],
          cancelId: 0,
          defaultId: 0,
        })
      ).response === 1
        ? store.recover()
        : null,
    export: async (value) => {
      if (typeof value !== "string" || value.length > 20 * 1024 * 1024)
        throw new Error("导出内容过长");
      const result = await dialog.showSaveDialog(getWindow(), {
        title: "导出对比 Markdown",
        defaultPath: "AI 对比.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled) return null;
      const fs = require("node:fs/promises");
      try {
        await fs.copyFile(result.filePath, result.filePath + ".backup");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await store.atomic(result.filePath, value);
      return result.filePath;
    },
  }))
    ipcMain.handle("comparison:" + channel, async (event, request) => {
      if (!trusted(event, getWindow(), indexFile))
        return { ok: false, code: "FORBIDDEN", error: "不允许访问对比数据" };
      try {
        return { ok: true, value: await fn(request) };
      } catch (e) {
        return { ok: false, code: e.code || "IO", error: e.message };
      }
    });
}
module.exports = { registerComparisonIpc, comparisonMenuItem };
