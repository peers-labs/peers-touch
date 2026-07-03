# Atelier — 原型

> **Status**: draft
> **Version**: v0.4
> **Created**: 2026-06-21 | **Updated**: 2026-07-02
> **落地目标**: Applet（终态跑在 Lynx 上，运行在 peers-touch Desktop 容器内）；**原型本身只是 React + LobeUI 的 web 展示**，不绑运行时
> **总账状态**: drafting（见 [原型总账](../../prototypes/README.md)）
> **Owner**: Peers-Touch Agent Team
> **Module**: `packages/prototypes/desktop/applets/atelier/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/applets/atelier/`（统一原型工作区；独立 web 工程）。本目录只放入口说明，不复制源码（架构文档标准 §5.8）。

这个原型只为**展示 Atelier 终态产品长什么样**，用 React + LobeUI 写成网页给人确认形态；**不碰 Lynx / applet 容器 / SDK**。终态确认后，applet 落地由 `packages/applets/atelier/` 按 Lynx 运行时另行实现。

> **Atelier 本质是 applet，跑在 peers-touch Desktop 容器里**，不是独立全屏 app。容器外壳（全局 SideNav + 内容区 + applet pins）由 [desktop 容器外壳原型](../../desktop/prototype/README.md) 展示；本原型作为 workspace 包 `@peers-touch/prototype-desktop-atelier` 被 desktop 原型作为一个 applet 嵌入其内容区。本原型也可单独跑起来看 Atelier 自身界面（壳子高度自适应，`height: 100%`）。

## 怎么跑

```bash
cd packages/prototypes/desktop/applets/atelier
pnpm install        # 首次，monorepo 根装也可
pnpm dev            # Vite，浏览器打开 localhost
```

技术栈：React + Vite + `@lobehub/ui`(LobeUI) 优先 → antd 兜底 + `react-layout-kit` + `lucide-react` + `@peers-touch/applet-sdk` + CSS。当前入口已具备 **environment runtime bootstrap**：运行在 Lynx / Web Host applet 容器内时，UI 使用 applet-sdk bridge 调 `atelier.*` 真接口；普通浏览器 / Vite 独立预览时自动回退 mock runtime，不依赖 Station。Host 模式不应把 mock seed 当作真实首屏数据；真实 snapshot 返回前只能展示空壳 / loading / error 状态。

## 形态定调：对话优先（SOLO 式），不是团队项目管理

Atelier 是**个人** Agent 工作台，形态对标 TRAE Work / SOLO 的**对话优先**界面，刻意保持简单：左侧任务列表、中间一条对话流、底部一个大输入框；复杂任务时右侧才浮出 Todo 面板。

**不做**传统项目管理那套（项目树 + 看板 + DAG 计划图 + 多 Agent 协作侧栏）——那是给团队的，对个人太重。

Atelier 的灵魂（多 Agent 协商）不另开团队协作面板，而是**内联进对话流**：平时折叠成一行「🤝 N 个 Agent 协商了 X，已收敛」，点开看角色 / 带证据的反对 / 共识；只有需要你拍板时，决策卡才在对话流里冒出来。

## 任务管理是可插拔 plugin

「怎么组织我的任务」做成**可插拔 plugin**：同一份任务数据，换不同的 plugin 就换一种组织 / 展示方式（项目文件夹分组、简单平铺、Kanban、DAG……）。左栏顶部「管理方式」切换器选 plugin。

- **数据归壳子管，plugin 只渲染 + 委派**：壳子（Page）持有任务与生命周期；plugin 通过 `TaskHost`（`select / setStatus / purge / newTask`）回调改状态，不自己存数据。新增看板 / DAG 只需实现 `TaskPlugin.render`，对话流与数据模型不动。
- **默认 plugin = 项目文件夹分组（对齐 SOLO）**：任务按所属项目 / 仓库文件夹（`Task.project`）分组，每组可折叠、各带「+」新建，对齐 SOLO 的 "Your Task List"。简单平铺降为可选 plugin。
- **完整生命周期**：`active → archived → deleted`。进行中可归档 / 删除；归档可恢复 / 删除；删除进回收站可还原或彻底删除（`purge`）。归档段、回收站段作为分组下方可折叠段。
- 看板 / DAG 在切换器里作为「计划中」占位项，证明形态可换、未实现。

