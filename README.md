# AI Chat Hub

多平台 AI 助手聚合客户端，一个窗口管理所有 AI 对话。

## 支持的平台

- **DeepSeek** — chat.deepseek.com
- **腾讯元宝** — yuanbao.tencent.com
- **豆包** — www.doubao.com
- **Kimi** — www.kimi.com
- **MiniMax** — agent.minimaxi.com
- **千问** — www.tongyi.com
- **智谱清言** — chatglm.cn
- **Grok** — grok.com
- **ChatGPT** — chatgpt.com

## 功能

- 多 webview 独立会话，数据隔离
- 顶部标签栏：首位固定显示当前 AI 站点标签，其后为弹出的附属页面（如回复中的链接），切换站点时标签组自动切换；可新建 / 关闭 / 右键刷新 / 复制链接
- 默认新建页：本地简洁新标签页，logo 居中 + 百度搜索框（后续可切换其他搜索引擎）
- 侧栏红点关闭：加载中的站点显示彩色指示点，悬停放大为关闭按钮
- 可编辑地址栏：输入网址或搜索关键词，回车跳转到任意网页
- 侧栏站点一键切换，快捷键 `Ctrl+1~9`
- “AI 站点”右侧可添加自定义站点；设置 → AI站点可新增、隐藏或删除自定义站点
- 侧栏标签拖拽排序，顺序自动保存
- 内存策略（设置 → 功能 → 内存优化，Beta）：所有已打开的 AI 站点保持加载、切换即时恢复；隐藏页面空闲 15 分钟自动释放（标签保留、点击重新加载），附属页面全局最多保留 8 个，按 LRU 自动释放；可在设置中关闭
- 关闭窗口最小化到系统托盘常驻
- 托盘右键菜单快捷切换站点
- 桌面悬浮球，窗口隐藏时点击唤出
- 页面内右键菜单（返回 / 前进 / 刷新 / 复制 / 粘贴 / 全选）
- 分类导航设置面板：外观 / AI站点 / 功能 / 悬浮伙伴 / 下载 / 权限 / 关于
- 亮色 / 深色 / 跟随系统主题切换
- 悬浮球开关、快捷键开关
- 无边框窗口，自定义标题栏
- 前进 / 后退 / 刷新导航

## 开发

### 1.5.2：完整待机动作

活力模式自己玩时轮换轨道、爆散、彗星、播放、思考、跳动感叹号、感叹号、提醒、眨眼、惊讶、蛋形、六边形、小憩与自定义变形。保留 bloub 的彩色轨道前后遮挡、粒子和尾迹，动作按完整时长播放，结束后恢复所选外形、表情与朝向。悬停、点击和拖动会打断动作。设置 → 悬浮伙伴可选择动作立即预览；低精力模式只偶尔变形，静止模式不播放待机动作。

### 1.5.1：互动节奏与流畅拖动

拖动由主进程高频采样系统鼠标并直接更新位置，保持抓取点偏移；表情动画采用平滑帧刷新，三种模式均保持流畅的主动互动。设置新增 **表情朝向 → 面向屏幕中心 / 正面居中（对称）**；前者根据所在屏幕和悬浮球位置自动调整，适合右下角放置。

活力模式初次待机约 5–11 秒、之后约 9–15 秒会自己变形玩一小段；低精力模式约 60–100 秒才活动一次，平时保持常态表情，自发变形也保留常态表情；静止模式只在单击和右击时变表情。主动互动会暂停自己玩，结束后回到选定外形与常态表情。可以关闭“待机时自己玩”。

### 1.5.0：悬浮伙伴

