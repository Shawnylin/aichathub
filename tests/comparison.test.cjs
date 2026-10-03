const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ComparisonStore, safeURL } = require("../main/comparison-store");
const { TaskStore } = require("../main/task-store");
const { SiteRegistry } = require("../main/site-registry");
const {
  registerComparisonIpc,
  comparisonMenuItem,
} = require("../main/comparison-ipc");
const { guardedIpc } = require("../main/ipc-security");
const { pathToFileURL } = require("node:url");
const model = require("../renderer/comparison-model");
const root = path.resolve(__dirname, "../dist/comparison-tests");
async function fixture() {
  await fs.mkdir(root, { recursive: true });
  return new ComparisonStore(await fs.mkdtemp(path.join(root, "case-")));
}
function sample() {
  const c = model.create([
    { id: "deepseek", name: "DeepSeek" },
    { id: "custom-test", name: "自定义" },
  ]);
  c.prompt = "比较两种方案";
  return c;
}
async function save(store, c) {
  const data = await store.change({
    revision: (await store.read()).revision,
    comparison: c,
  });
  return data.comparisons.find((x) => x.id === data.currentId);
}
function answer() {
  return {
    id: "answer-1",
    title: "回答 <script>",
    text: "方案 A",
    siteId: "deepseek",
    siteName: "DeepSeek",
    url: "https://example.com/chat",
    capturedAt: new Date().toISOString(),
    prompt: "原问题",
    notes: "核查后推荐",
    recommended: true,
    common: true,
    conflict: true,
    deleted: false,
  };
}
test("comparison create/edit/delete/restore and prompt survive restart", async () => {
  const store = await fixture();
  let c = await save(store, sample());
  c.answers.push(answer());
  c = await save(store, c);
  c.answers[0].deleted = true;
  c.deleted = true;
  c = await save(store, c);
  c.deleted = false;
  c.answers[0].deleted = false;
  await save(store, c);
  const loaded = await new ComparisonStore(store.directory).read();
  assert.equal(loaded.comparisons[0].prompt, "比较两种方案");
  assert.equal(loaded.comparisons[0].answers[0].deleted, false);
  assert.equal(loaded.comparisons[0].deleted, false);
});
test("comparison revision conflict never overwrites", async () => {
  const store = await fixture();
  await save(store, sample());
  await assert.rejects(store.change({ revision: 0, comparison: sample() }), {
    code: "CONFLICT",
  });
  assert.equal((await store.read()).comparisons.length, 1);
});
test("corruption and unknown schema preserve exact original bytes; recover preserves damaged file", async () => {
  const store = await fixture();
  let c = await save(store, sample());
  c.title = "第二版";
  await save(store, c);
  for (const value of ["损坏", { schemaVersion: 999 }]) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    await fs.writeFile(store.file, raw);
    const next = new ComparisonStore(store.directory);
    await assert.rejects(next.read());
    await assert.rejects(next.change({ revision: 0, comparison: sample() }));
    assert.equal(await fs.readFile(store.file, "utf8"), raw);
  }
  const next = new ComparisonStore(store.directory);
  assert.equal((await next.recover()).comparisons[0].title, "新的 AI 对比");
  assert.ok(
    (await fs.readdir(store.directory)).some((f) => f.includes(".preserved-")),
  );
});
test("v1 task schema requires no migration: comparison link and append preserve all old entities", async () => {
  const store = await fixture();
  const tasks = new TaskStore(path.join(store.directory, "tasks"));
  let result = await tasks.change({
    revision: 0,
    type: "create-task",
    title: "旧任务",
    goal: "旧目标",
  });
  result = await tasks.change({
    revision: 1,
    type: "create-material",
    taskId: result.selectedId,
    title: "旧材料",
    text: "全部保留",
  });
  const original = structuredClone(result.data.tasks[0]);
  let c = sample();
  c.taskId = original.id;
  await save(store, c);
  assert.deepEqual(
    (await new TaskStore(tasks.directory).read()).tasks[0],
    original,
  );
  await tasks.change({
    revision: 2,
    type: "create-material",
    taskId: original.id,
    title: "对比",
    text: model.markdown(c),
  });
  const task = (await tasks.read()).tasks[0];
  assert.equal(task.goal, original.goal);
  assert.deepEqual(task.materials[1], original.materials[0]);
  assert.equal((await tasks.read()).schemaVersion, 1);
});
test("unsafe or credential URLs rejected by store and capture", async () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///private",
    "data:text/plain,hi",
    "https://token:secret@example.com",
  ]) {
    assert.throws(() => safeURL(url));
    assert.equal(
      comparisonMenuItem({ text: "x", url }, () => {}).enabled,
      false,
    );
    const store = await fixture(),
      c = sample();
    c.answers.push({ ...answer(), url });
    await assert.rejects(save(store, c));
  }
});
test("builtins and custom sites share lifecycle with distinct original partitions and single listeners", () => {
  const seen = new Map();
  const session = {
    fromPartition: (p) => {
      if (!seen.has(p))
        seen.set(p, {
          downloads: 0,
          setPermissionRequestHandler(fn) {
            this.request = fn;
          },
          setPermissionCheckHandler(fn) {
            this.check = fn;
          },
        });
      return seen.get(p);
    },
  };
  const r = new SiteRegistry({
    session,
    setupDownload: (s) => s.downloads++,
    permissions: () => ({}),
    builtins: { deepseek: { name: "DeepSeek" } },
  });
  const custom = [
    { id: "custom-test", name: "测试", url: "https://example.com" },
  ];
  r.sync(custom);
  r.sync(custom);
  assert.equal(r.partition("deepseek"), "persist:deepseek");
  assert.equal(r.partition("custom-test"), "persist:custom-test");
  assert.equal(seen.size, 2);
  for (const s of seen.values()) {
    assert.equal(s.downloads, 1);
    assert.equal(s.check(null, "media"), false);
  }
  assert.throws(() => r.sync([{ ...custom[0], id: "deepseek" }]));
  r.sync([]);
  assert.throws(() => r.partition("custom-test"));
});
test("2 or 3 unique sites only, bounded widths and valid queue statuses", async () => {
  for (const count of [1, 2, 3, 4]) {
    const c = sample();
    c.sites = Array.from({ length: count }, (_, i) => ({
      id: i === 0 ? "deepseek" : "s" + i,
      name: "站点",
      width: 1,
      status: "pending",
    }));
    const store = await fixture();
    if (count === 2 || count === 3) await save(store, c);
    else await assert.rejects(save(store, c));
  }
  const c = sample();
  c.sites[1] = c.sites[0];
  await assert.rejects(save(await fixture(), c));
});
test("Markdown contains question, answers, original prompt, source, time and all manual marks, excludes trash", () => {
  const c = sample();
  c.answers.push(answer(), {
    ...answer(),
    id: "a2",
    text: "不导出已删除",
    deleted: true,
  });
  c.common = "共同点";
  c.conflicts = "分歧";
  c.notes = "备注";
  const md = model.markdown(c);
  for (const value of [
    "比较两种方案",
    "方案 A",
    "https://example.com/chat",
    c.answers[0].capturedAt,
    "原问题",
    "推荐答案",
    "共同点",
    "分歧",
    "备注",
  ])
    assert.ok(md.includes(value));
  assert.ok(!md.includes("不导出已删除"));
});
test("all comparison IPC and generic sensitive IPC require exact local main frame", async () => {
  const handlers = new Map(),
    indexFile = path.resolve("index.html"),
    frame = { url: pathToFileURL(indexFile).href },
    wc = { mainFrame: frame },
    win = { webContents: wc, isDestroyed: () => false };
  const ipcMain = {
    handle: (n, f) => handlers.set(n, f),
    on: (n, f) => handlers.set(n, f),
  };
  registerComparisonIpc({
    ipcMain,
    getWindow: () => win,
    indexFile,
    store: await fixture(),
    dialog: {},
  });
  for (const fn of handlers.values())
    for (const e of [
      { sender: {}, senderFrame: frame },
      { sender: wc, senderFrame: { url: frame.url } },
    ])
      assert.equal((await fn(e)).code, "FORBIDDEN");
  assert.equal(
    (await handlers.get("comparison:read")({ sender: wc, senderFrame: frame }))
      .ok,
    true,
  );
  let count = 0;
  guardedIpc(ipcMain, {
    getWindow: () => win,
    getFloat: () => null,
    indexFile,
    floatFile: "floatball.html",
    validArgs: (_, args) => typeof args[0] === "boolean",
  }).on("set-float-ball", () => count++);
  handlers.get("set-float-ball")({ sender: wc, senderFrame: frame }, "true");
  handlers.get("set-float-ball")({ sender: {}, senderFrame: frame }, true);
  handlers.get("set-float-ball")({ sender: wc, senderFrame: frame }, true);
  assert.equal(count, 1);
});
test("write failure leaves committed revision unchanged, retry succeeds", async () => {
  const store = await fixture();
  const c = await save(store, sample()),
    original = await fs.readFile(store.file, "utf8"),
    io = store.io;
  store.io = {
    ...io,
    rename: async (from, to) => {
      if (to === store.file) throw new Error("simulated disk failure");
      return io.rename(from, to);
    },
  };
  c.prompt = "新的草稿";
  await assert.rejects(save(store, c));
  assert.equal(await fs.readFile(store.file, "utf8"), original);
  store.io = io;
  await save(store, c);
  assert.equal(
    (await new ComparisonStore(store.directory).read()).comparisons[0].prompt,
    "新的草稿",
  );
});