接口定义见 `src/types.ts` 的 `TaskHost` / `TaskPlugin`；plugin 实现见 `src/plugins.tsx`。

## SOLO 外壳对齐

以 SOLO 为外壳人体工学的基准线，在其上叠 Atelier 独有的协商 / 决策 / 预算灵魂：

- **左栏**：顶部 Work / Code / Design 模式 toggle（视觉态）+ New task / Skills / Automation 入口 + "Your Task List"（筛选图标 + plugin 切换器）+ 项目文件夹分组；标题行可一键收起侧栏。
- **顶栏**：（侧栏收起时显展开按钮）任务标题 + 项目 chip + git 分支（`Task.branch`）+ 打开文件夹 / 终端 / 大纲图标 + Open in IDE + 预算条。
- **对话流**：轻 markdown（`` `code` `` / **粗体** / 列表）、完成回复带 Completed + 反馈条（赞/踩/复制/重新生成）、"N files changed +X -Y" diff 卡（可展开文件列表）、图片附件 chip、Artifact 卡。
- **Artifacts 托盘 + 产物预览面板**：composer 上方一排 Artifacts 卡片（markdown / web / image / diff，按 kind 配紫色图标）；点卡片在右侧打开**产物预览面板**——markdown 轻渲染、**web 产物用真实 `<iframe>` 内嵌浏览器**（地址栏 + 刷新 + 可折叠 Console Logs 面板按 level 染色）、image 图片预览、diff 文件清单。
- **右栏（三元切换）**：打开产物时为产物预览面板（宽 460）；否则为 Todo + Context（token 用量条 + Files/Other 标签的触达文件）。
- **富输入框**：斜杠命令 / 图片附件 / 模型选择器（openrouter-3o…）/ 发送。语音输入暂不展示。

## Runtime / Projection 接入骨架

原型已从“Page 直接改 mock state”收敛到一个可联调边界：

- `src/runtime.ts` 定义 `AtelierRuntime`，这是 UI 和未来真实后端之间的唯一边界。
- `src/projection.ts` 定义 projection snapshot / patch / method 名称，作为联调数据契约草案。
- `src/bridgeRuntime.ts` 定义 bridge-backed runtime，后续可以接 Station、Tauri command 或 applet-sdk。
- `src/appletBridge.ts` 定义 applet-sdk / Web Host 适配器，把 `sdk.invoke('atelier.*')` 和 host event 转成 `AtelierRuntimeBridge`。
- `src/runtimeBootstrap.ts` 定义入口 runtime 选择：`sdk.runtime === 'lynx' | 'web-host'` 时创建 bridge runtime；`standalone / unavailable` 时回退 `createMockAtelierRuntime()`。
- `createMockAtelierRuntime()` 仍使用 `src/mock.ts` seed 数据，但所有状态变更都通过 runtime 方法发生。
- `src/Page.tsx` 只消费 `AtelierRuntimeSnapshot`，新增任务、发送消息、决策选择、归档 / 删除、模型切换都调用 runtime；如果 runtime 提供 `subscribe`，Page 会订阅 projection 更新。
- 真实联调时，`src/main.tsx` 会通过 `createAtelierRuntimeForEnvironment()` 自动装配 `createBridgeAtelierRuntime()` + `createAppletSdkAtelierBridge(sdk)`，对接已登记的 `atelier.*` runtime methods。
- UI 期望拿到的是 projection snapshot：`TaskList`、`StreamBlock[]`、`TodoProjection`、`ContextProjection`、`ArtifactProjection`、`GateProjection`；不要让 applet 直接解析裸 orchestration event。
- Station 已有第一批真源接口：`POST /sub-agent/agent/atelier/workspace/load` 和 `POST /sub-agent/agent/atelier/project/create-from-goal`。
- Desktop applet gateway 已开放最小 `atelier` capability：`sdk.invoke('atelier.workspace.load', payload)`、`sdk.invoke('atelier.project.createFromGoal', payload)`、`sdk.invoke('atelier.message.send', payload)`、`sdk.invoke('atelier.escalation.resolve', payload)`、`sdk.invoke('atelier.task.setStatus', payload)`、`sdk.invoke('atelier.task.purge', payload)` 和 `sdk.invoke('atelier.events.subscribe', payload)`。
- Projection 增量事件 topic 为 `atelier.projection.event`，Desktop gateway 会把 Station `/agent/events/subscribe` SSE 转成 `AtelierProjectionEvent` 并放入 applet event outbox。

