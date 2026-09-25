# Development Workflow Control Plane - Architecture Design

> **Status**: accepted
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
> **Owner**: Platform Team

---

## 1. Core Principles

1. **Journey before matrix**: 产品进度由真实用户 Journey 是否闭环决定，不由测试、
   Gate 或文档数量决定。
2. **Functional before formal proof**: 产品源码先在 exact-source 开发运行时通过
   功能验证，再补齐或执行正式 Acceptance。
3. **One owner per state**: Plan manifest 拥有 Task 生命周期和 current
   selection；Task、Session、Git、runtime lease 和 Evidence 各自只拥有其余事实。
4. **Declare before mutate**: 首次写入或占用运行资源前，必须发布并确认机器级资源声明。
5. **First failure first**: 一次运行只保留首个可行动失败；修复后回到同一 Task/Journey。
6. **Compact current state**: Git 只保存稳定计划、当前 Task 快照和 durable evidence
   引用；attempt、日志和截图留在机器 Dev root。
7. **Bounded resume**: 恢复只读取 active pointer、manifest、当前 Task 和当前 Session。
8. **No dual truth**: 迁移完成后，旧计划只能作为 archive 输入，不能继续承载状态。
9. **Progress-bearing continuation**: Context Anchor 的续作单位是可关闭一个
   Task 的 Progress Slice，不是单条命令、检查或授权动作。
10. **No zero-yield handoff**: Dev Workflow 在一个 Slice 内持续执行准备、诊断和
    修复，直到 Task 关闭并产生可计算进度，或到达真实 hard boundary。
11. **Workspace-owned Plan**: 仓库和 PR 可包含多个 active Plan；每个
    workspace 只消费一次建立且不可换绑的 Plan foreign key。
12. **Stable Plan, advancing source**: Plan 只记录 immutable initial HEAD；
    当前 Git HEAD、mutation source 与 runtime checkpoint 由外部 Owner 管理。
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

## 3. System Architecture

```text
accepted product + architecture
              |
              v
┌──────────────────────────────────────────────────────────────┐
│ Plan Package                                                 │
│ plan.md: goal / scope / DAG / task index / global gates      │
│ tasks/<id>.md: one resumable closure + durable current state │
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
| Stable goal, scope, DAG and Task lifecycle | Plan Package | `plan.md` machine block | `planctl status` |
| One execution closure specification and durable snapshot | Task Slice | `tasks/<id>.md` machine block and snapshot | Context Anchor |
| Current execution transition | Development Session | machine event log + `session.json` projection | workspace active-work `devState` |
| Attempt history and first failure | Development Session | bounded `events.ndjson` and artifacts | compact failure summary |
| Current physical source identity | Git | commit/tree | declaration and Session verification |
| Current mutation source identity | Development Workflow | `DevelopmentResourceDeclaration.sourceHead` | machine-wide work ledger |
| Runtime checkpoint source identity | Development Session | `SourceCheckpoint.commit/tree` | Context Anchor evidence |
| Runtime allocation | Local Dev Control Plane | machine registry and live observation | session binding ref |
| Formal product proof | Acceptance Framework | Evidence Store | Task evidence refs |
| Workspace Plan ownership | Development Workflow | machine-local immutable `plan-binding.json` | Plan/declaration/workspace active-work consistency checks |
| Current tracked locator | Plan Package | current Task entry | workspace active-work + Context Anchor |
| Distributed workflow implementation | `peers-dev-workflow` | canonical source and rollout receipts | installed worktree-local tools and Skills |
| User interaction preferences | user Overlay registry | `~/.peers-touch/dev/skill-overlays/registry.json` + digest-addressed installed copy | `pt-ew` resolution |
| Chat status | Context Anchor | derived projection only | none |

No owner may copy another owner's complete state. In particular:

- `plan.md` owns compact Task lifecycle fields, not Task body/status narratives.
- Task files do not copy current Task selection, Session events or raw output.
- workspace active-work mirrors the manifest/session locator; disagreement
  fails sync and is repaired at the owning source before execution.
- Plan, declaration and workspace active-work cannot select or replace the workspace
  Plan binding.
- Plan does not own an advancing HEAD. Declaration and Session own their
  distinct current-source responsibilities; workspace active-work projects
  them directly from Git.
- The `peers-dev-workflow` source repository never owns mutable state for a
  consuming worktree.
- Context Anchor does not read `archive/` or scan every task body.
- Development records do not satisfy formal Acceptance proof.

### 4.1 Methodology Runtime Boundaries

| Role | Owner | May mutate durable state? |
|---|---|---|
| Facade/router | `pt-god-view` | No |
| Development Run application service | `pt-dev-workflow` | Yes, only through the owning Plan/Task/Session/workspace active-work commands |
| Vertical dependency modeling | `pt-architecture-execution-methodology` | No |
| Repository persistence | `pt-plan-and-document` | Yes, for accepted documents/package and immutable workspace Plan binding |
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
Dev Workflow -> owner commands persist -> Context Anchor projects
Dev Workflow -> Runtime Handoff -> project driver
Dev Workflow -> admitted Host Capability Request -> optional Host Adapter
```

