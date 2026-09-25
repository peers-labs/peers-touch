# Development Workflow Control Plane - Integration

> **Status**: accepted
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
> **Owner**: Platform Team

---

## 1. Existing System Mapping

| Existing owner/path | Current role | Target relationship |
|---|---|---|
| `docs/global/workflow.md` | Outer development stages | Retains stages; points PLAN/EXECUTE to Plan Package and Session |
| `pt-god-view` | Methodology entry facade | Classifies intent and routes exactly one owner; never executes or persists |
| `pt-dev-workflow` | Stage classification and dispatch | Sole intake-to-close Development Run application service |
| `pt-architecture-execution-methodology` | Execution-plan analysis | Produces the vertical dependency model without writing files |
| `pt-plan-and-document` | Document writer | Persists the accepted model as a bounded Plan Package and immutable workspace Plan binding |
| `pt-goal-orchestrator` | Host-neutral Goal scheduler | Projects Ready/Parked work, order, and concurrency without durable mutation |
| `pt-dev-runtime-handoff` | Runtime verification owner | Selects project drivers, operates the Journey, commits Session results, and cleans up |
| `pt-*-host-adapter` | Optional host transport | Invokes capabilities exposed by detected TRAE, Cursor, Codex, or future hosts |
| `pt-execution-plan-guardian` | Plan-conformance guard | Returns a read-only allow/deny/escalate decision for one proposed action |
| `pt-context-anchor` | Status adapter | Validates owners and renders a read-only chat projection |
| `execution-plan.py` | Resolves local or explicit Plan input | Loads the immutable workspace binding locally; CI validates every Plan path declared by the PR |
| `acceptance-plan.py` | Selects current closure Gates | Uses current Task `closureId` from package |
| `tooling/scripts/local-dev/` | Make-backed runtime commands | Adds public declaration and Session commands |
| `skill-overlay-control.py` | Machine-local user Overlay lifecycle | Installs immutable copies and resolves interaction-only policy for `pt-ew` |
| `pt-ew` | Shared personal-workflow entry | Loads enabled user Overlays, then delegates project routing to `pt-god-view` |
| `tooling/acceptance/` | Formal product proof | Runs only after functional promotion |
| execution plans | Scope and current status | Stable manifest + bounded Task snapshots |

## 2. Control-Plane Composition

```text
workspace active-work pointer
      |
      v
Plan Package -> current Task -> Development Session
      |              |                 |
      |              |                 +-> transition / first failure
      |              +-> closure and durable evidence refs
      +-> DAG / global Acceptance contract
                       |
             Local Dev + Git identity
                       |
                FUNCTIONAL_PASS
                       |
          Acceptance -> Quality -> Delivery
```

No layer duplicates another:

- Plan owns stable graph plus compact Task lifecycle/current selection.
- Task owns one closure specification/snapshot, not lifecycle or transition history.
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
```

Tracked runs add `PLAN=<repository-relative-package-plan.md>` and
`TASK=<current-task-id>` to `dev-start` and `dev-update`. Those commands
validate the Plan locator against the workspace's immutable `plan-bind` record
before publishing it. A bound workspace cannot publish locator-less work.
Heartbeat runs periodically before expiry and preserves the locator. During
cleanup and delivery, a blocked/completed Plan retains its exact blocked/done
Task locator until the declaration is released.

After commit, merge, or rebase, Dev Workflow runs both `make env-update` and
`make dev-update` so registration and declaration source identities advance
together. Task handoff also updates the declaration's `TASK`.

The declaration schema rolls out as a hard compatibility boundary. Repository
source must be synchronized to every active worktree before the first writer
publishes non-null Plan locator fields into the shared machine ledger. Until
that synchronization completes, existing declarations retain their legacy
shape and Peers Dev may use the validated Development Session only as a
read-only locator bridge. The bridge never writes inferred fields back.

Plan Package:

```bash
make plan-bind PLAN=<package-plan.md>
make plan-binding
make plan-validate PLAN=<package-plan.md>
make plan-current PLAN=<package-plan.md>
make plan-next PLAN=<package-plan.md>
make plan-status PLAN=<package-plan.md>
make plan-advance PLAN=<package-plan.md> TASK=<current-id> \
  TO=done NEXT=<ready-id>
make plan-migrate LEGACY_PLAN=<legacy.md> PACKAGE=<package-plan.md>
```

Development Session:

```bash
make dev-session-start \
  WORK_ITEM=<id> PLAN=<package-plan.md> TASK=<task-id> JOURNEY=<journey-id>
make dev-session-status WORK_ITEM=<id>
make dev-transition WORK_ITEM=<id> TO=<state> REASON=<text> \
  [SOURCE=<json>] [VERIFICATION=<json>] [FAILURE=<json>] \
  [RUNTIME_BINDING_REF=<ref>]
make dev-functional-result WORK_ITEM=<id> REASON=<text> \
  [RUNTIME_CELL=<cell>]
make active-work-sync WORK_ITEM=<id> [EXPECTED_REVISION=<n>]
make active-work-status
make active-work-status-all
make active-work-close WORK_ITEM=<id> EXPECTED_REVISION=<n>
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

