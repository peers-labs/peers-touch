# Desktop 容器外壳 — 原型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
> **落地目标**: Desktop 容器外壳（`apps/desktop`）；**原型本身只是 React web 展示**，不碰真实 store / kernel / tauri
> **总账状态**: drafting（见 [原型总账](../README.md)）
> **Owner**: Peers-Touch Agent Team
> **Module**: `packages/prototypes/desktop/shell/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/shell/`（统一原型工作区；独立 web 工程）。本目录只放入口说明，不复制源码（架构文档标准 §5.8）。

这个原型展示 **peers-touch desktop 容器外壳长什么样**。容器壳负责全局导航与页面切换；Agent 使用 Peers-owned Shell Agent Surface，Modern Chat 产品评审态来自 `modern-chat-agent`，Atelier 作为原生 Agent 子入口继续收敛。

## 怎么跑

```bash
cd packages/prototypes/desktop
pnpm install        # 首次，monorepo 根装也可
pnpm dev            # Vite，浏览器打开 localhost:3105
```

技术栈：React + Vite + `lucide-react` + 内联样式 DOM，纯前端、mock 驱动，浏览器直接看，不需要任何运行时容器。原型通过 workspace 依赖 `@peers-touch/prototype-desktop-atelier`，把 atelier 原型整体作为一个 applet 嵌入内容区（基础件跨原型复用，不重复造）。

## 形态：容器壳 + applet 内容区（参照真实 apps/desktop）

参照真实桌面工程 `apps/desktop`（`ReadyView` → `GlobalLayout` → `AppSideNav` + `PageRouter`）复刻容器外壳：

- **全局 SideNav（LobeUI `<SideNav>` 形态）**：
  - `avatar`：用户头像（顶部方形头像）。
  - `topActions`：固定为 Search / Chat / Agent / Moments；模块、置顶 Agent 与 applet 都不能动态注入。
  - `bottomActions`：通知 / 设置。
- **内容区（页面路由）**：按 `page` 切换。Agent Chat/Profile、Atelier 和 Settings 使用已细化原型；编排是 Atelier 内部工作模式，不占用独立导航。
- **命令面板**（`⌘K`）：mock 命令列表；Evaluation 不提供用户入口，Discover 与 Memory 由 Settings > AI 承载。

## Agent 模块集成

- 操作生命周期对齐清单（参考工程双侧走查 + 处置 + 证据）：[agent-chat-coverage.md](agent-chat-coverage.md)，逐行更新，是本轮设计完成度的唯一核对表。
- Shell 的 `agent` / `agent-profile` 路由挂载 `src/AgentChatPage.tsx`（多 Agent 名册 + 会话工作台，Profile 为页内 surface）。
- Modern Chat 产品评审原型位于 `packages/prototypes/desktop/features/modern-chat-agent/`，由 Shell 评审态挂载；历史 benchmark 原型不参与产品身份。

### 普通 Agent 对话工作台（2026-10-20，confirmed）

按 live walkthrough（`http://127.0.0.1:8436` 参考实例）+ Quiet Protocol Minimalism 重设。
内置一个普通 Agent（显示名即 **Agent**，assistant 只是消息角色、不再作为产品名；
旧 localStorage 中未改名的 `Assistant` 种子读时自动归一，用户自改名保留），不预置专家 Agent；
用户可 **Create Local** 自建普通 Agent（对齐参考工程）。
结构为「常驻 Agent 名册 + Chat 专属 Topic rail + 连续对话」：

- 展开 rail 默认就是 **My Agents**，不再先显示“当前 Agent 卡片 + Search chats”：头部只有标题与一个 `+`
  创建菜单，其下是 Search agents、Pinned / All Agents 分组及 Agent 行；230px 展开、48px 收起。
  行=首字母瓦片+名称+描述，选中 wash+品牌瓦片；行尾 `⋯` 使用锚定菜单，
  仅保留 **Agent Profile** 与非内置 Agent 的红色 **Delete**。
  Start New Topic 与 Search 归属当前 Agent 的 Topic rail，不从 Agent 行菜单触发跨面跳转。
  菜单↑↓ roving、Esc/点遮罩关闭还焦 `⋯`；Agent 搜索实时过滤名称/描述并有空态。
  名册在聊天和 Profile 内始终可见；收起态仍保留 `+` 与 Search。两态共用头部、搜索槽、
  分组留白、48px 行高及同一个滚动容器，头像纵向中心完全一致，不因折叠上下移动。
  新建/选择/编辑/搜索/删除不会改变用户的展开选择；普通 Agent 行点击进入该 Agent 的 Chat，
  Profile 只由明确的 Agent Profile 动作进入。
