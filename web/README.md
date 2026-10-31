# 前端开发指南

前端使用 React、TypeScript、Vite 和 Tailwind CSS，按功能组织，不额外引入状态库或路径别名。当前通过登录状态切换页面，没有 React Router；标签切换不改变 URL。

用户操作见[使用指南](../docs/使用指南.md)，架构边界见[技术方案](../docs/技术方案.md)，字段与限额见[终端协议](../docs/终端协议.md)。

## 阅读导航

[目录与职责](#1-目录与职责) · [状态与资源所有权](#2-状态与资源所有权) · [交互维护要点](#3-终端与交互维护要点) · [本地开发](#4-本地开发) · [检查与测试](#5-检查与测试) · [联调服务更新](#6-联调服务更新)

首次参与开发可直接从[本地开发](#4-本地开发)开始。修改终端或移动交互时，需特别保留以下行为：

- 切换标签、主题和字号不重建终端或连接。
- 连接、终端实例、事件监听和观察器在退出或卸载时清理。
- 浏览器模拟不能替代真实设备上的中文 IME、软键盘和系统复制粘贴验收。

## 1. 目录与职责

```text
src/
├── main.tsx
├── app/
│   ├── App.tsx                  # 主题、页面行为、认证与工作台组装
│   ├── AppErrorBoundary.tsx     # 分块等错误的兜底界面
│   └── styles.css              # 全局样式导入顺序
├── features/
│   ├── auth/
│   │   ├── LoginScreen.tsx
│   │   └── auth.css
│   ├── sessions/
│   │   ├── api.ts              # 带响应校验的会话请求
│   │   ├── protocol.ts         # 协议类型与运行时校验
│   │   ├── sessionState.ts     # 连接状态、标签与等待状态文案
│   │   ├── sessionList.ts      # 列表、选中项、状态的纯 reducer
│   │   ├── SessionTabs.tsx     # 标签导航、排序与新建/菜单入口
│   │   ├── SessionActions.tsx  # 更多菜单与键盘焦点管理
│   │   └── sessionTabs.css
│   ├── project/
│   │   ├── ProjectDrawer.tsx  # 抽屉容器、标签、焦点与关闭动画
│   │   ├── useProjectDrawer.ts # 打开/关闭状态、浏览器返回历史与图标预加载
│   │   ├── ProjectChanges.tsx # Git 更改列表与按需差异渲染
│   │   ├── ProjectFiles.tsx   # 文件工具栏、上传、下载与删除
│   │   ├── ProjectFileTree.tsx # 文件树、状态标记与操作菜单
│   │   ├── ProjectPreview.tsx # Markdown、代码与图片预览
│   │   ├── useFileMenu.ts     # 右键/长按仲裁、菜单位置与监听清理
│   │   ├── useProjectBrowser.ts # 项目读取状态、目录跟随与刷新
│   │   ├── projectRequests.ts # 读取请求取消、替换与上下文失效
│   │   ├── projectApi.ts      # 项目文件、Git、上传下载与 cwd 请求
│   │   ├── projectChangeStatus.ts # 更改列表和文件树共用的状态映射
│   │   ├── ProjectFileIcon.tsx # 共用文件图标渲染
│   │   ├── projectFileIcons.ts # 文件类型到图标的映射
│   │   ├── opencode-file-icons.svg # 文件图标 sprite
│   │   └── projectDrawer.css  # 项目功能样式，统一入口加载以保留层叠顺序
│   ├── workspace/
│   │   ├── Workspace.tsx      # 布局、外观设置、终端测量与功能组装
│   │   ├── useWorkspace.ts    # 认证与会话操作协调
│   │   └── workspace.css
│   └── terminal/
│       ├── Terminal.tsx       # 终端容器、辅助键与文本面板
│       ├── TerminalTextPanel.tsx # 移动悬浮菜单、只读快照与粘贴草稿
│       ├── useTerminal.ts     # 实例、渲染插件、resize 与输入生命周期
│       ├── terminalSize.ts    # 创建前网格测量与共享终端配置
│       ├── terminalLayout.ts  # 布局调度、隐藏与恢复后的测量
│       ├── terminalText.ts    # 可见文本快照与自动折行合并
│       ├── terminalConnection.ts # WebSocket、有界回放顺序、背压、重连与撤销
│       ├── terminalTouch.ts   # 手势到 xterm 滚动/鼠标报告的桥接
│       ├── touchScroll.ts     # 滚动、长按、帧合并和惯性仲裁
│       ├── AuxKeys.tsx
│       ├── keys.ts
│       └── terminal.css
└── shared/
    ├── api/client.ts          # HTTP 请求与 Unauthorized
    ├── theme/                # 偏好、系统监听、配色变量
    ├── ui/                   # Icon、StatusToast、提示配色与基础控件样式
    └── viewport/             # 可视区域和页面手势
```

单元测试与被测模块相邻（`*.test.ts`），浏览器回归放在 `e2e/`。目录树不逐项列出测试和生成文件。

### 功能依赖边界

`app → workspace → auth / sessions / terminal / project → shared` 表示组装方向；终端连接可使用会话 API 与协议类型。工作台只传递会话 ID、偏好和回调，不直接管理项目读取或终端连接。

- `shared` 不依赖 `features` 或 `app`。
- 独立功能不反向导入 `workspace` 或 `app`，通过 props 和回调协作；以上边界由 ESLint 检查静态导入。
- `project` 不拥有 PTY，也不依赖终端实例；`terminal` 不依赖项目抽屉。
- 不设统一 barrel 导出或纯转发层，使用实际文件路径定位实现。

## 2. 状态与资源所有权

- `App` 组装页面；`useWorkspace` 处理认证和会话操作，不拥有 PTY 或终端连接。
- `sessionList` 原子更新列表、选中项和状态，迟到的已移除会话事件被忽略；关闭请求完成不能覆盖用户的新选择。
- 每个挂载终端拥有自己的 xterm 和 WebSocket，切换标签只隐藏、不卸载。主题和字号原地更新，不因重渲染重连。
- 共享的 Suspense 只覆盖终端模块；工作台外层按当前状态渲染统一提示卡片，模块未加载时也可显示。`pendingStateText` 同时决定提示文案与当前终端等待标记。
- 连接收到 `4001` 后停止重试并返回登录页；主动注销期间忽略自身撤销引发的异常警告。普通重连不重复生成底部提示卡片。
- 列表在初始化、登录及本页操作时更新，重连也检查会话是否仍存在。没有列表广播或多控制端同步；每次重连通过有界回放重建最近画面。

项目面板的读取由 `useProjectBrowser` 管理；切换终端、目录或隐藏文件设置时清理旧数据并取消过期请求，关闭面板时取消全部读取。首次加载与手动刷新复用同一流程，隐藏文件设置在切换终端时保留。文件树刷新最多四个请求并发；多步任务在上下文失效后停止启动后续请求。页面隐藏时暂停并取消目录轮询，回到前台立即重新查询。

终端连接在版本二回放阶段串行执行 reset、resize 和 xterm 写入，解析完成后才重新 fit 并开放输入。旧连接尚未完成的写入先排空，过期排队数据取消；最终状态之后收到连接关闭时仍完成已接收的最后画面。

简单请求直接使用公共 HTTP 客户端，`sessions/api.ts` 仅保留复用或带响应校验的请求；不为一次调用添加纯转发层。

## 3. 终端与交互维护要点

### 尺寸、渲染和外观

- 创建前动态加载 `terminalSize.ts`，按当前容器、字号与辅助栏测量网格，再提交会话请求。测量实例复用 `terminalOptions`、`.terminal-content`、`.terminal-host` 和辅助键样式；不手算字符宽度或写死留白/栏高。
- 临时测量实例及节点必须在成功、失败路径清理；测量失败不能创建 PTY。它不持有会话或连接。
- xterm 节点不设置 padding，留白放在外层；真实终端使用 ResizeObserver + FitAddon 重新适配，隐藏终端显示后再测量。
- WebGL 插件不可用或上下文丢失时回退 DOM，释放监听与实例；不为视觉更新重建终端。
- 字号由工作台持有，范围 `8/10/12/14/16px`，默认 14，本地键为 `yandock-terminal-font-size`。文本面板复用该字号；后端不保存此偏好。

### 项目文件与 Git 差异

- `ProjectDrawer` 只负责抽屉容器、焦点、标签与关闭动画；Git 更改、文件操作/文件树和预览分别由 `ProjectChanges`、`ProjectFiles` / `ProjectFileTree`、`ProjectPreview` 展示。`useProjectBrowser` 统一拥有读取状态与目录跟随，`projectRequests` 负责分组取消和上下文失效，不在子组件重复维护读取状态。
- `ProjectFiles` 在切换“更改 / 文件”时保持挂载，上传保留捕获的项目上下文；`useFileMenu` 只管理临时手势与菜单监听，切换视图卸载文件树时统一清理。
- 更改列表与文件树通过 `changeKind` / `changeMarker` 共用配色和状态字母：`??` 显示 U，新增显示 A，删除显示 D，其余显示 M；中文 label 保留用于可访问名称。该映射不等于完整 Git 状态枚举。
- 只有展开的 `.project-change-trigger` 在 `.project-review-list` 内吸顶，受对应 `.project-change-item` 范围约束。标题及悬停背景必须不透明，避免差异文本透出；不能给标题父级添加会改变 sticky 滚动容器的 overflow。
- 展开后的行数 / 打开文件工具栏最小高度 38px，打开文件按钮最小高度 32px；变更文件标题行最小高度 32px，文件树行最小高度 28px。调整时保持桌面和窄屏的折叠、焦点和点击操作可用。
- Git 差异优先使用完整旧、新内容，无法完整读取时回退补丁。`statsComplete=false` 时明确显示统计未完成；`truncated` 列表不展示为全部结果。
- Markdown 经 DOMPurify 清理后渲染，代码与差异按需加载 Pierre 组件。文件预览使用文本与大小限制，不提供编辑保存。
- PNG、JPEG、GIF、WebP、ICO、SVG 经图片预览接口读取为 Blob URL，以 `<img>` 展示；SVG 不插入 HTML。`useProjectBrowser` 在切换预览和卸载时释放 URL，过期请求不能创建 URL。图片加载失败提示下载原文件。
- 抽屉使用一个浏览器历史层级；系统返回先退出预览，再关闭抽屉。`useProjectDrawer` 管理历史，`ProjectDrawer` 通过 `previewBack` 消费预览返回，避免每次预览堆叠历史。`Workspace` 只连接按钮与抽屉，不操作历史细节。

### 移动手势与复制粘贴

- 辅助键与自定义复制粘贴使用同一设备识别策略：Android、iPhone、iPad，以及使用桌面 UA 的多点触摸 iPadOS。普通桌面不因窄窗口或触屏启用面板。
- 移动端全页禁止普通内容的文本选中和浏览器长按菜单；输入框、textarea 与 contenteditable 保留原生选区和粘贴操作。页面捕获并取消非输入区域的上下文菜单。
- 仅移动端取消终端 `touchend` 的默认激活行为，并捕获、阻止浏览器可能由触摸合成的 `mousedown` 事件，避免轻点激活焦点或向 CLI 发送点击操作；不阻断触摸滚动和长按监听器。xterm 隐藏输入框默认只读，意外获焦时立即失焦；辅助栏键盘按钮解除只读并先失焦再聚焦，按钮状态由输入焦点同步。切换终端或打开复制菜单时收起键盘。普通桌面端不注册这些点击拦截，输入框保持可编辑；不按窗口宽度启用移动限制。焦点不等同于系统软键盘可见状态，iOS 真机行为仍需独立验证。
- 捕获监听器统一仲裁滑动和长按；计时器、惯性、帧和监听在取消或卸载时清理。备用屏幕滚动优先复用 xterm 当前鼠标协议。
- 复制快照与粘贴草稿分离，文本及触点坐标用同一快照对象传递；外点关闭使用 Pointer Events，避免一指操作重复处理。
- 面板必须保留原生 textarea 选区和粘贴菜单，不调用 Clipboard API 或 execCommand；终端区域的原生菜单拦截不能影响面板。
- 面板发送捕获 xterm 同步生成的粘贴数据，绕过粘滞 Ctrl，在结束标记之外附加回车；整体验证后再分帧，拒绝时保留草稿。具体限额见协议文档。
- 标签排序只改变当前页面顺序，不改 ID、编号、当前选择或连接。内部 key 和连接地址使用唯一 ID，不能使用可复用的 `seq`。

### 样式与可访问性

- 功能样式由 `app/styles.css` 按“Tailwind → 主题 → 基础 → 功能”统一导入，不随组件挂载改变层叠顺序；xterm 官方样式随测量/终端模块动态加载。
- 主题颜色、字体、间距和圆角优先使用变量或共享样式，不覆盖 xterm 内部渲染与输入结构。
- 按控件保留可见的键盘焦点反馈：菜单、标签和文件操作分别使用既有下划线、透明度或 focus-visible 外框。不要全局取消 outline；文本面板保留实际焦点、输入与选择，不用 blur 或禁用 tabindex 隐藏焦点。
- 连接等待与错误提示统一在 `Workspace` 展示，终端容器保留 busy 状态；保持菜单 Tab 循环、Escape 关闭及既定焦点恢复。
- 软键盘使用动态可视区域和安全区适配，不硬编码键盘高度。浏览器模拟不能替代真机 IME、系统菜单和软键盘验收。

## 4. 本地开发

从项目根目录先安装依赖并构建嵌入资源，再启动 Go 服务：

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
export YANDOCK_TOKEN="$(openssl rand -hex 32)"
go run ./cmd/yandock
```

另开终端执行 `pnpm --dir web dev`，访问 Vite 输出的本机地址。Vite 将 `/api` 和 WebSocket 代理到 `127.0.0.1:8080`，不会自动读取已有服务的访问凭据；不要将 Vite 服务暴露公网。

前端构建依次运行 TypeScript 检查、Vite 构建和 `scripts/embed.mjs`，暂存产物后替换 `internal/webassets/dist`。仅运行 Vite dev 不生成 Go 所需嵌入资源，旧 Go 二进制也不会自动使用新网页。

## 5. 检查与测试

从项目根目录执行：

```sh
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web format:check
pnpm --dir web test
pnpm --dir web build
pnpm --dir web exec playwright install chromium
pnpm --dir web test:e2e
```

- 自动格式化用 `pnpm --dir web format`；规则以 `tsconfig.json`、`eslint.config.js` 和 `package.json` 为准。
- Vitest 覆盖协议、状态文案、按键、手势、背压/重连/撤销及会话 reducer；Playwright 覆盖认证、生命周期、尺寸测量、懒加载、渲染回退、复制粘贴、布局和主题，以及断线回放、目录跟随、请求取消、预览返回、状态字母和桌面/窄屏吸顶折叠。
- Playwright 在 `127.0.0.1:18080` 启动独立 Go 测试服务，使用公开测试凭据、单 worker、不复用已有服务。必须先构建前端；端口占用时查明来源，不改为复用用户服务。
- 等待新标签、协议、网络或画面等可观察就绪条件。用可控时钟推进长按与重连，不用固定睡眠或增加重试掩盖竞态。多设备测试用独立 context；同 context 共享 Cookie。
- 自动化通过不代表真实 IME、移动系统菜单或所有平台均已验收；结果需区分单测、浏览器模拟、构建与真机。

## 6. 联调服务更新

业务代码修改并验证后，按项目规则重建前端和 Go 二进制，并重启已确认身份的测试服务；提前告知内存登录和终端会话会失效，保留原目录、参数及必要环境，不记录凭据。就绪检查至少包括监听端口、首页与新资源、未认证 API 仍返回 `401`。

仅文档修改不重启服务。具体停止、更新和部署操作见[使用指南](../docs/使用指南.md#7-更新停止与重启)，后端检查见[后端文档](../docs/后端代码结构.md)。
