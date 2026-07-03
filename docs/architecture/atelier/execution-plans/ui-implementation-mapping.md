# Atelier UI/UX ↔ 底层实现映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
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
| [Page.tsx](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx) | 左栏 / 顶栏 / 中栏壳 / composer / RunPicker / 右栏 Todo+Context |
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
| `Task{ id, project, title, status, running, branch }` | `AtelierTask` + `Project` 拆开 | 原型把「项目分组」和「任务」压成一条；`project` 实为 `Project.id`，`branch` 属 Workspace（⚠️ GAP-11 缺 schema） |
| `TaskStatus = active/archived/deleted` | 与 `TaskState`（created…accepted）**正交** | 原型的是**收纳生命周期**（用户整理用），与执行状态机不是一回事，落地需双轨：收纳态 + 执行态 |
| `Block`（user/agent/nego/decision/artifact/diff） | Trace 事件投影 + `CollaborationSession` + `Decision` + `Artifact` 的**渲染投影** | 对话流不是新实体，是上述实体按时间线的只读投影（见 §3 表头说明） |
| `NegoBlock{ voices, converged, consensus }` | `CollaborationSession` + `Round` + `Decision` + `Objection` | `voices[].stance/evidenceRef` 对应 `Objection.evidence_ref` 与赞成票证据 |
| `DecisionBlock{ question, spentSoFar, options, rollbackImpact, chosen }` | `EscalationPayload`（⚠️ GAP-13 未定义）+ 用户裁决回写 | 原型已把升级载荷字段画全，data-model 反而缺这个实体 |
| `Artifact{ kind: markdown/web/image/diff }` | `Artifact{ type, uri, checksum, refs }` | 原型 `kind` 是**预览渲染类型**，正式 `type` 是产物语义类型；需加 `preview_hint` 字段（⚠️ GAP-UI-07） |
| `runKind = model / agents` + `flowId` | `CollaborationTask.engine` + 一个新的「直连模式」旁路 | ⚠️ GAP-UI-01：data-model 无「跳过协作直连单模型」的表达 |

---

