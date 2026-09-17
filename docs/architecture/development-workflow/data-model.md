# Development Workflow Control Plane - Data Model

> **Status**: accepted
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-17
> **Owner**: Platform Team

---

## 1. Work Classification

```ts
type DevelopmentWorkClass =
  | 'product-behavior'
  | 'infrastructure'
  | 'refactor'
  | 'documentation';
```

| Class | Required functional boundary |
|---|---|
| `product-behavior` | Real producer and receiver Journey |
| `infrastructure` | Real consumer or self-hosting operational Journey |
| `refactor` | Existing product Journey remains behaviorally unchanged |
| `documentation` | Link, structure and source-consistency checks |

A product defect cannot be downgraded to infrastructure/documentation to avoid
a runtime Journey.

## 2. Plan Package Manifest

`plan.md` contains one fenced `Plan Package` JSON object:

```ts
interface PlanPackage {
  schemaVersion: 1;
  kind: 'peers-touch-plan-package';
  planId: string;
  status:
    | 'draft'
    | 'prepared'
    | 'active'
    | 'blocked'
    | 'completed'
    | 'superseded';
  binding: {
    branch: string;
    workspaceId: string;
    initialHead: string;
    expectedHead: string;
  };
  workClass: DevelopmentWorkClass;
  architecture: {
    sources: string[];
    decisions: string[];
  };
  scope: {
    sourceClaims: Array<{
      pathPrefix: string;
      mode: 'shared-read' | 'exclusive-write';
    }>;
    nonGoals: string[];
  };
  tasks: Array<{
    id: string;
    workstreamId: string;
    path: string;
    dependsOn: string[];
    status: 'pending' | 'in_progress' | 'blocked' | 'done';
    blocker: null | {
      code: string;
      owner: string;
      evidenceRef: string;
    };
  }>;
  exhaustion: null | {
    recordedAt: string;
    blockedTaskIds: string[];
    decisionRefs: string[];
    evidenceRefs: string[];
  };
  authorization: ExecutionAuthorization;
}
```

The manifest is closed-schema and stable in scope. The Task index is its only
mutable current-state field and atomically owns Task lifecycle/current selection.
It does not store:

- Development Session state;
- first failure;
- per-attempt evidence;
- dated progress narratives.

The manifest `workClass` classifies the package's overall delivery. Each Task
Slice independently classifies its own closure, and may use a different
`workClass`; Session transition guards and claim vocabulary always use the
current Task's class. This permits one product package to retain infrastructure,
refactor or documentation closures without downgrading product Tasks.

Current Task derives from exactly one manifest Task entry with
`status: in_progress`. Ready Tasks derive from the same manifest DAG and statuses.
`expectedHead` changes only after an authorized Git operation; `initialHead`
follows the immutable binding rules. Sibling worktree inventory is machine
topology and is not part of this binding.

`planctl status` also derives a read-only progress projection:

```ts
interface PlanProgress {
  unit: 'task-closure';
  completed: number;
  total: number;
  percentage: number;
  currentTaskId: string | null;
  nextProgressBoundary: null | {
    taskId: string;
    title: string;
    transition: 'in_progress->done';
    completedDelta: 1;
    percentagePointDelta: number;
    unlocksTaskIds: string[];
  };
}
```

The projection is computed from manifest lifecycle and Task titles. It is not
persisted. A non-blocked active package always exposes one
`nextProgressBoundary`. Prepared, blocked, completed and superseded packages
expose `null`.

Status rules:

- `draft` and `prepared`: zero `in_progress` Tasks and `exhaustion=null`;
- `active`: exactly one `in_progress` Task;
- `blocked`: zero `in_progress` Tasks, at least one `blocked` Task, no ready
  Task, and non-null fixed-point `exhaustion`;
- `completed`: every Task is `done`;
- `superseded`: zero `in_progress` Tasks and no live discovery.

Markdown metadata is a discovery projection. `Status`, `Branch`, `Workspace ID`
and `Initial HEAD` must equal the machine block; mismatch is invalid rather than
resolved by precedence.

## 3. Task Slice

Each `tasks/<task-id>.md` contains one fenced `Task Slice` JSON object:

```ts
interface TaskSlice {
  schemaVersion: 1;
  kind: 'peers-touch-task-slice';
  planId: string;
  taskId: string;
  workstreamId: string;
  title: string;
  workClass: DevelopmentWorkClass;
  completionClass: 'source' | 'functional' | 'acceptance-aggregate';
  executionMode: 'build' | 'fix';
  closureId: string;
  journeyId: string;
  runtimeClass:
    | 'source-only'
    | 'service'
    | 'browser'
    | 'native-desktop'
    | 'native-mobile';
  writeSet: string[];
  readSet: string[];
  budgets: {
    focusedCheckSeconds: number;
    functionalRunSeconds: number;
    cleanupSeconds: number;
  };
  checks: Array<{
    id: string;
    command: string;
    verificationClass:
      | 'SOURCE_CHECK'
      | 'STRUCTURAL_CHECK'
      | 'UX_REVIEW'
      | 'FUNCTIONAL_CHECK'
      | 'ACCEPTANCE_PROOF';
  }>;
  doneWhen: string[];
  failureBehavior: string[];
  updatedAt: string;
  durableEvidence: Array<{
    verificationClass:
      | 'SOURCE_CHECK'
      | 'STRUCTURAL_CHECK'
      | 'UX_REVIEW'
      | 'FUNCTIONAL_CHECK'
      | 'ACCEPTANCE_PROOF';
    result: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
    ref: string;
  }>;
}
```

The Markdown body explains:

- objective and responsibility;
- exact target paths;
- inputs/outputs and dependencies;
- completion and failure criteria;
- bounded verification commands;
- one `Current Snapshot` section with at most 30 lines.

Task checks must make the Session path reachable:

- every Task declares at least one focused `SOURCE_CHECK`,
  `STRUCTURAL_CHECK`, or `UX_REVIEW`;
- a `source` Task uses `runtimeClass=source-only`, declares neither
  `FUNCTIONAL_CHECK` nor `ACCEPTANCE_PROOF`, and owns an empty Acceptance
  closure;
- every non-documentation `source` Task has exactly one direct
  same-workstream `functional` successor; documentation source Tasks are
  terminal source closures and do not require a runtime proof successor;
- a `functional` Task declares at least one `FUNCTIONAL_CHECK`; when its
  Acceptance closure is non-empty it also declares `ACCEPTANCE_PROOF`;
- an `acceptance-aggregate` Task declares no `FUNCTIONAL_CHECK`, declares
  `ACCEPTANCE_PROOF`, and owns a non-empty Acceptance closure; its
  `runtimeClass` names the strongest runtime class in the aggregate;
- formal Gate ownership remains in `Acceptance Execution`; an
  `ACCEPTANCE_PROOF` record cannot substitute for `FUNCTIONAL_CHECK/PASS`.

`product-behavior + source-only` is legal only for
`completionClass=source`. A source Task becoming `done` means its source
closure reached `SOURCE_READY`; it does not imply that its workstream's
functional proof Task is done.

The Task does not own lifecycle status, current selection or transition event
history. `updatedAt` changes only when a durable task snapshot changes, not for
each command.

Task closure is the only progress unit. Task weights and command-level progress
percentages are forbidden. A Task that cannot be completed as one meaningful
continuation boundary must be split by the plan owner before execution.

## 4. Path And Scope Containment

Every source path uses one canonical representation:

- repository-relative POSIX path;
- no empty value, absolute path, NUL, `.` segment or `..` segment;
- duplicate separators and trailing separators normalize before comparison;
- an existing path and every existing parent resolve by realpath inside the
  verified repository root;
- a not-yet-created path uses its nearest existing parent for the same symlink
  containment check.

Containment is prefix-segment based, never raw string prefix. For example,
`tooling/scripts` contains `tooling/scripts/plan` but not
`tooling/scripts-old`.

Required relations:

```text
Task.writeSet
  subset of Plan.scope exclusive-write claims
  = WorkItem current-task exclusive-write scope
  subset of active DevelopmentResourceDeclaration exclusive-write claims
```

Task `readSet` must be covered by a Plan shared-read or exclusive-write claim.
The active declaration may narrow Plan scope but cannot add a source claim
outside it. Scope expansion requires a plan amendment, package validation and
atomic declaration update before mutation.

## 5. Acceptance Execution Contract

The manifest contains exactly one `Acceptance Execution` JSON contract:

```ts
interface AcceptanceExecution {
  schemaVersion: 1;
  closures: Record<string, string[]>;
  completion: string[];
  full: string[];
}
```

Rules:

- every Task `closureId` appears exactly once in `closures`;
- no closure exists without a Task;
- Gate IDs are unique non-empty strings;
- plain Acceptance runs only the current Task closure;
- completion/full remain explicit and never derive from diff expansion.

## 6. Active Work Pointer

The tracked-work row becomes:

```text
id
plan
stage
current_task_id
current_task_path
dev_state
branch
workspace_id
initial_head
expected_head
blocked
last_session
```

Ownership:

- `plan`, `stage`, binding and task pointers are a durable locator/index.
- `current_task_id/path` mirror the manifest's single `in_progress` Task, or
  both are `NONE` when package status is `blocked` or `completed`.
- `dev_state` is a projection of the current Development Session, or `NONE`
  before a Session exists.
- `blocked` is true only after fixed-point queue exhaustion.
- On disagreement, manifest and Session repair `active_work`; the projection
  never rewrites its owners.
- `current_step` is removed after package cutover; it cannot coexist as a second
  current-state field.
- adopting DWF-D17 atomically removes the obsolete sibling-topology column
  while preserving workspace and HEAD identity and appending a binding
  migration audit row.

## 7. Development Work Item

```ts
interface DevelopmentWorkItem {
  schemaVersion: 1;
  id: string;
  workClass: DevelopmentWorkClass;
  planRef: string;
  taskId: string;
  productRefs: string[];
  architectureRefs: string[];
  journeyIds: string[];
  scope: {
    sourceClaims: Array<{
      pathPrefix: string;
      mode: 'shared-read' | 'exclusive-write';
    }>;
    nonGoals: string[];
  };
  resources: DevelopmentResourceIntent;
  authorization: ExecutionAuthorization;
}
```

The Work Item is durable plan-derived input. It does not store output, runtime
credentials, screenshots or Acceptance results.

## 8. Machine-Wide Resource Declaration

The machine ledger remains:

```text
~/.peers-touch/dev/work.json
```

```ts
interface DevelopmentResourceIntent {
  sourceClaims: Array<{
    pathPrefix: string;
    mode: 'shared-read' | 'exclusive-write';
  }>;
  runtimeClaims: Array<{
    kind:
      | 'profile'
      | 'local.slot'
      | 'station.connect'
      | 'station.deploy'
      | 'station.reset'
      | 'relay.connect'
      | 'relay.deploy'
      | 'database'
      | 'client.storage'
      | 'fixture';
    resourceId: string;
    mode: 'shared' | 'exclusive';
  }>;
}

interface DevelopmentResourceDeclaration extends DevelopmentResourceIntent {
  declarationId: string;
  workItemId: string;
  sessionId: string;
  planPath: string | null;
  planId: string | null;
  taskId: string | null;
  workspaceId: string;
  branch: string;
  sourceHead: string;
  owner: string;
  purpose: string;
  journeyId: string | null;
  state: 'DECLARED' | 'ACTIVE' | 'RELEASING' | 'RELEASED' | 'STALE';
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
  declarationDigest: string;
}
```

The Plan locator fields are an all-or-none tuple. Null means the declaration is
explicitly untracked; it never means "discover a Plan". A non-null
`planPath` is repository-relative, resolves inside the declared worktree, and
must identify a package whose `planId`, binding, and current `taskId` match the
declaration. During the mixed-version rollout, legacy records may omit the
tuple; compatible readers normalize absence to a locator-less declaration
without rewriting the shared ledger.

Publication uses lock, closed-schema validation, atomic replace and digest
readback. Declaration intent never substitutes for a live runtime lease.
Relay and database claims provide machine-wide planning visibility only; they
do not create deployment, mutation or lease authority.

## 9. Execution Authorization

```ts
interface ExecutionAuthorization {
  checkpoint: {
    localCommit: 'allowed' | 'denied';
    amend: 'allowed' | 'denied';
  };
  delivery: {
    push: 'allowed' | 'denied';
    pullRequest: 'allowed' | 'denied';
  };
  runtime: {
    deployProfiles: string[];
    destructiveResetScopes: string[];
  };
  history: {
    rewrite: 'allowed' | 'denied';
  };
}
```

Local commit does not imply push; deploy does not imply reset; PR does not imply
merge; merge does not imply history rewrite.

## 10. Development Session

