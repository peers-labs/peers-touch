# Atelier × Peers Agent Collaboration — 数据模型

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-20 | **Updated**: 2026-07-05
> **Owner**: Peers-Touch Agent Team

---

本文档给出字段级数据契约、状态机图与可机器判定的完成条件谓词。先定数据，再定行为。下方 schema 用语言无关的伪 IDL 表达，后续在 `model/domain/` 下落为 proto。

---

## 1. 核心数据契约

### 1.1 可验收性分级（贯穿全系统的枚举）

```
enum VerifiabilityLevel {
  L0   // 二值可判定：test/build/lint/编译/schema 校验。Verifier=确定性脚本，全自动
  L1   // 规则可判定：数值阈值/约束/数据质量/白名单。Verifier=规则引擎，自动+异常升级
  L2   // 主观需人判：结论质量/内容质量/不可逆动作。Verifier=LLM 仅建议，强制人工
}

enum EvaluatorKind { deterministic, rule_engine, human }
```

### 1.2 Project / Contract

```
Project {
  id            : ID
  goal          : string                 // 用户原始目标
  contract      : ProjectContract
  milestone_tree: MilestoneTree
  state         : ProjectState
  budget_ref    : BudgetID
  policy_ref    : PolicyID
  workspace_ref : WorkspaceID
  trace_root    : TraceID
  goal_owner_signoff : bool
  residual_risks     : []ResidualRiskID
  open_blockers      : []BlockerID
  memory_candidates  : []MemoryCandidateID
}

ProjectContract {
  goals          : []Goal                // 必达目标
  non_goals      : []string              // 显式非目标（防 scope 蔓延）
  acceptance     : []AcceptancePredicate // 项目级验收，每条必须可判定或显式标 L2
  constraints    : []Constraint          // 时间/成本/安全/合规上限
  invariants     : []string              // 本项目额外不变量（如"不得改 prod 数据"）
  owner_signoff_required : bool
}

AcceptancePredicate {
  id        : ID
  expr      : string              // 例: "all_milestones.status == accepted"
  level     : VerifiabilityLevel
  evaluator : EvaluatorKind
  // 运行期结果
  last_eval : bool | null
  human_signoff : bool            // 仅 L2 使用
}

Goal {
  id          : ID
  statement   : string
  priority    : enum{ must, should, optional }
  evidence_ref: ArtifactID | null
}

Constraint {
  id       : ID
  type     : enum{ time, cost, security, compliance, scope, workspace }
  expr     : string
  severity : enum{ block, warn, info }
}

MilestoneTree {
  root_id    : MilestoneID
  milestones : []Milestone
  edges      : []DependencyEdge
}

TaskGraph {
  root_task_ids : []TaskID
  tasks         : []AtelierTask
  edges         : []DependencyEdge
  parallel_policy : enum{ serial_only, independent_only, integrator_required }
}

DependencyEdge {
  from : ID
  to   : ID
  type : enum{ blocks, informs, produces_input_for }
}

Blocker {
  id          : ID
  owner       : AgentRole
  severity    : enum{ block, warn, info }
  state       : enum{ open, resolved, waived }
  evidence_ref: ArtifactID
  reason      : string
}

ResidualRisk {
  id          : ID
  desc        : string
  state       : enum{ logged, downgraded, follow_up }
  evidence_ref: ArtifactID
  owner       : AgentRole
}

Workspace {
  id           : ID
  uri          : string                 // Host/Station 可解析，Open in IDE 只能使用该字段；P2-10 使用 pt-workspace://task/<task_id>?workspace=<workspace_id>
  ide_hint     : string?                // e.g. vscode；Host 解释，不是 applet 执行命令
  sandbox_ref  : SandboxID
  branch       : string
  touched_paths: []string
  policy_ref   : PolicyID
}

WorkspaceOpenTarget {                   // P2-10 projection-facing Host intent
  workspace_id  : WorkspaceID
  workspace_uri : string                 // 必须是 pt-workspace://；不得暴露 file:// 或本机绝对路径
  label         : string
  ide_hint      : string?
}

AppletMethodIntent {                     // projection contract metadata
  method              : string
  intent_owner        : enum{ station, desktop_host }
  intent_kind         : string            // e.g. projection_read, project_create_intent
  side_effect_class   : enum{ none, host_ui, station_transaction }
  execution_forbidden : true              // applet-visible methods never own provider/run/gate/artifact execution
}

AppletMethodTransport {                  // machine contract: methodTransports
  method                 : string
  transport_kind         : enum{
    service_binding,                      // sdk.network.request({service:'atelier', path})
    desktop_gateway_host_local,           // sdk.invoke -> Desktop Host-local intent handler
    event_subscription                    // sdk.events topic + Host-opened Station stream
  }
  public_path            : string?         // /v1/... for service_binding
  station_path           : string?         // /applets/atelier/v1/...; realtime uses canonical /events/stream
  desktop_gateway_action : string?         // Host-local/event actions only
  station_handler        : string?         // Station handler/facade anchor
}

Station-owned applet methods must prefer `service_binding`; Host-local
transports are reserved for local UI intents such as workspace open and artifact
preview open. The applet still submits intents only; provider execution, memory
writes, rerun creation, artifact storage and gate execution remain Station/Host
owned.

Sandbox {
  id            : ID
  type          : enum{ worktree, container, remote_station, readonly }
  root_uri      : string
  allowed_paths : []string
  denied_paths  : []string
  network_policy: enum{ offline, allowlist, unrestricted }
}
```

