# Atelier UI/UX ↔ 底层实现映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-07-05
> **Owner**: Peers-Touch Agent Team

---

> **Boundary update (2026-07-02)**: 本文仍沿用早期“机制 / Provider / 状态机”映射语言。当前边界是：Atelier applet 只拥有 UI、projection runtime、task organizer plugin 和 human-in-loop 回写；所有多 Agent 编排、Provider 调度、Gate 执行、Artifact 生产、Trace/Checkpoint/Resume 均由 Station / Agent orchestration 提供真源。表格中的“底层动作 / Provider / 状态转移”应理解为 applet 需要消费或触发的后端 projection/capability，而不是 applet 内部实现。

## 0. 这份文档回答什么

> 「可运行原型里**每一个用户能看见、能点的元素**，点下去底层到底发生了什么？读写哪个数据契约？引起哪个状态转移？走哪个接口 / Provider？现在缺什么？」

[design.md](../design.md) 是「机制 / 引擎 / 状态机」抽象视角，[data-model.md](../data-model.md) 是字段契约视角，[functional-modules.md](./functional-modules.md) 是「模块 + UI 落点」视角。三者都**自顶向下**，但都没有从**具体控件**反推到底层。结果是原型表达的体验（协商行能展开看证据、决策卡升级给人、RunPicker 双 tab 分流、预算条熔断、Artifact 真预览）与底层机制之间隔着一层没写的映射——这正是「设计不够细、离 UI/UX 差距很大」的来源。

本文档补这一层，且**只补这一层**：

- **不**重写机制（机制真源仍是 design.md）。
- **不**重定字段（字段真源仍是 data-model.md）。
- 只做「UI 元素 → 触发动作 → 数据契约 → 状态转移 → 接口/Provider → 缺口」的逐元素桥接，外加几条关键交互的时序图。

### 0.1 锚定原型（UI 一侧的单一事实源）

逐元素清单严格锚定可运行原型源码，不锚定线框草图：

| 原型文件 | 承载的 UI 区域 |
|---------|--------------|
| [Page.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx) | 左栏 / 顶栏 / 中栏壳 / composer / RunPicker / 右栏 TaskGraph projection / legacy Todo fallback + Context |
| [blocks.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx) | 对话流 blocks：UserBubble / AgentBubble / NegoRow / DecisionCard / ArtifactCard / DiffCard |
| [preview.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx) | Artifacts 托盘 + 右侧产物预览面板 |
| [plugins.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx) | 左栏任务组织 plugin（folders / flat / kanban / dag） |
| [types.ts](../../../../packages/prototypes/desktop/applets/atelier/src/types.ts) | 原型态轻契约（与 data-model 正式契约的对照见下表） |

### 0.2 读法与符号

每个区域一张表，列固定为：

- **UI 元素**：原型里的具体控件（带源码锚点）。
- **触发动作**：用户操作 / 系统驱动。
- **底层动作**：落到哪个模块（M1–M14）/ 机制。
- **数据契约**：读写哪个 data-model 实体 · 字段。
- **状态转移**：引起哪个状态机的哪步迁移（无则 `—`）。
- **接口 / Provider**：经哪个接口或 Provider（无则 `—`）。
- **缺口**：当前 data-model / 原型 / 机制缺什么，引 §6 的 GAP-UI 编号。

符号：✅ 三侧（UI/机制/契约）已对齐 ｜ ⚠️ 有缺口（见 §6） ｜ 🅟 原型态轻契约，需在落地时换成正式契约。

### 0.3 原型轻契约 ↔ 正式契约对照（先消歧义）

原型 [types.ts](../../../../packages/prototypes/desktop/applets/atelier/src/types.ts) 为了能跑，用了简化结构。落地时**不直接用 types.ts**，按下表映射回 data-model 正式契约：

| 原型轻契约（types.ts） | 正式契约（data-model.md） | 落差 |
|----------------------|--------------------------|------|
| `Task{ id, project, title, status, running, branch }` | `AtelierTask` + `Project` 拆开 | 原型把「项目分组」和「任务」压成一条；`project` 实为 `Project.id`，`branch` 属 Workspace；Station projection 已产出 `WorkspaceOpenTarget`，Desktop Host 只接受 `atelier.workspace.open` intent，真实 IDE launch / workspace resolver / E2E 未验 |
| `TaskStatus = active/archived/deleted` | 与 `TaskState`（created…accepted）**正交** | 原型的是**收纳生命周期**（用户整理用），与执行状态机不是一回事，落地需双轨：收纳态 + 执行态 |
| `Block`（user/agent/nego/decision/artifact/diff） | Trace 事件投影 + `CollaborationSession` + `Decision` + `Artifact` 的**渲染投影** | 对话流不是新实体，是上述实体按时间线的只读投影（见 §3 表头说明） |
| `NegoBlock{ voices, converged, consensus }` | `CollaborationSession` + `Round` + `Decision` + `Objection` | `voices[].stance/evidenceRef` 对应 `Objection.evidence_ref` 与赞成票证据 |
| `DecisionBlock{ question, spentSoFar, options, rollbackImpact, chosen }` | `EscalationPayload` + `HumanDecisionOption` + `HumanDecisionRoute` | data-model v0.2 已补文档契约；Station blocking gate / supervisor runtime 会生成 typed escalation payload，resolve 侧按 durable payload 路由 |
| `Artifact{ kind: markdown/web/image/diff }` | `Artifact{ type, preview_hint, uri, checksum, refs, body_ref/body_hash/body_size/body_kind, preview_target }` | data-model v0.2 已补 `preview_hint` 与 metadata-only `preview_target` descriptor；P2-04a / F-CO-07a metadata-only projection / official UI 已收敛，P2-07 作为底层 artifact slice 提供 safe text fetch 与 sandbox manifest intent；Station outbox 会从 body metadata 生成 `preview_target.mode=sandbox_manifest` + deterministic `atelier-sandbox://...` ref，Desktop mapper 转为 camelCase；official contract/guard 拒绝 raw `url/src`、正文、html/diff/patch/iframe 泄漏，并拒绝非 `sandbox_manifest`、非 `atelier-sandbox://`、非 `artifact://` 的 `previewTarget`；body 只经 `atelier.artifact.body.fetch` safe text capability，sandbox preview 只经 `atelier.artifact.preview.open` Host intent，并只接收 opaque Host-rendered surface descriptor；Desktop Gateway 发出的 `openAtelierArtifactPreview` UI command 由 Lynx Host 消费并剥离，不进入 applet result；P2-04b / F-CO-07b iframe / image / html 真预览仍待 Host-owned sandbox visual rendering runtime，diff renderer、Console Logs 与 attachment runtime 仍待 Host-owned sandbox runtime |
| `runKind = model / agents` + `flowId` | `CollaborationTask.engine` + `DirectRun` | data-model v0.2 已补 `DirectRun`、`DirectRunCLIHandoff`、`BudgetUsage` 与 `ProviderPricingCatalog`；Station `createFromGoal` 已把 `run.kind=model` 收敛为 Station-owned DirectRun intent guard（必填 `run.model`、禁止 `run.flowId`、拒绝 `execute/run` 形态）；Station execution 已消费 persisted `TaskProviderPlan` 覆盖 `TurnConfig.Provider/Model/Effort` 与 conversation metadata；Station `agent_direct_runs` 已作为 first-class DirectRun persistence record 接入同事务创建和 purge；Station 已新增 typed `TASK_SURFACE_DIRECT_RUN`，并在同事务写入 no-session `TaskRun`、`ExecutionStep(PENDING/STATION_HOSTED)` 与 durable `TASK_CREATED` marker event；DirectRun runtime preflight 已 fail-closed 校验 provider/model/budget/policy/trace refs 与 pending step，recovery 已路由到专用 no-session runtime；Station service-level model provider execution 已写 durable artifact / gate / task status evidence 与 `agent_task_budget_usages` token/money ledger + provider pricing catalog snapshot + provider-reported billing capture，provider-call 前 time budget / token cap / pricing/billed money cap / policy hard deny guard 会阻断并写 interrupt + failed blocking gate；CLI CodingProvider 已收敛为 typed Desktop runtime handoff interrupt，不调用 Station provider executor、不投影 raw CLI command；真实 Desktop worker execution / 真实 Host+Station+applet E2E / 外部 provider billing 填充联调仍未落 |

