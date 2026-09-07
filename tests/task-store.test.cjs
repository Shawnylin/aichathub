const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TaskStore } = require('../main/task-store');
const { registerTaskIpc } = require('../main/task-ipc');
const { pathToFileURL } = require('node:url');
const { captureMenuItem } = require('../main/task-capture');
const root = path.resolve(__dirname, '../dist/task-tests');
async function fixture(io) { await fs.mkdir(root, { recursive: true }); return new TaskStore(await fs.mkdtemp(path.join(root, 'case-')), io); }
async function change(store, type, args = {}) { return store.change({ revision: (await store.read()).revision, type, ...args }); }
async function task(store) { const result = await change(store, 'create-task', { title: '复盘', goal: '明确问题' }); return result.selectedId; }

test('tasks and Unicode materials survive restart, archive and soft deletion', async () => {
  const store = await fixture(), id = await task(store);
  const added = await change(store, 'create-material', { taskId: id, title: '分析', text: '<script>原样保留</script>\n中文 😀' });
  const materialId = added.data.tasks[0].materials[0].id;
  const restarted = new TaskStore(store.directory);
  assert.equal((await restarted.read()).tasks[0].materials[0].text, '<script>原样保留</script>\n中文 😀');
  await change(restarted, 'archive-task', { taskId: id });
  await change(restarted, 'delete-task', { taskId: id });
  await assert.rejects(change(restarted, 'create-material', { taskId: id, title: 'x', text: 'x' }));
  await change(restarted, 'restore-task', { taskId: id });
  assert.equal((await restarted.read()).tasks[0].status, 'archived');
  await change(restarted, 'update-material', { taskId: id, materialId, title: '修订', text: '新正文' });
  await change(restarted, 'delete-material', { taskId: id, materialId });
  assert.ok((await restarted.read()).tasks[0].materials[0].deletedAt);
  await change(restarted, 'restore-material', { taskId: id, materialId });
  assert.equal((await restarted.read()).tasks[0].materials[0].text, '新正文');
});

