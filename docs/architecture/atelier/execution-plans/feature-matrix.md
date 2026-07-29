# Atelier 功能点对齐矩阵

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-07-05
> **Owner**: Peers-Touch Agent Team

---

> **Boundary update (2026-07-02)**: 本表保留早期功能域名称（如 Atelier Core、Provider、Gate）。当前执行口径是：这些域中的事务状态、编排、Provider、Gate、Artifact、Trace/Resume 属于 Station / Agent orchestration；Atelier applet 只承担 projection surface、runtime bridge、task organizer 和 human-in-loop capability 回写。后续重排功能点时，应把表中 F-CO/F-PR/F-GT/F-CL 拆到 Agent / Station 功能域，Atelier 只保留工作台投影域。

## 0. 怎么用这张表

- 这是全部功能点的**单一清单**，每条有稳定编号（F-XX-NN），后续讨论/排期/落地都引用编号。
- 三个对齐列分别指向：[design.md](../design.md) 章节、[data-model.md](../data-model.md) 章节、[roadmap.md](./roadmap.md) 积木。
- **状态**：✅ 三处一致；⚠️ 有缺口/错位（在 §3 列明）；空 = 该列本就不该覆盖。
- 本表是「对齐用」的活文档；每次改动功能点，先改这里，再改对应文档。

---

## 1. 功能点清单（按域）

### A. Foundation 横切设施（F-FD）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-FD-01 | Trace 全链路追踪 | §1.6, §2 | §2(不变量), §4 | B0 | ✅ |
| F-FD-02 | Budget / Circuit Breaker 预算熔断 | §4.3 | §1.5 Budget | B6 | ✅ |
| F-FD-03 | Policy 引擎 | §4.6, §3.2 | §1.5(Policy) / formal proto / Station projection | B7 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station Policy/Defect query index、Project Health read-only projection visibility 与 DirectRun pre-provider hard-deny guard 已有 service/static evidence；完整 Policy engine / Defect governance lifecycle 与真实 E2E 未落 |
| F-FD-04 | Storage 存储 | §2.1 | §4 | B0 | ✅ |
| F-FD-05 | EventBus（驱动 Supervisor Loop） | §8 | §1.4.1(StationEvent / SupervisorEventPayload) | B9.5* | ⚠️ Station EventBus schema contract 已补，明确内存 EventBus 只做 realtime fanout、durable TaskEvent 才是真源；Supervisor tick/sweep + scheduler static/service 已落；真实运行时 E2E 待验 |