- Chat 在 Agent 名册与主对话之间常驻一个 **Topic rail**；Profile 保留 Agent 名册但不挂载 Topic rail。
  宽屏为 238px 展开栏：顶部只显示当前 Agent 名称，不重复头像；其下是等宽的 Start new topic / Agent Profile / Search
  三个图标槽。Search 在原槽行内横向替换三个动作，Cancel/Escape 清空并反向恢复，不新增行或挤压布局；
  `Topics <数量>` 紧贴列表上方，批量选择/删除在右侧；列表包含
  Pinned/Today/Yesterday/Previous 分组、折叠、切换、状态和 Pin/Unpin、Edit、Delete。
  小于 1040px 时 Topic rail 收为 48px，但仍保留新建与带数量的 Topics 入口；
  展开 Agent 或 Topic rail 会收起另一个。小于 560px 时两个 Desktop rail 都退出阅读路径：
  chat 独占内容区，Back 进入全宽 Topic list，Switch Agent 打开左侧全高抽屉。
  Topic Search 只匹配标题，当前话题不丢；
  选择 Topic 不关闭 rail。Esc 仅在焦点位于 Topic rail 内时收起并还焦 opener。
  Agent/Topic 行菜单继续 portal 到 body，避开列表裁剪，在空间不足时向上展开，
  source 移动/窗口 resize 时关闭。新建与 Agent/Topic 菜单共用定位生命周期。
  会话/草稿/未发送附件/Topic 模型覆盖/产物按 Topic 归属；切换 Agent 或进入 Profile 后恢复上次选中的会话和草稿。
- Agent 头像支持首字母、Emoji、本地图片三种持久化形态，并同步投影到名册与 Profile。
  图片限制 PNG/JPEG/WebP/GIF、2 MB；Upload 必须经过预览后 Save，Cancel 不改动已保存头像。
  对话标题栏不再重复 Agent 头像和描述；左侧只显示当前 Topic 标题，右侧是会话正文搜索。
  搜索匹配消息正文、附件名、提问和产物标题，可上/下一处定位并高亮当前命中；AI/Skill 标题栏快捷按钮暂不展示。
- Create Local（**瞬时创建，无阻塞表单，批次 17 对齐参考工程**）：My Agents 头部 `+`
  打开 **Create Local / Create Orchestrator** 菜单（Import×2/From Hub 无合同 CUT）。Create Local
  立即写名册（自动唯一名 `New Agent` / `New Agent N`）、激活该 Agent 并打开其 **Profile Builder 工作区**；
  名称/描述/SOUL/AGENTS/头像/Extensions 自动保存，成功或失败使用 Shell 通用 Toast 通知，
  不在 Profile 几何中常驻保存说明。Back、pagehide 与组件卸载会同步落盘最后一次编辑，立即返回也不丢稿。
  Back 即直达新 Agent 的聊天空态。Create Orchestrator 进入 Atelier 编排模式。
  Agent 身份存 localStorage，刷新后列表保留（会话历史是 Station 真源，原型刷新不保留，见 A10）。
- 删除 Agent（非内置）：行 `⋯` → Delete → alertdialog 二步确认 → 名册/order/profile 草稿/extensions 键与该 Agent
  的内存线程/草稿/定时器全部清除，活动面回落内置 Agent；内置 Agent 不可删。置顶/排序/Hub/Import/Duplicate
  无后端合同，CUT，不放假入口。
  正在编辑的 Agent 被删除后，Profile 的最后一次保存遵守名册实体生命周期，不重新创建已删除的草稿键。
