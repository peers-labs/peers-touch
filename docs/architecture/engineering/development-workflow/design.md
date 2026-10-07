# Development Workflow Control Plane - Architecture Design

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-07
> **Owner**: Platform Team

---

## 1. Core Principles

1. **Journey before matrix**: 产品进度由真实用户 Journey 是否闭环决定，不由测试、
   Gate 或文档数量决定。
2. **Functional before formal proof**: 产品源码先在 exact-source 开发运行时通过
   功能验证，再补齐或执行正式 Acceptance。
3. **One owner per state**: ExecutionRun 拥有 Task 生命周期和 current
   selection；Plan、Task、Session、Git、runtime lease 和 Evidence 各自只拥有
   其余事实。
4. **Declare before mutate**: 首次写入或占用运行资源前，必须发布并确认机器级资源声明。
5. **First failure first**: 一次运行只保留首个可行动失败；修复后回到同一 Task/Journey。
6. **Compact current state**: Git 只保存 stable Plan、Task 规格和 amendment
   audit；lifecycle、attempt、日志和截图留在机器 Dev root。
7. **Bounded resume**: 恢复只读取 active pointer、manifest、当前 Task 和当前 Session。
8. **No dual truth**: 迁移完成后，旧计划只能作为 archive 输入，不能继续承载状态。
9. **Progress-bearing continuation**: Context Anchor 的续作单位是可关闭一个
   Task 的 Progress Slice，不是单条命令、检查或授权动作。
10. **No zero-yield handoff**: Dev Workflow 在一个 Slice 内持续执行准备、诊断和
    修复，直到 Task 关闭并产生可计算进度，或到达真实 hard boundary。
11. **Stable Plan, explicit mount**: `planId` 在一个北极星目标生命周期内保持
    稳定；Project Ledger 通过 PlanMount 将其显式挂载到一个执行 worktree。
    普通执行修订不取消、不重挂，也不产生新版本号。
12. **Snapshot-bound execution**: 每次初始挂载或修订都复制当前 Plan 和
    executionBinding 形成 immutable ExecutionPlanSnapshot；ExecutionRun 以
    CAS 指向当前快照，历史快照保留审计。
13. **Continuous Plan Run**: 一次执行授权在 Plan 已接受范围内连续跨越多个
    Task、Goal Slice 和 agent review gate，直到 Plan 完成或命中真实 hard
    boundary。
14. **Agent-led review**: Review 是 Development Run 内部质量 Gate。Agent
    默认调用项目 Review Skills、自修并重审；用户只处理接受源无法裁决或需要外部
    权限的高风险决定。
15. **Host-neutral control plane**: 调度、Journey、Session、evidence 与 cleanup
    由项目 Owner 定义；TRAE、Cursor、Codex 仅作为按当前 capability inventory
    选择的工具 transport。
16. **Unversioned internal workflow**: 内部流程没有 `vN` 阶段。Plan、Task、
    Acceptance Execution 与 rollout receipt 使用 `kind` 和唯一当前格式。
17. **Authorization reuse**: 用户或 accepted Plan 已明确授权的精确操作必须
    直接执行；操作类别、Task 切换、重试、上下文压缩和宿主变化都不能触发重复
    询问。只有操作超出授权包，或已准入操作实际返回外部权限错误时，才提出权限
    问题。
18. **Personal policy stays local**: 用户专属的语言、措辞和 coaching 偏好只
    通过 machine-local Overlay 注入；共享 Skill 与项目执行语义不携带个人策略。
19. **Owner-rooted execution**: 一个可见开发会话只创建一个不可变 OWNER
    binding；内部 WORKER/REVIEWER 通过显式 assignment 形成 child lineage，
    不能升级为并列 owner。
20. **Canonical binding projection**: 每次 hook、状态、handoff 和 completion
    claim 都消费同一个 `BindingProjection`，其中分别给出 execution root、
    subject roots、role、lineage、release 和 child liveness。
21. **Capability-honest enforcement**: 只有宿主规定的稳定 root-chat identity 和可阻断
    `PreToolUse` 同时存在时才声明 `ENFORCED`；其他宿主只能明确标记为
    `OBSERVE_ONLY`。
22. **No worktree as a workaround**: Agent 不得为了绕过 Plan mount、
    lifecycle 或并发错误自行创建 worktree；worktree 创建只来自用户明确选择的
    隔离或并行需求。
23. **Aggregate before acquire**: 模块 Skill 只描述 `ModuleImpact`；Dev
    Workflow 在任何 runtime acquisition 前统一解析 target、依赖、峰值容量和
    资源复用，业务 Gate 只 attach 到已准备的 runtime manifest。
24. **Native Desktop only**: Desktop functional and formal proof uses one
    native Tauri runtime. Browser launch, browser runtime classes, and browser
    product proof do not exist.
25. **Explicit no-Plan is standalone**: 用户明确拒绝为当前请求创建 Plan 时，
    intake 必须保持 worktree unmounted，禁止进入 Plan model/persistence 或
    伪造 Task、Session、active-work；声明、验证、review 和 cleanup 仍执行。