## 1. 左栏（任务组织 + 全局导航 + peers footer）

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| Work / Code toggle [Page.tsx#L383](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L383) | 点切换 | 切换默认 Provider 策略偏好（Work=研究/通用，Code=CodingProvider 优先）与默认 plugin | `AtelierTask.provider_strategy`（默认偏好层） | — | — | ⚠️ GAP-UI-02：原型仅视觉态；落地需定义「模式 → provider_strategy 默认值 + gate_plan 默认集」的映射表 |
| New task [Page.tsx#L408](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L408) | 点击 | M13 多元输入 → 起草一个 Project（未契约化） | 新建 `Project{state:draft}` 🅟 原型只建 `Task` | `Project: (none)→draft` | `F-UI-01` | ⚠️ 原型直接建可对话的 Task，跳过了 draft Project；落地新任务=draft Project，首条消息才触发契约化 |
| Skills 入口 [Page.tsx#L412](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L412) | 点击 | 复用框架 Skill 注册表，作为 Provider 能力之一供 Executor 调 | `Provider.capabilities()` | — | 框架 Skill 接入层（M9 复用） | ⚠️ GAP-UI-03：原型未接；落地走 Host Capability Gateway |
| Automation 入口 [Page.tsx#L416](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L416) | 点击 | M12 定时（复用框架 cron）→「定时触发起一个协作会话」模板 | 框架 `domain/cron` 任务 → `CollaborationTask` 模板 | 触发时 `CollaborationSession: →proposing` | 框架 Scheduler（`F-CO-01`/`F-FD-01`） | ✅（复用框架）原型为占位 |
| Your Task List + plugin 切换 [Page.tsx#L422](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L422) | 选 plugin | M-task-org：壳持有数据，plugin 只渲染+委派 | `TaskHost`/`TaskPlugin`（applet 内视图层，不入后端） | — | — | ✅ 已落地；kanban/dag 为占位 |
| TaskRow + ⋯ 菜单（归档/删除/还原/彻底删除） [plugins.tsx#L25](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L25) | 点菜单项 | 收纳生命周期迁移（与执行状态机正交） | 原型 `TaskStatus`；落地需新 `Task.archival_state` | `archival: active↔archived→deleted→(purge)` | — | ⚠️ GAP-UI-04：data-model 无收纳态字段；需补 `Task.archival_state` 且与 `TaskState` 双轨 |
| 任务 running 圆点 [plugins.tsx#L72](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L72) | 系统驱动 | 反映该任务最新 Run 是否 running | `Run.state==running` 的投影 | 读 `RunState` | — | ✅ 投影 |
| 任务 ⎇ 分支标 [plugins.tsx#L71](../../../../packages/prototypes/desktop/applets/atelier/src/plugins.tsx#L71) | 系统驱动 | 该任务绑定的 Workspace/worktree | Workspace.branch（⚠️ GAP-11 缺 schema） | — | `F-PR-05` 工作区/沙箱 | ⚠️ GAP-11：Workspace 实体未定义 |
| peers footer（9 角色头像） [Page.tsx#L435](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L435) | 系统驱动 | M2 九角色权力结构的可视化 | `AgentRole` 枚举（⚠️ GAP-04 未定义） | — | — | ⚠️ GAP-04：data-model 缺 `AgentRole` 枚举；原型已列全 9 角色，回填即可 |

---

## 2. 顶栏（任务上下文 + 协作可见 + 预算闸）

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| 任务标题 [Page.tsx#L470](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L470) | 系统驱动 | 显示当前 Project/Task 目标 | `Project.goal` / `AtelierTask.task_contract` | — | — | ✅ |
| 项目 chip 🗂 [Page.tsx#L471](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L471) | 系统驱动 | 所属 Project | `Project.id` | — | — | ✅ |
| git 分支 ⎇ [Page.tsx#L474](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L474) | 系统驱动 | 绑定 Workspace | Workspace.branch | — | `F-PR-05` | ⚠️ GAP-11 |
| 协作引擎指示（头像簇 + flow 名 + "多 Agent 协作中"） [Page.tsx#L477](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L477) | 系统驱动 | M1 当前生效的协作引擎 + 参与角色 | `CollaborationTask.engine` + `participants` | 读 `CollaborationSession.state` | — | ⚠️ GAP-05：缺 `EngineType` 枚举 |
| 直连指示 "⚡ 直连 {model}" [Page.tsx#L504](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L504) | 系统驱动 | 直连旁路（不起协作会话） | 新「直连模式」标记 | 无 CollaborationSession | 直接 Provider/Model 调用 | ⚠️ GAP-UI-01：直连旁路未在机制层定义（见 §5.6） |
| Open in IDE ↗ [Page.tsx#L510](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L510) | 点击 | 在宿主里打开该任务 Workspace | Workspace.uri | — | Host Gateway | ⚠️ GAP-UI-05：未接 |
| 预算条 + $spent/$cap [Page.tsx#L511](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L511) | 系统驱动（每 Run/Round 结算后刷新） | M7 预算熔断；danger 态=触顶预警 | `Budget{spent, money_cap, token_cap…}` | 触顶 → `escalated`（多状态机，见 §5.4） | — | ✅ 机制有（`F-FD-02`）；原型只读 money 维度，落地需展示多维 |

---

## 3. 中栏对话流 blocks（Atelier 的灵魂可视化）

> 关键认知：对话流**不是一组新实体**，而是 Trace + CollaborationSession + Decision + Artifact 按时间线的**只读渲染投影**。落地时 block 由后端事件流投影生成，前端不持有可变状态（D-02 决策执行分离的直接结果）。

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| UserBubble（含图片 chip） [blocks.tsx#L68](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L68) | 用户发消息 | M13 输入 → 强制走「意图→契约」 | 输入事件 → `CollaborationTask.question` / `Project.goal` | 首条 → `Project: draft→(契约化中)` | `F-UI-01` | ✅ |
| AgentBubble（轻 markdown + bullets） [blocks.tsx#L115](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L115) | 系统驱动 | Agent 文本输出（非状态写） | Trace 事件投影 | — | — | ✅ |
| Completed 标记 ✓ [blocks.tsx#L146](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L146) | 系统驱动 | 任务/里程碑验收通过的对话内反映 | `AtelierTask.state==accepted` 投影 | 读 Task 状态机 `→accepted` | — | ✅ |
| FeedbackBar（👍👎/复制/重新生成） [blocks.tsx#L102](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L102) | 点击 | 👍👎→ M10 记忆候选信号；重新生成→新 Run | `MemoryCandidate`（弱信号）/ 新 `Run` | 重新生成 → `Run: queued`（attempt_no++） | `F-CO-02` | ⚠️ GAP-UI-06：反馈信号→记忆/重跑的链路未在机制层定义 |
| NegoRow 折叠摘要行（👥 + summary + 收敛 Tag + 计数） [blocks.tsx#L159](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L159) | 系统驱动 | M1/M3 一次协作会话的折叠投影 | `CollaborationSession{state, rounds}` | 读 `proposing/converging/reached/escalated` | — | ⚠️ 见下两行 |
| NegoRow 展开：每条 voice（角色 Tag + stance Tag + 文本 + 证据） [blocks.tsx#L190](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L190) | 点开 | M2 角色发言 + M3 反附和（证据约束） | `Round` 内发言；`Objection{by, claim, evidence_ref}` | — | — | ⚠️ GAP-04/05：角色与引擎枚举缺；`Round` 结构 data-model 未展开字段 |
| NegoRow「无证据→降级为疑虑」标 [blocks.tsx#L206](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L206) | 系统驱动 | M3 反附和规则的可视化 | `Objection.evidence_ref==null → 不阻断` | — | — | ✅ 机制有（design §4.1） |
| NegoRow consensus 框 [blocks.tsx#L212](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L212) | 系统驱动 | 收敛产物 | `Decision{outcome, produces}` | `CollaborationSession→reached` | — | ✅ |
| DecisionCard（升级给人：问题/已花成本/回滚影响/选项/推荐） [blocks.tsx#L229](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L229) | 系统驱动弹出 | M7 Escalation Guard 的结构化升级载荷 | `EscalationPayload`（⚠️ GAP-13 未定义） | 触发自 `→escalated` / `awaiting_human` | — | ⚠️ GAP-13：原型字段已全，data-model 缺 `EscalationPayload` 实体 |
| DecisionCard 选项点击 [blocks.tsx#L254](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L254) | 用户裁决 | 人工决策回写 → Core 据此改状态/解熔断/批 replan | 写回裁决 → 触发对应状态机 | `escalated→running` / `awaiting_human→accepted|rejected` | `F-UI-03` | ⚠️ GAP-UI-08：裁决回写到「哪个状态机的哪步」需按升级原因分支（见 §5.3 时序） |
| ArtifactCard（流内产物卡） [blocks.tsx#L284](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L284) | 系统驱动 | M8/M9 产物落账的流内引用 | `Artifact{id, type, produced_at}` + `producedBy`(run/agent 回链) | 读 `Run→succeeded` 必产 Artifact | — | ✅ |
| DiffCard（N files changed +X -Y，可展开路径） [blocks.tsx#L309](../../../../packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L309) | 系统驱动/点开 | CodingProvider 产物 diff.patch 的摘要投影 | `Artifact{type:diff}` | — | `CodingProvider` | ✅ |

---

## 4. composer / RunPicker / Artifacts 托盘 / 右栏

| UI 元素 | 触发动作 | 底层动作 | 数据契约 | 状态转移 | 接口/Provider | 缺口 |
|--------|---------|---------|---------|---------|--------------|------|
| composer 输入 + 发送 [Page.tsx#L540](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L540) | 输入并发送 | M13 输入 → 起 CollaborationTask 或直连 Run | `CollaborationTask.question` / 直连 Run input | 见 §5.1 / §5.6 | `F-UI-01` | ⚠️ 原型未做真实发送+流式 |
| 斜杠命令 `/` [Page.tsx#L549](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L549) | 点击 | 命令面板 → Skill/Provider 能力 | `Provider.capabilities()` | — | 框架 Skill | ⚠️ GAP-UI-03 |
| 图片/附件 `＋` [Page.tsx#L550](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L550) | 点击 | 附件入 input_snapshot | `Run.input_snapshot` | — | Host Gateway（存储） | ⚠️ 未接 |
| RunPicker 触发器（显示当前 model 或 flow） [Page.tsx#L201](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L201) | 系统驱动 | 显示当前 runKind 的目标 | `runKind` + `model`/`flowId` | — | — | ⚠️ GAP-UI-01 |
| RunPicker tab「⚡直接模型」选项 [Page.tsx#L248](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L248) | 选 model/CLI | 直连旁路（跳过协作会话） | 直连模式标记 + model id（CLI 也是 model 形态） | 直接 `Run` 无 Session | 单 Provider/Model（含 trae-cli/claude-code） | ⚠️ GAP-UI-01：直连旁路需机制定义；CLI 作为 model 形态需 `CodingProvider` 适配 |
| RunPicker tab「👥Agents」选项 [Page.tsx#L262](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L262) | 选协作流 | M1 选协作引擎写入会话 | `CollaborationTask.engine`(=flowId) | `CollaborationSession→proposing` | — | ⚠️ GAP-05：`EngineType` 枚举需与 AGENT_FLOWS 6 项对齐 |
| Artifacts 托盘卡片 [preview.tsx#L26](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx#L26) | 系统驱动/点开 | M14 产物集中预览入口 | `Artifact[]`(per task) | — | — | ✅ |
| 产物预览面板：markdown 渲染 [preview.tsx#L202](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx#L202) | 点产物 | M14 markdown 轻渲染 | `Artifact{type, preview_hint:markdown}` | — | — | ⚠️ GAP-UI-07：需 `preview_hint` |
| 产物预览：web `<iframe>` + 地址栏 + Console Logs [preview.tsx#L120](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx#L120) | 点产物 | M14 web 产物内嵌预览 | `Artifact{uri}` + `ConsoleLog[]` | — | 沙箱运行的 web 服务 | ⚠️ Console Logs 落地需 Run 真实日志流（原型为 mock） |
| 产物预览：image / diff [preview.tsx#L208](../../../../packages/prototypes/desktop/applets/atelier/src/preview.tsx#L208) | 点产物 | M14 图片/文件清单预览 | `Artifact{src/paths}` | — | — | ✅ |
| 右栏 Todo 列表 [Page.tsx#L579](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L579) | 系统驱动 | 当前任务的子步骤进度 | TaskGraph 节点状态投影（⚠️ GAP-06） | 读各 Task/Run 态 | — | ⚠️ GAP-06：TaskGraph 结构未定义 |
| 右栏 Context（token 条 + Files/Other） [Page.tsx#L90](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L90) | 系统驱动 | 上下文窗口用量 + 触达文件 | `Run.cost.tokens` / Workspace 触达文件 | — | — | ⚠️ GAP-11（文件来自 Workspace） |

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
**暴露缺口**：GAP-13（EscalationPayload 未定义）、GAP-UI-08（裁决→状态机分支路由表需显式定义）。这是原型已画全、底层最该补的一处。

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
**暴露缺口**：GAP-10（Resume 应前移并与熔断绑定）、GAP-09（Replan 前移）；机制有（design §4.3/§7.3）。

### 5.5 Artifact 产出 → 预览（Run → ArtifactCard/托盘 → 预览面板）

```
Executor 调 Provider → Run: running→succeeded（必产 Artifact）
  → [Core] 收集 Artifact{ type, uri, checksum, refs }
  → [前端] 投影 ArtifactCard（流内）+ 进 Artifacts 托盘
用户点托盘卡片 → 右栏 PreviewPanel 按 preview_hint 渲染：
  markdown→轻渲染 / web→<iframe>+地址栏+Console Logs / image→图 / diff→文件清单
  web 的 Console Logs 来自该 Run 的真实日志流（原型为 mock）
```
**暴露缺口**：GAP-UI-07（Artifact 需 `preview_hint`）、web 预览的 Console Logs 需接 Run 日志流。

### 5.6 直连模型旁路（RunPicker「直接模型」→ 无协作会话）

```
用户在 RunPicker 选「⚡直接模型 / CLI」→ runKind=model
  → composer 发送 → [Workflow] 不起 CollaborationTask，直接：
       Run{ provider=选中model/CLI, input_snapshot } → Run 状态机
  → 仍过 Budget 预扣 + Policy 校验（全局闸不因直连而旁路！）
  → 产 Artifact → 投影 AgentBubble / DiffCard
  注意：直连=跳过「多 Agent 协商」，不=跳过「预算/权限/Trace」三道全局不变量闸
```
**暴露缺口**：GAP-UI-01（直连旁路机制未定义）。**关键纪律**：直连只跳过协作层，不变量 5（预算/权限全局闸）与不变量 6（可追踪）仍必须生效——这点原型未表达，落地必须显式约束。

---

## 6. UI 暴露出的新缺口清单

> [feature-matrix.md](./feature-matrix.md) §3 已列 GAP-01~16（从机制/契约自洽性视角）。下面是**从 UI/UX 反推**新增/强化的缺口，编号 GAP-UI-NN，与原 GAP 不冲突，可一并并入 feature-matrix。

| 编号 | 缺口 | 涉及 UI 元素 | 修法 | 优先级 |
|------|------|------------|------|--------|
| GAP-UI-01 | 「直连单模型/CLI」旁路未在机制层定义 | RunPicker 直接模型 tab、顶栏直连指示 | data-model 加「直连 Run（无 Session）」路径；约束其仍过 Budget/Policy/Trace | P0 |
| GAP-UI-02 | Work/Code 模式 → provider_strategy/gate_plan 默认映射未定 | Work/Code toggle | 定义两套默认 `provider_strategy` + `gate_plan` 预设 | P1 |
| GAP-UI-03 | Skills/斜杠命令未接 Provider 能力层 | Skills 入口、composer `/` | 经 Host Gateway 把 Skill 暴露为 `Provider.capabilities()` | P1 |
| GAP-UI-04 | 收纳生命周期（archived/deleted）与执行状态机正交但 data-model 无字段 | TaskRow ⋯ 菜单 | 补 `Task.archival_state`，与 `TaskState` 双轨 | P1 |
| GAP-UI-05 | Open in IDE 未接 Workspace.uri | Open in IDE | 依赖 GAP-11 Workspace schema | P2 |
| GAP-UI-06 | 反馈（👍👎/重新生成）→ 记忆候选/重跑链路未定义 | FeedbackBar | 定义反馈信号 → MemoryCandidate(弱) / 新 Run(attempt++) | P2 |
| GAP-UI-07 | Artifact 缺 `preview_hint`（预览渲染类型与语义类型分离） | Artifacts 托盘、预览面板 | data-model `Artifact` 加 `preview_hint: markdown/web/image/diff` | P1 |
| GAP-UI-08 | 用户裁决 → 状态机分支路由表未显式定义 | DecisionCard 选项点击 | 按升级原因（§5.3）定义裁决→转移映射表 | P0 |

并入既有缺口（UI 侧再次确认其必要性）：GAP-04（AgentRole）、GAP-05（EngineType）、GAP-06（TaskGraph/MilestoneTree）、GAP-11（Workspace/沙箱）、GAP-13（EscalationPayload）、GAP-09/10（Replan/Resume 前移）。

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