> **约束**：`acceptance` 在立项时写死，每条标 `level`。含 L2 条目的项目天然无法 100% 自动收尾，必须预留人工签字位。

### 1.3 Milestone / Task / Run

```
Milestone {
  id, parent_id : ID                    // 树结构
  contract      : MilestoneContract     // 局部目标 + 局部验收谓词
  depends_on    : []MilestoneID
  state         : MilestoneState
  tasks         : []TaskID
  acceptance    : []AcceptancePredicate
}

AtelierTask {
  id, milestone_id   : ID
  task_contract      : TaskContract      // 输入、期望产物、验收谓词
  provider_strategy  : ProviderStrategy  // 选哪个 provider、降级链、并发度
  gate_plan          : GatePlan          // 必过哪些 gate、阻断级别
  intent_preset      : enum{ work, code, design } // UI 选择的声明式默认策略，不是执行能力
  provider_strategy_preset : string      // Station-owned default strategy label
  gate_plan_preset          : string      // Station-owned default gate label
  verifiability_level: VerifiabilityLevel
  state              : TaskState
  archival_state     : enum{ active, archived, deleted }
  runs               : []RunID
  escalation_policy  : ref
}

`archival_state` 是用户收纳生命周期，不是执行状态机；projection contract `taskLifecycle` 以机器可读方式固定 `active/archived/deleted`、reversible transitions、`purgeRequiresStatus=deleted` 与 `orthogonalTo=execution_state`，`atelier.task.setStatus` / `atelier.task.purge` 必须与该契约一致。

Run {
  id, task_id  : ID
  provider_id  : ID
  attempt_no   : int
  input_snapshot : blob                  // 幂等重放所需的完整输入
  state        : RunState
  artifacts    : []ArtifactID
  gate_results : []GateResult
  cost         : Cost { tokens, wall_clock, money }
  trace_id     : TraceID
}

DirectRun {
  id              : ID
  task_id          : TaskID | null
  provider_id      : ID
  model_intent     : string
  input_snapshot   : blob
  budget_ref       : BudgetID
  policy_ref       : PolicyID
  trace_id         : TraceID
  state            : RunState
}

DirectRunCLIHandoff {
  direct_run_id      : DirectRunID
  provider_id        : ProviderID
  adapter            : "desktop_coding_provider"
  handoff_kind       : "desktop_executor_required"
  handoff_owner      : "desktop_runtime"
  executor_kind      : "EXECUTOR_KIND_DESKTOP_DEVICE"
  requested_capabilities : ["cli"]
  cli_command_ref    : "agent_provider.cli_command" // raw command is not projected
  invariant          : "Station records typed handoff; Applet never executes CLI"
}

DirectRunExecutionEvidence {
  owner        : "station"
  surface_kind : "read_only_execution_evidence"
  source       : "agent_direct_runs + agent_task_runs + agent_task_events + agent_task_artifacts + agent_task_gate_results + agent_task_budget_usages"
  display_fields : [
    directRunId, taskId, providerId, modelIntent, state, traceId,
    artifactRefs, gateRefs, budgetUsage, failureArtifactRef, cliHandoffRef
  ]
  forbidden_actions : [
    directRun.start, directRun.resume, directRun.cancel,
    provider.invoke, model.run, cli.execute, shell.execute,
    trace.write, artifact.write, gate.run, budget.write,
    inputSnapshot.read, inputSnapshot.write, HostStorage.write
  ]
}
```

