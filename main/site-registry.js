const { safeURL } = require("./comparison-store");
class SiteRegistry {
  constructor({ session, setupDownload, permissions, builtins }) {
    this.session = session;
    this.setupDownload = setupDownload;
    this.permissions = permissions;
    this.builtins = builtins;
    this.sites = new Map();
    this.initialized = new Set();
    this.sync([]);
  }
  sync(custom) {
    if (!Array.isArray(custom) || custom.length > 100)
      throw new Error("最多支持 100 个自定义站点");
    const next = new Map(
      Object.entries(this.builtins).map(([id, s]) => [id, { id, ...s }]),
    );
    for (const s of custom) {
      if (
        !s ||
        typeof s.id !== "string" ||
        !/^custom-[a-z0-9-]{1,57}$/i.test(s.id) ||
        typeof s.name !== "string" ||
        !s.name.trim() ||
        s.name.length > 120 ||
        next.has(s.id)
      )
        throw new Error("自定义站点无效");
      next.set(s.id, { id: s.id, name: s.name, url: safeURL(s.url) });
    }
    this.sites = next;
    for (const [id] of next)
      if (!this.initialized.has(id)) {
        const ses = this.session.fromPartition(this.partition(id));
        const allowed = (permission) =>
          this.sites.has(id) &&
          (permission === "clipboard-sanitized-write" ||
            (["media", "geolocation", "notifications"].includes(permission) &&
              this.permissions()[id]?.[permission] === true));
        ses.setPermissionRequestHandler((_wc, permission, cb) =>
          cb(allowed(permission)),
        );
        ses.setPermissionCheckHandler((_wc, permission) => allowed(permission));
        this.setupDownload(ses);
        this.initialized.add(id);
      }
    return [...next.values()];
  }
  partition(id) {
    if (!this.sites.has(id)) throw new Error("站点未注册");
    return "persist:" + id;
  }
}
module.exports = { SiteRegistry };