### Projection 契约纪律

当前 projection 仍是联调草案，不是生产稳定协议。为避免 TS / Rust / Go 三边手写结构漂移，后续每次改 projection 字段或 patch kind 必须同步检查：

- TypeScript：`packages/prototypes/desktop/applets/atelier/src/projection.ts`
- Rust Desktop gateway：`apps/desktop/src-tauri/src/application/applets/mod.rs` 中 `station_event_to_atelier_projection_event`
- Go Station projection：`apps/station/app/subserver/agent/service/atelier_projection.go`
- Manifest / capability：`apps/applets/atelier/applet.manifest.json` 与 `packages/applet-contract/src/capability.ts`
- Docs：本文的 Runtime method 与联调约定

在没有 proto / JSON Schema 统一源之前，不能把 `atelier-projection/v0` 宣称为稳定协议；只能宣称“当前三端手写契约已按本轮改动对齐”。下一步应补一个 schema-first 或 contract-test-first 的源头，至少覆盖 snapshot required fields、patch union、event id/seq、snake_case / camelCase 兼容和 capability method 列表。

### Runtime method 草案

| Method | 用途 |
|--------|------|
| `atelier.workspace.load` | 加载当前 workspace projection snapshot |
| `atelier.project.createFromGoal` | 从用户目标创建 Atelier project / task |
| `atelier.message.send` | 向当前 task 追加用户输入 |
| `atelier.escalation.resolve` | 回写决策卡选择 |
| `atelier.task.setStatus` | 更新左栏收纳态：active / archived / deleted |
| `atelier.task.purge` | 彻底删除回收站任务 |

`AtelierRuntime.setModel()` 只更新 composer 本地偏好，不走 Host / Station capability。

### applet-sdk 接入草案

真实 applet 侧不直接 import Desktop `api` 或 Tauri `invoke`，而是把 applet-sdk 的 `sdk` 适配成 `AtelierRuntimeBridge`。当前 `src/main.tsx` 已使用 `src/runtimeBootstrap.ts` 做环境切换，等价于：

```ts
import { sdk } from '@peers-touch/applet-sdk';
import { MOCK } from './mock';
import { createAppletSdkAtelierBridge } from './appletBridge';
import { createBridgeAtelierRuntime } from './bridgeRuntime';
import { toProjectionSnapshot } from './projection';

export const runtime = createBridgeAtelierRuntime({
  bridge: createAppletSdkAtelierBridge(sdk),
  initialSnapshot: toProjectionSnapshot(MOCK),
});
```

联调约定：

