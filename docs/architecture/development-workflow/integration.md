# Development Workflow Control Plane - Integration

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-05
> **Owner**: Platform Team

---

## 1. Existing System Mapping

| Existing owner/path | Current role | Target relationship |
|---|---|---|
| `docs/global/workflow.md` | Outer development stages | Retains stages; points PLAN/EXECUTE to Plan Version, mount, run, and Session |
| `pt-god-view` | Methodology entry facade | Classifies intent and routes exactly one owner; never executes or persists |
| `pt-dev-workflow` | Stage classification and dispatch | Sole intake-to-close Development Run application service |
| `pt-architecture-execution-methodology` | Execution-plan analysis | Produces the vertical dependency model without writing files |
| `pt-plan-and-document` | Document writer | Persists the accepted model as a frozen Plan Version; explicit owner action mounts it for execution |
| `pt-goal-orchestrator` | Host-neutral Goal scheduler | Projects Ready/Parked work, order, and concurrency without durable mutation |
| `pt-dev-runtime-handoff` | Runtime verification owner | Selects project drivers, operates the Journey, commits Session results, and cleans up |
| `pt-*-host-adapter` | Optional host transport | Invokes capabilities exposed by detected TRAE, Cursor, Codex, or future hosts |
| `pt-execution-plan-guardian` | Plan-conformance guard | Returns a read-only allow/deny/escalate decision for one proposed action |
| `pt-context-anchor` | Status adapter | Validates owners and renders a read-only chat projection |
| `execution-plan.py` | Resolves local or explicit Plan input | Loads the current PlanMount and immutable snapshot locally; CI validates explicit frozen Plan inputs |
| `acceptance-plan.py` | Selects current closure Gates | Uses current Task `closureId` from package |
| `tooling/scripts/local-dev/` | Make-backed runtime commands | Adds public declaration and Session commands |
| Domain development Skills | Module-local impact policy | Emit standard `ModuleImpact`; never allocate or provision concrete resources |
| Local Dev / Acceptance Suite Runtime | Physical runtime lifecycle | Consume selected resources, return manifest-bound results, and own cleanup/quarantine |
| `skill-overlay-control.py` | Machine-local user Overlay lifecycle | Installs immutable copies and resolves interaction-only policy for `pt-ew` |
| `pt-ew` | Shared personal-workflow entry | Loads enabled user Overlays, then delegates project routing to `pt-god-view` |
| `tooling/acceptance/` | Formal product proof | Runs only after functional promotion |
| execution plans | Frozen execution specification | Immutable Plan Version + Task Slices |

## 2. Control-Plane Composition

```text
Project Ledger PlanMount
      |
      v
ExecutionPlanSnapshot -> ExecutionRun -> current Task -> Development Session
      |                    |                |                 |
      |                    |                |                 +-> transition / first failure
      |                    |                +-> closure
      |                    +-> lifecycle / evidence refs
      +-> immutable DAG / global Acceptance contract / executionBinding
                       |
             Local Dev + Git identity
                       |
                FUNCTIONAL_PASS
                       |
          Acceptance -> Quality -> Delivery
```

No layer duplicates another:

- Plan Version and Task Slices own only immutable specification.
- PlanMount owns worktree occupancy; ExecutionPlanSnapshot owns exact run input.
- ExecutionRun owns Plan/Task lifecycle and evidence references.
- Session event journal owns current transition/attempt; `session.json` is its projection.
- Local Dev owns allocation, not task completion.
- Acceptance owns proof, not development iteration.
- God View routes, Dev Workflow coordinates the Run, Goal schedules, Guardian
  authorizes, and Context Anchor projects.

## 3. Command Surface

Resource declarations:

```bash
make dev-start WORK_ITEM=<id> PURPOSE=<text> SOURCE_CLAIMS=<claims>
make dev-update WORK_ITEM=<id>
make dev-status [WORK_ITEM=<id>]
make dev-status-all
make dev-check WORK_ITEM=<id>
make dev-heartbeat WORK_ITEM=<id>
make dev-release WORK_ITEM=<id>
make dev-close WORK_ITEM=<id> MODE=<tracked|standalone> \
  CLOSE_REASON=<completed|cancelled|owner-abandon> \
  ENVIRONMENT_POLICY=<retain|unregister> \
  [MOUNT=<mount-id>] [WORKSPACE_ID=<workspace-id>]
make dev-close-status WORK_ITEM=<id> [WORKSPACE_ID=<workspace-id>]
make dev-resources-prepare WORK_ITEM=<id> RESOURCE_INPUT=<json-file>
make dev-resources-status WORK_ITEM=<id>
make dev-resource-record WORK_ITEM=<id> RESOURCE_RESULT=<json-file>
```