- Profile Builder 分 **Identity / Extensions** 两个 Tab：Identity 使用参考工程同轴布局：
  左轴固定 64px；Back 为 36×36、头像本体为 64×64 且无二层按钮框，两者左边界一致；
  头像与 64px 描述框顶边一致，名称/描述占同一右轴，SOUL/AGENTS 双栏填满剩余高度。
  头像点击打开 Emoji/Upload 锚定选择器；Identity 不承担模型配置。
  SOUL/AGENTS 未手改时身份行随改名联动。
  SOUL 的生成/手改归属被持久化，重开后自动模板仍随身份字段更新，手改内容不被覆盖；Tab 支持方向键/Home/End。
  Extensions 把 Skills 与 MCP 工具放在同一配置面，但只展示已绑定项：
  Skills/MCP 分组头只显示带标签语义的 `+` 图标，点击后打开 Settings 共用目录的按需选择器，搜索并选择后才进入列表；
  已绑定行提供开关与移除。选择器每次最多挂载 12 项并支持继续加载，100 项目录不会变成 100 行 Profile。
  启用态按 Agent 持久化并在 Tab 计数；Hooks/Docker/文件系统 retention 等开发者面不暴露。
- 主区空态：Agent 名称、职责说明和 4 个紧凑起手问题；默认即此态，不重复 Agent 头像或第二个身份入口。
- 对话：用户气泡右置；助手为连续正文（无逐消息头像）；可折叠 `N thoughts / N commands`
  活动聚合；富文本（标题/项目符号/编号/inline code）；产物卡；`You may also ask` 追问；
  完成后安静的时间/token meta；hover/focus Copy / Regenerate；用户消息 Edit and resend
  （内联编辑，Save 截断其后轨迹并重跑、未改禁用、⌘/Ctrl+↩ 保存、Esc 取消；busy 时隐藏）。
- 状态面：thinking 三点、streaming caret、Stop、typed error+Retry、
  追问、空会话、compact/mobile。Stop 终态为
  `Agent execution cancelled` + Topic error，不再显示自创 `Stopped+Regenerate`。三个动效类（spin/typing/caret）为页内
  `<style>` 自包含，遵循 `prefers-reduced-motion`。
- 对话门控（turn gates，原型脚本演示，非真实执行）：
  - **Clarification ask**：对齐 `request_user_input`，包含 radio、Recommended、Other input 和 Submit；
    提交后保留 `Answered · <choice>` 记录并以独立 assistant message 续跑；等待时 Stop 可达。
  - **Tool approval**：展示 tool/category/参数预览与 Pending/Executed/Cancelled；
    Cancel/Run tool 均保留终态卡，写入 Agent system receipt，再由 Agent 自动续跑。
- 阅读位置合同：流式/门控决议/续答时仅在用户钉底（距底 <48px）时自动滚到底，用户上滚读历史不被拽回。
- Composer 遵循 grounded chat composer 合同，且与参考工程 `ChatInput` 同构（源码事实
  `DEFAULT_LEFT_ACTIONS=["slash","upload"]`）：左侧 **Commands & Skills palette**
  支持 `/` 输入、指针和键盘打开；`/help` 为 Desktop 静态说明，`/tools`/`/skills`
  只读版本化 Station snapshot，`/clear` 创建空 Topic 并保留旧历史。ready/empty/stale/unavailable
  状态完整，stale/unavailable 只禁用 capability action，不阻断普通文本。ready Skill/MCP
  点击插入 `/token`，无绑定项可直达 Profile→Extensions。其后为 **回形针附件**（原生文件选择、可删除 chip；
  切换后按会话恢复，发送后作为消息元数据回显）；
  右侧 **上下文余量环**（按会话已产 token/128k 派生）+ **Topic model**（显示真实模型名；
  模型按 Provider→Models 归属，可折叠并搜索；Settings 从同一 Provider 树设置全局默认值，
  新 Topic 继承默认值，当前 Topic 可独立覆盖）+ **纸飞机发送**（流式时红色方块 Stop）。
  占位符 `Ask, create, or start a task…  Press ⌘ ↵ to insert a line break`；Enter 发送、
  ⌘/Ctrl/Shift+Enter 换行；聚焦=品牌边+soft ring。所有控件均有真实本地闭环，不放假入口。
