(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.resolveSourceRoute = factory();
})(typeof window === 'undefined' ? globalThis : window, () => function resolveSourceRoute(source, sites) {
  if (!source || typeof source.url !== 'string' || source.url.length > 8192) throw new Error('来源网址无效。');
  const url = new URL(source.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('来源仅支持 HTTP 或 HTTPS 网页。');
  let siteId = Object.hasOwn(sites, source.siteId || '') ? source.siteId : null;
  if (!siteId) siteId = Object.keys(sites).find(id => sites[id].name === source.siteName);
  if (!siteId) siteId = Object.keys(sites).find(id => {
    try { return new URL(sites[id].url).hostname === url.hostname; } catch (_) { return false; }
  });
  if (!siteId) throw new Error('找不到来源对应的 AI 站点，无法确定登录会话。请先恢复该站点后再打开来源。');
  return { siteId, url: url.href };
});