---

## 1. 左栏（任务组织 + 全局导航 + peers footer）

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| Work / Code / Design toggle [Page.tsx#L383](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L383) | 点切换 | 提交 `intentPreset=work/code/design`，Station 映射声明式 provider/gate 默认值：Work=`station_generalist_research + plan_review_evidence`，Code=`coding_provider_preferred + lint_typecheck_build`，Design=`design_review_preferred + prototype_visual_review` | `AtelierTask.intent_preset` + `provider_strategy_preset` + `gate_plan_preset`（默认偏好层） | — | `atelier.project.createFromGoal` | ✅ controlled：contract 定义 `allowedIntentPresets` + `intentPresetMapping`，official/browser prototype create intent 会提交 preset，Station 投影 metadata；不切真实 IDE mode |
| New task [Page.tsx#L408](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L408) | 点击 | M13 多元输入 → 起草一个 Project（未契约化） | 新建 `Project{state:draft}` 🅟 原型只建 `Task` | `Project: (none)→draft` | `F-UI-01` | ⚠️ 原型直接建可对话的 Task，跳过了 draft Project；落地新任务=draft Project，首条消息才触发契约化 |
| Skills 入口 [Page.tsx#L412](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L412) | 点击 | 复用框架 Skill 注册表，作为 Provider 能力之一供 Executor 调 | `Provider.capabilities()` | — | 框架 Skill 接入层（M9 复用） | ⚠️ GAP-UI-03：原型未接；落地走 Host Capability Gateway |
| Automation 入口 [Page.tsx#L416](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L416) | 点击 | M12 定时（复用框架 cron）→「定时触发起一个协作会话」模板 | 框架 `domain/cron` 任务 → `CollaborationTask` 模板 | 触发时 `CollaborationSession: →proposing` | 框架 Scheduler（`F-CO-01`/`F-FD-01`） | ✅（复用框架）原型为占位 |
| Your Task List + plugin 切换 [Page.tsx#L422](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L422) | 选 plugin | M-task-org：壳持有数据，plugin 只渲染+委派 | `TaskHost`/`TaskPlugin`（applet 内视图层，不入后端） | — | — | ✅ 已落地；kanban/dag 为占位 |
| TaskRow + ⋯ 菜单（归档/删除/还原/彻底删除） [plugins.tsx#L25](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L25) | 点菜单项 | 收纳生命周期迁移（与执行状态机正交） | 原型 `TaskStatus`；data-model v0.2 已补 `AtelierTask.archival_state`；projection contract `taskLifecycle` 机器定义 `active/archived/deleted`、reversible transitions、`purgeRequiresStatus=deleted` 且 `orthogonalTo=execution_state` | `archival: active↔archived→deleted→(purge)` | `atelier.task.setStatus` / `atelier.task.purge` | ✅ Contract/codegen/official/prototype guard 已统一；真实 Station proto/E2E 仍未证明 |
| 任务 running 圆点 [plugins.tsx#L72](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L72) | 系统驱动 | 反映该任务最新 Run 是否 running | `Run.state==running` 的投影 | 读 `RunState` | — | ✅ 投影 |
| 任务 ⎇ 分支标 [plugins.tsx#L71](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L71) | 系统驱动 | 该任务绑定的 Workspace/worktree | Workspace.branch | — | `F-PR-05` 工作区/沙箱 | ⚠️ Station projection 已产出 `WorkspaceOpenTarget`，official/browser guard 与 Desktop Host `atelier.workspace.open` intent handler 已接入；真实 IDE launch、本机 workspace resolver、sandbox runtime 与 E2E 未验 |
| peers footer（9 角色头像） [Page.tsx#L435](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L435) | 系统驱动 | M2 九角色权力结构的可视化 | `AgentRole` 枚举 | — | — | ⚠️ Station CreateTask/provider plan role allowlist + canonicalization service/static done；formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补；EnginePolicy runtime、真实否决/验收 E2E 仍待后续 |

---

## 2. 顶栏（任务上下文 + 协作可见 + 预算闸）

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| 任务标题 [Page.tsx#L470](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L470) | 系统驱动 | 显示当前 Project/Task 目标 | `Project.goal` / `AtelierTask.task_contract` | — | — | ✅ |
| 项目 chip 🗂 [Page.tsx#L471](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L471) | 系统驱动 | 所属 Project | `Project.id` | — | — | ✅ |
| git 分支 ⎇ [Page.tsx#L474](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L474) | 系统驱动 | 绑定 Workspace | Workspace.branch | — | `F-PR-05` | ⚠️ WorkspaceOpenTarget projection + Desktop Host open intent 已接入；真实 IDE launch、本机 resolver、sandbox runtime 与 E2E 未验 |
| 协作引擎指示（头像簇 + flow 名 + "多 Agent 协作中"） [Page.tsx#L477](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L477) | 系统驱动 | M1 当前生效的协作引擎 + 参与角色 | `CollaborationTask.engine` + `participants` | 读 `CollaborationSession.state` | — | ✅ Station facade 已将 prototype `flowId` 映射到 `CollaborationEngineType`；真实 EnginePolicy runtime 未落 |
| 直连指示 "⚡ 直连 {model}" [Page.tsx#L504](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L504) | 系统驱动 | 直连旁路 intent；browser prototype 与 official applet 都提交 `run.kind=model`，不让 applet 直接执行 Provider | `DirectRun` + `TaskProviderPlan.source=atelier.direct_run.intent` + `TASK_SURFACE_DIRECT_RUN` | 目标态无 CollaborationSession；当前实现仍是 task/createFromGoal 入口，execution 会消费 persisted provider plan 覆盖 provider/model/effort，并创建 no-session TaskRun/ExecutionStep marker；DirectRun marker 之后进入专用 no-session runtime，不启动普通 collaboration execution；recovery 会走 DirectRun runtime | Station 决定是否创建 DirectRun 与何时启动 provider | ⚠️ Station-owned intent guard + provider runtime override + DirectRun persistence + no-session lifecycle marker + runtime preflight/recovery split + model provider execution + CLI typed Desktop handoff + Budget/Policy pre-provider-call guard + token/money usage ledger + provider pricing catalog snapshot + provider billing capture/reconciler service-level done；真实 Desktop worker execution、真实 E2E、外部 provider billing 填充联调未落 |
| Open in IDE ↗ [Page.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx) / [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 点击 | P2-10：Applet 只提交 `atelier.workspace.open`，Desktop Host 校验 `pt-workspace://` target 并接受 open intent | `WorkspaceOpenTarget{workspaceUri, workspaceId, label, ideHint}` | — | `atelier.workspace.open` / `workspace.open` | ✅ intent/schema done；真实 IDE launch/E2E 未证明 |
| 预算条 + $spent/$cap [Page.tsx#L511](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L511) | 系统驱动（每 Run/Round 结算后刷新） | M7 预算熔断；danger 态=触顶预警 | `Budget{spent, money_cap, token_cap…}` | 触顶 → `escalated`（多状态机，见 §5.4） | — | ✅ 机制有（`F-FD-02`）；原型只读 money 维度，落地需展示多维 |

---

## 3. 中栏对话流 blocks（Atelier 的灵魂可视化）

> 关键认知：对话流**不是一组新实体**，而是 Trace + CollaborationSession + Decision + Artifact 按时间线的**只读渲染投影**。落地时 block 由后端事件流投影生成，前端不持有可变状态（D-02 决策执行分离的直接结果）。

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| UserBubble（含图片 chip） [blocks.tsx#L68](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L68) | 用户发消息 | M13 输入 → 强制走「意图→契约」 | 输入事件 → `CollaborationTask.question` / `Project.goal` | 首条 → `Project: draft→(契约化中)` | `F-UI-01` | ✅ |
| AgentBubble（轻 markdown + bullets） [blocks.tsx#L115](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L115) | 系统驱动 | Agent 文本输出（非状态写） | Trace 事件投影 | — | — | ✅ |
| Completed 标记 ✓ [blocks.tsx#L146](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L146) | 系统驱动 | 任务/里程碑验收通过的对话内反映 | `AtelierTask.state==accepted` 投影 | 读 Task 状态机 `→accepted` | — | ✅ |
| FeedbackBar（👍👎/复制/重新生成/确认写入记忆/确认重新生成） [blocks.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx) / [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 点击 | P2-09：提交 `atelier.feedback.submit` 到 Station，记录 typed feedback event；👍👎→ memory candidate policy metadata，确认写入记忆→提交 Station-owned memory confirmation intent，重新生成→rerun intent metadata，确认重新生成→提交 Station-owned rerun confirmation intent | `FeedbackSignal` / `MemoryCandidateConfirmation` / `RerunConfirmation` | memory confirm 只确认既有 durable candidate 并由 Station `MemoryService` 写长期 memory；rerun confirm 只确认既有 durable rerun intent 并由 Station/orchestration 创建 new Run task | `atelier.feedback.submit` / `feedback.submit` / `atelier.memory.confirmCandidate` / `memory.confirmCandidate` / `atelier.feedback.confirmRerun` / `feedback.confirmRerun` | ✅ memory confirmation + rerun confirmation service/static gates done；真实 E2E 未证明 |
| NegoRow 折叠摘要行（👥 + summary + 收敛 Tag + 计数） [blocks.tsx#L159](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L159) | 系统驱动 | M1/M3 一次协作会话的折叠投影 | `CollaborationSession{state, rounds}` | 读 `proposing/converging/reached/escalated` | — | ⚠️ 见下两行 |
| NegoRow 展开：每条 voice（角色 Tag + stance Tag + 文本 + 证据） [blocks.tsx#L190](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L190) | 点开 | M2 角色发言 + M3 反附和（证据约束） | `Round` 内发言；`Objection{by, claim, evidence_ref}` | — | — | ⚠️ data-model v0.2 已补角色/引擎枚举；official compact card 会显示剩余 Station negotiation voice 数量；`Round` 字段与 Station 实体仍待落地 |
| NegoRow「无证据→降级为疑虑」标 [blocks.tsx#L206](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L206) | 系统驱动 | M3 反附和规则的可视化 | `Objection.evidence_ref==null → 不阻断` | — | — | ✅ 机制有（design §4.1） |
| NegoRow consensus 框 [blocks.tsx#L212](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L212) | 系统驱动 | 收敛产物 | `Decision{outcome, produces}` | `CollaborationSession→reached` | — | ✅ |
| DecisionCard（升级给人：问题/已花成本/回滚影响/选项/推荐） [blocks.tsx#L229](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L229) | 系统驱动弹出 | M7 Escalation Guard 的结构化升级载荷 | `EscalationPayload` | 触发自 `→escalated` / `awaiting_human` | — | ✅ Station 从 durable pending interrupt payload 读取 reason/options；official compact card 优先保留 recommended/chosen option 并显示剩余 option 数量；真实 E2E 未证明 |
| DecisionCard 选项点击 [blocks.tsx#L254](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L254) | 用户裁决 | 人工决策回写 → Core 据此改状态/解熔断/批 replan | `HumanDecisionRoute` | `escalated→running` / `awaiting_human→accepted|rejected` | `F-UI-03` | ✅ Station `normalizeHumanDecisionRouteTx` 已将 selected option action 路由到 gate recovery / supervisor replan，并拒绝 policy hard deny continue；真实 E2E 未证明 |
| ArtifactCard（流内产物卡） [blocks.tsx#L284](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L284) | 系统驱动 | M8/M9 产物落账的流内引用 | `Artifact{id, type, produced_at}` + `producedBy`(run/agent 回链) | 读 `Run→succeeded` 必产 Artifact | — | ✅ |
| DiffCard（N files changed +X -Y，可展开路径） [blocks.tsx#L309](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L309) | 系统驱动/点开 | CodingProvider 产物 diff.patch 的摘要投影 | `Artifact{type:diff}` | — | `CodingProvider` | ✅ |

---

## 4. composer / RunPicker / Artifacts 托盘 / 右栏

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| composer 输入 + 发送 [Page.tsx#L540](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L540) | 输入并发送 | M13 输入 → 起 CollaborationTask 或直连 Run | `CollaborationTask.question` / 直连 Run input | 见 §5.1 / §5.6 | `F-UI-01` | ⚠️ 原型未做真实发送+流式 |
| Skills / 斜杠命令能力 [Page.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx) / [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 点击 capability | P2-08：Host Gateway → Station 读取只读 Provider capability descriptor；点击只插入 slash command 文本 | `ProviderCapabilitiesResponse{source, capabilities[]}`，`Capability{slashCommand, scope=station-provider, readOnly=true}` | — | `atelier.provider.capabilities` / `provider.capabilities` | ✅ discovery-only；official 与 browser prototype compact list 都显示剩余只读 Station capability 数量；真实 Provider invoke/runtime override/E2E 未证明 |
| 图片/附件 `＋` [Page.tsx#L550](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L550) | 点击 | 附件入 input_snapshot | `Run.input_snapshot` | — | Host Gateway（存储） | ⚠️ UI/Host upload 未接；browser prototype composer 已显示 `Attachment input is prototype-only`，official composer 仍 disclosure-only；Station DirectRun input_snapshot attachment shape guard 已补，只接受 `host-storage://...` opaque ref + mime/size/sha256 metadata，拒绝 raw path/url/base64/body/write intent |
| RunPicker 触发器（显示当前 model 或 flow） [Page.tsx#L201](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L201) | 系统驱动 | 显示当前 runKind 的目标 | `runKind` + `model`/`flowId` | — | — | ⚠️ GAP-UI-01 |
| RunPicker tab「⚡直接模型」选项 [Page.tsx#L248](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L248) | 选 model/CLI | 提交 Station-owned DirectRun intent；禁止 applet 携带 Provider 执行形态 | `run.kind=model` + `run.model`，禁止 `run.flowId` | 目标态直接 `Run` 无 Session；当前通过 task/createFromGoal 入口执行，runtime 已消费 provider plan override | 单 Provider/Model（含 trae-cli/claude-code）由 Station 路由 | ⚠️ GAP-UI-01：intent guard + provider/model/effort runtime override、DirectRun no-session runtime、CLI typed Desktop handoff service-level done；真实 Desktop worker execution 与 E2E 未落 |
| RunPicker tab「👥Agents」选项 [Page.tsx#L262](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L262) | 选协作流 | M1 选协作引擎写入会话 | `CollaborationTask.engine`(=flowId) | `CollaborationSession→proposing` | — | ✅ GAP-05：Station `atelierEngineTypeFromFlowID` 已与 AGENT_FLOWS 六项对齐并拒绝未知 flow；真实 EnginePolicy runtime 未落 |
| Artifacts 托盘卡片 [preview.tsx#L26](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx#L26) | 系统驱动/点开 | M14 产物集中预览入口 | `Artifact[]`(per task) | — | — | ✅ official compact tray 会显示剩余 Station artifact projection 数量，避免静默截断 metadata |
| 产物预览面板：metadata-only [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 点产物 | M14 安全预览入口 | `Artifact{preview_hint, body_ref/body_hash/body_size/body_kind, previewTarget}` | `artifact.upsert` | Station projection / Desktop mapper / Host capability | ✅ P2-04a / F-CO-07a metadata-only parity：P2-07 底层 artifact slice 提供 safe text fetch + sandbox preview Host intent；official 不直接渲染正文；official SafeTextPreview 只本地展开前 80 行并显示 hidden safe text line disclosure；official Artifacts 面板折叠时显示剩余 projection 数量，preview paths 折叠时显示剩余 Station artifact path refs；P2-04b / F-CO-07b rich renderer / Console Logs / attachment runtime 仍 pending Host runtime/E2E |
| Gates 面板：gate/check/artifact evidence projection [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 系统驱动 | M14 验收证据只读观察入口 | `Gate{summary, checks[], artifactIds[]}` | `gate.upsert` | Station projection / GateResult index | ✅ official compact Gates 面板会显示剩余 Station gate projection、gate checks 与 artifact evidence refs 数量；不执行 gate、不读取 raw artifact body |
| Browser prototype 产物预览：metadata-only [preview.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx) | 点产物 | M14 安全预览入口 | `Artifact{previewHint, bodyRef, bodyHash, bodySize, bodyKind, previewTarget, paths, logs, size}` | — | Host safe text fetch / Host sandbox preview intent | ✅ browser prototype 已移除 raw markdown / iframe / image / URL / src render branch，只展示 `ArtifactMetadataPreview`、paths metadata、prototype-only mock logs disclosure、Host safe text fetch 与 Host sandbox preview intent；不读取 `markdown/content/diff/url/src` raw projection fields |
| Host-owned rich renderer / Console Logs / attachment runtime | 点产物 / Run stream / 附件输入 | M14 rich sandbox runtime | Host-owned artifact sandbox manifest + Run runtime log stream + Host Storage attachment refs | — | Desktop Host / Station runtime | ⚠️ web iframe/image/html/diff renderer、Console Logs 真实 Run runtime stream、attachment upload / Host Storage runtime 仍 pending Host runtime/E2E；Applet 与 browser prototype 都不接 renderer、不读 raw body、不上传附件、不执行 provider/run/shell |
| 右栏 Project Health projection [Page.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx) / [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 系统驱动 | 当前 project 的只读 completion / blocker / residual risk / milestone / memory candidate / policy rule / defect projection | `workspace.projects[].completion/openBlockers/residualRisks/milestoneTree/milestones[].acceptancePredicateIds/openBlockers/memoryCandidates/policy/defects` | 读 Station-owned Project/Milestone/Acceptance/Memory/Policy/Defect projection；不验收、不豁免、不修改 project state、不写 memory、不治理 defect | — | ✅ browser prototype 与 official Lynx applet 已展示 Project Health projection；blocker/risk/milestone/memory candidate/policy rule/defect 紧凑列表显示剩余 projection 数量；milestone 行显示 Station projected `acceptancePredicateIds` 与 milestone-local `openBlockers` refs，并显示剩余 ref 数量；⚠️ 完整 Project/Milestone runtime、AcceptancePredicate DSL、memory write、Policy engine、Defect governance lifecycle 与真实 E2E 仍未验证 |
| 右栏 TaskGraph projection [Page.tsx#L109](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L109) / legacy Todo fallback [Page.tsx#L938](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L938) | 系统驱动 | 当前 project 的只读 TaskGraph 节点进度、node evidence refs、root ids、dependency edges 与 parallel policy；无 project projection 时回退 legacy Todo | `workspace.projects[].taskGraph.tasks[]` + `workspace.projects[].taskGraph.tasks[].artifactIds/gateIds` + `workspace.projects[].taskGraph.rootTaskIds[]` + `workspace.projects[].taskGraph.edges[]` + `workspace.projects[].taskGraph.parallelPolicy` + `Task.projectId` / selected node id；legacy `TodoProjection` fallback | 读 Station-owned Project/TaskGraph projection；不调度、不执行、不重排节点；不生产 artifact/gate；`integrator_required` 只披露 Station-owned integrator policy，不执行合并 | — | ✅ browser prototype 与 official Lynx applet 已消费现有 TaskGraph projection；browser prototype 保留 `workspace.projects` roundtrip，official controller 派生 `selectedProject` 并由 `atelier:official-frontend-gate` 固定只读边界；official/prototype 均展示 `parallelPolicy`、`rootTaskIds`、`edges` 与 node-level `artifactIds/gateIds`，紧凑列表显示剩余 root / edge / node / node evidence ref projection 数量；`integrator_required` 时披露 integrator identity 与 merge execution 仍归 Station；official legacy Todo fallback 也显示剩余 legacy todo projection 数量，避免静默隐藏投影；⚠️ 真实 TaskGraph production/runtime/E2E、真实 artifact/gate production、真实 Integrator merge runtime 与 legacy Todo 真源迁移仍未验证 |
| 右栏 Context（token 条 + Files/Other） [Page.tsx#L90](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L90) / [official frontend](../../../../apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx) | 系统驱动 | 上下文窗口用量 + 触达文件 | `Run.cost.tokens` / Workspace 触达文件 | — | Station projection / Workspace file discovery | ⚠️ GAP-11 文件发现真源仍待 Workspace/Run input snapshot E2E；✅ official compact Context 面板会显示剩余 Station context file refs，避免静默截断 metadata |

---

## 5. 关键交互时序

> 逐元素表说明「点这个→碰那个」，时序图说明「一串元素如何串成一次完整闭环」。每条时序末尾标它暴露的缺口。

### 5.1 提目标 → 协商 → 契约（UserBubble → NegoRow → AgentBubble）

```
用户在 composer 输入目标 + 发送（runKind=agents）
  → [前端] 投影一条 UserBubble
  → [Workflow] 起 CollaborationTask{ question=目标, engine=flowId, authority=GoalOwner }
  → [Collaboration] CollaborationSession: proposing
       Planner 提案 / Risk 标风险 / Verifier 反推 acceptance（每条标 L0/L1/L2）
       每条发言 → 一条 Round 记录；反对须带 evidence_ref（无则降级疑虑）
  → [前端] 投影 NegoRow（折叠摘要；展开见 voices + 证据）
  → CollaborationSession: converging → reached（authority_signoff && 无带证据未决反对）
  → [Collaboration] 产出 Decision{ produces: ProjectContract }
  → [Core] 消费 Decision，写 Project.contract，Project: draft→contracted（Goal Owner 签字）
  → [前端] 投影 AgentBubble（复述目标/非目标/验收清单，每条带 🟢/🟡 级别）
```
**暴露缺口**：GAP-04（AgentRole）、GAP-05（EngineType）、GAP-06（contract.acceptance 已有但 TaskGraph 未定）、`Round` 字段需在 data-model 展开。

### 5.2 协商收敛与反附和（NegoRow 展开态）

```
Round N：某 Agent 投赞成票
  → 有 evidence_ref ? 计入「无未决反对」判定 : 不计入（反附和）
某 Agent 反对
  → 有 evidence_ref ? 记为 open Objection（阻断 reached) : 降级「疑虑」（记录不阻断）
  → [前端] NegoRow 对应行显「证据：…」或「无证据→降级为疑虑」
判定 reached 充要：authority_signoff==true AND open_objections(unresolved && has_evidence)==0
  rounds 达 max_rounds 仍未 reached → CollaborationSession: →escalated（带分歧快照）
       → 触发 DecisionCard（见 §5.3）
```
**暴露缺口**：✅ 机制完整（design §4.1）；UI 已表达；仅 `Round`/`Objection` 需正式落 proto。

### 5.3 决策升级回写（DecisionCard → 按升级原因分支改状态）

```
升级源（任一）→ 组装 EscalationPayload{ 问题, 各方 evidence, 已花成本, 选项, 推荐, 回滚影响 }
  → [前端] 投影 DecisionCard
用户点选项 → [Core] 按升级原因分支回写：
  · 共识不收敛(max_rounds)   → 采纳某方案 → CollaborationSession 重开/直接产 Decision
  · L2 验收点               → Task: awaiting_human → accepted | rejected
  · 预算触顶                → 调 Budget + （resume/缩范围/放弃）→ 见 §5.4
  · Risk 硬否决/危险动作     → 仅「确认执行 ActionProvider」或「放弃」，Risk 否决不可被覆盖
  · 目标冲突                → 改 ProjectContract → 重新 contracted
```
**暴露缺口**：GAP-13 / GAP-UI-08 已在 `data-model.md` v0.2 补为文档契约；Station blocking gate / supervisor runtime payload generation 与裁决路由已接入 durable pending interrupt payload 和既有 gate recovery / supervisor replan primitives，剩余是真实恢复/复跑 E2E。

### 5.4 预算熔断 + 断点恢复（预算条 danger → DecisionCard → resume）

```
每个 Run/Round 执行前预扣、执行后结算 → 刷新顶栏预算条
  Budget 任一维度触顶 → 该层 Circuit Breaker 熔断
  → running Run 全部 cancelled、状态落盘（input_snapshot 保留）
  → 组装 EscalationPayload{ 已花$X, 已 accepted 锚点, 卡点, 选项=[缩范围/提预算/放弃] }
  → DecisionCard
用户选「缩范围+提预算」→ 更新 Budget + Replan 卡点子图
  → Project resume from 最近 accepted milestone（已 accepted 产物复用，不重跑）
```
**暴露缺口**：GAP-10 / GAP-09 已在 roadmap 前移并与 B6 熔断 / B9.5 supervisor replan 绑定；Station `resume_anchor_policy=LATEST_ACCEPTED_CHECKPOINT`、`supervisor_replan` interrupt 与 `atelier.task_graph_diff/v0` apply service/static evidence 已落。剩余缺口是真实跨重启恢复、真实运行时 replan 与 Host+Station+applet E2E。

### 5.5 Artifact 产出 → 预览（Run → ArtifactCard/托盘 → 预览面板）

```
Executor 调 Provider → Run: running→succeeded（必产 Artifact）
  → [Core] 收集 Artifact{ type, uri, checksum, refs }
  → [前端] 投影 ArtifactCard（流内）+ 进 Artifacts 托盘
用户点托盘卡片 → official 右栏 PreviewPanel 先按 preview_hint 展示 metadata-only：
  previewHint/bodyRef/bodyHash/bodySize/bodyKind/previewTarget + paths/size 文本
  不加载 artifact body，不 iframe，不 img，不外部 URL
safe text body 只能通过 atelier.artifact.body.fetch 显式拉取；
previewTarget 是 Station 生成或清洗后的 metadata-only descriptor；sandbox_manifest 可经 `atelier.artifact.preview.open` 提交给 Host runtime，当前返回 accepted/opened + rendered Host surface descriptor（`desktop_host` / `host_sandbox_manifest` / `rendered`，capabilities 含 `host_visual_renderer_surface`），并通过 Lynx Host 消费 `openAtelierArtifactPreview` UI side-effect
未来 sandbox preview capability 落地后才按 preview_hint 扩展：
  markdown→轻渲染 / web→sandbox preview + Console Logs / image→图 / diff→文件清单
```
**暴露缺口**：GAP-UI-07 拆为 P2-04a / P2-04b。P2-04a metadata-only projection parity 已落：metadata-only + safe text body fetch + Station-generated previewTarget sandbox_manifest metadata + Host preview open intent + opaque rendered surface descriptor + Host UI command handoff/stripping。P2-04b 仍 pending：web iframe/image/html/diff 真渲染、web Console Logs、attachment upload / Host Storage 需接 Host-owned sandbox visual rendering runtime 与 Run 真实日志流；Applet 不接 renderer、不读 raw body、不执行 provider/run/shell。

### 5.6 直连模型旁路（RunPicker「直接模型」→ 无协作会话）

```
用户在 RunPicker 选「⚡直接模型 / CLI」→ runKind=model
  → createFromGoal 只提交 Station-owned intent：
       { run.kind=model, run.model=选中model/CLI }；禁止 run.flowId / invoke / execute / run / shell / file
  → [Station] 校验 intent 并记录 TaskProviderPlan.source=atelier.direct_run.intent
  → [Station] execution 从 agent_task_provider_plans.plan_json 读取 provider spec，覆盖 TurnConfig.Provider/Model/Effort
    → [Station] 同事务创建：
       DirectRun{ provider=选中model/CLI, input_snapshot, budget_ref, policy_ref, trace_id }
       TaskRun{ surface=TASK_SURFACE_DIRECT_RUN, conversation_id="" }
       ExecutionStep{ status=PENDING, eligible_executor=STATION_HOSTED }
       TASK_CREATED durable marker event
    → 目标态由 Station 进一步接入真实 provider execution：
       DirectRun provider runtime → Run 状态机
  → 仍过 Budget 预扣 + Policy 校验（全局闸不因直连而旁路！）
  → 产 Artifact → 投影 AgentBubble / DiffCard
  注意：直连=跳过「多 Agent 协商」，不=跳过「预算/权限/Trace」三道全局不变量闸
```
**当前证据**：contract JSON 声明 `allowedRunKinds=[agents,model]` 与 `directRunIntent`；official frontend 在 selected model 分支提交 `run.kind=model` 且不携带 `run.flowId`；Station `validateAtelierRunTarget` 要求 model intent 必填 `run.model`、禁止 `run.flowId`，并把 provider plan source 标为 `atelier.direct_run.intent`；Station execution 的 `loadRuntimeProviderOverrideForNode` 会从 persisted `TaskProviderPlan` 读取 `provider_id/model/reasoning_effort` 并覆盖 `TurnConfig` 与 conversation metadata；Station `directRunRecordFromProviderPlan` 会从 DirectRun provider plan 创建 `agent_direct_runs`，保存 `input_snapshot_json / budget_ref / policy_ref / trace_id`；`model/domain/agent/orchestration.proto` 已定义 `TASK_SURFACE_DIRECT_RUN`，Station `directRunLifecycleRecordsFromProviderPlan` 会创建 `ConversationID=""` 的 `TaskRun`、`PENDING` 的 Station-hosted `ExecutionStep`，并通过 `TaskEventWriter.appendTx` 写 durable `TASK_CREATED` marker event；DirectRun marker path 不调用普通 create `startTaskExecution`；`validateDirectRunRuntimePreflight` 会 fail-closed 校验 provider/model/budget/policy/trace refs、no-session TaskRun、pending step 与 Station-hosted executor；`recoverRunningTasks` 会通过 `isDirectRunTaskForRecovery` 把 DirectRun 交给 `startDirectRunExecution`；`executePendingDirectRun` 会先执行 Budget/Policy preflight，time budget exceeded、token/money usage 已达 cap 或 policy hard deny 会在 provider call 前转为 paused + pending interrupt + failed blocking gate；通过 preflight 后调用内部 provider executor，成功写 durable artifact、step completed、gate result、task status 与 `agent_task_budget_usages` token/money ledger + provider pricing catalog/legacy pricing snapshot；`ProviderCallResponse.BilledMoney/BillingSource` 存在时，Station 同账记录 `estimated_money/provider_billed_money/provider_billing_source`，以 provider-reported billed money 作为 effective `used_money`，`BudgetUsageReconciler` 可检查 catalog expected 与 billed actual mismatch，并把无 pricing/无 billing evidence 的 token usage 标为 missing pricing；失败写 failure artifact。CLI provider 在 provider call 前转为 `direct_run_desktop_coding_provider_handoff` typed interrupt + failed blocking gate，payload 带 `adapter=desktop_coding_provider` / `handoff_owner=desktop_runtime` / `executor_kind=EXECUTOR_KIND_DESKTOP_DEVICE` / `requested_capabilities=[cli]` / `cli_command_ref=agent_provider.cli_command`，不调用 Station provider executor，也不投影 raw CLI command。
**暴露缺口**：GAP-UI-01 已在 `data-model.md` v0.2 补为 `DirectRun` / `DirectRunCLIHandoff` / `BudgetUsage` / `ProviderPricingCatalog` 文档契约，且当前已有 Station-owned intent guard、provider runtime override、DirectRun persistence record、no-session lifecycle marker、runtime preflight、recovery split、model-provider execution、CLI typed Desktop handoff、Budget/Policy pre-provider-call guard、token/money usage ledger、provider pricing catalog snapshot、provider billing capture 与 pricing/billing reconciler service-level slice。**关键纪律**：直连只跳过协作
层，不变量 5（预算/权限全局闸）与不变量 6（可追踪）仍必须生效；剩余是真实 Desktop worker execution、真实 Host+Station+applet E2E、外部 provider billing 填充联调与真实 provider/live stream 验证。

---

## 6. UI 暴露出的新缺口清单

> [feature-matrix.md](./feature-matrix.md) §3 已列 GAP-01~16（从机制/契约自洽性视角）。下面是**从 UI/UX 反推**新增/强化的缺口，编号 GAP-UI-NN，与原 GAP 不冲突，可一并并入 feature-matrix。

| 编号 | 缺口 | 涉及 UI 元素 | 修法 | 优先级 |
|------|------|------------|------|--------|
| GAP-UI-01 | 「直连单模型/CLI」旁路未在机制层定义 | RunPicker 直接模型 tab、顶栏直连指示 | ✅ `data-model.md` v0.2 已补 `DirectRun` / `DirectRunCLIHandoff` / `BudgetUsage` / `ProviderPricingCatalog`；Station `createFromGoal` 已落 intent guard：`run.kind=model` 必须带 `run.model`、不得带 `run.flowId`，contract 禁止 applet 提交 `invoke/execute/run/shell/file` 形态；Station execution 已消费 persisted `TaskProviderPlan` 覆盖 provider/model/effort；`agent_direct_runs` 已作为 first-class DirectRun persistence record；`TASK_SURFACE_DIRECT_RUN` + no-session `TaskRun` / `ExecutionStep(PENDING)` / durable `TASK_CREATED` marker 已接入 service-level；runtime preflight 与 recovery split 已接入，model provider execution、CLI typed Desktop handoff、Budget/Policy pre-provider-call guard、token/money usage ledger、provider pricing catalog snapshot、provider billing capture 与 pricing/billing reconciler 已在 Station service-level 产出 durable artifact/gate/status/interrupt/budget evidence。待真实 Desktop worker execution、真实 E2E、外部 provider billing 填充联调 | P0 |
| GAP-UI-02 | Work/Code/Design 模式 → provider_strategy/gate_plan 默认映射未定 | Work/Code/Design toggle | ✅ 已定义 `work/code/design` → `provider_strategy_preset` + `gate_plan_preset` 声明式映射，official/browser prototype 提交 intentPreset，Station 投影 metadata；真实 IDE mode / provider execution E2E 未证明 | P1 |
| GAP-UI-03 | Skills/斜杠命令未接 Provider 能力层 | Skills 入口、composer `/` | ✅ P2-08 已接 discovery-only：Station 暴露 `ProviderCapabilitiesResponse`，Desktop Gateway 映射 `provider.capabilities`，official/browser prototype 只展示并插入 slash command；不暴露 `invoke/execute/run`，真实 Provider runtime override/E2E 未证明 | P1 |
| GAP-UI-04 | 收纳生命周期（archived/deleted）与执行状态机正交 | TaskRow ⋯ 菜单 | ✅ `data-model.md` v0.2 已补 `AtelierTask.archival_state`，与 `TaskState` 双轨；projection contract `taskLifecycle` 已机器化 lifecycle states / reversible transitions / purge precondition，codegen 导出 `ATELIER_TASK_LIFECYCLE_STATES`，official/prototype guard 从同一契约读取；真实 Station proto/E2E 仍未证明 | P1 |
| GAP-UI-05 | Open in IDE 未接 Workspace.uri | Open in IDE | ✅ P2-10 已接 WorkspaceOpenTarget + `atelier.workspace.open` intent：Station projection 只给 `pt-workspace://` target，Desktop Gateway 校验 schema；真实本机 IDE launch 与 E2E 未证明 | P2 |
| GAP-UI-06 | 反馈（👍👎/重新生成）→ 记忆候选/重跑链路未定义 | FeedbackBar | ✅ P2-09 已定义并接入 feedback intent、memory confirmation intent 与 rerun confirmation intent：Applet 只提交 `atelier.feedback.submit` / `atelier.memory.confirmCandidate` / `atelier.feedback.confirmRerun`，Station 记录 `TASK_EVENT_TYPE_FEEDBACK_RECORDED` 与 memory/rerun policy metadata；长期 memory write 由 Station 校验 durable candidate 后调用 `MemoryService`；new Run 由 Station/orchestration 校验 durable rerun intent 后创建；真实 Desktop Host + Station + applet E2E 未证明 | P2 |
| GAP-UI-07 | Artifact `preview_hint`（预览渲染类型与语义类型分离） | Artifacts 托盘、预览面板 | ✅ P2-04a / F-CO-07a metadata-only projection parity 已落：P2-07 底层 artifact slice 提供 safe text fetch + Station-generated previewTarget sandbox_manifest metadata + Host preview.open intent + opaque rendered surface descriptor + Host UI command handoff/stripping + Desktop Host adapter session recording；data-model / contract schema-codegen / official guard/render 已支持 `preview_hint`、body metadata 与 metadata-only `previewTarget`；Station writer/projection 与 Desktop mapper 生成/转发 `sandboxRef/bodyRef` metadata；official projection contract/guard 拒绝 raw `url/src`、正文、html/diff/patch/iframe 泄漏，并已收紧为只接受 `previewTarget.mode=sandbox_manifest`、`sandboxRef=atelier-sandbox://...`、`bodyRef=artifact://...`；previewTarget 仅 metadata-only，`atelier.artifact.preview.open` 只提交 Host-owned sandbox manifest intent并返回 `desktop_host/host_sandbox_manifest/rendered` 状态与 `host_visual_renderer_surface` capability，Desktop Gateway 的 `openAtelierArtifactPreview` side-effect 由 Lynx Host 消费并从 applet result 剥离，Desktop Host adapter 校验 `atelier-sandbox://` / `artifact://` / `desktop_host` / `host_sandbox_manifest` 并拒绝 raw render fields，不赋予 applet iframe/image/html 执行权；Host sandbox console capture controlled gate 已补，可规范化 `host_sandbox_cdp` log/warn/error evidence，但不证明真实 Run runtime stream；Station DirectRun input_snapshot attachment shape guard 已补，只接受 Host-owned opaque attachment metadata。⚠️ P2-04b / F-CO-07b 仍 pending Host runtime/E2E：web iframe/image/html/diff renderer、Console Logs 真实 Run runtime stream、attachment upload / Host Storage runtime；Applet 不接 renderer、不读 raw body、不上传附件、不执行 provider/run/shell | P2 |
| GAP-UI-08 | 用户裁决 → 状态机分支路由表未显式定义 | DecisionCard 选项点击 | ✅ `data-model.md` v0.2 已补 `EscalationPayload` / `HumanDecisionOption` / `HumanDecisionRoute` 表；Station blocking gate / supervisor runtime 会生成 typed escalation payload，route normalization 复用 gate recovery / supervisor replan primitives，policy hard deny 不可被 GoalOwner 覆盖；真实 E2E 未证明 | P0 |

并入既有缺口（UI 侧再次确认其必要性）：GAP-04/05 已有 Station role/engine service-static evidence，GAP-06/GAP-11/GAP-13/GAP-09/GAP-10 已从“缺 schema/需前移”收敛为 projection/service-static evidence 已落；剩余是 TaskGraph/Milestone/Workspace/Escalation/Replan/Resume 的真实 runtime/E2E 验证。

---

## 7. 与其他文档的关系

- **UI 一侧真源**：可运行原型 [prototype/](../prototype/)，源码 `packages/prototypes/desktop/applets/atelier/src/`。
- **机制真源**：[design.md](../design.md)（§3 引擎/§4 六机制/§5 Provider·Gate·Artifact·Memory）。
- **字段真源**：[data-model.md](../data-model.md)（§1 契约/§2 状态机/§3 完成谓词）。本文档的 §3.0.3 与 §6 给出了 UI 反推的字段补全清单，应回写到 data-model 与 [feature-matrix.md](./feature-matrix.md)。
- **模块视角**：[functional-modules.md](./functional-modules.md)（§1.3 四种面孔、各 M 的 UI 落点）。本文档是其「UI 落点」的逐元素细化。
- **决策依据**：[decisions.md](../decisions.md)（D-02 决策执行分离 → 对话流是只读投影的根因；D-03 共识 → NegoRow；D-04 预算 → 预算条；D-08 Replan/Resume → §5.4）。

---

## Sources

- UI 一侧：`packages/prototypes/desktop/applets/atelier/src/{Page,blocks,preview,plugins,types}.tsx/.ts`
- 机制一侧：[design.md](../design.md) §3–§5
- 字段一侧：[data-model.md](../data-model.md) §1–§3
- 缺口对齐：[feature-matrix.md](./feature-matrix.md) §3