> **直连约束**：`DirectRun` 只跳过协作会话，不跳过 Budget / Policy / Trace / Artifact / Gate。Atelier applet 不能直接创建 Provider 调用，只能提交用户意图，由 Station 决定是否创建 `DirectRun`。
> `DirectRunExecutionEvidence` 只是 Station-owned 运行证据的只读投影契约；它不能被解释为 applet 拥有 provider/model/CLI 执行、trace/artifact/gate/budget 写入或 `input_snapshot` 读取/写入能力。

### 1.3.1 Provider / Capability 子类型

```
Provider {
  id           : ID
  kind         : ProviderKind
  display_name : string
  capabilities : []ProviderCapability
  policy_ref   : PolicyID
  sandbox_ref  : SandboxID | null
  pricing_catalog : ProviderPricingCatalog?
  owner         : enum{ station, external, user }
  state         : enum{ available, degraded, disabled }
}

ProviderPricingCatalog {
  source       : string            // e.g. station.provider_pricing_catalog
  version      : string
  models       : map<ModelName, ProviderModelPricing>
  fallback     : ProviderModelPricing?
  invariant    : "Station-owned catalog snapshot; Applet never computes billing"
}

ProviderModelPricing {
  input_token_price  : number      // per-token money unit
  output_token_price : number
}

enum ProviderKind {
  coding
  data
  action
}

ProviderCapability {
  id             : ID
  command        : string
  input_schema   : JSONSchemaRef
  output_schema  : JSONSchemaRef
  artifact_kinds : []ArtifactKind
  level          : VerifiabilityLevel
  side_effect    : ProviderSideEffect
}

JSONSchemaRef = string                  // points to versioned schema Artifact or contract URI
Duration      = string                  // ISO-8601 duration, e.g. PT5M

enum ArtifactKind {
  diff_patch
  build_log
  test_report
  review_report
  result_json
  data_snapshot
  quality_report
  execution_receipt
  rollback_token
  audit_log
}

DataSourceRef {
  id           : ID
  uri          : string                 // Station-resolved source URI; applet never receives secrets
  trust_level  : enum{ trusted, third_party, user_supplied }
  freshness_sla: Duration
  policy_ref   : PolicyID
}

ProviderSideEffect {
  workspace_write : bool
  network_read    : bool
  data_write      : bool
  money_or_rights : bool
  irreversible    : bool
}

CodingProvider extends Provider {
  kind             : coding
  workspace_ref    : WorkspaceID
  allowed_commands : []enum{ edit, test, build, lint, review }
  produces         : []enum{ diff_patch, build_log, test_report, review_report }
  invariant        : "side effects are confined to declared Workspace/Sandbox and must produce Artifact refs"
}

DataProvider extends Provider {
  kind             : data
  source_refs      : []DataSourceRef
  query_schema     : JSONSchemaRef
  cache_policy     : enum{ no_cache, ttl, snapshot_required }
  freshness_sla    : Duration
  quality_gates    : []GateID              // schema/completeness/freshness/source_trust
  produces         : []enum{ result_json, data_snapshot, quality_report }
  invariant        : "read-oriented by default; any data_write must be explicit in ProviderSideEffect and Policy"
}

ActionProvider extends Provider {
  kind                  : action
  action_schema          : JSONSchemaRef
  risk_policy_ref        : PolicyID
  rollback_plan_required : bool
  human_confirm_required : bool
  hard_deny_overridable  : false
  rollback_token_ref     : ArtifactID | null
  produces              : []enum{ execution_receipt, rollback_token, audit_log }
  invariant             : "irreversible/money_or_rights actions require Risk hard-deny gate, human confirmation, rollback plan, and audit Artifact before execution"
}
```