test("running stores detect externally damaged files and newer revisions", async () => {
  const store = await fixture();
  const c = await save(store, sample());
  await fs.writeFile(store.file, "damaged while running");
  await assert.rejects(store.change({ revision: 1, comparison: c }));
  assert.equal(await fs.readFile(store.file, "utf8"), "damaged while running");
  const other = await fixture();
  const original = await save(other, sample()),
    second = new ComparisonStore(other.directory);
  let revised = structuredClone(original);
  revised.title = "另一个调用方";
  await save(second, revised);
  await assert.rejects(other.change({ revision: 1, comparison: original }), {
    code: "CONFLICT",
  });
  assert.equal((await other.read()).comparisons[0].title, "另一个调用方");
});
test("20MB write and read limits preserve primary and backup", async () => {
  const store = await fixture();
  const c = await save(store, sample()),
    before = await fs.readFile(store.file, "utf8"),
    backup = await fs.readFile(store.backup, "utf8");
  c.answers = Array.from({ length: 215 }, (_, i) => ({
    ...answer(),
    id: "a" + i,
    text: "x".repeat(100000),
  }));
  await assert.rejects(save(store, c), { code: "LIMIT" });
  assert.equal(await fs.readFile(store.file, "utf8"), before);
  assert.equal(await fs.readFile(store.backup, "utf8"), backup);
  await fs.writeFile(store.file, " ".repeat(20 * 1024 * 1024 + 1));
  await assert.rejects(new ComparisonStore(store.directory).read(), {
    code: "LIMIT",
  });
  assert.equal((await fs.stat(store.file)).size, 20 * 1024 * 1024 + 1);
});
test("comparison selection capture freezes prompt and source at menu creation", () => {
  const input = {
    text: "选中段落",
    title: "页面 A",
    url: "https://example.com/a",
    siteId: "deepseek",
    siteName: "DeepSeek",
    prompt: "原问题",
    comparisonId: "comparison-a",
  };
  let snapshot;
  const menu = comparisonMenuItem(input, (s) => (snapshot = s));
  input.prompt = "下一轮问题";
  input.url = "https://example.com/b";
  menu.click();
  assert.equal(snapshot.prompt, "原问题");
  assert.equal(snapshot.source.url, "https://example.com/a");
  assert.equal(snapshot.comparisonId, "comparison-a");
});
test("recovery revision is monotonic and rejects edits made before recovery", async () => {
  const store = await fixture();
  let c = await save(store, sample());
  c.title = "二";
  c = await save(store, c);
  const revision = (await store.read()).revision;
  const recovered = await store.recover();
  assert.ok(recovered.revision > revision);
  await assert.rejects(store.change({ revision, comparison: c }), {
    code: "CONFLICT",
  });
});
test("webview attachment guard rejects unknown partitions and unsafe protocols and replaces guest preload", () => {
  const { installNavigationGuard } = require("../main/ipc-security");
  const handlers = new Map();
  const win = {
      webContents: {
        on: (n, fn) => handlers.set(n, fn),
        setWindowOpenHandler: () => {},
      },
    },
    registry = {
      sites: new Map([["deepseek", {}]]),
      partition: (id) => "persist:" + id,
    };
  installNavigationGuard(win, registry, "file:///app/newtab.html");
  for (const params of [
    { src: "file:///private", partition: "persist:deepseek" },
    { src: "javascript:alert(1)", partition: "persist:deepseek" },
    { src: "https://example.com", partition: "persist:unknown" },
  ]) {
    let prevented = false;
    handlers.get("will-attach-webview")(
      { preventDefault: () => (prevented = true) },
      {},
      params,
    );
    assert.equal(prevented, true);
  }
  const prefs = { preload: "malicious.js", nodeIntegration: true };
  handlers.get("will-attach-webview")(
    { preventDefault: () => assert.fail("safe guest") },
    prefs,
    { src: "https://example.com", partition: "persist:deepseek" },
  );
  assert.equal(prefs.preload, require('path').resolve(__dirname, '../main/guest-activity-preload.js'));
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
});