`active-work-sync` runs from the consuming worktree and derives its record from
the immutable Plan binding, Plan/Task, active declaration, Session and Git. It
does not accept arbitrary progress data. `active-work-status-all` and Peers Dev
only enumerate per-workspace records. The canonical implementation originates
in `peers-dev-workflow`, but mutable records never report back to that source
repository.

`dev-functional-result` is the single run-and-commit path for deterministic
Development proof. It derives the current closure from the bound Plan and
starts the Acceptance runner itself; callers cannot select one Gate or provide
a result file, and it starts only from `FUNCTIONAL_RUNNING`. When the workspace
runtime contains `acceptance-venv`, the owner invokes its exact Python
executable; otherwise it uses the machine `python3`. The Acceptance runner then
binds portable Python Gate argv to that same executable, so an isolated child
cannot drift back to another `PATH` interpreter. Under the Session lock the
owner validates the aggregate canonical run manifest, the exact required Gate
set, all class-required child source/runtime/cleanup artifacts, current Git
identity and the Task/Journey binding. Runtime-backed classes require the
existing checkpoint and runtime binding; `source-only` rejects runtime identity.
The owner then publishes a create-once, fsynced, content-addressed evidence
bundle before the Session journal. A pre-journal failure may leave an unreferenced
orphan seal for later garbage collection, but no published journal may reference
a missing seal. Missing or substituted identity returns
`SESSION_EVIDENCE_OUT_OF_SEQUENCE`.

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
state. `make skills` remains the only canonical project Skill projector.

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
- treats one user-authorized `continue`/`execute plan` request as a Plan Run,
  repeatedly activating dependency-ready successor Tasks and scheduling new
  Goal Slices until the Plan is terminal or DWF-D20 hard-boundary exhaustion is
  proven;
- executes an operation already granted by the user or the accepted Plan
  directly; it asks an authorization question only for an out-of-envelope
  action or after an admitted attempt returns an actual external permission
  failure;
- invokes agent-led methodology, quality, completion, and code review inside
  the Run; fixes source-backed findings and reruns affected review without
  delegating ordinary review work to the user;
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

### `pt-architecture-execution-methodology`


- derives vertical Journey/functional closures and their dependency DAG;
- defines atomic cutovers and risk/state-based verification;
- does not persist package files, schedule lanes, or execute work.

### `pt-plan-and-document`

- renders an accepted plan model into `plan.md` plus `tasks/*.md`;
- enforces manifest/task/current-snapshot bounds;
- creates the immutable workspace Plan binding; after review, Dev Workflow
  publishes the tracked declaration and derives workspace active-work from its
  owners;
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

The Anchor and Peers Dev copy `completedAfter` and `percentageAfter` from
`planctl status.progress.nextProgressBoundary`. They never add rounded
percentages locally or count unlocked pending Tasks as completed.

It does not expose an administrative command as the user-facing next action.
During an authorized Plan Run it also does not ask for confirmation; the Anchor
states the autonomous horizon and hard stop conditions, then execution
continues.

### `pt-goal-orchestrator`

- builds ready queue from manifest DAG;
- maps one Goal Slice to dependency-ready actions inside the current Task;
- binds the Goal Slice completion boundary to the current Task's derived
  Progress Slice;
- chooses serial/parallel/hybrid lanes and one integration order;
- returns a successor candidate after Task closure, while Dev Workflow alone
  activates it and continues the Plan Run;
- never rewrites manifest, Task, Session, workspace active-work, or evidence;
- treats stale/unaddressable agent records as runtime metadata, not blockers.

The schedule is complete before any host transport is selected. Parallel
worker capability missing from the current host degrades to a safe serial or
hybrid schedule and does not become a project blocker.

### `pt-dev-runtime-handoff`

- owns runtime selection, launch, Journey operation policy, deterministic
  functional result interpretation, Session result commit, and cleanup;
- prefers repository-native Make, Harness, WebDriver, Appium, accessibility,
  and browser drivers;
- reports a typed missing capability and native-attempt state to Dev Workflow
  without selecting a host or creating a request;
- rejects a PASS report that has not reached the source-bound
  `FUNCTIONAL_PASS` Session state as `SESSION_PROJECTION_STALE`.

Host adapters never own a Journey assertion, proof class, Session transition,
repository-native fallback, or Task blocker. Dev Workflow alone invokes
`pt-trae-host-adapter`, `pt-cursor-host-adapter`, or
`pt-codex-host-adapter` after `pt-goal-orchestrator`, the sole Host Capability
Request projector, has bound the need and Guardian has admitted it.
`HOST_CAPABILITY_UNAVAILABLE` with a typed UI capability blocks only the
required interaction when no repository-native path exists. The repository
driver and adapter are each attempted at most once for one unchanged capability
request. Dev Workflow persists `HOST_CAPABILITY_UNAVAILABLE`; only a new
`HOST_CAPABILITY_AVAILABLE` observation with the same immutable request identity
can unblock it. Without that observation, recomputation must select independent
ready Tasks or park the dependent Task instead of retrying at zero progress. A
failed cleanup enters bounded `HOST_CLEANUP_QUARANTINED`; it cannot recursively
request cleanup or stop unrelated ready Tasks. After lease expiry one read-only
`inspect-quarantine` observation commits either `HOST_CLEANUP_RELEASED` or
`HOST_CLEANUP_ESCALATION_REQUIRED`. Repeated, identity-changing, and pre-expiry
blocked updates fail closed.