26. **Close is coordinated, owners stay separate**: `dev-close` 在 workspace
    lifecycle fence 下按 owner 顺序关闭资源并写可恢复
    `DevelopmentCloseReceipt`；它不接管 Session、declaration、PlanMount、
    lease 或 environment 的真源。

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing Proof |
|---|---|---|---|---|
| 外层流程是 `PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER` | `verified_fact` | `docs/global/workflow.md`; `pt-dev-workflow` | high | none |
| 当前 `active_work.current_step` 是自由文本 | `verified_fact` | `AGENTS.md` 和相关 Skills | high | none |
| branch-wide Plan discovery cannot distinguish synchronized worktree ownership | `verified_fact` | pre-DWF-D18 `tooling/acceptance/core/execution_plan.py`; Group Chat reproduction | high | immutable binding regression |
| Mobile Shell 计划超过 4,000 行并包含大量 dated progress | `verified_fact` | `20260827-mobile-shell-implementation.md` | high | none |
| `DevelopmentSession` 已由 bounded event journal、snapshot replay 与 guarded transitions 实现 | `verified_fact` | `tooling/scripts/local-dev/dev-session-{schema,store}.mjs`; `dev-session.test.mjs` | high | none |
| compact package 会降低恢复输入且保持证明可追踪 | `proposal` | DWF-D13 | medium | pilot metrics and adversarial simulation |
| Context Anchor 的 `Next action` 是无结构自由文本 | `verified_fact` | `tooling/skills/pt-context-anchor/SKILL.md` | high | none |
| `planctl status` 未输出 Task closure 进度和下一关闭效果 | `verified_fact` | `tooling/scripts/plan/plan-package.mjs` | high | none |
| canonical `pt-ew` 强制所有消费者执行英语翻译和纠正 | `verified_fact` | pre-DWF-D25 `tooling/skills/pt-ew/SKILL.md` | high | machine-local Overlay regression |
| digest-addressed installed copy 可隔离安装后的 source mutation | `accepted_decision` | DWF-D25 | high | control-plane unit tests |
| hook `cwd` 同时承担聊天身份和工具作用路径会导致跨 worktree 权限漂移 | `verified_fact` | pre-DWF-D26 `workflow-guard.mjs`; adversarial kernel fixtures | high | none |
| Cursor project hooks 提供稳定 `conversation_id`、`workspace_roots`、可阻断 `preToolUse` 和 `failClosed` | `verified_fact` | Cursor Hooks official documentation; adapter fixtures | high | live Cursor session |
| TRAE payload 的 `chat_session_id` 标识可见顶层会话，而内部 reviewer/retry/subtask 可使用不同 `session_id` | `verified_fact` | high-chat 24-binding reproduction；TRAE hook payload capture | high | production regression |
| 当前 binding schema 没有 role、root/parent lineage 或 child lifecycle | `verified_fact` | `workflow-conversation-binding.mjs`; 20 条 unreleased high-chat records | high | none |
| `resolveActiveConversationBinding()` 将同 worktree 未 release 记录作为 peer owner，并强制全局唯一 | `verified_fact` | `workflow-conversation-binding.mjs`; `completion-review.mjs` | high | none |
| 20 条冲突记录中多数 RUNNING Action Receipt lease 已过期，并不代表 live owner | `verified_fact` | workspace `95620934d3348d95` machine-store audit | high | none |
| Mobile execution used successive Plan versions only to add missing write paths/Gates while the accepted goal and every Task state remained unchanged | `verified_fact` | MPS v4/v5 and current mount/run records | high | stable-Plan amendment regression |
| OWNER 不按通用 TTL 过期；child 由 assignment lease 与 terminal receipt 定义 liveness | `accepted_decision` | DWF-D33 | high | owner/child lifecycle tests |
| TRAE Hook 是等价事件入口而非 owner authority；参与根共享一个 canonical Kernel | `accepted_decision` | DWF-D35 | high | multi-root projection regression |
| 非破坏性 projection 不依赖待安装 Hook 的 grant；cleanup 仍需 exact OWNER grant | `accepted_decision` | DWF-D36 | high | ungranted install and cleanup-grant tests |

## 3. System Architecture

Intake first resolves one immutable request policy:

```text
explicit no-Plan intent -> standalone declaration -> execution/review/delivery
accepted formal Plan    -> PlanMount -> snapshot/run -> tracked execution
```

Task size cannot upgrade standalone intent into tracked work. A live PlanMount
cannot be downgraded by standalone intent; that conflict requires an explicit
owner action.

```text
accepted product + architecture
              |
              v
┌──────────────────────────────────────────────────────────────┐
│ Stable Plan                                                  │
│ plan.md + tasks: northStar / current scope / DAG / gates     │
└───────────────┬──────────────────────────────────────────────┘
                │ explicit PlanMount
                v
┌──────────────────────────────────────────────────────────────┐
│ ExecutionPlanSnapshot + ExecutionRun                         │
│ immutable revisions / current snapshot + mutable lifecycle   │
└───────────────┬──────────────────────────────────────────────┘
                │ current task
                v
┌──────────────────────────────────────────────────────────────┐
│ Development Session                                          │
│ session.json: current transition state + first failure       │
│ events.ndjson: bounded transition history                    │
└──────────┬───────────────────┬───────────────────────────────┘
           │                   │
           v                   v
       Git checkpoint     Local Dev Control Plane
       source identity    profile / slot / lease / runtime
           │                   │
           └─────────┬─────────┘
                     ├──────────────► SOURCE_READY
                     │                source claim only
                     v
               FUNCTIONAL_PASS
                     |
          ┌──────────┴──────────┐
          v                     v
  Acceptance Evidence      Quality / delivery
```