### B. Atelier Core 执行内核（F-CO）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-CO-01 | Task 状态机 | §2.2 | §2.2 | B0/B2 | ✅ |
| F-CO-02 | Run 状态机 | §2.2 | §2.1 | B1 | ✅ |
| F-CO-03 | Milestone 状态机 | §2.2 | §2.3 / Station projection | B10 | ⚠️ read-only projection state 派生已补；完整 runtime/E2E 待落 |
| F-CO-04 | Project 状态机 | §2.2 | §2.4 / Station projection | B10 | ⚠️ read-only projection state 派生已补；完整 runtime/E2E 待落 |
| F-CO-05 | Provider 路由 | §2.2 | §1.3(provider_strategy) / DirectRun | B1 | ⚠️ Station typed provider plan 已接入；official/browser createFromGoal model 分支已提交 `run.kind=model`；DirectRun model intent guard 已落并标记 `TaskProviderPlan.source=atelier.direct_run.intent`；Station execution 已消费 persisted `TaskProviderPlan` 覆盖 `TurnConfig.Provider/Model/Effort` 与 conversation metadata；`agent_direct_runs` 已作为 first-class DirectRun persistence record；`TASK_SURFACE_DIRECT_RUN` + no-session `TaskRun` / `ExecutionStep(PENDING)` / durable `TASK_CREATED` marker 已到 service-level；runtime preflight 已 fail-closed 校验 provider/model/budget/policy/trace refs，recovery 已路由 DirectRun 专用 no-session runtime；Station service-level model provider execution 已产出 durable artifact/gate/status evidence，Budget/Policy pre-provider-call guard 会在 time budget exceeded、token/money usage 已达 cap 或 policy hard deny 时暂停并
产生 interrupt + failed blocking gate；provider success 会从 provider pricing catalog 或 legacy explicit pricing config 写 `agent_task_budget_usages` token/money ledger + pricing snapshot，若 provider response 携带 billed money/source 则同账记录 `estimated_money/provider_billed_money/provider_billing_source` 并以 billed money 作为 effective `used_money`；`BudgetUsageReconciler` 可检查 ledger expected/actual money、报告 provider billing mismatch，并把缺 pricing 与缺 billing evidence 的 token usage 判为 missing pricing；CLI provider 会在 provider call 前暂停并产生 `direct_run_desktop_coding_provider_handoff` typed interrupt + blocking gate，payload 只带 `cli_command_ref`，不泄漏 raw CLI command。真实 Desktop worker execution、真实 Host+Station+applet E2E、外部 provider billing 填充联调未证明 |
| F-CO-06 | 执行循环 Run Loop | §2.2 | §2.1 | B2 | ✅ |
| F-CO-07a | Artifact metadata-only projection parity | §5.3 | §1.5 Artifact | B1/P2-04a | ✅ Artifact evidence index / blob redaction / gate result 已落；official projection 只展示 metadata + safe text fetch + Station-generated `previewTarget.mode=sandbox_manifest` descriptor，official SafeTextPreview 只本地展开前 80 行并显示 hidden safe text line disclosure；official guard 只接受 `sandbox_manifest`、`atelier-sandbox://` 与 `artifact://` preview target refs；并可通过 `atelier.artifact.preview.open` 提交 Host-owned sandbox manifest intent，Desktop Host 返回 opaque rendered surface descriptor（`desktop_host` / `host_sandbox_manifest` / `rendered`，capabilities 含 `host_visual_renderer_surface`）并发出 Host-consumed `openAtelierArtifactPreview` UI command；Desktop Host adapter 已校验并记录 opaque renderer session，拒绝 raw render fields；此项证明 metadata-only projection parity + Host-rendered surface handoff，不证明 web iframe/image/html/diff renderer、Console Logs 或 attachment runtime |
| F-CO-07b | Artifact rich renderer / Console Logs / attachment runtime | §5.3 | §1.5 Artifact / Host sandbox runtime | P2-04b/P3 | ⚠️ rich sandbox visual rendering runtime/E2E 仍未完整落；真实 Desktop product-window webview renderer、Console Logs 真实 Run runtime stream、attachment upload/Host Storage 均归 Host-owned runtime/E2E。已落证据：artifact body fetch controlled service gate 已补 + focused product-window safe body fetch，Station `FetchArtifactBody` 只对 actor-owned task + canonical `artifact://.../body` + active safe text kind + matching hash 返回截断 safe text，product-window telemetry 仅记录 metadata 且不含 raw `text`；artifact renderer controlled surface matrix 已补，并扩展为 controlled surface/runtime gate，可为 `markdown/web/image/diff` 生成 Host-owned `host_sandbox_visual_surface` descriptor，四类 controlled runtime 只返回 metadata-only evidence，并禁用 scripts/network/external navigation/file access/patch apply；新增 `atelier:artifact-renderer-live-controlled-gate` 用 Headless Chrome/CDP 证明 controlled live sandbox DOM render 覆盖 markdown/diff/web/image，且 forbidden DOM count 为 0、`unexpectedScriptExecution=false`；artifactRendererSurface contract `controlledEvidence` 固定 evidence blocks 与 `liveWebviewProven=false`，不声明真实 Desktop product-window webview 真渲染；Host sandbox console capture controlled gate 已补，可规范化 `host_sandbox_cdp` log/warn/error evidence，runtimeLogStream contract `controlledEvidence` 已补，但不声明真实 Run runtime stream；Host Storage attachment staging controlled gate 已补，可生成 `host-storage://...` opaque ref + mime/size/sha256 metadata，新增 `atelier:host-storage-attachment-browser-controlled-gate` 用 Headless Chrome/CDP 证明 controlled browser File API intake 只产生 metadata 并转为 Host-owned opaque ref，hostStorageAttachment contract `controlledEvidence` 已补，校验 readback并拒绝 raw path/url/base64/body/bytes/write intent，但不声明真实 Desktop Host Storage runtime、真实 native file picker 或真实 upload flow；Station DirectRun input_snapshot attachment shape guard 已补，只接受 Host-owned opaque ref + metadata；Applet 不接 renderer、不读 raw body、不上传附件、不执行 provider/run/shell |
| F-CO-08 | Gate Runner | §5.2 | §1.5 Gate | B3 | ✅ |
| F-CO-09 | Fix Loop（含无进展检测） | §2.2 | §2.2 | B4 | ✅ |
| F-CO-10 | Verifier（L0/L1/L2 三档） | §4.2 | §1.1, §3 | B5/B12/B13 | ✅ |
| F-CO-11 | 完成谓词求值器 | §1.3 | §3 | B5/B10 | ✅ |
| F-CO-12 | Resume / 恢复锚点 | §1.6, §7.3 | §4 | B6 | ⚠️ roadmap 已前移并与 B6 熔断/accepted anchor 绑定；Station `TaskOrchestrationPolicy.resume_anchor_policy=LATEST_ACCEPTED_CHECKPOINT` 与既有 resume lifecycle 已接入；真实跨重启恢复 E2E 待验 |
| F-CO-13 | input_snapshot 幂等重放 | §1.6 | §1.3, §4 | B2 | ✅ |

