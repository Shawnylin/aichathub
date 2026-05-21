# AI Chat Hub

多平台 AI 助手聚合客户端，一个窗口管理所有 AI 对话。

## 支持的平台

- **DeepSeek** — chat.deepseek.com
- **腾讯元宝** — yuanbao.tencent.com
- **豆包** — www.doubao.com
- **Kimi** — www.kimi.com
- **MiniMax** — agent.minimaxi.com
- **千问** — www.tongyi.com

## 功能

- 多 webview 独立会话，数据隔离
- 侧栏一键切换，快捷键 `Ctrl+1~6`
- 侧栏标签页拖拽排序，顺序自动保存
- 关闭窗口最小化到系统托盘常驻
- 托盘右键菜单快捷切换站点
- 桌面悬浮球，窗口隐藏时点击唤出
- 页面内右键菜单（返回 / 前进 / 刷新 / 复制 / 粘贴 / 全选）
- 统一设置面板，集中管理偏好
- 亮色 / 深色主题切换
- 字体方案切换（系统默认 / 阿里健康体）
- 悬浮球开关、快捷键开关
- 无边框窗口，自定义标题栏
- 前进 / 后退 / 刷新导航

## 开发

```bash
npm install
npm start        # 启动应用
npm run icon     # 生成图标文件
npm run build    # 打包安装包
```

## 修改图标

1. 替换 `assets/logo.svg` 为你的 SVG 文件
2. 运行 `npm run build`（自动生成图标并打包）

## 技术栈

- Electron
- electron-builder
- sharp / png-to-ico

## 许可

ISC