No scheduler or policy result is itself a Task/Session transition. No
projection repairs its inputs. A Host Adapter supplies actions or observations
only; it cannot define a Journey result, run a repository-native fallback, or
write project state. Runtime Handoff reports the missing capability;
`pt-goal-orchestrator` alone projects the Host Capability Request, and only Dev
Workflow invokes the adapter after Guardian admission.

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

The Overlay control plane is distinct from canonical project Skill rollout:

- `make skills` projects only tracked `tooling/skills/pt-*` into the detected
  host discovery directory.
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

## 5. Plan Package Contract

An active formal plan is a directory:

```text
execution-plans/<date>-<slug>/
├── plan.md
├── tasks/
│   └── <task-id>.md
└── archive/
    └── <historical-input>.md
```

`plan.md` owns:

- plan identity and its claimed worktree binding, verified against the
  machine-local immutable workspace Plan binding;
- immutable initial HEAD only, never the advancing source commit;
- current-worktree binding only; sibling worktree inventory remains
  non-authoritative machine topology;
- stable goal, scope, non-scope and architecture references;
- task ID/path/dependency graph, Task lifecycle status and compact blocker reference;
- one machine-readable Acceptance Execution contract;
- global authorization, completion gates and non-claims.

The manifest is stable in scope and bounded in mutable state. Its Task index is
the sole owner of `pending | in_progress | blocked | done`; exactly one
`in_progress` entry identifies the current Task. It does not store Development
transition state, first failure, per-attempt evidence or dated progress.
When fixed-point exhaustion leaves no ready Task, package status becomes
`blocked` with zero `in_progress` entries. Resume must re-audit the DAG before
reactivating one Task.

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

The repository may contain multiple active Plan Packages from independent
worktrees synchronized into one PR. Discovery never scans that set to select an
owner. `plan-binding.json` names the only Plan visible to the current workspace;
foreign packages remain ordinary synchronized source files.

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

Exactly one Task must be `in_progress` in an active package. A `pending` Task is
ready only when every dependency is `done`. `blocked` parks that branch; it does
not block independent ready Tasks. One worktree has one current Task; parallel
subagents are lanes inside that Task, not concurrently current Tasks.

Task handoff is one atomic manifest update performed by `planctl advance`:

1. verify the current Session is terminal or absent for `done`, or is
   `BLOCKED` with a first-failure record for `blocked`;
2. mark the old Task `done` or `blocked`;
3. select an explicit dependency-ready successor, or no successor when complete;
4. mark that successor `in_progress`;
5. atomically replace `plan.md`;
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

The Plan Run owns no duplicate durable state. `pt-dev-workflow` derives it from
the user's execution intent, the immutable workspace Plan binding, the Plan
Package DAG, active declaration, current Session, and accepted authorization.

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