### C. Provider 接入层（F-PR）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-PR-01 | Provider 最小共性接口 | §5.1 | §1.5 Provider | B1 | ✅ |
| F-PR-02 | CodingProvider | §5.1 | §1.5(注) | B1 | ✅ |
| F-PR-03 | DataProvider | §5.1 | §1.3.1(DataProvider) | B12 | ⚠️ data-model 已补正式子类型 schema；真实 DataProvider runtime/E2E 未落 |
| F-PR-04 | ActionProvider（高危单列） | §5.1 | §1.3.1(ActionProvider) | B14 | ⚠️ data-model 已补正式子类型 schema，要求 Risk hard-deny + human confirmation + rollback plan + audit Artifact；真实 ActionProvider runtime/E2E 未落 |
| F-PR-05 | 工作区 / 沙箱 | §5.1(一句带过) | §1.2(Workspace/Sandbox) / `WorkspaceOpenTarget` | B1 | ⚠️ B1 已显式加入 Workspace/Sandbox；Station projection 已产出 `pt-workspace://` `WorkspaceOpenTarget`，official/browser guard 与 Desktop Host `atelier.workspace.open` intent handler 已接入；真实 IDE launch、本机 workspace resolver、sandbox runtime 与 E2E 未落 |
| F-PR-06 | Provider Strategy（降级链/并发） | §2.2 | §1.3 | B1/B8 | ✅ |

### D. Gate 门禁（F-GT）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-GT-01 | Gate 框架 + GatePlan | §5.2 | §1.5 Gate | B3 | ✅ |
| F-GT-02 | L0 coding gates（lint/type/test/build） | §5.2 | §1.1 | B3 | ✅ |
| F-GT-03 | L1 Domain gates | §5.2 | §1.1 | B12 | ✅ |
| F-GT-04 | L2 warn-only gates | §5.2 | §1.5(注) | B13 | ✅ |
| F-GT-05 | block 阻断 + 回灌协作 | §5.2 | §2.2 | B3 | ✅ |