### Agent Review Loop

Review prompts remain structured inputs, not user handoff requirements. The
Development Run routes them through the repository's review stack:

```text
stage methodology review
  -> pt-quality-check
  -> pt-completion-auditor
  -> pt-github-review
  -> source-backed remediation
  -> affected checks and review rerun
```

An internal pass advances the stage or Task. A finding that accepted sources
already resolve is implementation work. Only DWF-D20 hard-boundary decisions
are projected to the user.

### `pt-completion-auditor`

Rejects:

- a package that violates bounds/DAG/current-task rules;
- completion inferred from archive or chat;
- a product Task without current functional proof;
- a plan completed while any Task is not `done`;
- workspace active-work pointers inconsistent with package/session.

## 5. Acceptance Integration

`execution-plan.py` and `acceptance-plan.py` consume package manifests through a
structured parser. Local execution loads only the immutable workspace
`planId + planPath`; synchronized foreign Plans are ignored. Pull-request CI
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

## 8. Mobile Shell Pilot

The first migration uses:

```text
docs/architecture/mobile/execution-plans/
├── 20260827-mobile-shell-implementation/
│   ├── plan.md
│   ├── tasks/
│   └── archive/
│       └── legacy-plan.md
└── 20260827-mobile-shell-implementation.md  # removed after atomic cutover
```

Requirements:

- every legacy byte is preserved in `archive/legacy-plan.md`;
- before/after SHA-256 values match and `cmp -s` succeeds;
- the migration inventory enumerates every legacy workstream, status, dependency,
  Acceptance closure, evidence reference and live path reference;
- current workstream state is reconstructed from the legacy status table and
  current repository evidence, not blindly copied from the latest prose;
- existing Acceptance Gate IDs and product assertions are unchanged;
- `tooling/acceptance/plans/mobile-shell.json` points to package `plan.md`;
- all docs references point to package `plan.md`;
- tree-wide old-path search returns only archive history and migration evidence;
- the migrated workspace binding resolves the intended package without scanning
  other active Plans;
- Mobile source changes remain untouched.

Plan migration uses a non-blocking `PREPARED` journal for DWF-B4 review, then
holds an owner-token machine lock only for
`LOCKED/APPLYING/VERIFYING/ROLLING_BACK`. Recovery first acquires its own
exclusive claim before taking over an abandoned matching lock, and lock release
verifies ownership. Discovery derives the canonical machine path from the
repository/workspace identity, fixes the locator at
`workflow/plan-migration/{migration.json,migration.lock}`, rejects caller
overrides and malformed phases, ignores library machine-home redirection, and
fails closed in locked phases. Each package read captures journal/lock digests
before reading and rechecks them after manifest validation and after the full
Task/crosswalk window. The writer canonicalizes `repoRoot`, derives the
workspace ID, and rejects mismatches before journal access. Immediately before
locking and again before recovery, the engine revalidates the reviewed
crosswalk digest, old-path reference inventory and `active_work` disposition.
It probes atomic exchange and no-replace support on the package and journal
filesystems before lock acquisition.

Replacement paths are globally unique across target/prepared/backup roles.
Prepared writes materialize the after-image carrier, durably journal a
`pendingOperation` with hash, device/inode and size/mtime/ctime snapshots for
both paths, then atomically exchange existing inodes and verify the resulting
file objects. Absent targets use atomic no-replace creation. Legacy removal and
rollback use the same journal-before-syscall protocol. Recovery can therefore
classify pre-operation, completed-operation and conflicting states without
guessing or overwriting a concurrent writer. Lock liveness binds PID to
boot/start identity so PID reuse cannot preserve an abandoned owner.

Terminal cleanup is one recoverable batch: capture every expected backup, run
one final terminal target/archive fence plus capture-stability validation,
persist `VALIDATED`, then delete captures. Any mismatch before validation moves
all captures back to their source paths. Stale claim/lock takeover uses the
same capture-before-validation rule. A changed or missing COMMITTED archive
fails closed and is never repaired from a backup. These rules permit idempotent
completion or rollback without a Git checkpoint.

## 9. Migration Constraints

- No generic framework beyond package parsing, transition storage and required adapters.
- No automatic commit, deploy, reset, push or history rewrite.
- No broad Acceptance run during the pilot.
- No second Profile, lease, driver, Journey or evidence authority.
- No host-specific scheduler, Journey, Session, or evidence authority.
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
projection. Dev Workflow continues across internal actions and, after the Task
closes, across dependency-ready successor Slices until the Plan Run ends.
Otherwise it reports the hard boundary and the unchanged delta explicitly.