> **Provider 约束**：顶层 `Provider` 只保留 capability、policy、sandbox、状态等最小共性。领域差异必须落到 `CodingProvider` / `DataProvider` / `ActionProvider` 子类型；Atelier applet 只能看到 Station 投影出的 read-only capability descriptor，不能直接执行 provider、绕过 Policy/Gate，或创建 ActionProvider 副作用。

### 1.4 协作侧

```
enum AgentRole {
  goal_owner   // 唯一终裁签字者
  architect    // 约束架构边界
  planner      // 拆解计划 / TaskGraph
  risk         // 风险与 Policy，硬否决危险动作
  supervisor   // 推进控制，不做内容否决
  executor     // 执行者，零判断写事实
  verifier     // 验收者，否决必须带 evidence_ref
  integrator   // 并行结果合并 / 冲突消解
  historian    // 产 MemoryCandidate
}

enum EngineType {
  expert_hierarchy
  roundtable
  debate_judge
  expert_mesh
  swarm
  hierarchy
}

CollaborationTask {
  id           : ID
  source       : enum{ project, milestone, task, defect }
  question     : string                  // 要协作解决的具体问题
  engine       : EngineType              // 默认 expert_hierarchy
  participants : []AgentRole
  authority    : AgentRole               // 终裁者（默认 goal_owner）
  max_rounds   : int
  budget_slice : ref
  session      : CollaborationSession
}

CollaborationSession {
  state       : enum{ proposing, converging, reached, escalated, aborted }
  rounds      : []Round
  decision    : Decision | null
  exit_reason : enum{ signoff, no_objection, max_rounds, budget, policy, abort }
}

Decision {
  outcome         : string
  authority_signoff : bool
  open_objections : []Objection          // 每个都带 evidence_ref
  evidence_refs   : []ArtifactID
  produces        : []Contract | Plan | TaskGraph   // 共识的产物
}

Objection {
  by          : AgentRole
  claim       : string
  evidence_ref: ArtifactID | null        // null → 降级为"疑虑"，不阻断
  resolved    : bool
}

EscalationPayload {
  id              : ID
  reason          : enum{ budget, policy, gate_blocked, max_rounds, max_fix_loops, l2_review, workspace_conflict, unknown }
  question        : string
  evidence_refs   : []ArtifactID
  spent           : Cost
  rollback_impact : string
  options         : []HumanDecisionOption
  recommendation  : string | null
}

HumanDecisionOption {
  id       : ID
  label    : string
  action   : enum{ continue, rerun_failed_node, accept_risk, replan, cancel, mark_rejected }
  requires : []AcceptancePredicateID
}
```

### 1.4.1 Station EventBus / Supervisor event schema

EventBus 是 Station 内部推进机制，不是 Atelier applet capability。Applet 只能通过 projection snapshot / event stream 观察已持久化结果，不能 publish supervisor event、不能直接触发 replan，也不能绕过 `TaskEventWriter` durable outbox。

```
StationEvent {
  id              : EventID
  task_id         : TaskID
  source          : enum{ station.supervisor.tick, station.scheduler, station.gate_runner, station.interrupt.resolve, station.task_event_writer }
  kind            : enum{ supervisor_replan_requested, supervisor_replan_applied, gate_result_recorded, interrupt_resolved, projection_invalidated }
  event_seq       : int64                 // 必须来自 durable TaskEvent seq；实时 EventBus 只镜像，不是真源
  trace_id        : TraceID
  payload_schema  : string                // e.g. atelier.supervisor_event/v0
  payload         : SupervisorEventPayload | GateResult | HumanDecisionRoute
  created_at      : timestamp
}

SupervisorEventPayload {
  supervisor_loop : enum{ station_event_bus }
  reason          : enum{ workspace_conflict, max_rounds, max_fix_loops, budget, policy, unknown }
  interrupt_type  : enum{ supervisor_replan }
  resume_anchor_checkpoint_id : CheckpointID | null
  options         : []HumanDecisionOption  // 必须包含 action=replan 的 Goal Owner 选项
  task_graph_diff : TaskGraphDiffProposal | null
}

TaskGraphDiffProposal {
  version           : "atelier.task_graph_diff/v0"
  task_id           : TaskID
  affected_node_ids : []TaskID
  retained_node_ids : []TaskID
  action            : enum{ reset_affected_to_pending }
}
```