## 4. Sources Of Truth And Ownership

| Concern | Owner | Canonical Source | Projection |
|---|---|---|---|
| Product behavior | Product/domain docs | accepted journeys and acceptance IDs | Task references |
| Architecture | Architecture docs | `docs/architecture/**` | manifest references |
| Current request Plan policy | Development Workflow intake | explicit user intent plus live PlanMount state | standalone or tracked dispatch |
| Stable goal and current execution model | Plan | mutable `plan.md` plus referenced Task Slices and append-only amendments | current execution snapshot |
| Plan-to-worktree occupancy | Project Ledger | immutable `PlanMount` plus live mount index | workflow inspection |
| Exact execution input and audit history | Development Workflow | immutable `ExecutionPlanSnapshot` chain | Context Anchor |
| Plan and Task lifecycle | Execution Run | machine-local `execution-run.json` | `planctl status` |
| One execution closure specification | Task Slice | current `tasks/<id>.md` machine block | immutable execution snapshot |
| Current execution transition | Development Session | machine event log + `session.json` projection | workspace active-work `devState` |
| Attempt history and first failure | Development Session | bounded `events.ndjson` and artifacts | compact failure summary |
| Current physical source identity | Git | commit/tree | declaration and Session verification |
| Current mutation source identity | Development Workflow | `DevelopmentResourceDeclaration.sourceHead` | machine-wide work ledger |
| Runtime checkpoint source identity | Development Session | `SourceCheckpoint.commit/tree` | Context Anchor evidence |
| Runtime allocation | Local Dev Control Plane | machine registry and live observation | session binding ref |
| Cross-module resource intent | Development Workflow | machine-local `PlanResourcePlan` plus public declaration claims | Context Anchor / Workflow Snapshot |
| Physical account/service/client/device/Fixture lifecycle | owning Local Dev or Acceptance Suite Runtime | owner manifest and live lease | `PlanResourcePlan.resourceResults` |
| Formal product proof | Acceptance Framework | Evidence Store | Task evidence refs |
| Current Plan ownership | Development Workflow | Project Ledger `PlanMount` | snapshot/declaration/active-work consistency checks |
| Current tracked locator | Execution Run | current Task state | workspace active-work + Context Anchor |
| Distributed workflow implementation | `peers-dev-workflow` | canonical source and rollout receipts | installed worktree-local tools and Skills |
| Read-only workflow projection | Workflow Snapshot | `workflow-snapshot-core.mjs` | CLI, Context Anchor, Doctor |
| Development conversation authority | Workflow Binding Store | one machine-local immutable OWNER binding rooted in host root-chat identity | canonical `BindingProjection` |
| Worker/reviewer identity and liveness | Workflow Binding Store | assignment, child binding, lease and terminal receipt | canonical `BindingProjection` |
| Tool action target | Workflow Kernel | normalized Tool Intent AST plus resolved `subjectRoot` | admission result |
| Final handoff completeness | Workflow Kernel | rendered Anchor receipt plus create-once release receipt | host-native Stop continuation |
| Development resource closure | Dev Workflow close coordinator | machine-local `DevelopmentCloseReceipt` plus each owner readback | Completion Auditor `close-ready` |
| User interaction preferences | user Overlay registry | `~/.peers-touch/dev/skill-overlays/registry.json` + digest-addressed installed copy | `pt-ew` resolution |
| Chat status | Context Anchor | derived projection only | none |

No owner may copy another owner's complete state. In particular:

- Plan and Task files own no execution lifecycle, evidence, or worktree
  identity.
- Execution Run owns Plan/Task lifecycle but cannot alter its snapshot.
- workspace active-work mirrors the run/session locator; disagreement
  fails sync and is repaired at the owning source before execution.
- Plan, declaration, Session and workspace active-work cannot select, replace,
  or release a PlanMount.
- Plan does not own an advancing HEAD. Declaration and Session own their
  distinct current-source responsibilities; workspace active-work projects
  them directly from Git.
- The `peers-dev-workflow` source repository never owns mutable state for a
  consuming worktree.
- Context Anchor does not read `archive/` or scan every task body.
- Development records do not satisfy formal Acceptance proof.
- Module Skills do not select concrete runtime resources or execute lifecycle
  actions; they emit standard `ModuleImpact`.
- `PlanResourcePlan` does not replace a physical lease or runtime manifest.
- Business Gates do not build, provision, log in, clean up, or release
  resources.
- Declaration release, Session archive, active-work removal, PlanMount release,
  and environment unregister remain separate owner mutations. Only a
  `CLOSED` close receipt proves their coordinated completion.

### 4.1 Methodology Runtime Boundaries

| Role | Owner | May mutate durable state? |
|---|---|---|
| Facade/router | `pt-god-view` | No |
| Development Run application service | `pt-dev-workflow` | Yes, only through the owning Plan/Task/Session/workspace active-work commands |
| Vertical dependency modeling | `pt-architecture-execution-methodology` | No |
| Repository persistence | `pt-plan-and-document` | Yes, for accepted documents and stable Plan candidates; mounting requires explicit North Star approval, ordinary amendments are Agent-owned, and North Star changes require reapproval |
| Scheduler / WHAT runs next | `pt-goal-orchestrator` | No |
| Policy / MAY this action run | `pt-execution-plan-guardian` | No |
| Runtime launch, Journey operation and functional result commit | `pt-dev-runtime-handoff` | Yes, through runtime and Session owner commands |
| Host-specific tool invocation | detected `pt-*-host-adapter` | No project durable state |
| Chat projection | `pt-context-anchor` | No |