- 命令：`sdk.invoke(method, payload)`，其中 `method` 使用上表的 `atelier.*` 点分方法名。
- 启动：Host adapter 为 `lynx` / `web-host` 时走 bridge；`standalone` / `unavailable` 时走 mock，保证 prototype 可以继续独立设计评审。Host 模式的初始 snapshot 必须是空 projection，不允许展示 mock 任务后再被真实数据覆盖。
- 权限：`@peers-touch/applet-contract` 已登记 `atelier.*` capability methods；运行时 manifest 草案位于 `apps/applets/atelier/applet.manifest.json`。
- 订阅：如需自动连接 Station SSE，可通过 URL 参数 `agentId`、可选 `taskId` / `afterEventSeq`，或在页面注入 `window.__ATELIER_PROJECTION_STREAM__`，由 `runtimeBootstrap` 传给 `createAppletSdkAtelierBridge()`。
- 返回：每个命令先返回完整 `AtelierProjectionSnapshot`，保证 UI 能从任意一次操作恢复一致状态。
- 增量：host 通过 `atelier.projection.event` 推送 `AtelierProjectionEvent`，其中 `patch` 使用 `AtelierProjectionPatch`；bridge runtime 会按 event `id` / `seq` 幂等消费，并在 `stream.append` 时按 block `id` 去重，抵御 SSE 重连回放 / outbox 重投。
- 真源：Station / agent orchestration 负责把底层 collaboration task、run、event、artifact、gate、decision 转成 projection；Atelier applet 只消费 projection。
- Artifact / Gate：`block_kind=artifact` 会投影为 `artifact.upsert` 并在 snapshot replay 时还原到 Artifacts 托盘；`block_kind=gate_result` 会投影为 `gate.upsert` 并在 snapshot replay 时还原到 `workspace.gates`。当前完成的是 projection 契约、Station mapper、Desktop SSE mapper 和单测，真实 Artifact/Gate 生产由 orchestration 层后续接入。
- 当前已落地：`atelier.workspace.load`、`atelier.project.createFromGoal`、`atelier.message.send`、`atelier.escalation.resolve`、`atelier.task.setStatus`、`atelier.task.purge`。创建项目要求 payload 显式传 `agentIds` 或 `run.agentIds`，Atelier 不从 `flowId` 猜 Agent。
- 模型选择：`AtelierRuntime.setModel()` 在 mock / bridge runtime 内本地更新 snapshot，不调用 Desktop gateway；后续如需跨设备保存偏好，应单独设计 settings capability，而不是伪造 orchestration 接口。
- `atelier.message.send` 会写入 Station `agent_task_events`，并标记为 `block_kind=user`；snapshot replay 和 `atelier.projection.event` 都会还原为用户消息块。
- `atelier.escalation.resolve` 会写入 Station `agent_task_events`，并标记为 `block_kind=decision_resolved`；snapshot replay 和 `atelier.projection.event` 都会还原为 `decision.resolved` patch。当前只完成选择回写，真实 interrupt/resume 状态机仍待接入。
- `atelier.task.setStatus` 会更新 `CollaborationTask.MetaJSON.atelier_status`，支持 `active / archived / deleted`；`atelier.task.purge` 仅允许删除状态任务，执行后清理 task、nodes、events。
- 当前已落地：`atelier.events.subscribe`，要求 payload 显式传 `agentId`，可选 `taskId` / `afterEventSeq`；订阅后通过 `events.poll` 读取 `atelier.projection.event`。
- 当前不足：Desktop gateway 目前按订阅启动 Station SSE reader，并把事件写入 applet outbox；还没有 session-level subscription registry、Station stream cancel、重复订阅合并、断线重连 / backoff、last-seq cursor 持久化。`events.unsubscribe` 只能退订 applet topic，不能证明 Station SSE 已被取消。
- 仍待落地：真实 interrupt/resume、真实 Artifact/Gate 生产、workspace/task 默认订阅策略、projection schema 统一源、Station SSE 生命周期管理和 Host 端到端联调。

### 下一步落地顺序

按“先静态可验证，后真实联调”的顺序推进：

1. Projection contract guard：建立 schema 或 contract test，固定 `atelier-projection/v0` 的 snapshot、patch union、event id/seq 和 method 列表，防止 TS / Rust / Go 漂移。
2. Desktop subscription lifecycle：为 `atelier.events.subscribe` 增加 session-level registry、重复订阅合并、取消、断线重连 / backoff 和 last-seq cursor。
3. Station replay model：从 raw event page replay 升级为 materialized projection / checkpoint / cursor replay，保证长任务、Artifact、Gate、Decision 可恢复。
4. Orchestration resume：让 `atelier.message.send` 和 `atelier.escalation.resolve` 不只是写 event，而是真正推进或恢复 Agent orchestration runtime。
5. Artifact / Gate production：由 orchestration 层真实产出 `block_kind=artifact` / `block_kind=gate_result`，Atelier 只消费 projection。
6. Official applet bundle：生成真实 `main.lynx.bundle`、写入 manifest integrity，并跑 Desktop Host + Station + applet 端到端验证。

## 对应设计

原型从 [functional-modules.md](../execution-plans/functional-modules.md) §1「产品形态」推导，做到「对话流 + 协商内联可展开 + 内联决策」：