约束：

- `StationEvent.id` / metadata `event_id` 与 `StationEvent.event_seq` 必须来自 durable `TaskEventWriter` / transaction；内存 EventBus 只用于实时 fanout。
- `TaskEvent.collaboration_session_event` 是 Station-owned typed session lifecycle projection，只能从 durable payload 中显式 `collaboration_session_event` 字段投影，不能从 `result_summary` 或自然语言 fallback 推断。当前 typed schema 覆盖 `round_started / voice_recorded / convergence_evaluated / awaiting_human / reached` 与 `gathering / converging / awaiting_human / reached` phase；它证明 session lifecycle event envelope 已有 proto/service-static evidence，不证明真实 schedule 流转、真实 SSE reconnect 或完整 Host+Station+applet E2E。
- `SupervisorEventPayload` 只由 Station supervisor tick/sweep 产生，Applet 只能通过 human decision 选择已给出的 `HumanDecisionOption.action=replan`。
- `TaskGraphDiffProposal` 只有在 pending `supervisor_replan` interrupt 被 Goal Owner 批准后，才能由 Station interrupt resolution apply；不得由 applet 直接写 TaskGraph。

### 1.5 Provider / Gate / Artifact / Budget / Memory

Provider 正式 schema 见 §1.3.1。本节只定义 Atelier applet 可见的 discovery-only capability projection；不得把 `Capability` 反向解释为 provider execution API。