The runtime call direction is:

```text
God View -> Dev Workflow -> Scheduler -> Guardian -> Dev Workflow executes
                               |                         |
                               +------ read only --------+
Module Skills -> ModuleImpact -> Dev Workflow Resource Aggregator
                                      |
                                      +-> public declaration claims
                                      +-> Runtime/Suite Owner manifest
Dev Workflow -> owner commands persist -> Context Anchor projects
Dev Workflow -> Runtime Handoff -> project driver
Dev Workflow -> admitted Host Capability Request -> optional Host Adapter
```

No scheduler or policy result is itself a Task/Session transition. No
projection repairs its inputs. Host adapters supply actions or observations
only; they cannot define Journey results, run repository-native fallback, or
write project state.

### 4.2 User Skill Overlay Boundary

```text
mutable local source
        |
        | explicit install / replace
        v
validated immutable copy -----> machine-local registry
                                      |
                                      | resolve target=pt-ew
                                      v
user request -> pt-ew host -> ordered interaction transforms
                                  |
                                  v
                              pt-god-view
                                  |
                                  v
                         project-owned workflow
```

The Overlay control plane is distinct from canonical project agent integration:

- `make skills` projects tracked `tooling/skills/pt-*` plus the
  supported host hook surface into the selected worktree.
- `skill-overlay-control.py` writes only under the machine Dev root and never
  edits a host discovery directory.
- The registry owns enablement and ordering. The source directory is only
  install input and is never read during normal resolution.
- The installed copy is content-addressed. Resolution rehashes it before
  returning its `SKILL.md`.
- Overlay instructions are untrusted interaction policy. They may shape
  language and presentation but cannot affect task intent, routing authority,
  Plan state, authorization, execution, evidence, or Acceptance.
- Overlay files are data only. Neither install nor runtime resolution executes
  scripts, hooks, or binaries from the package.
- An empty resolution is valid passthrough. A malformed registry, unexpected
  symlink, or digest mismatch is a typed failure and never degrades silently to
  passthrough.

### 4.3 Owner-Rooted Workflow Kernel

```text
TRAE / Cursor / Codex payload
  -> host adapter
  -> host-specific root-chat / execution-session identity
  -> BindingProjection
       OWNER | assigned WORKER | assigned REVIEWER
       rootBindingDigest + parentBindingDigest + child liveness
       immutable executionRoot + per-event subjectRoots
  -> canonical HookEvent + ToolIntent AST
  -> independently resolved subjectRoot(s)
  -> workflow owner-state inspection
  -> ALLOW | typed DENY | machine-rendered continuation
```

The first blockable `PreToolUse` atomically creates one OWNER binding from the
host's root-chat identity. TRAE uses only `chat_session_id` for that identity;
its `session_id` identifies an execution session and never creates another
owner. Cursor and Codex each use their one documented root-chat field. Generic
alias probing and process-global environment fallbacks are forbidden. The
opaque root-chat ID is retained only in owner-controlled machine-local state
and is copied into verified workflow-owner references so status consumers can
identify the originating main session.

A WORKER or REVIEWER exists only after the OWNER creates a bounded assignment.
The child first atomically publishes one assignment-keyed claim for its
execution-session hash, then publishes the child binding. Only the winning
execution session can retry or use that assignment. The resulting child binding
records `rootBindingDigest`, `parentBindingDigest`, role, Development Session
identity, lease, and terminal receipt. Unassigned internal sessions inherit the
OWNER projection for admission but cannot claim worker or reviewer independence.
Assignment creation first validates that `active-work.json` and the canonical
`session.json` identify the same current workspace, Work Item, Plan, Task,
Session, and Development state.

The Kernel distinguishes identity from action:

- `executionRoot` comes from the OWNER binding and remains immutable for the
  entire lineage;
- `subjectRoot` comes from structured tool paths, shell working directory and
  parsed shell arguments;
- reads may cross roots;
- writes must stay inside `executionRoot` and, for explicit file writes, inside
  the active declaration's `exclusive-write` claims;
- multiline commands, command substitution and unsupported shell operators
  fail closed instead of passing through regex classification.

The Kernel does not mutate Plan, Task, declaration, Development Session,
active-work, runtime, or evidence state. Its machine-local writes are limited
to atomically published OWNER bindings, assignments, assignment claims, child
bindings, child terminal receipts, one current receipt per compacting binding
lineage, exact installer-action grants, the latest rendered Anchor receipt, and
OWNER release receipt. OWNER liveness is never inferred from a generic TTL.
Child liveness is `ASSIGNED | LEASED | TERMINAL`; an expired or terminal child
is diagnostic history and cannot participate in current ownership.

Every injection contains the binding role, root/parent digests, binding digest,
release state, execution root, subject roots, tool root and target roots.
Every status, readiness, handoff and final claim revalidates the same
projection. Completion Review is a separate repository-native owner: it
derives implementation context from successful Development Sessions and
delegates through one request-scoped reviewer capability. It never reads
Workflow Bindings or Action Receipts. Canonical requests, capabilities, and
receipts live only in the versioned `completion-reviews-v3` namespace;
earlier review records are neither read nor migrated.