test('serialized changes reject stale revisions instead of overwriting', async () => {
  const store = await fixture();
  const request = { revision: 0, type: 'create-task', title: '任务', goal: '' };
  const results = await Promise.allSettled([store.change(request), store.change(request)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'CONFLICT');
  assert.equal((await store.read()).tasks.length, 1);
});

test('a failed primary replacement keeps disk and in-memory revision unchanged; retry works', async () => {
  let failing = false;
  const io = { ...fs, rename: async (from, to) => { if (failing && to.endsWith('workspace.json')) throw Object.assign(new Error('read only'), { code: 'EACCES' }); return fs.rename(from, to); } };
  const store = await fixture(io), id = await task(store);
  const original = await fs.readFile(store.file, 'utf8'); failing = true;
  await assert.rejects(change(store, 'update-task', { taskId: id, title: '未保存', goal: '' }));
  assert.equal(await fs.readFile(store.file, 'utf8'), original);
  assert.equal((await store.read()).tasks[0].title, '复盘');
  assert.equal((await fs.readdir(store.directory)).some(name => name.endsWith('.tmp')), false);
  failing = false; await change(store, 'update-task', { taskId: id, title: '已保存', goal: '' });
  assert.equal((await new TaskStore(store.directory).read()).tasks[0].title, '已保存');
});

test('corrupt primary is not overwritten; explicit recovery preserves original bytes', async () => {
  const store = await fixture(), id = await task(store);
  await change(store, 'update-task', { taskId: id, title: '第二次保存', goal: '' });
  await fs.writeFile(store.file, '{损坏');
  const restarted = new TaskStore(store.directory);
  await assert.rejects(restarted.read(), { code: 'CORRUPT' });
  assert.equal(await fs.readFile(store.file, 'utf8'), '{损坏');
  const restored = await restarted.recover(); assert.equal(restored.tasks[0].title, '复盘');
  const preserved = (await fs.readdir(store.directory)).find(name => name.includes('.preserved-'));
  assert.equal(await fs.readFile(path.join(store.directory, preserved), 'utf8'), '{损坏');
});

test('future data versions and malformed backups cannot be silently replaced', async () => {
  const store = await fixture(); await task(store);
  await fs.writeFile(store.file, JSON.stringify({ schemaVersion: 99 }));
  const restarted = new TaskStore(store.directory);
  await assert.rejects(restarted.read(), { code: 'VERSION' });
  await fs.writeFile(store.backup, 'bad');
  await assert.rejects(restarted.recover());
  assert.deepEqual(JSON.parse(await fs.readFile(store.file)), { schemaVersion: 99 });
});

test('missing primary with existing backup requires recovery', async () => {
  const store = await fixture(), id = await task(store);
  await change(store, 'update-task', { taskId: id, title: '第二版', goal: '' });
  await fs.unlink(store.file);
  const restarted = new TaskStore(store.directory);
  await assert.rejects(restarted.read(), { code: 'CORRUPT' });
  assert.equal((await restarted.recover()).tasks.length, 1);
});

test('validation rejects empty titles, oversized text and unknown operations without writes', async () => {
  const store = await fixture(), id = await task(store), revision = (await store.read()).revision;
  for (const request of [
    { type: 'create-task', title: '   ', goal: '' },
    { type: 'create-material', title: '超长', text: 'a'.repeat(100001) },
    { type: 'execute', path: 'C:/arbitrary' }
  ]) await assert.rejects(store.change({ ...request, revision, taskId: id }));
  assert.equal((await store.read()).revision, revision);
});

test('only the exact local main frame can access workspace IPC', async () => {
  const handlers = new Map(), store = await fixture();
  const indexFile = path.resolve(__dirname, '../index.html');
  const frame = { url: pathToFileURL(indexFile).href }, webContents = { mainFrame: frame };
  const win = { isDestroyed: () => false, webContents };
  registerTaskIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: {}, getWindow: () => win, store, indexFile });
  const read = handlers.get('tasks:read');
  assert.equal((await read({ sender: webContents, senderFrame: frame })).ok, true);
  assert.equal((await read({ sender: {}, senderFrame: frame })).code, 'FORBIDDEN');
  assert.equal((await read({ sender: webContents, senderFrame: { url: frame.url } })).code, 'FORBIDDEN');
  frame.url = 'https://example.com';
  assert.equal((await read({ sender: webContents, senderFrame: frame })).code, 'FORBIDDEN');
});

test('capture freezes selection and source; new task and material commit together', async () => {
  const input = { title: '页面 A', text: '选中的回答', url: 'https://example.com/chat/1', siteName: '测试 AI' };
  let snapshot;
  const item = captureMenuItem(input, value => { snapshot = value; });
  input.text = '页面 B 的内容'; input.url = 'https://example.com/chat/2'; item.click();
  assert.equal(snapshot.text, '选中的回答'); assert.equal(snapshot.source.url, 'https://example.com/chat/1');
  const store = await fixture();
  const result = await change(store, 'capture-material', { ...snapshot, newTaskTitle: '收藏任务' });
  assert.equal(result.data.tasks.length, 1);
  assert.equal(result.data.tasks[0].materials[0].source.url, 'https://example.com/chat/1');
  const id = result.selectedId, materialId = result.data.tasks[0].materials[0].id;
  await change(store, 'update-material', { taskId: id, materialId, title: '补充笔记', text: '编辑内容' });
  assert.equal((await store.read()).tasks[0].materials[0].source.siteName, '测试 AI');
  const revision = (await store.read()).revision;
  await assert.rejects(store.change({ revision, type: 'capture-material', newTaskTitle: '不应留下空任务', title: 'x', text: '' }));
  assert.equal((await store.read()).tasks.length, 1);
  assert.equal(captureMenuItem({ text: '' }, () => {}).enabled, false);
  assert.equal(captureMenuItem({ text: 'x'.repeat(100001) }, () => {}).enabled, false);
});