悬浮球采用 [bloub](https://github.com/jeremy-prt/bloub) 的离线 SVG 形变与表情引擎。鼠标悬停、移动、单击、右击和拖动时会有眼神及表情回应。单击先回应再打开主窗口；右击提供自定义页和模式切换；拖动松手后继续自动贴边。

**设置 → 悬浮伙伴** 提供实时互动预览、8 种外形、16 种常态与互动表情、12 种预设颜色、自选颜色、跟随主题色、48–84 px 大小、35%–100% 不透明度、眼神幅度、鼠标跟随、互动表情与待机活动开关。单击、右击、悬停、拖动可分别选择表情，也可随机搭配或恢复默认外观，位置单独恢复。预览点击只体验表情。配置自动保存到 `userData/config.json`，保存失败会显示原因并保留重试入口。

- **活力模式**：自然眨眼、跟随鼠标，并较频繁地主动变形、自己玩。
- **低精力模式**：休息时保持常态表情、停止动画，减少主动活动频率；互动时保持流畅。
- **静止模式**：休息时固定外形与表情，只有单击和右击触发表情变化；保留打开主窗口、右击菜单、拖动贴边。系统减少动态效果设置会暂停动画。

设置预览只在该页可见时运行，悬浮球全屏淡出时也暂停动画。实现保留原项目 MIT 许可与来源修订，见 `renderer/bloub-src/LICENSE` 与 `PROVENANCE.md`；无需 Vue 或在线资源。

```powershell
npm run build:floatball
node --test tests/*.test.cjs
.\node_modules\electron\dist\electron.exe scripts/check-floatball-ui.cjs
```

界面检查使用独立测试配置及实际窗口 IPC，截图与结果位于 `dist/floatball-ui-check`。

### 1.4.1：任务收藏与快速复制

侧栏底部点击 **任务** 打开工作台：

1. 新建任务，填写名称和目标，点击“保存”。
2. 回到任一 AI 网页，选中有用的回答，右键“保存选中文字到任务”。文字、平台、页面标题和来源网址自动带入；有当前任务时直接保存，没有时选择或新建任务。
3. 材料可以“复制正文”或“打开来源”；“复制任务资料”会汇总任务名称、目标、未删除材料和来源，便于粘贴到另一个 AI 中继续提问。也支持手动添加自己的笔记。
4. 任务可以归档或移入回收站；删除的材料也可通过“已删除材料”恢复。搜索会匹配任务和材料正文。

本版为首个增量，完成选区采集和资料复制，不包含完整会话抓取、自动发送、AI 自动摘要、云同步或导入导出。编辑使用明确的保存按钮（也支持 Ctrl+S）；关闭工作台保留当前草稿，退出前会提醒未保存内容。尚未保存的草稿和待归类选区不保证在程序异常退出后恢复。打开来源会在应用内打开标签页，并沿用来源站点的登录会话；旧材料通过平台名或域名识别来源站点。

网页顶部保留标签页，悬停顶部 AI 网站图标会向下展开后退、前进、刷新胶囊；右侧圆形网址按钮悬停向左展开，点击可输入，Ctrl+L 也可直接输入网址或搜索。胶囊覆盖在网页上，不改变网页尺寸。下载入口位于侧栏底部。侧栏底部的对比、任务、设置、下载四个入口共用同一套图标规格（24 网格、1.6 描边、圆头圆角、18px 显示尺寸）与对齐方式：展开时 2×2 等宽网格，收起时 34×34 单列居中、只留图标；样式集中定义在 `renderer/sidebar-actions.css`。设置 → 外观 → 毛玻璃透明度可实时调整面板背景（0%—70%），自动保存，支持恢复默认。

Beta 的毛玻璃设置面板、规整的主题预览和低饱和主题色选项已合入正式版；保留原 logo，移除原来只改变预览、未连接实际悬浮窗口的光晕和高光控件。

任务存储在应用 `userData/task-workspace/workspace.json`，与网站登录信息分开。每次保存保留上一版 `workspace.backup.json`；读取失败时可从工作台恢复备份，当前原文件会另存保留。备份仅覆盖上一次保存前的状态，不等同于完整版本历史。任务正文不会上传给 AI 网站。

```powershell
Set-Location F:\mycode\aichathub
npm run test:tasks
# Electron 界面检查：独立测试数据，会短暂显示测试窗口
.\node_modules\electron\dist\electron.exe .\scripts\check-task-ui.cjs
# 本地 1.5.2 安装包，不发布
npm run build:local
```

安装包输出到 `dist/1.5.2`。若本机 npm 启动器不可用，测试可用 `node --test tests/task-store.test.cjs`；已安装依赖时可用 `node .\node_modules\electron-builder\cli.js --win --publish never '--config.directories.output=dist/1.5.2' '--config.electronDist=node_modules/electron/dist'` 打包。

### 常用命令

```bash
npm install
npm start        # 启动应用
npm run icon     # 生成图标文件
npm run build    # 打包安装包
```

## 1.4 Beta 界面预览

主窗口、设置、新标签页和悬浮入口采用中性色毛玻璃、统一圆角及间距；支持浅色、深色与减少动态效果。悬浮入口颜色跟随主题色，移除了原来仅改变预览、未连接实际悬浮窗口的光晕及高光控件。

```powershell
Set-Location F:\mycode\aichathub
npm start
# 生成本地安装包，不发布到 GitHub
npm run build:local
# 独立配置、阻止外网的 Electron 界面验证（会短暂显示预览窗口）
.\node_modules\electron\dist\electron.exe .\scripts\check-beta-ui.cjs
```

本地安装包输出到 `dist/1.5.2`；界面检查结果和截图输出到 `dist/beta-ui-check`。`npm run build:release` 会发布版本，不用于本地 beta 验证。

若本机全局 npm 启动器报 `npm-cli.js` 缺失，已安装依赖时可直接运行 `node .\node_modules\electron-builder\cli.js --win --publish never '--config.directories.output=dist/1.5.2'` 打包，或 `.\node_modules\electron\dist\electron.exe .` 启动。

## 修改图标

1. 替换 `assets/logo.svg` 为你的 SVG 文件
2. 运行 `npm run build`（自动生成图标并打包）

## 技术栈

- Electron
- electron-builder
- sharp / png-to-ico

## 许可

ISC

### 跨 AI 对比工作台

侧栏底部点击 **对比**。默认使用当前可用站点中的前两个，点击“选择 AI”可选 2～3 个不同的内置或自定义站点，并按第一、第二、第三栏调整顺序。宽窗口并排显示；栏宽不足或单栏放大时，未聚焦的栏折叠成可点击的标题条，点一下就切换聚焦栏。拖动栏边缘可以调整宽度，聚焦栏边缘后也可用左右方向键调整。每栏提供加载状态、刷新、放大/还原和关闭；只有两栏时关闭按钮打开替换站点选择器。

对比页只做分屏浏览本身：顶部仅保留对比标题、保存状态、“选择 AI”和“关闭”，没有标题输入框、公共提示词、已保存对比/回收站、草稿与任务材料、站点标签行或结果整理区。选中 AI 回答的有用文字后右键“保存到当前对比”仍会采集选区（记录平台、站点 ID、页面标题、来源 URL、采集时间和采集时的问题），直接写入本机对比文件；同时保留原有“保存选中文字到任务”。需要编辑卡片、标记推荐/冲突、导出 Markdown 或追加任务材料时，请使用任务工作台与导出文件。

点击关闭返回普通浏览，原浏览页保持；仅为对比新建的临时 webview 会释放。

快捷键：`Ctrl+S` 保存；网页获得焦点时也可使用。`Esc` 关闭选择弹层或工作台，有未保存修改时先确认。`Ctrl+Enter` 不再被工作台接管，留给 AI 网站自己的发送行为。栏宽、每栏按钮和折叠标题条均可使用键盘操作，支持减少动态效果。

#### 本地数据与兼容性

- 对比文件：`userData/comparison-workspace/comparisons.json`；上一版备份为同目录 `comparisons.backup.json`。Windows 正常安装默认 `userData` 位于 `%APPDATA%/AIchatHub`（以 Electron 实际应用名称为准）。
- 对比 schemaVersion 为 1，包含 `revision`、`currentId` 和 `comparisons`；每份对比保存标题、问题、任务 ID、站点顺序/栏宽/处理状态、最近提示词、回答及人工整理字段。
- **任务 schemaVersion 仍为 1，不需要迁移或重写旧任务文件。** 对比独立存储，通过任务 ID 关联，追加结果使用现有 `create-material` 操作。旧任务、来源和回收站字段原样保留。
- 保存采用 600ms 防抖、串行队列、revision 检查、20MB 文件限制、临时文件写入/fsync/原子替换，每次提交先备份上一版。读取/写入时发现损坏或未知版本均停止，保留原文件。显式恢复会额外保留当前文件为 `.preserved-*`，恢复后的 revision 单调增加。
- 主窗口本地存储另保留待保存编辑日志，重启后尝试恢复异常退出前的草稿；版本不一致时保留草稿供复制，不自动覆盖文件。磁盘或本地存储耗尽时会提示，无法保证所有故障下最后一个输入字符都能恢复。
- 自定义站点沿用原 `persist:<siteId>` 分区，由主进程统一注册下载、权限和托盘生命周期；配置仍兼容原本的本地站点列表，并镜像到 `userData/config.json`。会话监听器按 partition 只安装一次。配置写入也保留 `.backup`。

#### 隐私与安全边界

对比数据默认只在本机，不新增云服务、不要求 API Key、不上传提示词或回答到统计服务。只有用户自己粘贴并发送时，内容才进入对应 AI 网站。工作台复用既有 session，不读取、复制或合并 Cookie、令牌或浏览器凭据；导出只包含选区内容及对比字段。系统剪贴板和用户选择的导出文件由用户自行管理。

主窗口敏感 IPC 限定本地 `index.html` 主 frame，并校验参数；悬浮球仅允许自身本地主 frame 的专用窗口控制。普通导航及来源只接受 HTTP/HTTPS（不含 URL 用户名密码）；内置新标签页是明确允许的本地页面。webview 强制关闭 Node、移除 preload，开启隔离和沙箱。回答、标题、下载文件名与图标通过文本/属性 API 呈现，不执行采集到的 HTML。

#### 启动与验证命令

```powershell
Set-Location F:\mycode\aichathub
# 已安装依赖即可预览当前代码，不需要安装 beta 或生成安装包
npm start

# npm 启动器损坏时的直接备用命令
.\node_modules\electron\dist\electron.exe .

# 所有单元测试（test:tasks 实际覆盖 tests 下全部测试）
npm run test:tasks
# 直接 Node 备用命令
node --test tests/task-store.test.cjs tests/source-route.test.cjs tests/comparison.test.cjs
node scripts/check-syntax.cjs

# 使用临时 userData/sessionData，阻断外网，仅允许本机测试网页
.\node_modules\electron\dist\electron.exe .\scripts\check-comparison-ui.cjs
.\node_modules\electron\dist\electron.exe .\scripts\check-task-ui.cjs
# 侧栏图标规格、收起/展开对齐与对比页减法断言
.\node_modules\electron\dist\electron.exe .\scripts\check-icon-ui.cjs
git diff --check
```

对比界面验证会实际启动应用主进程并暂时显示测试窗口，覆盖原 webview 复用、顶部无输入控件的减法断言、原生选区菜单与采集落盘、自定义站点下载/权限/托盘、三种窗口尺寸（1400 双栏/三栏、1024 单栏、480 窄窗口）、栏宽拖动与键盘调整、单栏放大、网页焦点 `Ctrl+S`、重启与异常草稿恢复、损坏文件的界面保护及显式恢复。截图与机器可读结果位于 `dist/comparison-ui-check`；原任务回归结果位于 `dist/task-ui-check`。不接触正式登录和任务数据，不验证外部 AI 服务当时的可用性。

图标与对齐验证只加载 `index.html`，断言侧栏底部四个入口在展开态为 2×2 等宽网格、收起态为 34×34 单列居中，四个图标与侧栏标题栏按钮、分区按钮、站点图标共用同一水平中线和同一套 24 网格 / 1.6 描边 / 18px 规格，并断言对比页顶部没有输入控件、窄窗口下未聚焦栏折叠为可点击标题条。截图与结果位于 `dist/icon-ui-check`。若在受限容器里报 `ERR_FAILED` 打不开 `index.html`，在该命令后追加 `--no-sandbox`。
