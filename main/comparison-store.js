const { TaskStore } = require("./task-store");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const invalid = (message) =>
  Object.assign(new Error(message), { code: "INVALID" });
function str(v, n) {
  if (typeof v !== "string" || v.length > n)
    throw invalid("内容类型或长度无效");
}
function safeURL(v) {
  str(v, 8192);
  const u = new URL(v);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw invalid("只允许不含凭据的 HTTP/HTTPS 来源");
  return u.href;
}
function validateComparison(c) {
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw invalid("对比数据无效");
  str(c.id, 64);
  str(c.title, 120);
  str(c.prompt, 100000);
  str(c.taskId, 64);
  for (const k of ["common", "conflicts", "notes"]) str(c[k], 100000);
  if (
    !Array.isArray(c.sites) ||
    c.sites.length < 2 ||
    c.sites.length > 3 ||
    !c.sites.every((s) => s && typeof s === "object" && !Array.isArray(s)) ||
    new Set(c.sites.map((s) => s.id)).size !== c.sites.length
  )
    throw invalid("请选择 2～3 个不同站点");
  for (const s of c.sites) {
    if (s.url !== undefined) safeURL(s.url);
    if (!/^[a-z0-9_-]{1,64}$/i.test(s.id)) throw invalid("站点 ID 无效");
    str(s.name, 120);
    if (!["pending", "copied", "sent", "captured"].includes(s.status))
      throw invalid("站点状态无效");
    if (!Number.isFinite(s.width) || s.width < 0.2 || s.width > 5)
      throw invalid("栏宽无效");
  }
  if (!c.sites.some((s) => s.id === c.active)) throw invalid("当前站点无效");
  if (!Array.isArray(c.history) || c.history.length > 20)
    throw invalid("提示词历史无效");
  c.history.forEach((p) => str(p, 100000));
  if (!Array.isArray(c.answers) || c.answers.length > 2000)
    throw invalid("回答数量超限");
  const ids = new Set();
  for (const a of c.answers) {
    if (!a || typeof a !== "object" || Array.isArray(a))
      throw invalid("回答数据无效");
    if (a.pageTitle !== undefined) str(a.pageTitle, 500);
    str(a.id, 64);
    if (ids.has(a.id)) throw invalid("回答 ID 重复");
    ids.add(a.id);
    for (const [k, n] of Object.entries({
      title: 500,
      text: 100000,
      siteId: 64,
      siteName: 120,
      prompt: 100000,
      notes: 100000,
    }))
      str(a[k], n);
    safeURL(a.url);
    if (!Number.isFinite(Date.parse(a.capturedAt)))
      throw invalid("采集日期无效");
    for (const k of ["recommended", "common", "conflict", "deleted"])
      if (typeof a[k] !== "boolean") throw invalid("人工标记无效");
  }
  if (typeof c.deleted !== "boolean") throw invalid("回收站状态无效");
  return c;
}
function validate(data) {
  if (data?.schemaVersion !== 1)
    throw Object.assign(new Error("对比数据版本不受支持，原文件未修改"), {
      code: "VERSION",
    });
  if (
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !Array.isArray(data.comparisons)
  )
    throw invalid("对比文件损坏");
  const ids = new Set();
  for (const c of data.comparisons) {
    validateComparison(c);
    if (ids.has(c.id)) throw invalid("对比 ID 重复");
    ids.add(c.id);
  }
  str(data.currentId, 64);
  return data;
}
class ComparisonStore extends TaskStore {
  constructor(directory, io) {
    super(directory, io);
    this.file = path.join(directory, "comparisons.json");
    this.backup = path.join(directory, "comparisons.backup.json");
    this.validate = validate;
    this.initial = () => ({
      schemaVersion: 1,
      revision: 0,
      currentId: "",
      comparisons: [],
    });
  }
  change(request) {
    return this.serial(async () => {
      const current = await this.loadForChange();
      if (!request || request.revision !== current.revision)
        throw Object.assign(
          new Error("对比已发生变化。请复制未保存内容后重新载入。"),
          { code: "CONFLICT" },
        );
      const next = structuredClone(current),
        c = structuredClone(validateComparison(request.comparison));
      if (!c.id) c.id = randomUUID();
      const index = next.comparisons.findIndex((x) => x.id === c.id);
      if (index < 0) next.comparisons.unshift(c);
      else next.comparisons[index] = c;
      next.currentId = c.id;
      next.revision++;
      validate(next);
      const encoded = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(encoded) > 20 * 1024 * 1024)
        throw Object.assign(new Error("对比文件超过 20MB，原文件未修改"), {
          code: "LIMIT",
        });
      await this.io.mkdir(this.directory, { recursive: true });
      await this.atomic(this.backup, JSON.stringify(current, null, 2));
      await this.atomic(this.file, encoded);
      this.data = next;
      return structuredClone(next);
    });
  }
}
module.exports = { ComparisonStore, validateComparison, safeURL };