Tracked runs add `PLAN=<repository-relative-package-plan.md>` and
`TASK=<current-task-id>` to `dev-start` and `dev-update`. Those commands
validate the Plan locator and Task against the workspace's live PlanMount,
snapshot, and ExecutionRun before publishing it. A mounted workspace cannot
publish locator-less work.
Heartbeat runs periodically before expiry and preserves the locator. During
cleanup and delivery, a blocked/completed Plan retains its exact blocked/done
Task locator until the declaration is released.

After commit, merge, or rebase, Dev Workflow runs `make dev-update` so the
declaration source identity advances before the next mutation or runtime
acquisition. The machine registration does not store Git HEAD and therefore
requires no source refresh. Task handoff also updates the declaration's `TASK`.

The declaration schema is a hard compatibility boundary. Repository source
must be synchronized before a writer publishes mount/run locator fields into
the shared machine ledger. No legacy binding reader or inferred locator bridge
exists.

`dev-resources-prepare` runs after all affected module Skills emit
`ModuleImpact` and before the first runtime acquisition. It resolves the
current Plan target dependency closure, computes execution waves and peak
capacity, selects concrete resources from Runtime Owner inventory, and
atomically replaces the declaration's planner-owned runtime claims. Repeating
the same request is idempotent. A changed request advances the resource-plan
fencing token.

Resource shortage parks only the affected target and its dependents. A target's
claims are all-or-none, so parallel work never holds one account, service,
client, device, Fixture, or automation session while waiting for another. The
mandatory allocation owner solves the complete wave and rematches flexible
requirements before declaring a constrained target unavailable. The
Runtime Owner performs the selected `REUSE | RESTART | BUILD | PROVISION`
action and reports its manifest with `dev-resource-record`; stale fences, wrong
owners, unplanned resources, and digest mismatches fail closed.

The generated `PlanResourcePlan` is machine-local workflow evidence. It does
not replace Local Dev leases or Acceptance runtime manifests. Business Gates
remain attach-only and cannot invoke resource preparation or lifecycle
operations.
When a Local Dev lease request matches a planner-owned declaration claim,
`machine-dev-registry.mjs` requires the same resource plan to be `COMMITTED`
and current before lease acquisition. Claims present before planning remain
base declaration claims and do not acquire or lose planner ownership.

Plan Version and execution mount:

```bash
make plan-validate PLAN=<package-plan.md>
make plan-mount PLAN=<package-plan.md>
make plan-mount-status
make plan-unmount MOUNT=<mount-id> REASON=<completed|cancelled|owner-unmount>
make plan-run-activate RUN=<run-id> TASK=<ready-id>
make plan-current RUN=<run-id>
make plan-next RUN=<run-id>
make plan-status RUN=<run-id>
make plan-advance RUN=<run-id> WORK_ITEM=<id> \
  TASK=<current-id> TO=done NEXT=<ready-id> SESSION=<session.json>
make plan-cancel PLAN=<package-plan.md>
make plan-reopen RUN=<run-id> WORK_ITEM=<id>
make plan-migrate LEGACY_PLAN=<legacy.md> PACKAGE=<package-plan.md>
```

Development Session:

```bash
make dev-session-start \
  WORK_ITEM=<id> PLAN=<package-plan.md> TASK=<task-id> JOURNEY=<journey-id>
make dev-session-status WORK_ITEM=<id>
make dev-session-archive WORK_ITEM=<id> SESSION=<session-id>
make dev-transition WORK_ITEM=<id> TO=<state> REASON=<text> \
  [SOURCE=<json>] [VERIFICATION=<json>] [FAILURE=<json>] \
  [RUNTIME_BINDING_REF=<ref>]
make dev-functional-result WORK_ITEM=<id> REASON=<text> \
  [RUNTIME_CELL=<cell>]
make active-work-sync WORK_ITEM=<id> [EXPECTED_REVISION=<n>]
make active-work-status
make active-work-status-all
make active-work-close WORK_ITEM=<id> EXPECTED_REVISION=<n>
make completion-review-prepare WORK_ITEM=<id> [SCOPE=<task|plan>]
make completion-review-submit REVIEW=<id> VERDICT=<PASS|FAIL> \
  ASSESSMENT=<json-file> CAPABILITY=<reviewer-capability-json-file>
make completion-review-status WORK_ITEM=<id>
make workflow-snapshot
make workflow-doctor IDE=<trae|cursor|codex>
```