```
Capability {                             // P2-08 discovery-only projection
  id            : ID
  label         : string
  description   : string
  slash_command : string                 // e.g. "/implement"; intent text only
  provider_kind : string                 // e.g. coding / verifier
  scope         : enum{ station-provider }
  read_only     : true
}

ProviderCapabilitiesResponse {
  source       : string                   // e.g. station.provider.capabilities
  capabilities : []Capability
}

Gate {
  id, type     : ID/string
  blocking_level : enum{ block, warn, info }
  evaluator    : EvaluatorKind
  level        : VerifiabilityLevel      // L2 的 gate 只能 warn
}
GateResult { gate_id, run_id, passed: bool, blocking: bool, artifact_ref }

Artifact {
  id, run_id  : ID
  type        : string
  preview_hint: enum{ markdown, web, image, diff, metadata, metadata_only }
  body_ref    : string?                 // artifact://<task_id>/<artifact_id>/body; Station-owned body blob
  body_hash   : string?                 // sha256:<64hex>
  body_size   : int?
  body_kind   : enum{ markdown, content, body, html, diff, patch }?
  preview_target : ArtifactPreviewTarget? // Station-generated metadata-only descriptor; Host-owned preview.open intent may consume it
  uri         : string                 // artifact://<task_id>/<artifact_id>
  checksum    : string                 // sha256:<64hex>
  produced_at : timestamp
  refs        : []ArtifactID
}

ArtifactPreviewTarget {
  kind        : enum{ markdown, web, image, diff, metadata }
  mode        : enum{ sandbox_manifest }
  label       : string?
  sandbox_ref : SandboxID?
  body_ref    : string?
  invariant   : "projection metadata only; Station may generate sandbox_manifest ref from body_ref; applet may call atelier.artifact.preview.open as Host intent, but no raw url/src/html/body and no applet-side iframe/image execution"
}

ArtifactPreviewOpenIntent {
  method      : "atelier.artifact.preview.open"
  input       : { task_id, artifact_id, sandbox_ref, body_ref, kind?, mode="sandbox_manifest" }
  output      : { accepted, opened=false, prepared=true, sandbox_ref, body_ref, mode, renderer_session_id, renderer_owner="desktop_host", renderer_mode="host_sandbox_manifest", renderer_status="prepared_not_opened", renderer_capabilities, reason }
  host_effect : { type="ui", action="openAtelierArtifactPreview", returns_result=false, params={renderer_session_id, sandbox_ref, body_ref, mode} }
  host_adapter : { owner="Desktop Host", action="record opaque renderer session", rejects={url, src, href, iframe, html, image, file, path, execute, run, openExternalUrl} }
  owner       : "Desktop Host"
  invariant   : "validates Host-owned sandbox manifest, prepares an opaque Host renderer session descriptor, emits a Host-consumed UI command, and records it through a Desktop Host adapter only; Lynx Host strips command metadata from applet result and does not grant applet iframe/image/html/raw URL rendering or artifact execution"
}

Policy {
  id        : ID
  rules     : []PolicyRule
  hard_deny : bool
}

PolicyRule {
  id       : ID
  scope    : enum{ workspace, command, network, data, action }
  expr     : string
  severity : enum{ block, warn, info }
}

Defect {
  id          : ID
  task_id     : TaskID
  source      : enum{ gate, verifier, user, supervisor }
  state       : enum{ proposed, accepted, fixed, rejected }
  evidence_ref: ArtifactID
  proposal    : DefectProposal
}

DefectProposal {
  summary        : string
  expected_change : string
  target_refs     : []ArtifactID
}

Budget {
  token_cap, money_cap, wall_clock_cap : number
  max_fix_loops, max_collab_rounds, max_parallel_runs : int
  spent : Cost
}

BudgetUsage {
  usage_id      : id
  budget_id     : BudgetID
  task_id       : TaskID
  step_id       : StepID?
  direct_run_id : DirectRunID?
  provider_id   : ProviderID?
  model         : string?
  input_tokens  : number
  output_tokens : number
  total_tokens  : number
  used_money    : number       // effective budget charge; provider billed money when reported, else estimate
  estimated_money : number
  provider_billed_money : number?
  provider_billing_source : string?
  provider_billing_currency : string?
  input_token_price  : number
  output_token_price : number
  pricing_source    : string?
  evidence_ref  : EventID
  source        : enum{ station.direct_run, station.collaboration }
}

BudgetUsageReconciliation {
  task_id          : TaskID
  expected_money   : number
  actual_money     : number
  mismatches       : []BudgetUsageID
  missing_pricings : []BudgetUsageID
  invariant        : "token usage without pricing snapshot or provider billing evidence is not balanced"
}

MemoryCandidate {
  type : enum{ success_pattern, failure_cause, project_rule,
               domain_rule, arch_decision, workflow_improvement }
  content      : string
  evidence_refs: []ArtifactID
  scope        : enum{ user, project, domain }
  confirmed    : bool                    // 默认 false，用户确认才写长期记忆
  feeds         : []enum{ planner, risk, verifier }
}

FeedbackSignal {                          // P2-09 applet-facing intent
  feedback_id : ID
  task_id     : TaskID
  block_id    : ID                       // projected stream block id
  signal      : enum{ positive, negative, copy, regenerate }
  comment     : string?
  actor_id    : ActorID
  memory_candidate_status : enum{ candidate, not_applicable }
  memory_confirmation_required : bool    // true only when Station memory review must confirm candidate before write
  memory_confirmation_mode     : enum{ station_memory_review, not_required }
  rerun_intent_status          : enum{ intent_recorded, not_requested }
  rerun_confirmation_required  : bool    // true only when Station rerun review must confirm before creating a new Run
  rerun_confirmation_mode      : enum{ station_rerun_review, not_required }
}

MemoryCandidateConfirmation {             // P2-09 Station-owned confirmation action
  task_id     : TaskID
  feedback_id : ID                       // references a durable FeedbackSignal event
  actor_id    : ActorID
  confirmation_mode : enum{ station_memory_review }
  status      : enum{ confirmed, rejected, already_done }
  memory_id   : ID?                      // set only after Station MemoryService writes/locates memory
  source      : enum{ station_memory_review }
  target      : enum{ memory }
  layer       : enum{ experience }
  confirmed_at: Timestamp?
}

RerunConfirmation {                       // P2-09 Station-owned confirmation action
  task_id        : TaskID
  feedback_id    : ID                    // references a durable FeedbackSignal event
  actor_id       : ActorID
  confirmation_mode : enum{ station_rerun_review }
  status         : enum{ confirmed, rejected, already_done }
  rerun_task_id  : TaskID?               // new collaboration task created by Station/orchestration
  source         : enum{ station_rerun_review }
  started        : bool                  // true when Station has created/started the new Run task
  confirmed_at   : Timestamp?
}
```

