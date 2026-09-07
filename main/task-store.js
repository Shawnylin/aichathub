const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_BYTES = 20 * 1024 * 1024;
const fail = (message, code = 'INVALID') => Object.assign(new Error(message), { code });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail('内容为空或超过长度限制。');
  return value;
}
function source(value) {
  if (value === undefined || value === null) return null;
  if (!plain(value)) throw fail('材料来源无效。');
  text(value.url, 8192); text(value.title, 500); text(value.siteName, 120);
  if (value.url && !['http:', 'https:'].includes(new URL(value.url).protocol)) throw fail('来源网址仅支持 HTTP 或 HTTPS。');
  if (typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) throw fail('采集日期无效。');
  const siteId = value.siteId === undefined ? '' : text(value.siteId, 64);
  if (siteId && !/^[a-z0-9_-]+$/i.test(siteId)) throw fail('来源站点标识无效。');
  return { url: value.url, title: value.title, siteName: value.siteName, siteId, capturedAt: value.capturedAt };
}
function validate(data) {
  if (!plain(data) || data.schemaVersion !== 1) throw fail('任务数据版本不受支持，原文件未修改。', 'VERSION');
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.tasks)) throw fail('任务数据损坏。', 'CORRUPT');
  const ids = new Set();
  function entity(item) {
    if (!plain(item) || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw fail('任务标识损坏。', 'CORRUPT');
    ids.add(item.id);
    for (const key of ['createdAt', 'updatedAt']) if (typeof item[key] !== 'string' || !Number.isFinite(Date.parse(item[key]))) throw fail('任务日期损坏。', 'CORRUPT');
    if (item.deletedAt !== null && (typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt)))) throw fail('回收站数据损坏。', 'CORRUPT');
  }
  for (const task of data.tasks) {
    entity(task); text(task.title, 120, true); text(task.goal, 10000);
    if (!['active', 'archived'].includes(task.status) || !Array.isArray(task.materials)) throw fail('任务状态损坏。', 'CORRUPT');
    for (const material of task.materials) { entity(material); text(material.title, 120, true); text(material.text, 100000, true); source(material.source); }
  }
  return data;
}

class TaskStore {
  constructor(directory, io = fs) {
    this.directory = directory;
    this.file = path.join(directory, 'workspace.json');
    this.backup = path.join(directory, 'workspace.backup.json');
    this.io = io;
    this.queue = Promise.resolve();
  }
  serial(action) {
    const pending = this.queue.then(action);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async readFile(file) {
    const stat = await this.io.stat(file);
    if (stat.size > MAX_BYTES) throw fail('任务文件超过 20MB，已停止写入。', 'LIMIT');
    let data;
    try { data = JSON.parse(await this.io.readFile(file, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) throw fail('任务数据无法解析，原文件未修改。', 'CORRUPT'); throw error; }
    return validate(data);
  }
  async load() {
    if (this.data) return this.data;
    try { this.data = await this.readFile(this.file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A missing primary beside an existing backup is a recovery case, not a new workspace.
      try { await this.io.access(this.backup); }
      catch (missing) {
        if (missing.code !== 'ENOENT') throw missing;
        this.data = { schemaVersion: 1, revision: 0, tasks: [] };
        return this.data;
      }
      throw fail('主任务文件缺失，可以从本地备份恢复。', 'CORRUPT');
    }
    return this.data;
  }
  read() { return this.serial(async () => structuredClone(await this.load())); }
  async atomic(file, data) {
    const temp = file + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await this.io.open(temp, 'wx');
      await handle.writeFile(data, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await this.io.rename(temp, file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await this.io.unlink(temp).catch(() => {});
    }
  }
  change(request) {
    return this.serial(async () => {
      const current = await this.load();
      if (!plain(request) || request.revision !== current.revision) throw fail('任务已发生变化，请先复制未保存内容，再重新载入。', 'CONFLICT');
      const next = structuredClone(current);
      const now = new Date().toISOString();
      const base = () => ({ id: randomUUID(), createdAt: now, updatedAt: now, deletedAt: null });
      let selectedId = request.taskId;
      if (request.type === 'create-task' || (request.type === 'capture-material' && !request.taskId)) {
        const task = { ...base(), title: text(request.type === 'capture-material' ? request.newTaskTitle : request.title, 120, true).trim(), goal: text(request.goal || '', 10000), status: 'active', materials: [] };
        if (request.type === 'capture-material') task.materials.push({ ...base(), title: text(request.title, 120, true), text: text(request.text, 100000, true), source: source(request.source) });
        next.tasks.unshift(task); selectedId = task.id;
      } else {
        const task = next.tasks.find(item => item.id === request.taskId);
        if (!task) throw fail('任务不存在。');
        if (request.type === 'restore-task') task.deletedAt = null;
        else {
          if (task.deletedAt) throw fail('请先从回收站恢复任务。');
          switch (request.type) {
            case 'update-task': task.title = text(request.title, 120, true).trim(); task.goal = text(request.goal, 10000); break;
            case 'archive-task': task.status = task.status === 'active' ? 'archived' : 'active'; break;
            case 'delete-task': task.deletedAt = now; break;
            case 'create-material':
            case 'capture-material':
              task.materials.unshift({ ...base(), title: text(request.title, 120, true).trim(), text: text(request.text, 100000, true), source: source(request.source) }); break;
            case 'update-material':
            case 'delete-material':
            case 'restore-material': {
              const material = task.materials.find(item => item.id === request.materialId);
              if (!material) throw fail('材料不存在。');
              if (request.type === 'restore-material') material.deletedAt = null;
              else if (material.deletedAt) throw fail('请先恢复材料。');
              else if (request.type === 'delete-material') material.deletedAt = now;
              else { material.title = text(request.title, 120, true).trim(); material.text = text(request.text, 100000, true); }
              material.updatedAt = now;
              break;
            }
            default: throw fail('不支持的任务操作。');
          }
        }
        task.updatedAt = now;
      }
      next.revision++;
      validate(next);
      const encoded = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(encoded) > MAX_BYTES) throw fail('任务数据已达 20MB 上限，请先整理现有材料。', 'LIMIT');
      await this.io.mkdir(this.directory, { recursive: true });
      await this.atomic(this.backup, JSON.stringify(current, null, 2));
      await this.atomic(this.file, encoded);
      this.data = next; // Publish state only after the primary file is committed.
      return { data: structuredClone(next), selectedId };
    });
  }
  recover() {
    return this.serial(async () => {
      const backup = await this.readFile(this.backup);
      const preserved = this.file + '.preserved-' + randomUUID();
      try { await this.io.copyFile(this.file, preserved); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      backup.revision++;
      await this.atomic(this.file, JSON.stringify(backup, null, 2));
      this.data = backup;
      return structuredClone(backup);
    });
  }
}
module.exports = { TaskStore, validate };
