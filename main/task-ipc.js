const { pathToFileURL } = require('node:url');
function trusted(event, window, indexFile) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pathToFileURL(indexFile).href;
}
function registerTaskIpc({ ipcMain, dialog, clipboard, shell, getWindow, store, indexFile }) {
  const register = (channel, action) => ipcMain.handle(channel, async (event, request) => {
    if (!trusted(event, getWindow(), indexFile)) return { ok: false, code: 'FORBIDDEN', error: '不允许访问任务数据。' };
    try { return { ok: true, value: await action(request) }; }
    catch (error) {
      const known = ['INVALID', 'VERSION', 'CORRUPT', 'LIMIT', 'CONFLICT'].includes(error.code);
      const fallback = channel === 'tasks:copy' ? '复制失败，内容可能过长或剪贴板暂不可用。' : channel === 'tasks:open-source' ? '无法打开来源网址。仅支持 HTTP 和 HTTPS 链接。' : '无法保存或读取任务文件，请检查磁盘空间及文件权限。编辑内容仍保留，可稍后重试。';
      return { ok: false, code: error.code || 'IO', error: known ? error.message : fallback };
    }
  });
  register('tasks:read', () => store.read());
  register('tasks:change', request => store.change(request));
  register('tasks:copy', value => {
    if (typeof value !== 'string' || value.length > 2000000) throw new Error('复制内容超出限制');
    clipboard.writeText(value);
    return true;
  });
  register('tasks:recover', async () => {
    const { response } = await dialog.showMessageBox(getWindow(), { type: 'warning', title: '恢复任务备份', message: '恢复到上一次保存前的本地备份？', detail: '当前文件会另存保留。最近一次修改可能不在备份中。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 });
    return response === 1 ? store.recover() : null;
  });
}
module.exports = { registerTaskIpc, trusted };
