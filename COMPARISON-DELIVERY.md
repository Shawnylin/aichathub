# 跨 AI 对比工作台交付报告

## 实现范围

已实现本地可启动的端到端流程：侧栏“对比”入口 → 选择 2～3 个内置/自定义 AI → 并排分屏浏览 → 原生右键选区采集。

包含：站点排列与栏宽保存、原 webview 与登录会话复用、窄窗口与单栏放大时把未聚焦栏折叠为可点击标题条、鼠标与键盘调整栏宽、单栏放大、选区采集写入本机对比文件、自动保存与异常草稿恢复。关闭时恢复原浏览页并释放对比临时创建的 webview。

### 界面减法（本次调整）

对比页按奥卡姆原则只保留分屏对比本身：顶部只剩对比标题、保存状态、“选择 AI”和“关闭”一行，已移除对比标题输入、已保存对比/回收站、公共提示词、草稿/最近提示词/任务材料、站点标签行和结果整理区（回答卡片编辑、标记、导出 Markdown、追加任务材料）。相应地，工作台不再接管 `Ctrl+Enter`（交回 AI 网站自身的发送行为），只保留 `Ctrl+S` 保存与 `Esc` 关闭。窄窗口下原来的站点标签行由“折叠标题条”承担，点一下即可切换聚焦栏。

侧栏底部的对比、任务、设置、下载四个入口统一为同一套图标规格（24 网格、1.6 描边、圆头圆角、18px 显示尺寸），「对比」由文字符号 `⇄` 改为 SVG 双向箭头；展开时 2×2 等宽网格、收起时 34×34 单列居中只留图标，样式集中到 `renderer/sidebar-actions.css`，不再由 index.html 与 comparison-workbench.css 各自定义冲突规则。全程序 22 处线性图标统一为 `stroke-width="1.6"`。

## 修改文件

| 文件 | 职责 |
| --- | --- |
| `main.js` | 主进程接入、敏感 IPC 参数与来源检查、站点注册、右键菜单、配置备份与导航安全 |
| `preload.js` | 最小化对比及站点注册桥接接口、网页焦点快捷键转发 |
| `index.html` | 复用现有 webview、站点配置同步、普通导航限制、标题/favicon/下载名称安全呈现 |
| `main/comparison-store.js` | 对比 schema 校验、revision、20MB 上限与原子备份存储 |
| `main/comparison-ipc.js` | 对比读写、选区快照、显式备份恢复与本地 Markdown 导出 |
| `main/site-registry.js` | 内置与自定义站点统一 session、权限和下载生命周期 |
| `main/ipc-security.js` | IPC 主 frame 身份检查、webview 安全配置/导航限制、工作台快捷键转发（只接管 `Ctrl+S` 与 `Esc`） |
| `main/task-store.js` | 复用原子存储基础逻辑，增加运行时磁盘状态检查和单调恢复 revision |
| `main/task-ipc.js` | 有界剪贴板容量与对比文件容量对齐 |
| `renderer/comparison-model.js` | 默认对比模型和 Markdown 格式 |
| `renderer/comparison-workbench.js` | 独立工作台交互及持久化队列；顶部精简为标题/状态/选择 AI/关闭，窄窗口用折叠标题条切换 |
| `renderer/comparison-workbench.css` | 主题、响应式布局、栏宽交互、折叠标题条、无障碍焦点及 reduced-motion |
| `renderer/sidebar-actions.css` | 侧栏底部四个入口（对比/任务/设置/下载）的统一图标规格与收起/展开对齐，该区域唯一样式来源 |
| `renderer/task-panel.js` | 任务入口图标改用统一的 `svg.sf-icon` + `span.sf-label` 结构 |
| `renderer/source-route.js` | 拒绝含 URL 用户名密码的来源，保留原站点会话路由 |
| `tests/comparison.test.cjs` | 新增 15 项存储、安全、站点与导出单元测试 |
| `scripts/check-comparison-ui.cjs` | 实际启动主进程的隔离 Electron 工作流验证 |
| `scripts/check-icon-ui.cjs` | 侧栏图标规格、收起/展开对齐与对比页减法的隔离渲染层验证 |
| `scripts/check-syntax.cjs` | Node --check 与 HTML 内联脚本语法检查 |
| `scripts/check-task-ui.cjs` | 保留原断言；失败时增加焦点/按钮状态诊断 |
| `README.md` | 操作流程、数据位置、隐私、真实开发命令；修正不存在的 build:beta 命令 |

新增业务拆分为主进程存储/IPC/站点注册/安全和渲染层模型/交互/CSS，避免继续扩大原 HTML 中的业务实现。未改依赖清单，代码格式化工具仅下载到忽略的 dist 目录。

## 数据结构与兼容

