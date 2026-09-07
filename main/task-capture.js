function sourceSnapshot(value) {
  if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 100000) return null;
  let url = '';
  try { const parsed = new URL(value.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch (_) {}
  if (url.length > 8192) return null;
  return {
    text: value.text,
    title: String(value.title || '网页摘录').slice(0, 120),
    source: { url, title: String(value.title || '网页摘录').slice(0, 500), siteName: String(value.siteName || '网页').slice(0, 120), siteId: typeof value.siteId === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value.siteId) ? value.siteId : '', capturedAt: new Date().toISOString() }
  };
}
function captureMenuItem(value, send) {
  const snapshot = sourceSnapshot(value);
  return { label: value?.text?.length > 100000 ? '选中内容过长，请缩小范围' : '保存选中文字到任务', enabled: !!snapshot, click: () => { if (snapshot) send(snapshot); } };
}
module.exports = { sourceSnapshot, captureMenuItem };
