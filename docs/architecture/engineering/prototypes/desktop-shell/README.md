# Desktop 容器外壳 — 原型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-10-16
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
make run-prototype
```

技术栈：React + Vite + `lucide-react` + 内联样式 DOM，纯前端、mock 驱动，浏览器直接看，不需要任何运行时容器。原型通过 workspace 依赖 `@peers-touch/prototype-desktop-atelier`，把 atelier 原型整体作为一个 applet 嵌入内容区（基础件跨原型复用，不重复造）。

## 形态：容器壳 + applet 内容区（参照真实 apps/desktop）

参照真实桌面工程 `apps/desktop`（`ReadyView` → `GlobalLayout` → `AppSideNav` + `PageRouter`）复刻容器外壳：

- **全局 SideNav（LobeUI `<SideNav>` 形态）**：
  - `avatar`：用户头像（顶部方形头像）。
  - `topActions`：Search / 聊天 / Agent / Notes 等内核页入口 + **applet pins**（Blocks 图标，active 态对应 `page === 'applet:<id>'`）。
  - `bottomActions`：通知 / 命令面板 / 设置。
- **内容区（页面路由）**：按 `page` 切换。Agent Chat、Agent Profile、Orchestration 和 Settings 使用已细化原型；其他未覆盖页面使用轻量占位。
- **命令面板**（`⌘⇧P`）：mock 命令列表，可跳转各页/applet（对齐真实 AppSideNav 的 Command Palette）。

## Agent 模块集成

- Shell 的 `agent-profile` 路由由 `src/AgentChatPage.tsx` 内的 Agent Profile surface 承载。
- Modern Chat 产品原型位于 `packages/prototypes/desktop/features/modern-chat-agent/`，由 Shell Agent 页面挂载；历史 benchmark 原型不参与产品身份。
- Profile 根据 Shell 内容容器宽度响应，而不是根据浏览器 viewport 猜测：
  - 小于 920px：My Agents 收为 48px 图标栏，Builder 默认关闭。
  - 窄容器打开 Builder：作为右侧覆盖层，不压缩主内容。
  - 小于 680px：SOUL / AGENTS 与配置卡片改为单列。
- Agent Chat 使用相同的容器宽度策略：
  - 小于 900px：Agent roster 收为 48px；Topics 改为按需覆盖层。
  - Profile / Orchestration 入口常驻 Chat Header。
  - Welcome、快捷操作和 Composer 使用主区可用宽度，不保留固定 430px/560px 横向约束。
- Orchestration Canvas 小于 1000px 时改为 `56px Agent rail + Canvas`，Engine / Progress / Detail 下移到下一行，由页面纵向滚动承载。

## Notifications 查看流程

- 用户目标：从当前工作上下文快速处理最近通知，按需搜索和翻阅全部通知。
- 紧凑预览从全局铃铛打开；面板底边与铃铛按钮的实时底边对齐，最近四条通知内部滚动。
- More notifications 替换预览为一个居中 dialog；不注册独立页面或 tab。搜索覆盖作者与正文，不区分大小写；每页六条，页码随筛选或删除修正。
- Shell 持有唯一通知数据；预览和完整查看器复用 `NotificationList` 与 `RequestDecisionButtons`。读状态、邀请决策和删除立即在两种形态同步。
- 列表拥有头像、正文、时间和操作区的共享列轨：时间右边界统一，单按钮与双按钮保留同宽操作区，决策完成后列轨不移动；左右留白及上下内距成对相等。继承 [共同布局合同 §3.1](../../../../client/common/ui-identity/layout.md#31-symmetry-and-repeated-row-tracks)，gate 比较跨行轴线、可见按钮边界、长时间文案与状态转换，并用故意错位的负例验证检出能力。
- 浮层、搜索、列表与页码各有独立边界；分页和空态保持 dialog 大小，关闭后卸载内容并恢复铃铛焦点。完整列表只渲染当前页，筛选由 memoized derivation 承担。
- 继承 shared UI Identity 与 Social Desktop 合同；保持安静的连续列表、单一强调色、方形头像和统一决策按钮。拒绝独立通知页面、重复实体控件、装饰动效和全部历史行同时挂载。
- 验证入口：`packages/prototypes/desktop/features/social-chat/qa/geometry_checks.py`，覆盖宽窄窗口、对齐、搜索无结果及恢复、分页、决策、标记已读、删除末页、键盘关闭与回焦。数据为本地 mock，无网络加载和服务端失败态；生产状态同步、高数据量搜索性能与读屏器实测为 UNPROVEN。

## Login 与 General Settings（DUI-03）

本轮对齐 C19-C24。Settings 属于高频工作流，复用 shared UI Identity 的
Quiet Protocol Minimalism；当前没有独立 Settings module UI ID。Auth 继承
`ui-identity/modules/auth/`，保持一个稳定登录卡片、一个 Station/trust
utility rail 和局部恢复反馈。

- C19：General 只保留已交付的亮色界面，不展示 System/Light/Dark 或消息密度控制。
- C20：语言只列出实际打包的 `en` 与 `zh-CN`，并使用与 Auth utility bar
  相同的 prototype-local persisted preference。
- C21：OAuth 卡片消费 Shell 注入的 broker provider projection；组件内不声明
  provider 可用性。`auth-oauth-empty/opening/waiting/initializing/success/error`
  覆盖空态、固定槽位进度、取消和失败重试。
- C22：Email 登录字段为空且不预填示例凭据；提交只推进 prototype-local
  Journey，不伪造生产会话。
- C23：`auth-gate-invite/terms/custom/blocked/maintenance/unknown` 可直接打开。
  unknown gate 明确 fail closed，不进入 Shell。
- C24：左下 Station picker 覆盖 add/select/remove/probe；宽窗使用锚定
  Popover，窄窗使用 bottom Drawer；未知状态不显示装饰性灰点。

Craft contract：

- Product thesis：进入产品前，用户明确知道使用哪个 Station、可用哪种登录方式，
  且 Access policy 不被客户端猜测。
- Main subject：登录或当前 Access Gate；Station/trust context 为次级决策信息。
- Boundary model：Auth card 是 content/action/recovery layer；底部 utility rail
  是 trust source；Popover/Drawer 是 floating layer。
- Signature：Station 所有权持续可见，但只在 picker 与 Access Gate 决策点提升权重。
- Positive calibration：provider 进度留在原按钮、卡片几何稳定、错误保留输入、
  unknown gate fail closed、浮层关闭回焦。
- Negative calibration：无 fake credentials、无 hardcoded provider availability、
  无未交付主题/密度/locale、无 dashboard card grid、无装饰 motion。

Review URLs：

```text
?state=auth-login
?state=auth-login-email
?state=auth-oauth-empty
?state=auth-oauth-error
?state=auth-gate-invite
?state=auth-gate-terms
?state=auth-gate-custom
?state=auth-gate-blocked
?state=auth-gate-maintenance
?state=auth-gate-unknown
?state=auth-recovery
```

L2 evidence（light）：

- [`20261015-auth-login-wide.png`](./evidence-l2/20261015-auth-login-wide.png):
  1440×900，provider projection、固定 auth card、Station/language trust rail。
- [`20261015-auth-oauth-error-wide.png`](./evidence-l2/20261015-auth-oauth-error-wide.png):
  1440×900，provider-local retry 与固定 trailing cancel。
- [`20261015-access-custom-filled-wide.png`](./evidence-l2/20261015-access-custom-filled-wide.png):
  1440×900，Station-authored generic schema 与唯一 primary action。
- [`20261015-access-unknown-narrow.png`](./evidence-l2/20261015-access-unknown-narrow.png):
  900×720，unsupported gate fail-closed recovery。
- [`20261015-station-picker-narrow.png`](./evidence-l2/20261015-station-picker-narrow.png):
  900×720，窄窗 Drawer、stable status/action slots、无非预期重叠。
- [`20261015-settings-language-wide.png`](./evidence-l2/20261015-settings-language-wide.png)
  与 [`20261015-settings-language-narrow.png`](./evidence-l2/20261015-settings-language-narrow.png):
  1440×900 / 900×720，仅显示两套 shipped locale pack。

L3 dynamic：

- OAuth provider action 在 idle → opening → waiting 间保持相同 x/y/width/height；
  cancel 后焦点回到原 provider。
- Station picker invalid URL 保留输入并显示局部错误；add/select/remove/probe 与
  local persistence 已真实点击；Drawer/Popover 关闭后焦点回到触发器。
- Language picker 仅有 `en` / `zh-CN`，选择后回焦。
- 六类 Access Gate 均可达；custom schema 只有必填字段完成后启用主动作。

L4：name/role/value、icon accessible name、keyboard focus、无横向 overflow 已检查。
真实 screen reader、Native window、broker/Station 网络、field performance 仍由正式
Acceptance 证明；prototype mock 不构成 runtime 证据。

## Advanced Settings（DUI-15）

产品目标是让设置成为实际能力的操作入口。当前无 Settings module UI ID，
复用 shared UI Identity、固定 section rail 和现有 Settings atoms。主要对象是
当前选中的设置面板；命令结果和错误留在该面板，不创建第二套设置导航。

- `Settings.tsx` 负责导航和规范化控件；`AdvancedSettings.tsx` 只渲染当前面板。
  控件通过组合传入，两个模块之间没有循环 import。
- `advancedSettingsAdapter.ts` 负责浏览器原型的 snapshot、命令结果和订阅；
  Shell 可以注入替代 adapter。面板不导入 Desktop API、kernel、store 或 Tauri。
- 默认 snapshot 没有存储测量、文件、渠道或安装清单。未测量显示
  `Not measured`；零字节只能来自已注入的测量。cache cleanup 必须消费调用方
  提供的完整重测结果，不能由面板估算物理释放量。
- Storage 对齐 `ChatStorageSettings` 的测量、retention 和 cache cleanup；
  My Files 对齐 `MyFilesSettings` 的查询、trash/delete/restore 和到期时间
  keep / `clear_expires_at` / `expires_at` 三态 PATCH。
- Recovery 只表达 encrypted messaging recovery 和 memory export；
  浏览器缺少加密运行时，create/restore 明确禁用，不生成虚假密钥或恢复成功。
  删除了“导出全部消息与设置”的虚构承诺。
- Channels 只管理已交付的 Lark integration，配置字段是 `appId` / `appSecret`。
  凭据只作为 transient command input，不进入 snapshot 或 localStorage。
  删除了 Email、Matrix 和 core messaging 的渠道行。
- Applet settings 消费调用方安装清单与 `settingsPanel`，只挂载选中的 panel；
  不创建自己的六个 applet 或 enable switch。与统一 launcher catalog 的对齐
  仍归 DUI-12。
- Logs 消费注入的 tail projection，支持六类 level、筛选、pause/follow 和只导出
  可见行。尾部订阅与当前 section 同寿命，离开后清理；最多渲染 200 行。
- Cron 使用 cron/interval/once、shell/agent 和 outbound delivery 的字段。
  渠道与目的地必须来自 projection；没有目的地时拒绝保存并保留草稿。
  Run Now 只显示 execution requested / running，不伪造任务执行成功。
- Command Palette 继续打开 Shell 的唯一全局 palette；reset confirmation 通过
  adapter 回到登录/引导。About 显示当前 web package、浏览器平台和 build mode，
  未提供 source commit 时显示 unknown；不展示虚构的 Native runtime/build。
- Statistics 的导航、组件、热图、排行与常量已删除。

Craft contract：继承 Quiet Protocol Minimalism；content rail 是选中的 section，
action rail 是面板 header 与每个对象的操作区，recovery layer 是局部状态消息，
floating layer 继续归 Shell。signature 是能力状态与操作结果保持在同一对象附近。
保留单一 primary action、失败保留输入、可见 disabled reason；拒绝虚构计量、
静态日志、装饰热图和全部面板同时挂载。窄容器按内容宽度重排操作区。

Review scenarios（通过 Prototype Portal 的 Desktop Live Preview）：

```text
?settings-fixture=empty
?settings-fixture=sample
?settings-fixture=failure
?settings-fixture=error
?settings-fixture=loading
```

`sample` 和 `failure` 是显式 QA fixture，数值和日志不表示本机或 Station 状态。
默认路径不加载这些数据。

验证入口：

```bash
python3 packages/prototypes/desktop/features/social-chat/qa/geometry_checks.py \
  --base-url http://localhost:3290 --surface advanced \
  --evidence /tmp/pt-dui15-evidence