```ts
type DevelopmentState =
  | 'BOUND'
  | 'REPRODUCING'
  | 'REPRODUCED'
  | 'IMPLEMENTING'
  | 'FOCUSED_CHECKING'
  | 'FOCUSED_PASS'
  | 'SOURCE_READY'
  | 'CHECKPOINTING'
  | 'CHECKPOINTED'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'FUNCTIONAL_RUNNING'
  | 'FUNCTIONAL_PASS'
  | 'ACCEPTANCE_READY'
  | 'ACCEPTANCE_UPDATING'
  | 'FINAL_CHECKPOINTED'
  | 'ACCEPTANCE_RUNNING'
  | 'ACCEPTANCE_PASS'
  | 'DELIVERY_READY'
  | 'FAILED'
  | 'BLOCKED'
  | 'STALE'
  | 'CLEANING'
  | 'CANCELLED';

interface DevelopmentSessionState {
  sessionId: string;
  workItemId: string;
  planId: string;
  taskId: string;
  workspaceId: string;
  branch: string;
  journeyId: string;
  executionMode: 'build' | 'fix';
  state: DevelopmentState;
  source: SourceCheckpoint | null;
  runtimeBindingRef: string | null;
  currentFailure: DevelopmentFailure | null;
  lastVerification: VerificationRecord | null;
  startedAt: string;
  updatedAt: string;
}

interface DevelopmentSession {
  schemaVersion: 1;
  kind: 'peers-touch-development-session';
  state: DevelopmentSessionState;
  eventCount: number;
  eventDigest: string;
}
```

Session transitions describe execution state but do not increment overall
progress. A Progress Slice may contain several transitions and supporting
actions; its successful terminal effect is the manifest's current Task changing
from `in_progress` to `done`.

Only one state is current. The bounded event log owns transition order;
`session.json` is its materialized current projection. Neither is duplicated in
a Task.

## 11. Transition Event

```ts
interface DevelopmentTransitionEvent {
  schemaVersion: 1;
  kind: 'SESSION_STARTED' | 'TRANSITIONED' | 'COMPACTED_BASELINE';
  sequence: number;
  sessionId: string;
  at: string;
  reason: string;
  previousDigest: string | null;
  compactedThrough: number | null;
  snapshot: DevelopmentSessionState;
  eventDigest: string;
}
```

Constraints:

- sequence is contiguous and monotonic;
- every event carries the full post-transition Session snapshot;
- one event per atomic transition;
- maximum event count and file bytes are bounded;
- raw stdout/stderr belongs in `artifacts/`, referenced by digest/path;
- no secrets or absolute repository paths.

`eventDigest` is SHA-256 over canonical JSON for every event field except
`eventDigest` itself. `snapshot` never contains journal count/digest metadata, so
the hash has no self-reference. `session.json.eventDigest` equals the latest
event digest and `eventCount` equals the number of retained events.

Transition commit protocol:

1. acquire the work-item Session lock;
2. read and validate every complete event plus the snapshot digest/count;
3. append the next event in memory;
4. atomically replace and fsync the complete bounded `events.ndjson`;
5. derive and atomically replace `session.json`;
6. release the lock.

On read, an event log ahead of the snapshot rebuilds the snapshot. A snapshot
ahead of the event log, a non-contiguous sequence or a digest mismatch returns
`SESSION_JOURNAL_INVALID` without mutation.

When the log would exceed 256 events or 1 MiB, the writer replaces it under the
same lock with one `COMPACTED_BASELINE` carrying the full latest snapshot,
`compactedThrough` and the prior log digest. Sequence continues monotonically;
future events chain from the baseline digest.

## 12. Source Checkpoint And Verification

```ts
interface SourceCheckpoint {
  commit: string;
  tree: string;
  branch: string;
  clean: true;
  createdAt: string;
  purpose: 'development-runtime';
}

interface VerificationRecord {
  id: string;
  verificationClass:
    | 'SOURCE_CHECK'
    | 'STRUCTURAL_CHECK'
    | 'UX_REVIEW'
    | 'FUNCTIONAL_CHECK'
    | 'ACCEPTANCE_PROOF';
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
  commandDigest?: string;
  sourceCommit?: string;
  journeyId?: string;
  runtimeBindingDigest?: string;
  startedAt: string;
  durationMs: number;
  artifactRefs: string[];
}
```

`FUNCTIONAL_PASS` requires `FUNCTIONAL_CHECK/PASS`.
`ACCEPTANCE_PASS` requires `ACCEPTANCE_PROOF/PASS`.

## 13. Failure