TRAE multi-root startup projects equivalent event ingress into the selected
source root, the descriptor bootstrap root, and descriptor roots with an
existing real `.trae` directory. Every entry calls the selected source root's
same canonical integration; Hook location is never owner authority or an
execution-root hint. On first `PreToolUse`, an explicit host task root wins
when it is one of the declared workspace roots; otherwise all mutation targets
must resolve to exactly one workspace root. Ambiguous or target-less selection
returns `WORKTREE_SELECTION_REQUIRED`. Changing the workspace descriptor or
writing these cross-root projections remains a separately declared rollout
operation. Descriptor roots without `.trae` remain untouched.

Ordinary `skills` projection is non-destructive. It completes fallible
preflight, updates equivalent host projections under the machine install lock,
and records truthful installation/callback state without requiring global idle
or a Hook-issued grant. It never deletes workflow state.

`skills-hard-cut` and `skills-gc` are separate destructive operations. Each
requires its own exact OWNER grant and global-idle proof before deleting its
bounded legacy store. A post-grant failure records `BLOCKED`; no old
binding/action schema reader, importer, alias, or dual-write path exists.

## 5. Stable Plan And Execution Contract

An active formal plan is a directory:

```text
execution-plans/<date>-<slug>/
├── plan.md
├── tasks/
│   └── <task-id>.md
└── archive/
    └── <historical-input>.md
```

`plan.md` and referenced Task Slices own:

- stable Plan identity and machine-readable North Star;
- an explicit North Star approval bound to `planId + northStarDigest`;
- criterion-to-Task/closure/Gate coverage derived from the current execution
  model;
- current scope, non-scope, architecture references, DAG, and Gate mapping;
- an append-only Amendment Log with reason, actor, impact, approval class, and
  before/after content digests;
- task ID/path/dependency graph without lifecycle state;
- one machine-readable Acceptance Execution contract;
- global authorization, completion gates and non-claims.

Project Ledger PlanMount explicitly selects one execution worktree and remains
bound to the stable `planId + planPath`. Before execution, Development Workflow
copies the current Plan plus `mountId/workspaceId/branch/initialHead` into an
immutable ExecutionPlanSnapshot. ExecutionRun exclusively owns
`pending | in_progress | blocked | done`, current Task, blockers, exhaustion,
and the current snapshot pointer. A normal amendment appends its audit record,
publishes another immutable snapshot, and advances that pointer with one CAS
update; it does not replace the Plan, mount, or run.

Plan authoring produces a candidate with `northStarApproval=null`.
`planctl validate` keeps that state visible but does not approve it. After the
user explicitly accepts the objective and criteria, `planctl
approve-north-star` atomically records the exact digest, actor, timestamp, and
decision reference. Mount and execution admission reject a missing or stale
record with `NORTH_STAR_APPROVAL_REQUIRED`.

The amendment owner compares the prior and candidate snapshots. New or changed
Tasks and their transitive dependents return to `pending`; unchanged completed
Tasks remain complete. The full candidate DAG, source containment, Task
contracts, and Acceptance mapping must validate before the new snapshot can
become current. A source edit without a matching amendment record fails closed
as `PLAN_AMENDMENT_REQUIRED`.

The complete `northStar`, including criterion IDs and source references, is the
only Plan-content boundary that invalidates North Star approval. Such a change
must first receive a fresh explicit approval, then proceeds as an
owner-approved amendment; without those records it returns
`NORTH_STAR_APPROVAL_REQUIRED` or `OWNER_DECISION_REQUIRED`. The denial names
the conflict, impacted goal, options with tradeoffs, and a recommendation.
Changes to `criterionCoverage`, Task/Gate mappings, or other execution details
do not change the North Star digest and remain Agent-owned. Operation-
authorization expansion remains separately governed and returns
`OPERATION_AUTHORIZATION_REQUIRED`.

A Plan that permits source reopening declares one strict
`Source Invalidation Policy` block beside the Package. The policy names one
source owner and one or more invalidation roots. After the failed runtime
owners are quiescent, `planctl invalidate-source` derives the transitive
affected set, persists an immutable proof of the prior manifest and evidence
references, then atomically makes the source owner current and returns the
affected closure to pending. No caller-selected owner, root, or task list is
accepted.

Mechanical bounds:

- manifest: at most 300 lines and 20 KiB;
- Task Slice: at most 200 lines and 12 KiB;
- current snapshot section: at most 30 lines;
- no `## Context Anchor`, dated progress appendix, raw command output or run-ID list.

Archive files are excluded from discovery, status, dependency and resume parsing.
They preserve history only.

The repository may contain multiple stable Plans synchronized into one PR.
Discovery never scans that set to select an owner. The Project Ledger's live
`PlanMount` names the only Plan executable in the current workspace; all other
Plans remain ordinary source files.

## 6. Task Slice Contract

A Task Slice is the smallest execution closure that can be verified and left
internally consistent. It is split by responsibility/Journey, not by file count
or individual test case.

One legacy workstream may map to multiple Task Slices. A dependency-ready source
slice and a completion/proof slice keep the same `workstreamId` but have distinct
Task IDs and dependencies. Source successors depend on predecessor source
Tasks; proof successors depend on their own source plus required predecessor
proof Tasks. An aggregate partial workstream is never made current by bypassing
incomplete completion dependencies.

Each Task Slice owns:

- stable task ID and plan ID;
- one functional boundary or Journey;
- exact in/out scope and target paths;
- dependencies, completion criteria and failure behavior;
- closure Gate reference, budgets and durable evidence references;
- a compact current snapshot.