```

L2 light evidence：`evidence-l2/20261016-advanced-cron-wide.png`（1440×1000）、
`20261016-advanced-cron-narrow.png`（760×1000）、
`20261016-advanced-files-narrow.png`、
`20261016-advanced-channel-error.png`、
`20261016-advanced-empty-recovery.png`。L3 覆盖 channel create/enable/error retry、
file expiration clear/delete/restore、cron create/pause/run/history、
log visible export/filter recovery、onboarding reset 和 section retry。
L4 覆盖 selected-only tree、bounded logs、name-role-value 和按钮尺寸。
Native storage/recovery/OSS/cron execution、真实读屏器、field performance、
完整 localization 和 DUI-12 catalog 仍为 UNPROVEN。

## Atelier 是容器里的一个 applet

- 左栏 Atelier pin（Blocks 图标）→ 进入 `applet:atelier` → 内容区渲染 `@peers-touch/prototype-desktop-atelier` 的 `AtelierPage`。
- atelier 原型壳由 `height: 100vh` 改为 `height: 100%`，以便自适应嵌入容器内容区。
- 默认落在 `applet:atelier`，直观体现「容器 → applet」从属关系。

## 对应设计

- 容器外壳形态参照真实工程 `apps/desktop`：`src/views/ReadyView.tsx`、`src/components/GlobalLayout.tsx`、`src/components/AppSideNav.tsx`、`src/components/PageRouter.tsx`。
- 设计真源：[runtime/desktop-runtime-architecture.md](../../../platform/client/desktop/runtime.md)、[applet-runtime](../../../platform/applet-runtime/README.md)。
- Atelier applet 设计：[atelier 原型](../../../domains/applets/atelier/prototype/README.md)。

## 总账状态

drafting（见 [原型总账](../README.md)）。

## 已知差异 / 待补

- Search、Chat、Notes 等未覆盖页面仍有占位内容；Agent Profile 已接入整合原型。
- SideNav 用纯 DOM 复刻 LobeUI `<SideNav>` 形态（avatar/topActions/bottomActions），未引入 `@lobehub/ui` 与 antd theme token；视觉为近似，不接真实主题系统。
- 二级侧栏（真实工程 agent 页的 `DraggablePanel`）未复刻。
- 命令面板为 mock 跳转，未接真实快捷键全集与命令注册表。
- applet 进入/退出未做 keep-alive / 生命周期（真实 `PageRouter` 对 agent 页 keep-alive）；原型为简单挂载/卸载。
- Auth 的 provider、Access Gate 和 Station probe 是可交互 scenario fixtures；
  生产权威仍在 OAuth broker、Station Access Gate 与 Native Station registry。