### E. Collaboration 协作底座（F-CL）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-CL-01 | CollaborationTask / Session | §3, §4.1 | §1.4, §2.5 | B8/B9 | ✅ |
| F-CL-02 | 六协作引擎 | §3.1 | §1.4(EngineType) | B8/B13 | ✅ Station Atelier facade 已将六个 prototype `flowId` 映射到 `CollaborationEngineType` 并拒绝未知 flow；EnginePolicy deterministic consensus evaluator + durable event input + typed proto turn schema + typed TaskEvent projection + deterministic schedule policy 已落；真实多引擎 provider E2E 仍待后续 |
| F-CL-03 | 九角色 + 权力结构 | §3.2, §3.3 | §1.4(AgentRole) | B8/B11/B13 | ✅ Station CreateTask/provider plan role allowlist + canonicalization service/static done；formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补；EnginePolicy deterministic consensus evaluator + durable event input + typed proto turn schema + typed TaskEvent projection + awaiting_human pause hook + deterministic schedule policy + authority matrix runtime 已有 service-static evidence；真实否决/验收 E2E 仍待后续 |
| F-CL-04 | 共识收敛 + 反附和 | §4.1 | §2.5 | B9 | ✅ |
| F-CL-05 | Decision → Core 消费 | §1.1, §8 | §1.4 Decision | B8 | ✅ |
| F-CL-06 | 任务拆解 / TaskGraph | §6 | §1.2(TaskGraph) / §1.4(produces) / formal proto / Station projection | B8 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station-owned `agent_atelier_task_graph_nodes/edges` query index 已由 ProjectStateMachine 从 task nodes 与 artifact/gate indexes materialize，LoadWorkspace 优先消费该 index；完整 TaskGraph production/runtime 与 E2E 仍未落 |
| F-CL-07 | Supervisor Loop | §4.4 | §1.4.1(SupervisorEventPayload) | B9.5* | ⚠️ roadmap B9.5 + EventBus schema contract 已补；Station supervisor tick/sweep + scheduler job service/static done；真实运行时 E2E 待验 |
| F-CL-08 | Replan 机制 | §4.5 | §2.2/§2.3(replanning) | B9.5* | ⚠️ roadmap 已前移到 B9.5；Station supervisor replan interrupt + `atelier.task_graph_diff/v0` proposal + Goal Owner `replan` apply service/static done；真实运行时/E2E 待验 |
| F-CL-09 | Integrator 合并去冲突 | §3.3 | §1.4(AgentRole.integrator) / §1.2(TaskGraph.parallel_policy) | B13 | ⚠️ 并行前置条件已收敛为 `integrator_required` + Station integrator identity，official/prototype TaskGraph 已只读展示 parallel policy；真实 Integrator merge runtime/E2E 未落 |
| F-CL-10 | Escalation Guard | §4.6 | §2(escalated 态) | B7 | ✅ |

### F. Project 生命周期（F-PJ）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-PJ-01 | Project Contract | §6 | §1.2 | B10 | ✅ |
| F-PJ-02 | Milestone Tree | §6 | §1.2(MilestoneTree) / formal proto / Station projection | B10 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station-owned `agent_atelier_milestones` query index 已由 ProjectStateMachine materialize，LoadWorkspace 优先消费该 index；完整 Milestone entity/runtime 与 E2E 仍未落 |
| F-PJ-03 | Task Graph | §6 | §1.2(TaskGraph) / §1.4(produces) / formal proto / Station projection | B8 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station-owned `agent_atelier_task_graph_nodes/edges` query index 已由 ProjectStateMachine materialize，node evidence refs 来自 `TaskArtifact` / `TaskGateResult` Station indexes；完整 TaskGraph production/runtime 与 E2E 仍未落 |
| F-PJ-04 | Milestone Acceptance | §6 | §3 | B10 | ✅ |
| F-PJ-05 | Project Verification / Acceptance | §6 | §3 | B10 | ✅ |
| F-PJ-06 | Residual Risk / Follow-up | §6 | §1.2(ResidualRisk) / §3 / formal proto / Station projection | B10 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station 实体/runtime 未落 |
| F-PJ-07 | Blocker 管理 | §6 | §1.2(Blocker) / §3 / formal proto / Station projection | B10 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station 实体/runtime 未落 |

### G. Memory 记忆沉淀（F-MM）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-MM-01 | Memory Candidate 生成 | §5.4 | §1.5 | B11 | ✅ |
| F-MM-02 | 两阶段 confirm 写入 | §5.4 | §1.5(confirmed) | B11 | ✅ |
| F-MM-03 | 失败记忆反哺 Planner/Risk | §5.4 | §1.5(MemoryCandidate.feeds) | B11 | ⚠️ Station feedback policy 已输出 `memory_candidate_feeds`，positive→planner/verifier，negative→planner/risk/verifier；真实反哺消费 E2E 未验 |

### H. UI / Console（F-UI）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-UI-01 | 目标录入 | §2.2 | — | B0/B8 | ✅ |
| F-UI-02 | 会话 / 任务观察 | §2.2 | — | B0/B1/B8 | ✅ |
| F-UI-03 | Escalation 人工决策 | §2.2, §4.6 | — | B6/B7 | ✅ |
| F-UI-04 | Memory / rerun 确认 | §5.4 | §1.5(FeedbackSignal, MemoryCandidateConfirmation, RerunConfirmation) | B11 | ⚠️ confirmation intent + Station-owned write/new Run service/static gates done；真实 Desktop Host + Station + applet E2E pending |