---

## 2. 状态机

### 2.1 Run 状态机（最底层，确定性）

```
enum RunState { queued, running, succeeded, failed, cancelled, escalated }

queued ──start──► running
running ──ok────► succeeded ──► (gate 入口)
running ──err───► failed ──► (Fix 决策)
running ──budget/policy──► escalated
running ──cancel──► cancelled

不变量：succeeded/failed 后必产 Artifact；任何转移必入 Trace
```

### 2.2 Task 状态机（含 Fix Loop / Gate / 验收）

```
enum TaskState { created, planning, ready, executing, gating,
                 fixing, verifying, awaiting_human, accepted, rejected,
                 replanning, escalated }

created → planning → ready → executing
executing → gating（跑 GatePlan）
gating ──全过────────► verifying
gating ──可阻断失败──► fixing（生成 defect_proposal，回 Executor）
fixing → executing（attempt_no++，受 max_fix_loops 限）
fixing ──超 fix 上限──► escalated
verifying ──L0/L1 自动判定──► accepted | rejected
verifying ──L2────────────► awaiting_human ──► accepted | rejected
rejected → fixing | replanning
任意态 ──budget/policy/危险动作──► escalated

Fix Loop 硬约束：
  attempt_no <= max_fix_loops
  每次 fix 必须改变 input_snapshot；否则判"无进展循环"直接 escalate
```

### 2.6 人工裁决路由

```
HumanDecisionRoute {
  reason : EscalationPayload.reason
  option_action : HumanDecisionOption.action
  precondition  : string
  transition    : string
}
```

| reason | option action | 前置条件 | 状态转移 |
|---|---|---|---|
| `gate_blocked` | `rerun_failed_node` | task 已 `PAUSED`，无 running node，lease 已释放 | `paused/escalated → executing`，复跑失败 node |
| `gate_blocked` | `accept_risk` | L2 或 warn gate；block gate 不允许绕过 | `paused → verifying` 或保持 `paused` 并记录 override rejected |
| `budget` | `continue` | 新 budget cap 已签字 | `escalated → executing` |
| `policy` | `continue` | 禁止；Policy hard deny 不可被 GoalOwner 覆盖 | 保持 `escalated` |
| `max_fix_loops` | `replan` | 生成 TaskGraph diff | `fixing/escalated → replanning` |
| `l2_review` | `mark_rejected` | human signoff | `awaiting_human → rejected` |
| `l2_review` | `continue` | human signoff accepted | `awaiting_human → accepted` |
| `workspace_conflict` | `replan` | Workspace/Sandbox policy 更新 | `blocked → replanning` |

### 2.3 Milestone 状态机

```
enum MilestoneState { planned, active, blocked, replanning, accepted, abandoned }

planned → active → (所有 task accepted) → accepted
active → blocked（有未闭环 blocker）→ active | abandoned
active → replanning（Task Graph 与现实偏离）→ active
```

### 2.4 Project 状态机

```
enum ProjectState { draft, contracted, executing, blocked,
                    verifying, awaiting_owner_signoff, accepted, escalated }

draft → contracted（Goal Owner signoff）→ executing
executing → blocked → executing | escalated
executing → verifying（所有 milestone accepted）
verifying ──全部 AcceptancePredicate 真──► accepted
verifying ──含 L2──► awaiting_owner_signoff → accepted
```