After each Task closes or parks, Dev Workflow atomically updates owner state,
asks the scheduler for `NEXT`, selects a legal successor through the Plan owner
command, refreshes the declaration locator, and continues. Task closure,
stage transition, internal review success, Context Anchor emission, or context
compaction does not consume the Plan Run authorization.

At each required quality boundary, Dev Workflow executes an agent-led review
loop:

```text
focused verification
  -> pt-quality-check
  -> pt-completion-auditor
  -> pt-github-review
  -> fix source-backed findings
  -> rerun affected checks and review
```

The exact Skills vary by stage and change profile, but the user is not the
default reviewer. Human escalation is valid only for:

- an operation outside or explicitly denied by every exact grant;
- an admitted operation whose attempted execution returns an actual external
  permission, credential, or scope failure with no legal in-scope remediation;
- force push, history rewrite, merge, release, production mutation, data
  deletion/reset, environment creation, permission expansion, version/schema
  bump, worktree add/remove/prune, or secret access only when its exact grant is
  absent;
- unresolved product, architecture, security, privacy, compatibility, or
  rollout choices with multiple materially valid outcomes;
- unavailable external resources or credentials;
- fixed-point exhaustion after every dependency-ready Task and legal
  remediation has been drained.

Review findings, implementation defects, failed checks, mechanical plan repair,
successor activation, and non-destructive retries remain internal Run work.
Status projections may report them but do not ask `Continue?`.

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
- the runtime result-commit operation binds one source/runtime/Journey result to
  its Session, starts only from `FUNCTIONAL_RUNNING`, publishes the
  content-addressed evidence seal with create-once fsync semantics, and makes
  `FUNCTIONAL_CHECK/PASS -> FUNCTIONAL_PASS` durable before Task closure. A
  pre-journal failure may retain an unreferenced orphan seal; an exposed journal
  never references a deleted seal. A PASS report beside an earlier Session
  state is `SESSION_PROJECTION_STALE`;
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
2. Resolve the workspace's immutable `planId + planPath` binding and load that
   Plan Package directly. Missing or mismatched binding fails closed; no branch
   scan or alternate Plan fallback runs.
3. Run `planctl validate`; tooling may scan bounded machine blocks, but no Task
   body or archive content enters agent context.
4. If package status is `blocked`, validate typed exhaustion and recompute the
   frontier without reading a Task body. Reactivate an explicit ready Task and
   clear exhaustion, or report no current Task.
5. Otherwise resolve the manifest's one `in_progress` Task.
6. Read that Task only and replay/repair its matching Session store, if present.
7. Reconcile workspace active-work `currentTaskId`, `currentTaskPath` and
   `devState`.
8. Derive ready/parked next Tasks from the manifest DAG.
9. Emit or update Context Anchor when due, then continue the next legal
   transition without waiting for confirmation.

The emitted Anchor is a compact long-running execution contract. It carries the
stable mission, execution horizon, current closure, machine-derived progress,
the next Progress Slice and its expected delta. It does not enumerate every
supporting action or stop after administrative work.

Missing or mismatched session state is explicit `SESSION_UNAVAILABLE` or
`SESSION_IDENTITY_MISMATCH`; it never causes history reconstruction from chat.

## 9. Concurrency And Cutover

- Manifest, active pointer, shared parser, generated outputs, commit, deployment,
  Fixture mutation and final Gates have one integrator owner.