### I. Human-in-loop（F-HL）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-HL-01 | 升级触发条件（强制/流程性） | §4.6 | §1.4(exit_reason) | B7/B13 | ✅ |
| F-HL-02 | 升级载荷（证据/成本/选项/回滚影响） | §4.6 | §1.4(EscalationPayload) / §2.6 | B6/B7 | ⚠️ Station blocking gate / supervisor runtime 会生成 typed escalation payload，resolve 侧按 durable payload 做 HumanDecisionRoute normalization；真实 Desktop Host + Station + applet E2E 未证明 |

---

## 2. 对齐总览

- **功能点总数**：56
- **三处一致 ✅**：35
- **有缺口/错位 ⚠️**：21

⚠️ 主要集中在两类：(1) **文档契约 / formal proto / read-only projection / service-static evidence 已落，但完整 Station runtime 或治理生命周期未落**；(2) **Host / Desktop product window / 外部 Provider / 跨重启恢复等真实 E2E 未验**。当前 P1/P2 口径不再是 roadmap 积木错位，而是已落 service/static 能力与真实 runtime/E2E 之间的证据边界。

---

## 3. 缺口清单（按优先级）

### P0 — data-model 自洽性硬伤（谓词引用了不存在的定义）

> 2026-07-04 更新：下列 P0 缺口已从 `data-model.md` v0.2 文档契约继续推进到 formal proto/codegen、Station read-only projection、official/prototype guard 或 service/static evidence；剩余边界逐项标注为完整 runtime、治理生命周期或真实 E2E，不能再用统一 backlog 描述覆盖每个 GAP 的真实证据状态。

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-01 | Blocker 实体 | F-PJ-07 | ✅ 文档契约 + formal proto/codegen + Station read-only projection + official/prototype guard 已补 `AtelierBlockerProjection{ id, owner, severity, state, evidence_ref, reason }`；Station-owned `agent_project_blockers` query index 已接入 TaskEventWriter 与 LoadWorkspace，blocking gate / gate-blocked decision 可持久化 blocker lifecycle；ProjectStateMachine runtime 已消费 blocker lifecycle 推进 Project/Milestone state；真实 E2E 待落 |
| GAP-02 | ResidualRisk 实体 | F-PJ-06 | ✅ 文档契约 + formal proto/codegen + Station read-only projection + official/prototype guard 已补 `AtelierResidualRiskProjection{ id, desc, state, evidence_ref, owner }`；Station-owned `agent_project_residual_risks` query index 已接入 negative feedback 与 LoadWorkspace；ResidualRisk 完整治理流 / E2E 待落 |
| GAP-03 | Project 缺字段 | F-PJ-05/06/07 | ✅ 文档契约 + formal proto/codegen + Station read-only projection + official/prototype guard 已补 `goal_owner_signoff / residual_risks / open_blockers / memory_candidates / workspace_ref / completion`；Blocker/Risk query index 已作为 Project acceptance persistence 支撑；Station-owned `ProjectStateMachine` 已在 durable event transaction 内从 task/node/gate/blocker/risk/predicate/memory evidence 推进 `agent_project_states`，并 materialize MilestoneTree/TaskGraph query indexes；LoadWorkspace 优先消费 persisted runtime state/structure；完整 TaskGraph production/runtime 与真实 E2E 待落 |
| GAP-04 | AgentRole 枚举 | F-CL-03 | ✅ Station CreateTask/provider plan 已按九角色 allowlist 规范化 role，拒绝未知 role，legacy fallback 使用 `planner/executor`，synthesis node 使用 `integrator`；formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补；EnginePolicy deterministic consensus evaluator + durable event input + typed proto turn schema + awaiting_human pause hook + deterministic schedule policy + authority matrix runtime 已有 service-static evidence；真实否决/验收 E2E 仍待后续 |
| GAP-05 | EngineType 枚举 | F-CL-02 | ✅ proto 已有六引擎枚举，Station Atelier facade 已对齐 prototype `AGENT_FLOWS` 六个 flow id 并拒绝未知 flow；EnginePolicy deterministic consensus evaluator + durable event input + typed proto turn schema + typed TaskEvent projection + deterministic schedule policy 已落；真实 E2E 仍待后续 |
| GAP-06 | MilestoneTree / TaskGraph 结构 | F-PJ-02/03, F-CL-06 | ✅ 文档契约 + formal proto/codegen + Station read-only projection + official/prototype guard 已补 `AtelierMilestoneTreeProjection` / `AtelierTaskGraphProjection` / `AtelierDependencyEdgeProjection`；Station-owned `agent_atelier_milestones` / `agent_atelier_task_graph_nodes` / `agent_atelier_task_graph_edges` query index 已接入 ProjectStateMachine 和 LoadWorkspace，TaskGraph node artifact/gate refs 从 Station `TaskArtifact` / `TaskGateResult` indexes 回链；完整 TaskGraph production/runtime 与真实 E2E 待落 |
| GAP-07 | Policy / Defect 实体 | F-FD-03, F-CO-09 | ✅ 文档契约 + formal proto/codegen + Station read-only projection + official/prototype guard 已补 `AtelierPolicyProjection` / `AtelierPolicyRuleProjection` / `AtelierDefectProjection` / `AtelierDefectProposalProjection`；Station-owned `agent_atelier_policies` / `agent_atelier_policy_rules` / `agent_atelier_defects` query index 已接入 ProjectStateMachine 和 LoadWorkspace，failed gate 会 materialize proposed defect；Project Health 已只读展示 policy rule 与 defect proposal 明细并披露紧凑列表 overflow；完整 Policy engine / Defect governance lifecycle 与真实 E2E 待落 |