All commands:

- return structured JSON;
- return non-zero typed errors;
- accept an injected machine root/clock in tests;
- resolve direct and symlinked invocation identically;
- never infer authorization from operation need, declaration, or mere Plan
  existence; consume explicit user grants and accepted Plan authorization
  fields without requesting them again;
- never run broad Acceptance before functional promotion;
- use atomic replacement, lock metadata and replayable migration/session journals.

`dev-close` is the only normal cross-owner closure command. It verifies that
physical leases are gone, archives the exact Session, closes active-work,
releases the declaration and PlanMount, and optionally unregisters the
environment only for authorized worktree removal. Each successful step advances
the machine-local `DevelopmentCloseReceipt`; retries resume the same receipt.
New declaration and mount admission rejects an unfinished receipt.

`plan-cancel` requires the exact PlanMount owner. Low-level `dev-release`,
`active-work-close`, Session archive, Plan unmount, and environment unregister
remain owner/recovery primitives; their individual success is not a workflow
completion claim. Deleted-worktree recovery uses
`dev-close ... WORKSPACE_ID=<id> MOUNT=<id> CLOSE_REASON=owner-abandon`.

`active-work-sync` runs from the consuming worktree and derives its record from
the current mount, snapshot, run/Task, active declaration, Session and Git. It
does not accept arbitrary progress data. `active-work-status-all` and Workflow Snapshot
only enumerate per-workspace records. The canonical implementation originates
in `peers-dev-workflow`, but mutable records never report back to that source
repository.

`dev-functional-result` is the single run-and-commit path for deterministic
Development proof. It derives the current closure from the mounted snapshot and
starts the Development runner itself; callers cannot select one Gate or provide
a result file. Under the Session lock it validates the aggregate run manifest,
the exact Gate set, class-required source/runtime/cleanup artifacts, current Git
identity and Task/Journey binding. It publishes a create-once,
content-addressed evidence bundle before the Session journal and then commits
`FUNCTIONAL_PASS`.

User Skill Overlays:

```bash
make skill-overlay-install SOURCE=<local-skill-directory> [REPLACE=1]
make skill-overlay-list
make skill-overlay-enable OVERLAY=<name>
make skill-overlay-disable OVERLAY=<name>
make skill-overlay-uninstall OVERLAY=<name>
make skill-overlay-resolve [TARGET=pt-ew]
```

These commands mutate only `~/.peers-touch/dev/skill-overlays/`. They do not
project files into `.trae/skills`, `.cursor/skills`, or `.agents/skills`, and
they do not change Plan, declaration, Session, active-work, or Acceptance
state.

Agent integration:

```bash
make skills IDE=<trae|cursor|codex>
make skills IDE=trae WORKSPACE=<absolute-.code-workspace-path>
make skills-hard-cut IDE=<trae|cursor|codex>
make skills-gc IDE=<trae|cursor|codex>
make agent-integration-audit IDE=<trae|cursor|codex> ROOT=<worktree-root>
```

This is the only canonical project Skill projector. Codex also receives the
worktree-local `pt-ew-plugin`; TRAE projects equivalent canonical Hooks into
the selected source root, the descriptor bootstrap root, and descriptor roots
with an existing real `.trae` directory. Untouched roots remain untouched.
Every projected Hook calls the selected source root's same plugin and remains
transport only; the Kernel owns root selection and the single OWNER binding.
The installer preserves unrelated host files, never edits global hooks, and
does not depend on a grant from the Hook it installs. The machine ledger lock,
canonical source checks, path boundaries, workspace descriptor, merged Hook
shape, and callback proof still fail closed. Unrelated live declarations,
child assignments, Action Receipts, and Action Store activity do not block
this non-destructive projection. There is no separate acknowledgement command;
restart the IDE only when the host cannot reload changed hooks, then rerun the
audit.