- Goal scheduling is host-neutral. Detected TRAE, Cursor, Codex, or future host
  adapters may provide worker or UI transport only after scheduling and
  Guardian admission; missing optional capability degrades to serial or
  repository-native execution.
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
- A plan migration is atomic to readers under a migration lock and journal:
  1. create a `prepared` package and byte-identical archive copy;
  2. record old/new hashes, the reviewed crosswalk digest, every live reference
     and the directly observed `active_work` disposition in a non-blocking
     `PREPARED` journal;
  3. bind the journal to actual worktree identity and the frozen formal Gate
     `workspaceDigest`, then validate package, archive hash, crosswalk,
     reference rewrite set and projection precondition;
  4. require the exact independently reviewed journal SHA-256 and preserve that
     PREPARED input as `migration.json.reviewed`;
  5. acquire an owner-token plan migration lock and enter `LOCKED`, making
     discovery fail closed through the fixed
     `workflow/plan-migration/{migration.json,migration.lock}` path; public
     readers cannot override that locator, writers derive `workspaceId` from
     the canonical repository root before journal access, and unknown journal
     phases are rejected; each reader fences the journal/lock digests before
     reading and rechecks that fence after manifest validation and again after
     the complete Task/crosswalk read window;
  6. preflight atomic exchange and no-replace support on both the package and
     journal filesystems before acquiring the migration lock; require global
     uniqueness across every target/prepared/backup path, materialize the
     after-image carrier, journal the exact source/destination file snapshots
     before the syscall, then use the platform atomic primitive and verify the
     resulting file objects; an originally absent target uses atomic no-replace
     creation, while legacy removal atomically moves the live path into its
     backup before validating the captured bytes;
  7. set the reviewed target status (`prepared`, `active` or `blocked`), verify
     the caller-declared live-plan count and record the projection disposition;
  8. rehash every applied target and mark the journal committed; initialize one
     journaled cleanup batch, capture every expected backup, revalidate the full
     terminal target/archive fence and every stable capture, persist
     `VALIDATED`, then delete the captures and release only the owned lock.

On interruption, the journal either completes the remaining idempotent replaces
or restores backups with the same exchange/no-replace primitives under an
exclusive recovery claim before releasing the owned lock. Every filesystem
mutation has one durable `pendingOperation` containing hashes, device/inode and
size/mtime/ctime version fences, so recovery distinguishes pre-syscall,
post-syscall and conflicting states without guessing. Locks and recovery claims
bind PID to boot/start identity, preventing PID reuse from impersonating a live
owner. Stale claim and lock takeover atomically move the observed inode to a
private capture before validating or discarding it. Cleanup first captures the
whole backup set; a pre-validation mismatch restores every capture, while only
a durable `VALIDATED` batch may delete captures. Rollback rehashes every
restored target before `ROLLED_BACK`. A changed or missing COMMITTED archive
fails closed; recovery never reconstructs reviewed history. Recovery
revalidates reviewed-journal lineage, actual worktree binding, the
registry-backed `active_work` observation, crosswalk, reference inventory and
replacement hashes. No reader falls through to a partially migrated plan.
- No compatibility alias may keep both old and new status owners live.

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

- a 4,000-line legacy plan migrates under lock/journal without content loss or
  dual active truth;
- resume exposes only manifest, current Task and current Session to agent context;
- plan/task bounds fail closed mechanically;
- invalid DAG, duplicate current Task and dependency violations fail;
- legal and illegal Session transitions are covered deterministically;
- symlinked CLI invocation executes rather than silently returning success;
- clock-dependent tests use an injected/current clock;
- Acceptance current-closure selection reads the Plan Package;
- work-class-specific Tasks have legal completion paths without false product claims;
- Context Anchor contains stable task pointers, not prose recovery state;
- `planctl status` exposes deterministic Task-closure progress and the next
  closure's exact target count, target percentage, delta, and unlock effect;
- tracked Development declarations publish the exact Plan Package and current
  Task locator; Peers Dev never infers progress from a work item or branch;
- Dev Workflow heartbeats long-running declarations before expiry and refreshes
  both the declaration and workspace registration after source HEAD changes;
- unrelated sibling worktree add/remove/prune operations do not invalidate the
  selected worktree's binding;
- multiple active Plans may coexist in one repository/PR while each workspace
  resolves only its immutable binding and rebind attempts fail closed;
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
- a deterministic runner PASS cannot coexist with a pre-functional Session
  projection at Task closure;
- two independent reviews find no unresolved source-of-truth or runnable gap.