### P1 — service/static 已落，真实 runtime/E2E 待验

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-08 | Supervisor Loop 无独立积木 | F-CL-07, F-FD-05 | ✅ roadmap 已新增 B9.5；`data-model.md` 已补 `StationEvent` / `SupervisorEventPayload` / `TaskGraphDiffProposal` schema，明确内存 EventBus 只做 realtime fanout，durable TaskEvent 才是真源；Station `TaskOrchestrationPolicy.supervisor_loop=STATION_EVENT_BUS` 已接入 CreateTask typed provider plan；`RunCollaborationSupervisorTick` / `RunCollaborationSupervisorSweep` service-level runtime 可从 durable task state 发现 workspace conflict / max rounds / max fix loops / budget 卡点并写 Station replan interrupt；`JobKindCollaborationSupervisor` 已接入 Station scheduler job 并直接调用 orchestration service；真实运行时 E2E 待验 |
| GAP-09 | Replan 已前移到 B9.5 | F-CL-08 | ✅ roadmap 已前移到 B9.5；Station `TaskOrchestrationPolicy.replan_policy=BEFORE_B10_FROM_RESUME_ANCHOR` 已接入；Supervisor tick 会以 `supervisor_replan` interrupt 暴露 Station-owned replan request，携带 resume anchor 与 versioned `atelier.task_graph_diff/v0` proposal（affected / retained nodes + proposed action）；Goal Owner 选择 `replan` 后，Station interrupt resolution 会校验 pending `supervisor_replan` 并事务内 apply diff，把 affected nodes 重置为 pending、保留 retained nodes；真实运行时/E2E 待验 |
| GAP-10 | Resume 已前移并绑定 accepted anchor | F-CO-12 | ✅ roadmap 已前移并与 B6 熔断/accepted anchor 绑定；Station `TaskOrchestrationPolicy.resume_anchor_policy=LATEST_ACCEPTED_CHECKPOINT` 与既有 resume lifecycle 已接入；真实跨重启恢复 E2E 待验 |
| GAP-11 | 工作区/沙箱无积木无 schema | F-PR-05 | ✅ B1 已显式加入 Workspace/Sandbox；`data-model.md` 已有 `Workspace/Sandbox` / `WorkspaceOpenTarget` schema，Station policy 通过 `workspace_ref` typed policy 绑定，P2-10 已投影 `pt-workspace://` open target；真实 IDE launch、workspace conflict escalation 与 E2E 待验 |
| GAP-12 | Integrator 并行前置条件已定 | F-CL-09 | ✅ B9.5 明确 parallel TaskGraph 必须 `integrator_required`；Station CreateTask 要求 parallel engine 具备 `provider_plan.synthesizer_agent_id` 作为 integrator identity；无 integrator 时仅 `serial_only`；official/prototype TaskGraph projection 已只读展示 `parallelPolicy` 并披露 integrator identity / merge execution 仍归 Station；真实 Integrator merge runtime/E2E 未落 |