Task lifecycle defines the progress unit. One completed Task contributes exactly
one closure unit. Commands, checks, declarations, leases, diagnostics and
individual Session transitions are execution activity, not independent progress.
Task weights are intentionally forbidden: if one Task is too broad to serve as
one meaningful progress unit, the plan owner must split it into independently
closable Task Slices.

Exactly one Task must be `in_progress` in an active ExecutionRun. A `pending`
Task is ready only when every dependency is `done`. `blocked` parks that
branch; it does not block independent ready Tasks. One worktree has one current
Task; parallel subagents are lanes inside that Task, not concurrently current
Tasks.

Task handoff is one atomic ExecutionRun update performed by `planctl advance`:

1. verify the current Session is terminal or absent for `done`, or is
   `BLOCKED` with a first-failure record for `blocked`;
2. mark the old Task `done` or `blocked`;
3. select an explicit dependency-ready successor, or no successor when complete;
4. mark that successor `in_progress`;
5. atomically replace `execution-run.json`;
6. let `pt-dev-workflow` synchronize this workspace's active-work record
   through its owner-derived command.

If execution stops after step 5, `pt-dev-workflow` retries owner-derived
active-work sync during resume. `pt-context-anchor` only reports the mismatch,
and no component reverses an owner from a stale projection.

If a blocked Task has no ready successor, the same atomic update sets package
status `blocked`. If a ready Task exists, the package remains `active` and that
Task becomes the sole `in_progress` entry.

### 6.1 Progress Slice Contract

A Progress Slice is the Task-closing progress and scheduling boundary projected
from the current Task. It is not another durable graph, status owner, or
default user interaction boundary.

`planctl status` derives:

- completed and total Task closures;
- the current Task closure;
- the exact `in_progress -> done` target transition;
- the resulting completed-count, target percentage and percentage-point delta;
- Task IDs unlocked when that closure completes.

The target endpoint is machine-derived from integer Task counts:
`completedAfter = completed + 1` and
`percentageAfter = round(100 * completedAfter / total, 2)`. The delta is the
rounded difference between independently derived current and target
percentages. Consumers display these values; they do not recompute them or
count newly unlocked pending Tasks as completed.

`pt-goal-orchestrator` may schedule multiple supporting actions inside the
Slice, but the Slice completion boundary is the Task closure. `pt-dev-workflow`
does not hand control back after a successful setup, inspection, authorization,
or diagnostic action. It continues until:

1. the target Task is `done` and the progress delta is durable; or
2. a hard product, architecture, worktree, ownership, authorization, or
   unavailable-resource boundary prevents closure.

If the current Task hard-blocks while another Task is dependency-ready, the
workflow parks the blocked branch and continues with a new Progress Slice.
Only fixed-point exhaustion may produce a zero-delta blocked handoff.

### 6.2 Plan Run Contract

A Plan Run is the user-authorized outer execution horizon:

```text
accepted Plan + authorization envelope
  -> Task Goal Slice
  -> agent review/remediation
  -> Task handoff
  -> dependency-ready successor
  -> repeat until Plan terminal or hard boundary
```

The Plan Run owns lifecycle only. `pt-dev-workflow` consumes the user's
execution intent, PlanMount, immutable snapshot, ExecutionRun, active
declaration, current Session, and accepted authorization. Task closure, review,
Context Anchor output, and context compaction do not consume authorization.

Already-authorized operations execute directly. Authorization admission is
exact and reusable:

1. match the proposed operation against explicit user grants and the accepted
   Plan's `authorization` envelope;
2. execute directly when an exact grant exists and every other Guardian check
   passes;
3. return `OPERATION_AUTHORIZATION_REQUIRED` only when the operation is denied
   or outside every explicit grant;
4. after admission, treat only an observed external permission, credential, or
   scope failure as a permission escalation.

The existence of a Plan or declaration alone grants nothing. Conversely, an
explicit allowed Plan field is authorization and cannot be discarded merely
because the operation is commit, deploy, reset, merge, release, or another
sensitive category.

Review is agent-led. Source-backed findings are fixed and re-reviewed inside the
Run. Only destructive or irreversible work, missing external authorization or
resources, unresolved material semantic choices, or fixed-point exhaustion
reach the user.

## 7. Development Session State Machine

```text
BOUND -> REPRODUCING -> REPRODUCED
  -> IMPLEMENTING -> FOCUSED_CHECKING -> FOCUSED_PASS
  -> SOURCE_READY

FOCUSED_PASS
  -> CHECKPOINTING -> CHECKPOINTED -> DEPLOYING -> DEPLOYED
  -> FUNCTIONAL_RUNNING -> FUNCTIONAL_PASS -> ACCEPTANCE_READY
  -> ACCEPTANCE_UPDATING -> FINAL_CHECKPOINTED
  -> ACCEPTANCE_RUNNING -> ACCEPTANCE_PASS -> DELIVERY_READY

active action -> FAILED | BLOCKED | STALE | CLEANING -> CANCELLED

build-mode BOUND -> IMPLEMENTING
```

Transition guards are closed, work-class aware and fail-closed:

- declaration must be ACTIVE before session start;
- Task must be the package's single `in_progress` Task;
- dependency status must be `done`;
- defect repair uses reproduction; new/refactor/infrastructure/documentation
  build mode enters implementation directly without fabricating a failure;