落地约束：Project / root Milestone 状态由 Station-owned `ProjectStateMachine` 在 durable `TaskEventWriter` transaction 内推进，并写入 `agent_project_states`。同一 runtime 会把当前 root Milestone 与 TaskGraph materialize 到 `agent_atelier_milestones`、`agent_atelier_task_graph_nodes`、`agent_atelier_task_graph_edges`，把 task-scoped Policy / failed-gate Defect materialize 到 `agent_atelier_policies`、`agent_atelier_policy_rules`、`agent_atelier_defects`，作为 projection query index；TaskGraph node 的 artifact/gate refs 只能从 Station-owned `TaskArtifact` / `TaskGateResult` index 按 `step_id` 回链。该 runtime 只能读取 Station 持久化 evidence（task/node status、gate result、Blocker、ResidualRisk、AcceptancePredicate、memory candidate event、task meta 的 owner signoff / policy hint），Applet / prototype 只消费 projection 字段，不执行状态转移、TaskGraph 生产、Policy engine 或 predicate 求值。历史 `project_state/milestone_state` event payload 仍可作为 legacy index input，但不再是状态机真源。

### 2.5 CollaborationSession 状态机

```
proposing → converging → reached
proposing/converging ──max_rounds/budget/policy──► escalated
任意态 ──abort──► aborted

进入 reached 充要条件（见 design §4.1）：
  authority_signoff == true
  AND open_objections.filter(unresolved && has_evidence).count == 0
```

---

## 3. 完成条件谓词（可机器查询）

项目级「完成」必须翻译为 Core 可求值的布尔表达式，不接受 LLM 口头声明：

```
project.accepted ⟺
     all(m in milestones        : m.state == accepted)
  ∧  no_open_blockers(project)
  ∧  all(p in contract.acceptance where p.level in {L0,L1} : p.eval() == true)
  ∧  all(p in contract.acceptance where p.level == L2       : p.human_signoff == true)
  ∧  all(r in residual_risks    : r.state in {logged, downgraded, follow_up})
  ∧  goal_owner_signoff == true
  ∧  memory_candidates.generated == true
```

阻断项谓词：

```
no_open_blockers(scope) ⟺
     all(b in scope.open_blockers : b.state in {resolved, waived})
```

> `open_blockers` 是 Project / Milestone 级阻断项索引；是否仍然阻断只由 `Blocker.state` 判定，不再维护计数式和角色专用两套完成口径。Verifier / Risk / Supervisor 的阻断意见必须先落成 `Blocker`，再由同一个 `no_open_blockers(scope)` 谓词参与验收。

L0/L1 `AcceptancePredicate.last_eval` 由 Station deterministic evaluator 在 durable event transaction 内刷新；unknown expression 必须 fail-closed。`all_milestones.status == accepted` 这类 milestone 谓词不得读取旧 `agent_project_states` 自证，必须从当前 task/node/blocker evidence 推导，避免同一事务中的 stale-cycle。

milestone 级：

```
milestone.accepted ⟺
     all(t in tasks : t.state == accepted)
  ∧  all(p in milestone.acceptance where level in {L0,L1} : p.eval() == true)
  ∧  all(p in milestone.acceptance where level == L2       : p.human_signoff == true)
  ∧  no_open_blockers(milestone)
```

task 级：

```
task.accepted ⟺
     latest_run.state == succeeded
  ∧  all(g in gate_plan where g.blocking_level == block : gate_result(g).passed)
  ∧  ( level in {L0,L1} ? verifier_predicate.eval()
                        : verifier_human_signoff == true )
```

---

## 4. 持久化与重放策略（要点）

- **事实源**：Artifact 是唯一事实源；所有 evidence_ref 指向 Artifact。
- **幂等重放**：`Run.input_snapshot` 完整保存重放所需输入，Run 可重跑得到等价结果。
- **恢复锚点**：Project resume 时回到最近 `accepted` 的 Milestone；其下已 accepted 产物复用，不重跑。
- **Trace**：所有状态转移、协作轮次、Gate 结果、预算扣费写入 Trace，支撑追踪与复盘。
- **落地映射**：projection surface 已落到 `model/domain/atelier/v1/projection.proto`；任务执行、Provider、Gate、Artifact、Trace、Checkpoint、Resume 真源仍与现有 `model/domain/agent/` / 后续 collaboration proto 对齐。