```ts
interface DevelopmentFailure {
  kind:
    | 'REPRODUCTION_NOT_OBSERVED'
    | 'SOURCE_CHECK_FAILED'
    | 'CHECKPOINT_REQUIRED'
    | 'AUTHORIZATION_REQUIRED'
    | 'PROFILE_UNAVAILABLE'
    | 'RESOURCE_CONFLICT'
    | 'DEPLOYMENT_FAILED'
    | 'SOURCE_IDENTITY_MISMATCH'
    | 'RUNTIME_START_FAILED'
    | 'PRODUCT_ASSERTION_FAILED'
    | 'DRIVER_FAILED'
    | 'TIMEOUT'
    | 'CLEANUP_FAILED'
    | 'CANCELLED';
  stage: DevelopmentState;
  journeyStepId?: string;
  owner:
    | 'product'
    | 'source'
    | 'local-dev-control-plane'
    | 'runtime'
    | 'journey-driver'
    | 'authorization';
  summary: string;
  diagnosticRef?: string;
  retryable: boolean;
}
```

Only the current first failure lives in `session.json`. Resolution appends a new
transition event and clears `currentFailure`.

## 14. State Transition Guards

| Transition | Required guard |
|---|---|
| create -> `BOUND` | declaration ACTIVE; plan/current Task/binding match |
| `BOUND -> REPRODUCING` | `executionMode=fix`; failing Journey resolves |
| `BOUND -> IMPLEMENTING` | `executionMode=build`; accepted target and owner resolve |
| `REPRODUCING -> REPRODUCED` | reproduction result recorded |
| `REPRODUCED -> IMPLEMENTING` | first failure owner recorded |
| `IMPLEMENTING -> FOCUSED_CHECKING` | source mutation complete for this attempt |
| `FOCUSED_CHECKING -> FOCUSED_PASS` | required focused records pass |
| `FOCUSED_PASS -> SOURCE_READY` | `completionClass=source`; no functional or Acceptance claim |
| `FOCUSED_PASS -> CHECKPOINTING` | checkpoint authorized when required |
| `FOCUSED_PASS -> ACCEPTANCE_RUNNING` | `completionClass=acceptance-aggregate`; non-empty formal Gate closure |
| `CHECKPOINTING -> CHECKPOINTED` | clean source checkpoint recorded |
| `CHECKPOINTED -> DEPLOYING` | deploy authorized and runtime required |
| `DEPLOYING -> DEPLOYED` | live source/binding match |
| `DEPLOYED -> FUNCTIONAL_RUNNING` | runtime and Journey driver ready |
| `FUNCTIONAL_RUNNING -> FUNCTIONAL_PASS` | functional verification passes |
| `FUNCTIONAL_PASS -> ACCEPTANCE_READY` | no source/runtime drift |
| `ACCEPTANCE_READY -> ACCEPTANCE_UPDATING` | regression coverage change required |
| `ACCEPTANCE_READY -> FINAL_CHECKPOINTED` | current Gate already covers Journey |
| `ACCEPTANCE_UPDATING -> FINAL_CHECKPOINTED` | changed coverage passes and is checkpointed |
| `FINAL_CHECKPOINTED -> ACCEPTANCE_RUNNING` | final identity matches |
| `ACCEPTANCE_RUNNING -> ACCEPTANCE_PASS` | formal Gate proof passes |
| `ACCEPTANCE_PASS -> DELIVERY_READY` | required Quality obligations pass |

Work-class/runtime variants:

- defect repair uses `executionMode=fix` and the reproduction path;
- new capability, infrastructure, refactor and documentation use
  `executionMode=build` without fabricating a first failure;
- `completionClass=source`:
  `FOCUSED_PASS -> SOURCE_READY`;
- `completionClass=functional` with `source-only` refactor/infrastructure:
  `FOCUSED_PASS -> FUNCTIONAL_RUNNING -> FUNCTIONAL_PASS`;
- `completionClass=functional` with `service|browser|native-*`:
  `FOCUSED_PASS -> CHECKPOINTING -> ... -> FUNCTIONAL_PASS`;
- `completionClass=acceptance-aggregate`:
  `FOCUSED_PASS -> ACCEPTANCE_RUNNING -> ACCEPTANCE_PASS -> DELIVERY_READY`;
- Tasks whose closure has no formal Gate:
  `FUNCTIONAL_PASS -> DELIVERY_READY`;
- Tasks with formal Gates follow the Acceptance path above.

Recovery edges:

- `FAILED -> IMPLEMENTING`;
- `BLOCKED -> BOUND | IMPLEMENTING | DEPLOYING`, selected by failure owner;
- `STALE -> FOCUSED_CHECKING | CHECKPOINTING | DEPLOYING`;
- any active state may enter `CLEANING`;
- `CLEANING -> CANCELLED`;
- `SOURCE_READY`, `CANCELLED` and `DELIVERY_READY` are terminal.

Unknown, skipped or work-class-incompatible edges are invalid.

## 15. Plan Migration Journal

```ts
interface PlanMigrationFileSnapshot {
  sha256: string;
  identity: { device: string; inode: string };
  version: { size: string; mtimeNs: string; ctimeNs: string };
}

interface PlanMigrationPendingOperation {
  kind: 'exchange' | 'move-no-replace';
  purpose:
    | 'apply-replacement'
    | 'rollback-replacement'
    | 'remove-legacy'
    | 'restore-legacy';
  replacementIndex: number | null;
  sourcePath: string;
  destinationPath: string;
  source: PlanMigrationFileSnapshot;
  destination: PlanMigrationFileSnapshot | null;
}

interface PlanMigrationCleanup {
  mode: 'commit' | 'rollback';
  state: 'CAPTURING' | 'CAPTURED' | 'RESTORING' | 'VALIDATED' | 'DONE';
  fence: Array<{
    path: string;
    expectedSha256: string | null;
    snapshot: PlanMigrationFileSnapshot | null;
  }>;
  captures: Array<{
    sourcePath: string;
    capturedPath: string;
    deletePath: string;
    expectedSha256: string;
    presence: 'required' | 'optional' | 'absent';
    snapshot: PlanMigrationFileSnapshot | null;
    state: 'pending' | 'absent' | 'captured' | 'restored' | 'deleted';
  }>;
}

interface PlanMigrationJournal {
  schemaVersion: 1;
  kind: 'peers-touch-plan-migration';
  migrationId: string;
  workspaceId: string;
  legacyPlan: string;
  packagePlan: string;
  legacyBackupPath: string;
  phase:
    | 'PREPARED'
    | 'LOCKED'
    | 'APPLYING'
    | 'VERIFYING'
    | 'COMMITTED'
    | 'ROLLING_BACK'
    | 'ROLLED_BACK';
  legacySha256: string;
  archiveSha256: string;
  crosswalkPath: string;
  crosswalkDigest: string;
  binding: {
    branch: string;
    workspaceId: string;
    initialHead: string;
    expectedHead: string;
  };
  sourceIdentity: {
    commit: string;
    workspaceDigest: 'clean' | `sha256:${string}`;
    canonicalWorktreeHash: string;
  };
  pendingOperation: PlanMigrationPendingOperation | null;
  cleanup: PlanMigrationCleanup | null;
  oldPathReferences: Array<{
    path: string;
    occurrences: number;
  }>;
  activeWorkProjection: {
    disposition: 'assert-absent';
    registryRef: string;
    observedSha256: string;
    before: 'NONE';
    after: 'NONE';
    applied: boolean;
  };
  verification: {
    discoveryRoot: string;
    expectedActivePlanCount: 1;
    expectedPackageStatus: 'active' | 'blocked';
  };
  replacements: Array<{
    path: string;
    preparedPath: string;
    backupPath: string;
    beforeSha256: string | null;
    afterSha256: string;
    applied: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

Rules:

- all paths are repository-relative and must remain inside the bound root;
- `crosswalkPath` is hashed during preparation and its digest is revalidated
  immediately before lock acquisition and recovery;
- the live-reference set and occurrence counts are recomputed immediately
  before `LOCKED`; undeclared or newly added references fail closed;
- the Mobile pilot has no `active_work` row. Prepare, commit and recovery read
  the declared registry source directly, hash its canonical `active_work`
  section and require the observed state to remain `NONE`; caller-supplied
  state text is not authoritative;
- `binding` is revalidated from actual branch, HEAD and workspace identity
  before mutation and throughout recovery;
- a pre-DWF-D17 journal may carry the removed sibling-topology digest only in
  its already-reviewed bytes; recovery validates its shape, excludes it from
  identity comparison, and drops it on the next journal write while preserving
  the original reviewed snapshot and digest;
- `sourceIdentity.workspaceDigest` is copied from the frozen formal Gate source
  and must still match immediately before the first live replacement;
- B4 reviews the exact PREPARED `migration.json` SHA-256. Commit/recovery require
  that digest and preserve an exact `migration.json.reviewed` snapshot so every
  later journal phase is checked as a derivation of the reviewed input;
- `legacySha256` must equal `archiveSha256` and `cmp` must pass;
- `legacyBackupPath` retains the original bytes until committed-state
  verification and cleanup both pass;
- the legacy hash is revalidated before lock acquisition and again under the
  owned lock before the first replacement write;
- `verification` is journal-owned reviewed input; commit and recovery must
  verify the target status and exactly one live package without optional caller
  overrides;
- every replacement is prepared and hashed before the first live rename;
- commit and recovery prove atomic exchange and atomic no-replace support on
  both the package and journal filesystems before acquiring the migration lock;
- every `path`, `preparedPath` and `backupPath` is globally unique across all
  replacements and roles; a path cannot be both one replacement's backup and
  another replacement's target;
- replacement writes first materialize the hash-verified after-image carrier at
  `backupPath`. Before the atomic syscall, `pendingOperation` records both path
  snapshots with content hash, device/inode identity and size/mtime/ctime
  version. Existing targets use exchange; an absent target uses no-replace
  move. Recovery recognizes only the exact before or after object arrangement;
  a mismatch is restored when that is non-destructive, then fails closed
  without overwriting a concurrent writer;
- legacy removal and every rollback replacement/restore use the same
  journal-before-syscall operation record and settle it before another
  filesystem mutation;
- committed-state verification requires every replacement to be journaled as
  applied and rehashes every live target against `afterSha256` before COMMITTED;
- terminal cleanup derives one immutable target/archive fence and complete
  capture inventory from the reviewed migration. It captures all backups before
  final validation, then revalidates every terminal target/archive snapshot and
  every stable capture, persists `VALIDATED`, and only then deletes captures;
- failure during `CAPTURING` or `CAPTURED` enters `RESTORING` and restores the
  entire captured set without overwriting a concurrent file. Recovery resumes
  every cleanup state idempotently;
- an unapplied target already matching its after-hash without its journaled
  operation is rejected; rollback provenance cannot be inferred from equal
  bytes alone;
- `PREPARED` is non-blocking and permits DWF-B4 review/Gates;
- every mutating commit/recovery owns an unguessable lock token; recovery first
  acquires a separate claim and may replace only an abandoned matching lock.
  Lock metadata binds PID to boot/start identity. Stale claim/lock takeover and
  owned release atomically move the observed inode to a unique capture before
  validating its owner token, so PID reuse or a newer contender cannot be
  mistaken for the original owner;
- plan discovery returns `PLAN_MIGRATION_IN_PROGRESS` only while a live
  `migration.lock` exists or phase is `LOCKED | APPLYING | VERIFYING |
  ROLLING_BACK`; public readers infer the fixed
  `workflow/plan-migration/{migration.json,migration.lock}` path from the
  repository/workspace identity, ignore library-level machine-home injection,
  reject locator override flags and reject an unknown or malformed journal
  phase. Writers canonicalize `repoRoot`, derive `workspaceId` from that root,
  and reject any caller-supplied mismatch before journal read or lock
  acquisition;
- a package reader captures journal/lock digests before reading and requires the
  same fence after manifest/lifecycle validation and after the complete
  Task/crosswalk window, so no migration can begin and end invisibly inside one
  read;
- recovery idempotently completes every replacement or restores every backup;
- rollback rehashes every restored target against `beforeSha256` before writing
  `ROLLED_BACK`, then uses the same batch cleanup protocol;
- a missing or changed COMMITTED archive fails closed. Recovery never rebuilds
  reviewed history from the legacy backup. Re-entering commit with a
  `COMMITTED` journal resumes the owned cleanup path instead of returning
  early. Terminal journals remain bounded audit data under the machine Dev
  root.

## 16. Storage Contract

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/
├── <workItemId>/
│   ├── session.json
│   ├── events.ndjson
│   ├── session.lock
│   ├── checks/<record-id>.json
│   └── artifacts/<attempt-id>/
└── plan-migration/
    ├── migration.json
    ├── migration.json.reviewed
    ├── migration.lock
    └── migration.lock.recovery
```

Constraints:

- owner-only permissions;
- atomic event-log and `session.json` replacements under one lock;
- logically append-only bounded events with replay repair;
- injected clock for deterministic tests;
- no credential or private key;
- no repository writer;
- no fallback to Acceptance Evidence Store.