- forward transitions must be legal for the current state;
- `FUNCTIONAL_PASS` requires a `FUNCTIONAL_CHECK/PASS` record;
- `ACCEPTANCE_PASS` requires an `ACCEPTANCE_PROOF/PASS` reference;
- `completionClass=source` uses `runtimeClass=source-only`, owns no formal Gate,
  and terminates at `SOURCE_READY` without a functional or product claim;
- every non-documentation source Task has exactly one direct same-workstream
  functional proof successor; documentation source Tasks terminate at
  `SOURCE_READY` without inventing a runtime proof;
- `completionClass=functional` owns the development Journey execution and is
  the only class that may produce `FUNCTIONAL_PASS`;
- `completionClass=acceptance-aggregate` owns no new functional claim and may
  aggregate formal Acceptance only after every referenced product Journey has
  a current `FUNCTIONAL_CHECK/PASS`; aggregation never creates or substitutes
  functional proof;
- failure records exactly one owner and first failure;
- functional `source-only` refactor/infrastructure work may go
  `FOCUSED_PASS -> FUNCTIONAL_RUNNING` without checkpoint/deploy;
  its result rejects runtime identity, while service/native work requires the
  existing checkpoint and runtime binding;
- documentation work may close at `FOCUSED_PASS` without a product-functional claim;
- transition commit atomically replaces the bounded event log, then materializes
  `session.json`; a stale/missing snapshot is rebuilt by replay;
- the runtime result owner starts the complete current closure only from
  `FUNCTIONAL_RUNNING`, validates source/runtime/Journey identity, publishes a
  create-once evidence seal, and commits
  `FUNCTIONAL_CHECK/PASS -> FUNCTIONAL_PASS` before Task closure;
- unknown fields, unknown states and source/task mismatch reject before mutation.

The event log is the transition transaction journal. Every event carries the full
post-transition Session snapshot and a digest chain. Under one session lock, a
transition validates all events, appends one event in memory, atomically replaces
the bounded `events.ndjson`, then atomically replaces `session.json`. If execution
stops between replacements, replay deterministically rebuilds the snapshot. A
snapshot ahead of the event log is invalid. Bounded compaction writes one full
baseline event with the prior log digest before admitting more transitions.

## 8. Resume Protocol

Resume is deterministic and bounded:

1. Verify worktree binding from persisted values.
2. Resolve the workspace's live PlanMount, current immutable
   ExecutionPlanSnapshot, and ExecutionRun. Missing or mismatched ownership
   fails closed; source drift routes to `planctl amend`; no branch scan or
   alternate Plan fallback runs.
3. Validate the current snapshot; tooling may scan bounded machine blocks, but no Task
   body or archive content enters agent context.
4. If run status is `blocked`, validate typed exhaustion and recompute the
   frontier without reading a Task body. Reactivate an explicit ready Task and
   clear exhaustion, or report no current Task.
5. Otherwise resolve the ExecutionRun's one `in_progress` Task.
6. Read that Task only and replay/repair its matching Session store, if present.
7. Reconcile workspace active-work `currentTaskId`, `currentTaskPath` and
   `devState`.
8. Derive ready/parked next Tasks from the snapshot DAG and run states.
9. Emit or update Context Anchor when due, then continue the next legal
   transition without waiting for confirmation.

The emitted Anchor is a compact long-running execution contract. It carries the
stable mission, execution horizon, current closure, machine-derived progress,
the next Progress Slice and its expected delta. It does not enumerate every
supporting action or stop after administrative work.

Missing or mismatched session state is explicit `SESSION_UNAVAILABLE` or
`SESSION_IDENTITY_MISMATCH`; it never causes history reconstruction from chat.

### 8.1 Close Resume Protocol

Close is a resumable owner sequence:

```text
no live runtime lease
  -> Session archived or not applicable
  -> active-work closed or not applicable
  -> declaration released or not applicable
  -> PlanMount released or not applicable
  -> environment retained | unregistered | not registered
  -> DevelopmentCloseReceipt CLOSED
```

Each successful stage advances the receipt before the next owner. A process
failure leaves `CLOSING`; an owner failure leaves `BLOCKED` with its typed
error. Repeating the exact selector resumes the remaining stages. A different
mode, reason, owner, mount, work item, workspace, or environment policy is a
receipt mismatch, not a new close.

`owner-abandon` is the only reason allowed to archive a non-terminal Session or
release an unfinished run. It is an explicit Owner decision and preserves the
observed Session state. Deleted-worktree recovery omits root resolution and
requires the exact `workspaceId + mountId + mountedBy` tuple.

## 9. Concurrency And Cutover

- Manifest, active pointer, shared parser, generated outputs, commit, deployment,
  Fixture mutation and final Gates have one integrator owner.
- Goal scheduling is host-neutral. Detected host adapters may provide worker or
  UI transport only after scheduling and Guardian admission; missing optional
  capability degrades to serial or repository-native execution.
- Development and Acceptance execution consume the same Journey/provisioning
  adapters. The runner selects an explicit `development` or `acceptance`
  execution policy. Development writes only under the current machine Dev
  Session artifact root, emits `FUNCTIONAL_CHECK` records, and cannot finalize
  an Acceptance manifest, publish a latest pointer, or emit `PROVEN`.
  Acceptance runs later and alone owns formal proof.
