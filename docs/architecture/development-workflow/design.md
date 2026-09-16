# Development Workflow Control Plane - Architecture Design

> **Status**: accepted
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-16
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

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing Proof |
|---|---|---|---|---|
| 外层流程是 `PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER` | `verified_fact` | `docs/global/workflow.md`; `pt-dev-workflow` | high | none |
| 当前 `active_work.current_step` 是自由文本 | `verified_fact` | `AGENTS.md` 和相关 Skills | high | none |
| 现有 execution-plan parser 只发现 `execution-plans/*.md` | `verified_fact` | `tooling/acceptance/core/execution_plan.py` | high | package parser integration |
| Mobile Shell 计划超过 4,000 行并包含大量 dated progress | `verified_fact` | `20260827-mobile-shell-implementation.md` | high | none |
| `DevelopmentSession` 目前只存在于文档模型 | `verified_fact` | DWF data model 与当前 tooling inventory | high | transition store implementation |
| compact package 会降低恢复输入且保持证明可追踪 | `proposal` | DWF-D13 | medium | pilot metrics and adversarial simulation |

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
| Current execution transition | Development Session | machine event log + `session.json` projection | `active_work.dev_state` |
| Attempt history and first failure | Development Session | bounded `events.ndjson` and artifacts | compact failure summary |
| Source identity | Git | commit/tree | session checkpoint |
| Runtime allocation | Local Dev Control Plane | machine registry and live observation | session binding ref |
| Formal product proof | Acceptance Framework | Evidence Store | Task evidence refs |
| Current tracked locator | Plan Package | current Task entry and verified binding | `active_work` + Context Anchor |
| Chat status | Context Anchor | derived projection only | none |

No owner may copy another owner's complete state. In particular:

- `plan.md` owns compact Task lifecycle fields, not Task body/status narratives.
- Task files do not copy current Task selection, Session events or raw output.
- `active_work` mirrors the manifest/session locator; disagreement is repaired
  from those owners before execution.
- Context Anchor does not read `archive/` or scan every task body.
- Development records do not satisfy formal Acceptance proof.

### 4.1 Methodology Runtime Boundaries

| Role | Owner | May mutate durable state? |
|---|---|---|
| Facade/router | `pt-god-view` | No |
| Development Run application service | `pt-dev-workflow` | Yes, only through the owning Plan/Task/Session/`active_work` commands |
| Vertical dependency modeling | `pt-architecture-execution-methodology` | No |
| Repository persistence | `pt-plan-and-document` | Yes, for accepted documents/package and initial tracked locator |
| Scheduler / WHAT runs next | `pt-trae-goal-orchestrator` | No |
| Policy / MAY this action run | `pt-execution-plan-guardian` | No |
| Chat projection | `pt-context-anchor` | No |

The runtime call direction is:

```text
God View -> Dev Workflow -> Scheduler -> Guardian -> Dev Workflow executes
                               |                         |
                               +------ read only --------+
Dev Workflow -> owner commands persist -> Context Anchor projects
```

No scheduler or policy result is itself a Task/Session transition. No
projection repairs its inputs.

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

- verified worktree binding and plan identity;
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

Mechanical bounds:

- manifest: at most 300 lines and 20 KiB;
- Task Slice: at most 200 lines and 12 KiB;
- current snapshot section: at most 30 lines;
- no `## Context Anchor`, dated progress appendix, raw command output or run-ID list.

Archive files are excluded from discovery, status, dependency and resume parsing.
They preserve history only.

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

Exactly one Task must be `in_progress` in an active package. A `pending` Task is
ready only when every dependency is `done`. `blocked` parks that branch; it does
not block independent ready Tasks. One worktree has one current Task; parallel
subagents are lanes inside that Task, not concurrently current Tasks.

Task handoff is one atomic manifest update performed by `planctl advance`:

1. verify the current Session is terminal or absent;
2. mark the old Task `done` or `blocked`;
3. select an explicit dependency-ready successor, or no successor when complete;
4. mark that successor `in_progress`;
5. atomically replace `plan.md`;
6. let `pt-dev-workflow` update `active_work` through its owner path.

If execution stops after step 5, `pt-dev-workflow` repairs `active_work` from
the manifest during resume. `pt-context-anchor` only reports the mismatch, and
no component reverses the manifest from a stale projection.

If a blocked Task has no ready successor, the same atomic update sets package
status `blocked`. If a ready Task exists, the package remains `active` and that
Task becomes the sole `in_progress` entry.

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
  service/native work requires checkpoint and runtime identity;
- documentation work may close at `FOCUSED_PASS` without a product-functional claim;
- transition commit atomically replaces the bounded event log, then materializes
  `session.json`; a stale/missing snapshot is rebuilt by replay;
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
2. Resolve the one active Plan Package.
3. Run `planctl validate`; tooling may scan bounded machine blocks, but no Task
   body or archive content enters agent context.
4. If package status is `blocked`, validate typed exhaustion and recompute the
   frontier without reading a Task body. Reactivate an explicit ready Task and
   clear exhaustion, or report no current Task.
5. Otherwise resolve the manifest's one `in_progress` Task.
6. Read that Task only and replay/repair its matching Session store, if present.
7. Reconcile `active_work.current_task_id`, `current_task_path` and `dev_state`.
8. Derive ready/parked next Tasks from the manifest DAG.
9. Emit or update Context Anchor, then continue the next legal transition.

Missing or mismatched session state is explicit `SESSION_UNAVAILABLE` or
`SESSION_IDENTITY_MISMATCH`; it never causes history reconstruction from chat.

## 9. Concurrency And Cutover

- Manifest, active pointer, shared parser, generated outputs, commit, deployment,
  Fixture mutation and final Gates have one integrator owner.
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

Forbidden:

- Plan or Task appending raw events, dated run narratives or full logs.
- Session files being committed or stored in the Evidence Store.
- `active_work.current_step` remaining as a parallel free-text truth after cutover.
- Archive files affecting current status.
- Static/source checks producing `FUNCTIONAL_PASS`.
- Acceptance expanding before `FUNCTIONAL_PASS`.
- A Task file per test case or per command.

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
- two independent reviews find no unresolved source-of-truth or runnable gap.