- Settings 的 Providers 保持一个 Direct/CLI 混合列表；Add Provider 在创建时选择类型，不增加类型 Tab。
  列表默认启用并持久化 `Show usable only`，仅显示已启用且配置可用的 Provider。
  Direct 仅挂载 API 与模型配置；CLI 仅挂载 Station 注册 adapter、默认模型、启动参数、环境变量、检查/恢复/保存，
  Advanced 只读显示注册命令与隔离 workspace policy。任意 executable path 或 shell command 编辑不进入客户端。
  两类 chat model 继续进入同一个 Provider→Models 目录。Provider 和单个 chat model 的启停写入共享 availability
  owner；Agent composer 只投影仍启用的 Provider/model，当前选择失效时立即回落到可用模型。AI / Models
  仅保留默认模型选择，不再重复 Provider 目录树。
- 当前 Topic 运行时保持单一 turn owner；queue 不在确认范围。composer 可保留草稿，
  但不会创建并行执行或隐藏队列。其他 Agent/话题显示 Return to running topic，草稿不丢。
- 完成消息以紧凑徽标投影实际参与或部分参与的 Skill/Memory/Knowledge/Attachment/Tool；
  展开详情显示 pinned version、included/omitted/truncated 与原因。历史 Turn 数据不会被当前
  Agent Binding 改写，且详情不暴露 Prompt、凭据、本地路径或 debug trace。
- Artifacts & references 右侧抽屉只保留基础列表与正文查看；六类筛选、搜索和排序不在确认范围。
  打开焦点落 Close、背景 inert，Esc/遮罩关闭还焦实际 opener。
- 键盘 L3（对齐 Channels experience-contract §7）：删除弹窗 portal 到 body 且打开时聊天根 inert，
  默认焦点 Cancel、Tab/Shift+Tab 首尾循环、Esc 还焦行触发器；行菜单打开进首项、↑↓/Home/End roving、
  Esc 还焦；改名 Enter 提交/Esc 丢弃（Esc 不被 blur-commit 反提交）后还焦；
  审批卡出现焦点落 Deny（安全默认）；Copy/Regenerate 经 :focus-within 显形；
  统一 :focus-visible 品牌焦点环。证据 `cdp-24~28`。
- 长内容（对齐参考工程同源机制）：正文/气泡/门控文本 `overflow-wrap:anywhere`；长 URL、inline code、
  长命令 `pre-wrap + break-all` 全文换行不裁切（待批准命令与审计记录必须完整可读）；产物卡 title/meta
  单行 ellipsis；长答案纵向滚动，六阶段横向溢出扫描零命中。`?agentStress=1`（配合 review=1）注入单 turn
  压力内容（生产复制剔除）；证据 `cdp-29~34`。
- 文案 +30% 膨胀：运行时伪本地化（chrome 叶子文案/placeholder 增长 30%，幂等、数字与正文不注入），
  welcome / 760px 窄宽 / 审批门控 / 抽屉 / 删除弹窗五态零横向溢出与定高裁切，零产品改动；证据 `cdp-35~39`。
- 提交语义：两层同步锁防重——同 tick 双 Enter / 双击门控 / 双击 Regenerate
  均只产生一次结果；busy 中不接收第二次发送并保留草稿；无 👍/👎 反馈控件
  （纯遥测无接收端，CUT，重新进入点=Station 反馈阶段）。reduced-motion 经媒体模拟实测三动效归 none。
- 类型化错误矩阵（fp-05 §4）：未配置/鉴权(401)/限流(429 倒计时)/网络(502)/流式中断五类，错误块就地给
  Open settings 或 Retry；失败留稿、Retry 恢复后清稿；无技术报文、无假成功。`?state=agent-chat&review=1`
  深链显示仅评审可见的故障注入条（生产复制剔除）；普通入口零注入 UI。