- A formal single-Gate run may use a caller-supplied, format-validated,
  previously unused run ID. The ID is generated before the evidence URI is
  written into the Task snapshot; run allocation fails closed on collision and
  never substitutes another ID.
- Independent source lanes inside one Task may run in parallel only after
  manifest/schema is frozen and write sets are disjoint. Different Tasks are
  not concurrently current in one worktree.
- Runtime targets run only after one Plan-level aggregation pass. Each ready
  target publishes its complete concrete claim set atomically in canonical key
  order; physical owner actions never hold one lease while waiting for another.
- Capacity shortage parks only the conflicting target and its dependents.
  Independent target lanes continue. A global workflow lock is forbidden.
- Reuse requires compatible source, artifact, runtime, health and owner
  manifest identity. Quarantine is controlled by the physical resource owner
  and cannot be cleared by the aggregator.

## 10. Allowed And Forbidden Relationships

Allowed:

- `planctl` reads structured blocks from `plan.md` and `tasks/*.md`.
- Dev Session records refer to plan/task IDs and Git/runtime identities.
- Acceptance planner consumes the package's single Acceptance contract.
- Context Anchor projects manifest + current Task + current Session.
- `pt-ew` resolves machine-local interaction overlays and then invokes
  `pt-god-view`; it never becomes another workflow owner.

Forbidden:

- Plan or Task appending raw events, dated run narratives or full logs.
- Session files being committed or stored in the Evidence Store.
- a shared `project_memory.md active_work` table or free-text `current_step`
  remaining as a parallel runtime truth after cutover.
- Archive files affecting current status.
- Static/source checks producing `FUNCTIONAL_PASS`.
- Acceptance expanding before `FUNCTIONAL_PASS`.
- A Task file per test case or per command.
- User Overlay state in Git, canonical host projections, or project Plan state.
- An Overlay changing project routing, authorization, execution, verification,
  Acceptance, or stop conditions.
- Runtime reads from the mutable Overlay source directory.

## 11. Architecture Quality Gates

The architecture is implemented only when:

- all current Plan sources parse as stable Plans with append-only amendment
  history and no runtime legacy fallback or dual active truth;
- resume exposes only snapshot/run projection, current Task and current Session to agent context;
- plan/task bounds fail closed mechanically;
- invalid DAG, duplicate current Task and dependency violations fail;
- legal and illegal Session transitions are covered deterministically;
- symlinked CLI invocation executes rather than silently returning success;
- clock-dependent tests use an injected/current clock;
- Acceptance current-closure selection reads the immutable snapshot and run;
- work-class-specific Tasks have legal completion paths without false product claims;
- Context Anchor contains stable task pointers, not prose recovery state;
- `planctl status` exposes deterministic Task-closure progress and the next
  closure's exact target count, target percentage, delta, and unlock effect;
- tracked Development declarations publish the exact mount, snapshot, run, and
  current Task locator; Workflow Snapshot never infers progress from a work
  item or branch;
- Dev Workflow heartbeats long-running declarations before expiry and refreshes
  the declaration after source HEAD changes; the machine registration does not
  persist source HEAD;
- unrelated sibling worktree add/remove/prune operations do not invalidate the
  selected worktree's binding;
- multiple Plans may coexist in one repository/PR while each workspace
  resolves only its live PlanMount; unfinished replacement and discovery-based
  reassignment fail closed;
- an authorized checkpoint can advance declaration, Session and workspace
  active-work source identity without editing the tracked Plan or dirtying the
  checkpoint;
- CI accepts only an explicitly supplied Plan and never infers ownership from a
  PR branch;
- every non-blocked Anchor continuation targets one Task closure and cannot
  terminate successfully with zero durable progress;
- one authorized Plan Run can close multiple dependency-ready Tasks and traverse
  internal review gates without another user confirmation;
- explicit user and accepted Plan authorization survives Task/Goal/context
  boundaries, and repeat confirmation is rejected unless the operation is
  outside the envelope or an admitted attempt returns an actual permission
  failure;
- agent review findings are remediated and re-reviewed inside the Run, while
  only DWF-D20 hard boundaries reach the user;
- the same Goal and Journey contracts execute under TRAE, Cursor, and Codex
  without changing owner semantics or proof strength;
- installing, disabling, enabling, replacing, resolving, and uninstalling a
  user Overlay preserves canonical Skill rollout and returns deterministic,
  digest-verified `pt-ew` inputs;
- with no enabled Overlay, `pt-ew` passes the original user intent to
  `pt-god-view` unchanged;
- one root chat cannot change `executionRoot` after its first blockable tool
  event; cross-worktree reads pass while writes fail with
  `CROSS_WORKTREE_WRITE_DENIED`;
- one OWNER plus two assigned child sessions retain exact lineage; expired
  child leases and terminal child receipts never create owner ambiguity;
- TRAE ignores `session_id` as owner identity and requires `chat_session_id`;
  missing host-specific root identity reports `OBSERVE_ONLY`;
- subject/tool/target roots and binding lineage are injected and revalidated
  before status, handoff and final claims;
- Completion Review remains resolvable with twenty stale historical child
  records because it selects the current assigned reviewer exactly;
- Session start does not create authority and unsupported shell structure fails closed;
- terminal/blocked Stop cannot release until the machine-rendered Anchor is
  observed and a create-once release receipt is committed;
- a deterministic runner PASS cannot coexist with a pre-functional Session
  projection at Task closure;
- two independent reviews find no unresolved source-of-truth or runnable gap.