`skills-hard-cut` is the only machine-store reset path. It consumes an exact
OWNER `skills-hard-cut` grant, proves global idle, validates every reset target,
then deletes only the old conversation and workflow-action stores.
`skills-gc` consumes an exact OWNER `skills-gc` grant, proves global idle, and
removes only retired project Skill/plugin projections. Neither cleanup runs
implicitly during `skills`. Reset, GC, or installation failure publishes a
bounded `BLOCKED` receipt. No legacy binding/action reader or dual writer
remains.

## 4. Skill Integration

### `pt-dev-workflow`

- permits read-only intake before declaration;
- requires active declaration before first mutation;
- dispatches stage owners and coordinates one Development Run;
- asks the Goal scheduler what is ready and the Guardian whether each proposed
  action may execute;
- performs allowed work and persists Session, Task, manifest, and
  workspace active-work updates through their owning commands;
- drains supporting actions until the current Progress Slice closes one Task or
  reaches a hard boundary;
- treats one user-authorized continuation as a Plan Run, repeatedly activating
  dependency-ready successor Tasks until the Plan is terminal or DWF-D20
  hard-boundary exhaustion is proven;
- executes an operation already granted by the user or the accepted Plan
  directly; it asks an authorization question only for an out-of-envelope
  action or after an admitted attempt returns an actual external permission
  failure;
- invokes agent-led review, fixes source-backed findings, and reruns review
  without delegating routine review to the user;
- reports task/Journey progress, not file/Gate counts;
- fences Acceptance before `FUNCTIONAL_PASS`;
- releases declaration and leases on close/cancel.

### `pt-ew`

- handles explicit Overlay install/list/enable/disable/uninstall intent through
  the repository-owned control command;
- resolves enabled `pt-ew` Overlays from the machine-local registry before a
  normal request;
- reads only resolver-returned, digest-verified installed `SKILL.md` files;
- permits interaction transforms but rejects any attempt to change task intent,
  owner routing, authorization, Plan execution, verification, Acceptance, or
  stop conditions;
- passes the original request through unchanged when resolution is empty;
- delegates exactly once to `pt-god-view` after Overlay processing.

### `pt-ew-plugin`

- normalizes Codex, Cursor and TRAE lifecycle payloads into one Kernel event;
- prewarms on Session/prompt hooks but creates authority only on the first
  blockable `PreToolUse`;
- atomically binds one host root chat to one immutable OWNER
  `executionRoot`;
- accepts only preassigned WORKER/REVIEWER child sessions and projects their
  root/parent lineage, lease and terminal state;
- resolves each tool action's `subjectRoot` independently, allowing
  cross-worktree reads and denying cross-worktree writes;
- parses shell structure before classifying owner/read/mutation intent;
- denies inconsistent owner state and direct runtime-owner execution without
  mutating Plan, Task, Session, declaration, active-work or evidence;
- injects one canonical `BindingProjection` into prompts and revalidates it for
  status, readiness, handoff and final claims;
- renders a machine-owned Context Anchor and commits a create-once OWNER
  release receipt at terminal or blocked Stop;
- reports `OBSERVE_ONLY` when the host does not expose its required root-chat
  identity or blocking capability;
- no-ops outside a Peers-Touch worktree.

### `pt-architecture-execution-methodology`


- derives vertical Journey/functional closures and their dependency DAG;
- defines atomic cutovers and risk/state-based verification;
- does not persist package files, schedule lanes, or execute work.

### `pt-plan-and-document`

- renders an accepted plan model into `plan.md` plus `tasks/*.md`;
- enforces manifest/task/current-snapshot bounds;
- freezes the Plan Version and, only with an explicitly selected execution
  worktree, creates its PlanMount and immutable snapshot; after review, Dev
  Workflow creates the ExecutionRun, publishes the tracked declaration, and
  derives workspace active-work from its owners;
- creates no Context Anchor section and no progress appendix;
- uses archive only for migrated historical input.

### `pt-execution-plan-guardian`

- consumes one scheduler-proposed action;
- validates binding, current Task, dependencies, scope, ownership,
  authorization, concurrency safety, and evidence policy;
- returns `ACTION_ALLOWED` for an exact user or accepted Plan grant when all
  other checks pass, regardless of the operation category;
- returns `OPERATION_AUTHORIZATION_REQUIRED` only for a denied or
  out-of-envelope action, never to repeat an existing grant;
- returns allow, deny, or typed amendment escalation;
- never selects work, executes commands, or mutates Plan/Task/Session/tracking
  state.