- 对比文件：`userData/comparison-workspace/comparisons.json`，`schemaVersion: 1`，顶层为 `revision`、`currentId`、`comparisons`。
- 每份对比保存标题、公共提示词、所属任务 ID、站点顺序/当前 URL/栏宽/处理状态、历史提示词、回答和人工整理字段；每条回答另外保留采集时的问题与原始页面标题。
- 任务仍使用 schemaVersion 1，**不需要迁移或重写旧任务文件**。关联只保存任务 ID，最终结果调用现有新增材料操作，不覆盖已有任务或材料。
- 共享串行保存、20MB 文件限制、临时文件 fsync/原子替换和每次提交前备份。损坏/未知版本拒绝读取与覆盖；显式恢复将原文件保留为 `.preserved-*`，revision 单调增加。
- 未提交编辑日志保存在主窗口本地存储，150ms 防抖；主文件保存 600ms 防抖。日志与文件 revision 不同会保留草稿供复制，不自动覆盖文件。

## 安全与隐私

对比不新增云服务，不需要 API Key，不上传任务/提示词/回答到统计服务。仅复用 `persist:<siteId>` 会话，不读取或混合用户 Cookie、登录令牌、缓存和凭据。导出只取对比业务字段；用户选择的正文与来源地址会进入导出文件。

敏感主窗口 IPC 仅接受本地 index.html 主 frame，悬浮球仅开放其本地主 frame 的专用控制。普通导航和来源限制为不含用户名密码的 HTTP/HTTPS；明确允许内置新标签页。webview 强制 Node 关闭、移除 preload、开启隔离和沙箱。远程文字不作为 HTML 执行。

## 验证结果

- `node --test tests/*.test.cjs`：**27 通过，0 失败**，包含原有 12 项和新增 15 项。
- `node scripts/check-syntax.cjs`：**26 个 JavaScript 文件及 3 个 HTML 的内联脚本通过**；JS 文件实际调用 `node --check`。
- `git diff --check`：通过，无空白错误。
- README 中所有 `npm run` 命令已与 package.json 的实际脚本核对。
- 对比 Electron 检查：使用真实 main.js、独立临时 userData/sessionData，阻断外网，只允许本机测试服务器。**10/10 通过，控制台零错误**。覆盖双栏/三栏、1400×900、1024×768 单栏、480×640、浅深主题、顶部无输入控件的减法断言、原生选区菜单与采集落盘、鼠标拖动和键盘调宽、单栏放大、原 webview 身份保留、自定义站点 session/下载/权限/托盘、重复选择拒绝、网页焦点 `Ctrl+S`、关闭释放和重启/异常草稿恢复、损坏文件的界面保护及显式恢复。
- 图标与对齐检查（`scripts/check-icon-ui.cjs`）：**5/5 通过，控制台零错误**。断言四个入口展开态 2×2 等宽、收起态 34×34 单列居中，四者图标均为 18px / 1.6 描边且几何居中，并与标题栏按钮、分区按钮、站点图标共用同一水平中线；断言对比页顶部无任何输入控件、顶部按钮只剩“选择 AI”和“关闭”、窄窗口把未聚焦栏折叠为可点击标题条并可用键盘切换。
- 原任务 Electron 检查：任务/材料增改、回收站、草稿、搜索、窄窗口、重启、写入失败重试、原生选区采集、复制、原站点来源打开、设置和导航回归通过。

机器可读结果与截图：`dist/comparison-ui-check/result.json`、`dist/icon-ui-check/result.json`、`dist/task-ui-check/result.json` 及各自目录的 PNG。

## 验证边界与保留事项

- UI 测试使用本机页面，未验证外部 AI 当时的可用性或真实账号登录过程。没有自动填充/自动发送，也没有依赖外部网站 DOM。
- 沙箱内 Electron GPU 子进程曾无法启动；界面检查改在沙箱外执行，但始终使用隔离配置并阻断外网。受限容器里若报 `ERR_FAILED` 打不开 `index.html`，需在命令后追加 `--no-sandbox`。
- 原生右键菜单捕获与原任务导航焦点各出现过一次偶发超时，复跑即通过，尚未复现为产品缺陷。
- 对比页已移除结果整理与导出入口，`model.markdown` 与 `comparison:export` IPC 仍保留但界面不再可达；如需恢复导出，应先确认是否与本次减法约定冲突。
- 单条任务材料保留原有 100,000 字符上限，大型结果应导出 Markdown。每次追加是独立快照，重复点击会再新增材料。
- 断电、磁盘耗尽或本地存储不可用时，不能保证最后一个输入字符恢复；错误不会静默创建空文件。
- 未发布 Release，未生成安装包，未接触正式用户登录、任务和配置数据。当前修改未提交 Git。

## PowerShell 预览

```powershell
Set-Location F:\mycode\aichathub
npm start
# npm 启动器不可用且依赖已安装时：
.\node_modules\electron\dist\electron.exe .
```

启动后点击侧栏底部“对比”。完整使用与测试命令见 README。