| 原型区域 | 对应设计 | 落地模块 |
|---------|---------|---------|
| 左栏：Work/Code/Design 模式 toggle + New task / Skills / Automation + 管理方式 plugin 切换器（含筛选图标）+ 项目文件夹分组任务列表（进行中带 spinner / 分支图标）+ 侧栏收起 | §1.2 | M11 / M12 |
| 顶栏：（可展开侧栏）任务标题 + 项目 chip + git 分支 + 打开文件夹/终端/大纲图标 + Open in IDE + 预算条（成本熔断可见） | §1.5 | M7 |
| 对话流：用户气泡（含图片附件 chip）+ Atelier 复述目标卡（轻 markdown + 含 L0/L1/L2 验收口径）+ Completed + 反馈条 | §1.3 ① | M5 / M6 / M13 |
| 对话流内联「协商行」：折叠一行 / 展开看角色·带证据反对·折中·共识；无证据反对降级为疑虑 | §1.4 / §2 | M1 / M2 / M3 |
| 对话流内联「决策卡」：升级给人，列选项 + 推荐 + 已花成本 + 回滚影响，点选即推进 | §1.5 | M7 |
| 对话流「diff 卡 / 产物卡」：N files changed +X -Y 可展开文件列表 / 文件名回链到哪步哪个 Agent | §1.4 | M8 / M9 |
| Artifacts 托盘 + 右侧产物预览面板：markdown 渲染 / web 真 iframe 内嵌浏览器（地址栏 + Console Logs）/ image / diff | §1.4 / §1.3 ④ | M14 / M8 |
| 右栏：Todo + Context（token 用量条 + Files/Other 触达文件），与产物预览面板三元切换，仅复杂任务出现 | §1.3 | M5 / M8 |
| 底部富输入框：斜杠命令 / 图片 / 模型选择器 / 发送 | §1.1 | M13 |

数据默认由 `src/mock.ts` seed 驱动，但 UI 已通过 `src/runtime.ts` 的 `AtelierRuntime` 访问 projection snapshot。当前还不接真实后端，下一步联调只替换 runtime 实现。

源码结构（React + LobeUI/antd DOM 组件）：`src/types.ts`（对话流 block 模型 + `Artifact`/`ConsoleLog` 产物模型 + `TaskHost`/`TaskPlugin` 接口）、`src/runtime.ts`（Atelier projection runtime 契约 + mock-backed 默认实现）、`src/theme.ts`（调色板 `C` + 角色色 `ROLE_COLOR` + 立场色 `STANCE`）、`src/mock.ts`（多项目任务含生命周期 + 各任务对话流：协商/决策/diff/产物/图片附件 + 各任务 artifacts：markdown/web/image/diff）、`src/blocks.tsx`（各类 block 渲染：用户气泡含图片 chip / Atelier 含反馈条 / 协商行 / 决策卡 / 产物卡 / diff 卡 + 轻 markdown 内联）、`src/preview.tsx`（Artifacts 托盘 + 产物预览面板：轻 markdown 渲染 / web 真 iframe 内嵌浏览器含地址栏与 Console Logs / image / diff）、`src/plugins.tsx`（管理 plugin：默认 folders 项目分组 + 简单平铺 + 看板/DAG 占位）、`src/Page.tsx`（壳：Work/Code/Design toggle + 左栏导航含折叠/筛选 + plugin 加载 + 顶栏含 Open in 与工具图标 + 对话流 + Artifacts 托盘 + 富输入框 + 右栏 Todo/Context 与产物预览三元切换）、`src/main.tsx`（Vite 入口）。构建配置：`vite.config.ts` / `index.html` / `tsconfig.json`。

## 已知差异 / 待补

- 管理 plugin 默认「项目文件夹分组」+ 可选「简单平铺」可用；看板 / DAG 为切换器占位，未实现 `render`。
- Work/Code/Design 模式 toggle、侧栏折叠/展开、顶栏工具图标已做**视觉态**（Work/Code 不切真实 IDE 模式、工具图标未接真实面板）。
- 产物预览面板：web 产物为**真实 `<iframe>` 内嵌浏览器**（加载 URL，可改地址 / 刷新），Console Logs 为 mock 日志流（未接真实运行时日志）。
- 协商行展开为列表式，未做角色头像/连线的可视化编排。
- 决策卡点选已通过 `AtelierRuntime.resolveDecision` 驱动 projection 更新，但未真正续接后续状态机。
- 富输入框的斜杠命令 / 图片 / 模型选择器为静态外壳；文本发送已进入 mock runtime，未接真实流式回复。
- 真实联调需要把 Station / applet-sdk backed runtime 跑通到真实 Desktop Host，并把 projection snapshot 接到真实 orchestration event。
- 长任务 replay 仍不健全：当前 Station snapshot 按每个 task 加载有限 event page，不能证明长任务完整恢复；后续需要 materialized projection、checkpoint 或 cursor-based replay。
- 正式 applet bundle 未闭合：`apps/applets/atelier/applet.manifest.json` 仍有 `main.lynx.bundle` integrity 占位，未生成可发布 bundle hash。
- 移动端单栏收敛未单独适配（当前布局在窄屏可用但未精修）。