### `pt-context-anchor`

Reads only:

1. matching workspace active-work record;
2. compact `plan.md`;
3. `current_task_path`;
4. matching `session.json`;
5. referenced durable evidence when needed.

It does not scan `archive/`, all Task bodies or conversation history. The chat
projection labels `dev_state` as Session-owned and Task lifecycle as
manifest-owned. Any mismatch is reported to Dev Workflow; the Anchor does not
repair it.

The projection uses `planctl status.progress` and renders one compact
continuation contract:

- stable mission and execution horizon;
- current Task closure and Session state;
- completed/total Task closures;
- completed delta since the previous Anchor;
- next Progress Slice;
- machine-derived post-Next completed count and percentage;
- expected `+1` closure and percentage-point delta;
- ordered Plan Run successor queue;
- newly unlocked Tasks, execution mandate/autonomous horizon, evidence, and
  hard boundaries.

The Anchor and Workflow Snapshot copy `completedAfter` and `percentageAfter` from
`planctl status.progress.nextProgressBoundary`. They never add rounded
percentages locally or count unlocked pending Tasks as completed.

It does not expose an administrative command as the user-facing next action.
During an authorized Plan Run it does not ask for confirmation.

### `pt-goal-orchestrator`

- builds ready queue from manifest DAG;
- maps one Goal Slice to dependency-ready actions inside the current Task;
- binds the Goal Slice completion boundary to the current Task's derived
  Progress Slice;
- chooses serial/parallel/hybrid lanes and one integration order;
- returns a successor candidate after Task closure, while Dev Workflow alone
  activates it;
- never rewrites manifest, Task, Session, workspace active-work, or evidence;
- treats stale/unaddressable agent records as runtime metadata, not blockers.

The schedule is complete before any host transport is selected. Missing worker
capability degrades to a safe serial or hybrid schedule.

### `pt-dev-runtime-handoff`

- owns runtime selection, launch, Journey operation, deterministic functional
  interpretation, Session result commit, and cleanup;
- prefers repository-native Make, Harness, embedded WebDriver, Appium, and
  native accessibility drivers; an independent Web product may use its own
  driver but never as Desktop proof;
- reports a typed missing capability without selecting a host or creating a
  request;
- rejects PASS not committed to source-bound `FUNCTIONAL_PASS` as
  `SESSION_PROJECTION_STALE`.

Host adapters supply optional transport only. Goal Orchestrator projects the
request; Dev Workflow invokes the selected adapter after Guardian admission.
Unavailable capability and cleanup quarantine are persisted with immutable
request identity, and independent ready Tasks continue.

### Agent Review Loop

Review prompts are workflow inputs, not user handoffs. Dev Workflow invokes the
stage methodology review and applicable quality/completion/code review Skills,
fixes source-backed findings, and reruns review. Only DWF-D20 hard-boundary
decisions reach the user.

### `pt-completion-auditor`

Requires one exact workspace/work-item selector and declares
`mode=tracked|standalone` plus one claim class:

- `implementation-ready`: exact active declaration and legal owner state;
- `delivery-ready`: completed implementation/review frontier before close;
- `close-ready`: exact `DevelopmentCloseReceipt=CLOSED` with no pending
  resource.

The executable lifecycle validator reports owner mismatches and missing close
evidence. The Skill still owns findings-first architecture, security, code,
test, docs, functional-proof, and overclaim judgment. Standalone mode never
requires a manufactured Plan, Session, active-work, BindingProjection, or
Completion Review receipt.

## 5. Acceptance Integration

`execution-plan.py` and `acceptance-plan.py` consume immutable snapshots through
a structured parser. Local execution loads only the current workspace
PlanMount's snapshot and run; synchronized foreign Plans are ignored.
Pull-request CI
reads `## Execution Plans / 执行计划` and invokes `--plan` once per declared
path. The current closure is the current Task's `closureId`.

The dedicated `development-workflow-control-plane` Gate runs package, Session,
legacy-declaration, package-aware execution-plan and Skill contract tests. It is
the formal Gate for DWF Task closures; `acceptance-plan-self` remains the generic
planner self-check and cannot substitute for DWF behavior.

`acceptance-run.py` exposes two explicit policies over the same selected Gate,
Journey and provisioning adapters:

- `development` writes bounded artifacts under the current machine Dev Session,
  returns a `FUNCTIONAL_CHECK` result, and cannot finalize or publish Acceptance
  evidence;
- `acceptance` writes the Evidence Store, may publish formal proof, and supports
  one preallocated run ID for an exactly-one-Gate invocation.

The preallocated ID is generated and written into the Task's durable evidence
URI before source capture. Allocation rejects an existing ID instead of
silently generating a replacement.

Compatibility policy is task-scoped, not dual truth:

- completed/inactive legacy single-file plans remain readable historical records;
- a legacy active plan is migrated atomically before further tracked execution;
- once migrated, its live references point only to package `plan.md`;
- the archived original is excluded from plan discovery and closure selection.

The diff-based planner may report candidate Gates but may not mutate the package
or current closure.

## 6. Active Work Migration

Old schema:

```text
plan | stage | current_step | binding... | blocked | last_session
```

New schema:

```text
plan | stage | current_task_id | current_task_path | dev_state |
binding... | blocked | last_session
```

Projection migration order is deterministic:

1. validate the package and current Task;
2. verify persisted worktree binding;
3. atomically advance the manifest Task index when a Task handoff is required;
4. replace `current_step` with manifest-derived task fields;
5. set `dev_state` from the replayed Session or `NONE`;
6. append one binding/schema migration audit record when required;
7. emit a Context Anchor from the new sources.

If projection update stops after manifest/Session mutation, resume repairs
workspace active-work from those owners. No fallback reads `current_step` after
migration.

The Mobile pilot has no `active_work` row in project memory. Its reviewed
crosswalk therefore declares `NONE -> NONE`; prepare, commit and recovery read
the declared project-memory registry source and require its hashed
`active_work` section to remain absent. The migration must not accept a
caller-authored state string, create a transient row or create a machine-local
copy of `active_work`.

## 7. Self-Hosting Cutover

DWF-D13 cannot rely on its parser before that parser exists. The current Mobile
Shell legacy plan therefore remains the sole execution authority and adds one
bounded `DWF-B` workstream:

1. DWF-B becomes the current closure; W6A returns to partial.
2. DWF-B owns schema, tooling, package-aware Skill implementation, migration
   preparation and both reviews; the legacy active-work pointer remains live.
3. The Mobile package stays `prepared` while DWF-B is running.
4. The final locked transaction performs the Skill/reference hard cut, verifies
   and records the reviewed `active_work NONE -> NONE` disposition, marks DWF-B
   complete, archives the legacy file and publishes the Mobile package as
   `blocked` with typed exhaustion and no current Task.

No temporary bootstrap plan or second active DWF package exists. If final
cutover fails, the journal restores the legacy Mobile plan as the same sole
active authority.

The pilot uses the package itself to exercise DWF-D14 before B5:

- source Tasks terminate at `SOURCE_READY` and unlock source successors;
- each non-documentation source Task has one direct same-workstream functional
  proof Task;
- proof Tasks execute their Journey first with the development policy, then
  formal Acceptance with the acceptance policy;
- proof unavailability parks only the proof branch and does not rewrite source
  readiness as a functional claim.

## 8. Historical Plan Inputs

Completed legacy Plan migrations are retained only under each Plan Version's `archive/` directory. No executable migration journal, compatibility reader, or workspace binding path remains.

## 9. Migration Constraints

- No generic framework beyond package parsing, transition storage and required adapters.
- No automatic commit, deploy, reset, push or history rewrite.
- No broad Acceptance run during the pilot.
- No second Profile, lease, driver, Journey or evidence authority.
- No old/new current-state owner after cutover.
- No historical raw logs copied into Task snapshots.
- No plan split by test case or command.
- No product semantic rewrite during Mobile migration.

## 10. Reporting

Before a long command:

```text
[DEV] action=<id> purpose=<one sentence> budget=<duration>
```

After completion:

```text
[DEV] result=PASS|FAIL|BLOCKED
      task=<task-id>
      state=<development-state>
      firstFailure=<one failure or none>
      next=<one legal transition or ready task>
```

Context Anchor renders current/next and blocker summary only. Detailed logs stay
in machine-local artifacts.

The `next` field is a Progress Slice, not an individual command. Its successful
completion must match the `planctl status.progress.nextProgressBoundary`
projection. Dev Workflow continues across internal actions until that boundary
is reached; otherwise it reports the hard boundary and the unchanged delta
explicitly.