- Profile 页内面（Agent 行菜单/Topic rail Profile 图标打开）：可编辑 title/description + 头像 + SOUL.md/AGENTS.md
  双栏等宽且填满剩余高度（窄容器上下堆叠且可滚动）；字段经 300ms 防抖自动写 localStorage
  （损坏/不符 id 回退默认），重开与整页刷新读回，Back 直接返回；保存名实时投影到 rail 身份、Welcome 标题、
  composer placeholder/aria。Configure/Activity 模式（Tasks/Memories/Diagnostics）与
  Capabilities/Workspace tab 全部 CUT——无真实数据，旧内容为硬编码 mock，且绑定/文件系统是
  Station 开发者面；死控件 AI Rewrite 同步移除。
- 全部为原型本地状态机；L1/L2/L3 当前证据、参考工程 disposition、截图清单、
  136 个操作合同与未证明边界统一记录在
  [agent-chat-coverage.md](agent-chat-coverage.md)，不再维护第二套历史 cdp 结论。

2026-10-16 默认信息架构复核：独立 Chromium 在 1222px Agent 根容器中确认
230px 常驻 My Agents rail + 238px Chat-only Topic rail + 主对话；刷新首屏直接出现
Pinned / All Agents，旧 Search chats 默认面不存在。Profile 保留名册且不挂载 Topic rail。
compact 根容器为 48px Agent rail + 48px Topic rail + 主对话；ultra-narrow 为 chat-only，
Back → Topic list → Switch Agent 左侧全高抽屉。全部视口横向溢出为 0。
source-bound reference parity 结果位于 `/tmp/pt-provider-usable-filter/`。

可重复执行的 Agent 回归入口：`node packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs`。
依赖 Playwright 和 Chromium，允许 `CHROMIUM_PATH`、`AGENT_CHAT_URL`、`AGENT_CHAT_EVIDENCE` 覆盖环境。
当前门禁为 11 条完整 Journey、136 个操作/状态合同，覆盖 Agent 名册/Profile/头像/右下角通用保存通知/Extensions、
Topic 新建/切换/Pin/同栏标题搜索/Edit/单删/批量删除、Direct/CLI Provider 创建与 selected-only schema、可用 Provider 持久化筛选、Provider/model 启停投影、Models 默认值/Topic 模型树与覆盖、Commands/Skills snapshot、历史 Turn Attribution、附件、两阶段 quick reply、
会话正文搜索定位、request-user-input、tool approval 两种决议与续跑、Stop/typed error、基础 artifact、
跨 Agent/Topic 草稿、wide/compact/mobile 左抽屉与 reduced-motion；
输出包含 Git commit、源码文件 SHA-256、结果及截图，
归类为 `PROTOTYPE_AGENT_CHAT_SCOPE_AND_REFERENCE_PARITY_CHECK`，不代表 Station/native Acceptance。