### P2 — 字段级补全（不阻塞但应补）

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-13 | EscalationPayload | F-HL-02 | ✅ Station blocking gate / supervisor runtime 会生成 typed escalation payload，resolve 侧按 durable payload 做 HumanDecisionRoute normalization；真实 Desktop Host + Station + applet E2E 未证明 |
| GAP-14 | 记忆反哺链路字段 | F-MM-03 | ✅ Station feedback submit response 与 durable `TASK_EVENT_TYPE_FEEDBACK_RECORDED` payload 已补 `MemoryCandidate.feeds` / `memory_candidate_feeds`，official/prototype guard 与 contract gate 已同步；真实 Planner/Risk/Verifier 反哺消费 E2E 未验 |
| GAP-15 | Provider 子类型 schema | F-PR-03/04 | ✅ data-model 已补 `Provider` / `ProviderCapability` / `ProviderSideEffect` / `DataProvider` / `ActionProvider` 正式 schema；Station runtime 与真实 Provider E2E 未落 |
| GAP-16 | 完成谓词冗余 | F-CO-11 | ✅ 已收敛为单一 `no_open_blockers(scope)` 谓词；Station read-only projection 已从 gate/feedback/meta 派生最小 `ProjectCompletion`，并补到 durable event acceptance evaluator：按 gate id 取 latest gate result、按 `Blocker.state in {resolved, waived}` 求值、gate-blocked human decision 会保留 gate/node id 供 blocker lifecycle 闭环；ProjectState/Blocker/Risk persistence query index 已接入；Station-owned `agent_acceptance_predicates` registry/query index 已接入 Milestone `acceptancePredicateIds` 与 ProjectCompletion L0/L1/L2 判定；Station deterministic `AcceptancePredicateEvaluator` 已支持 no_open_blockers / data-model blocker quantifier / milestone & task accepted / residual risks / goal owner signoff / memory candidates / gate.passed / `gate_result(g).passed` / blocking gate aggregate / L2 human signoff aggregate，TaskEventWriter 在索引同步后刷新 predicate verdict 并推进 `ProjectStateMachine` 和 MilestoneTree/TaskGraph materializer；Project Health 已只读展示 memory candidate projection 明细并披露紧凑列表 overflow；milestone accepted predicate 不再读取旧 ProjectState 自证；任意表达式 DSL、完整 TaskGraph production/runtime、真实 memory write 与真实 E2E 待落 |

---

## 4. 下一步对齐动作（建议顺序）

1. **保持矩阵 / 设计文档 freshness**：GAP-01~07、GAP-13~16 与 GAP-UI-01 已有 proto/codegen、Station read-only projection、service/static guard 或 controlled UI evidence 的条目，不再用“把文档契约落为 proto / Station Go 实体”作为统一下一步；若后续 implementation 状态变化，先更新本矩阵与 `README.md` / `data-model.md` / `prototype/README.md`，避免旧计划文字误导执行。
2. **继续硬化 P1（GAP-08~12）**：typed policy、Station CreateTask guard、Supervisor tick/sweep、scheduler job、supervisor replan interrupt、workspace conflict escalation service/static 与 Integrator 并行前置条件已落；下一步补真实运行时 E2E、跨重启 resume E2E 与真实 Integrator merge runtime。
3. **P2 字段级补全已基本闭合；剩余为 Station-owned / E2E-only**：真实 Desktop worker execution、外部 provider billing 填充联调、真实 Planner/Risk/Verifier 反哺消费、Provider runtime、memory write、真实 Host+Station+applet E2E 仍归 Station/Host/runtime 验证链路，不得下沉为 applet 执行权限或 prototype-only shortcut。
4. 每修完一项，回本表把对应 ⚠️ 翻成 ✅，保持矩阵与三份文档一致。