2026-10-14 当前操作复核见 [覆盖清单](agent-chat-coverage.md#当前操作复核)：
删除运行中会话后可继续发送、编辑重发保留独立草稿、产物查看和真实键盘焦点闭环均已复测。
本轮证据在 `/tmp/pt-current-audit/`。Desktop Shell 与 Portal 的全量 TypeScript 检查通过：
`pnpm --filter @peers-touch/prototype-desktop-shell exec tsc --noEmit`、
`pnpm --filter @peers-touch/prototype-portal exec tsc --noEmit`。
Shell 的类型解析与运行时保持同一个 React 主版本，Atelier 入口与 Vite 使用同一源文件。
真实 Station 业务闭环仍需落地验收。

样式收敛：时间/用量/快捷键等辅助文本使用 `text.secondary` 和 12px 字号；
聊天控件圆角复用现有 6/8/12 token。Profile 编辑器仅保留一层边框，
聚焦归属整个编辑区域；初始正文高度 200px，可纵向调整，窄容器上下堆叠。
宽窄屏渲染、无横向溢出、焦点边界与保存回读已复核，截图在 `/tmp/pt-style-review/`。

- Atelier 编排模式小于 1000px 时改为 `56px Agent rail + Canvas`，Engine / Progress / Detail 下移到下一行，由页面纵向滚动承载。

## Notifications 查看流程

- 用户目标：从当前工作上下文快速处理最近通知，按需搜索和翻阅全部通知。
- 紧凑预览从全局铃铛打开；面板底边与铃铛按钮的实时底边对齐，最近四条通知内部滚动。
- More notifications 替换预览为一个居中 dialog；不注册独立页面或 tab。搜索覆盖作者与正文，不区分大小写；每页六条，页码随筛选或删除修正。
- Shell 持有唯一通知数据；预览和完整查看器复用 `NotificationList` 与 `RequestDecisionButtons`。读状态、邀请决策和删除立即在两种形态同步。
- 列表拥有头像、正文、时间和操作区的共享列轨：时间右边界统一，单按钮与双按钮保留同宽操作区，决策完成后列轨不移动；左右留白及上下内距成对相等。继承 [共同布局合同 §3.1](../../../../client/common/ui-identity/layout.md#31-symmetry-and-repeated-row-tracks)，gate 比较跨行轴线、可见按钮边界、长时间文案与状态转换，并用故意错位的负例验证检出能力。
- 浮层、搜索、列表与页码各有独立边界；分页和空态保持 dialog 大小，关闭后卸载内容并恢复铃铛焦点。完整列表只渲染当前页，筛选由 memoized derivation 承担。
- 继承 shared UI Identity 与 Social Desktop 合同；保持安静的连续列表、单一强调色、方形头像和统一决策按钮。拒绝独立通知页面、重复实体控件、装饰动效和全部历史行同时挂载。
- 验证入口：`packages/prototypes/desktop/features/social-chat/qa/geometry_checks.py`，覆盖宽窄窗口、对齐、搜索无结果及恢复、分页、决策、标记已读、删除末页、键盘关闭与回焦。数据为本地 mock，无网络加载和服务端失败态；生产状态同步、高数据量搜索性能与读屏器实测为 UNPROVEN。

## Applet runtime

- Applet launcher 与 `applet:<id>` 路由继续作为容器内部能力存在，但不占用全局一级 Rail，也不提供 Pin 到 Rail。
- Atelier 的用户入口归入 Agent 模块二级工作面；其 applet runtime 仍可在内容区渲染 `@peers-touch/prototype-desktop-atelier` 的 `AtelierPage`。
- Search 是按需唤起的覆盖层（默认落点是 Chat）：rail 搜索按钮与 ⌘K 打开 `src/search/SearchOverlay.tsx`，只覆盖 Peers 封闭域（端 + Station、当前 actor 授权），不含公网/OS 文件。见 [Search 原型 README](../../../domains/search/prototype/README.md)。

## 对应设计

- 容器外壳形态参照真实工程 `apps/desktop`：`src/views/ReadyView.tsx`、`src/components/GlobalLayout.tsx`、`src/components/AppSideNav.tsx`、`src/components/PageRouter.tsx`。
- 设计真源：[runtime/desktop-runtime-architecture.md](../../../platform/client/desktop/runtime.md)、[applet-runtime](../../../platform/applet-runtime/README.md)。
- Atelier applet 设计：[atelier 原型](../../../domains/applets/atelier/prototype/README.md)。

## 总账状态

drafting（见 [原型总账](../README.md)）。

## 已知差异 / 待补

- Search 已接入封闭域覆盖层原型（见 [Search 原型](../../../domains/search/prototype/README.md)）；Moments 等未覆盖页面仍有占位内容。Agent Profile 已接入整合原型。
- SideNav 用纯 DOM 复刻 LobeUI `<SideNav>` 形态（avatar/topActions/bottomActions），未引入 `@lobehub/ui` 与 antd theme token；视觉为近似，不接真实主题系统。
- 二级侧栏（真实工程 agent 页的 `DraggablePanel`）未复刻。
- 命令面板为 mock 跳转，未接真实快捷键全集与命令注册表。
- applet 进入/退出未做 keep-alive / 生命周期（真实 `PageRouter` 对 agent 页 keep-alive）；原型为简单挂载/卸载。
