# Development Workflow Control Plane - Data Model

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-05
> **Owner**: Platform Team

---

The Development Workflow itself is unversioned. Plan, Task, Acceptance
Execution, and rollout contracts use `kind` plus a closed current shape.
Machine-state records that already participate in digest/replay chains may keep
an internal format guard for integrity; that number is never a workflow or
project version.

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

## 2. Frozen Plan Version

`plan.md` contains one fenced `Plan Version` JSON object. It is reviewed source,
not execution state:

```ts
interface PlanVersion {
  kind: 'peers-touch-plan-version';
  planId: string;
  versionId: string;
  createdAt: string;
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
  }>;
  authorization: ExecutionAuthorization;
}
```

The complete version digest is computed over canonical `PlanVersion`, every
referenced Task Slice, `Acceptance Execution`, and optional source invalidation
policy. Once frozen, no field or referenced Task file may change. A correction
creates a new `versionId` and digest through an explicit owner amendment; an
Agent cannot amend a mounted version.

The Plan Version does not store:

- execution worktree, branch, or initial HEAD;
- Plan/Task lifecycle or current selection;
- Development Session state;
- first failure;
- per-attempt evidence;
- dated progress narratives.

The version `workClass` classifies the overall delivery. Each Task
Slice independently classifies its own closure, and may use a different
`workClass`; Session transition guards and claim vocabulary always use the
current Task's class. This permits one product version to retain infrastructure,
refactor or documentation closures without downgrading product Tasks.

Current and ready Tasks derive from the mounted `ExecutionRun`, whose immutable
input is an `ExecutionPlanSnapshot`. Git remains physical source truth.
`ExecutionPlanSnapshot.executionBinding.initialHead` is the run baseline,
`DevelopmentResourceDeclaration.sourceHead` authorizes the current mutation
slice, and `DevelopmentSession.source.commit` identifies a clean runtime
checkpoint.

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
    completedAfter: number;
    percentageAfter: number;
    percentagePointDelta: number;
    unlocksTaskIds: string[];
  };
}
```

Plans that permit a completed source owner to reopen declare a separate strict
block outside the Plan Version:

```ts
interface SourceInvalidationPolicy {
  kind: 'peers-touch-source-invalidation-policy';
  sourceOwnerTaskId: string;
  rootTaskIds: string[];
}
```

The policy is optional because most Plans never reopen source. When present,
`planctl invalidate-source` derives the full transitive closure from
`rootTaskIds`; callers cannot provide an owner or affected set. The command
stores an immutable machine-local proof containing the Plan Version digest,
the first-failure reference, and every invalidated durable-evidence reference
before atomically replacing the Execution Run lifecycle projection.

The projection is computed from the immutable Task DAG plus
`ExecutionRun.taskStates`. It is not persisted. A non-blocked active run always
exposes one `nextProgressBoundary`. Prepared, blocked, completed and cancelled
runs expose `null`.

The endpoint is derived from integer Task counts:

```text
completedAfter = completed + 1
percentageAfter = round(100 * completedAfter / total, 2)
percentagePointDelta = round(percentageAfter - percentage, 2)
```

`percentageAfter` is never derived by adding a rounded delta to
`percentage`. Newly unlocked Tasks remain pending and do not contribute to
`completedAfter`.

Markdown metadata is a discovery projection. `Plan ID`, `Version ID`, and
`Created` must equal the machine block. Execution status, branch, worktree, and
source HEAD are never projected into the frozen Plan file.

## 3. Task Slice

Each `tasks/<task-id>.md` contains one fenced `Task Slice` JSON object:

```ts
interface TaskSlice {
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
    | 'native-desktop'
    | 'native-mobile';
  writeSet: string[];
  readSet: string[];
  budgets: {
    focusedCheckSeconds: number;
    functionalRunSeconds: number;
    cleanupSeconds: number;
  };
  runtimeReuse?: {
    scope: 'suite';
    entryCheckId: string;
    scenarioIds: string[];
    maxProvisioningRuns: number;
    maxClientLaunches: number;
    minWarmReuseRate: number;
    requireAttachOnlyScenarios: boolean;
    requireReceiverVisibleProof: boolean;
    allowClientReplacement: boolean;
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
- a multi-scenario executable-runtime Task that shares expensive resources
  declares closed `runtimeReuse`; `entryCheckId` names one functional check,
  Scenario IDs are unique, and count/rate budgets are valid;
- `runtimeReuse` is invalid for source or acceptance-aggregate Tasks and for
  `runtimeClass=source-only`;
- a `functional` Task with an empty Acceptance closure runs its declared
  `FUNCTIONAL_CHECK` commands directly through the Session owner, seals their
  bounded output plus the stable Git/workspace content digest, and does not
  invoke an Acceptance Gate;
- an `acceptance-aggregate` Task declares no `FUNCTIONAL_CHECK`, declares
  `ACCEPTANCE_PROOF`, owns a non-empty Acceptance closure, and uses
  `runtimeClass=source-only` because it orchestrates the Gate-owned runtime;
- formal Gate ownership remains in `Acceptance Execution`; an
  `ACCEPTANCE_PROOF` record cannot substitute for `FUNCTIONAL_CHECK/PASS`.

`product-behavior + source-only` is legal only for
`completionClass=source`. A source Task becoming `done` means its source
closure reached `SOURCE_READY`; it does not imply that its workstream's
functional proof Task is done.

The frozen Task does not own lifecycle status, current selection, durable
evidence, or transition event history. Those belong to `ExecutionRun`,
`TaskAttempt`, and Evidence. `updatedAt` changes only when a new Plan Version is
authored, never during execution.

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

## 5.1 Plan Mount Ledger

```ts
interface PlanMount {
  kind: 'peers-touch-plan-mount';
  mountId: string;
  projectId: string;
  planId: string;
  planVersionId: string;
  planVersionDigest: string;
  planPath: string;
  workspaceId: string;
  canonicalRoot: string;
  state: 'mounted' | 'released';
  mountedAt: string;
  mountedBy: string;
  releasedAt: string | null;
  releaseReason: 'completed' | 'cancelled' | 'owner-unmount' | null;
  recordDigest: string;
}
```

The machine Project Ledger stores immutable mount records and one atomic live
index:

```text
~/.peers-touch/dev/plan-mounts/ledger.json
~/.peers-touch/dev/plan-mounts/mounts/<mountId>.json
```

Rules:

- mount is explicit, owner-authorized, atomic, and idempotent for the same
  `planVersionDigest + workspaceId`;
- one workspace has at most one live mount and one Plan Version has at most one
  live execution mount unless its Plan explicitly allows parallel runs;
- a different live mount returns `PLAN_MOUNT_CONFLICT`;
- normal release requires the corresponding run to be `completed` or
  `cancelled`; an unfinished run requires explicit owner unmount;
- cancellation and release require exact `mountedBy` identity;
- deleted-worktree recovery requires explicit `workspaceId + mountId` and
  never resolves ownership from a branch or repository scan;
- mount has no TTL and is not a runtime lease;
- ledger writes hold one short atomic lock; the lock is not Plan occupancy;
- every mount record is create-once, digest-verified, and owner-controlled;
- `planPath` is repository-relative and resolves inside `canonicalRoot`;
- the referenced frozen version must match `planVersionDigest`;
- repository/branch scans, active-work, Session, and declaration recency never
  select or replace a mount;
- there is no workspace-binding, generation-advance, dual-read, or migration
  fallback path.

## 5.2 Execution Plan Snapshot And Run

```ts
interface ExecutionPlanSnapshot {
  kind: 'peers-touch-execution-plan-snapshot';
  snapshotId: string;
  capturedAt: string;
  planId: string;
  planVersionId: string;
  planVersionDigest: string;
  planPath: string;
  plan: PlanVersion;
  tasks: TaskSlice[];
  acceptance: AcceptanceExecution;
  executionBinding: {
    mountId: string;
    workspaceId: string;
    canonicalRoot: string;
    branch: string;
    initialHead: string;
  };
  recordDigest: string;
}

interface ExecutionRun {
  kind: 'peers-touch-execution-run';
  runId: string;
  snapshotId: string;
  snapshotDigest: string;
  mountId: string;
  state: 'prepared' | 'active' | 'blocked' | 'completed' | 'cancelled';
  taskStates: Record<string, {
    state: 'pending' | 'in_progress' | 'blocked' | 'done';
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
  currentTaskId: string | null;
  updatedAt: string;
  revision: number;
  recordDigest: string;
}
```

The snapshot is written once before execution and never updated. The mutable
run owns Plan/Task lifecycle only; it cannot change the snapshot, mount, source
scope, authorization, or Acceptance contract. Run storage is:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/<runId>/execution-plan-snapshot.json
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/<runId>/execution-run.json
```

Status rules:

- `prepared`: zero `in_progress` Tasks and `exhaustion=null`;
- `active`: exactly one `in_progress` Task;
- `blocked`: zero `in_progress` Tasks, at least one `blocked` Task, no ready
  Task, and non-null fixed-point `exhaustion`;
- `completed`: every Task is `done`;
- `cancelled`: no Task is `in_progress`.

`planctl cancel` is idempotent, requires the exact PlanMount owner, clears the
current Task selection, returns any in-progress Task to `pending`, and sets the
Execution Run to `cancelled`. It does not release Session, declaration,
active-work, leases, or PlanMount; `dev-close` coordinates those owners.

## 6. Workspace Active-Work Projection

The distributed workflow implementation writes one record for the consuming
workspace:

```ts
interface WorkspaceActiveWork {
  schemaVersion: 1;
  kind: 'peers-touch-workspace-active-work';
  revision: number;
  workspaceId: string;
  workItemId: string;
  mountId: string;
  runId: string;
  snapshotDigest: string;
  planId: string;
  planPath: string;
  planStatus: 'prepared' | 'active' | 'blocked' | 'completed' | 'cancelled';
  currentTaskId: string;
  currentTaskPath: string;
  taskStatus: 'pending' | 'in_progress' | 'blocked' | 'done';
  sessionId: string;
  journeyId: string;
  devState: DevelopmentState | null;
  branch: string;
  initialHead: string;
  expectedHead: string;
  updatedAt: string;
  recordDigest: string;
}
```

Storage:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/active-work.json
```

Ownership:

- `peers-dev-workflow` owns the canonical record shape and rollout implementation,
  not any consuming worktree's record.
- The installed implementation derives `workspaceId` from the consuming
  worktree's canonical root.
- `mountId/runId/snapshotDigest/planId/planPath` must equal the current
  PlanMount and ExecutionRun. The record cannot establish, replace, repair, or
  release either owner.
- `currentTaskId/currentTaskPath/taskStatus` mirror the declaration-selected
  Task and its manifest lifecycle.
- `devState` is a projection of the current Development Session, or `null`
  before a Session exists.
- `initialHead` comes from the immutable execution binding; `expectedHead`
  comes from the active declaration and must equal Git at sync time.
- Every update holds a workspace-local lock, verifies optional CAS revision,
  increments `revision`, recalculates `recordDigest`, atomically replaces the
  file, fsyncs the directory and reads back the record.
- On owner disagreement, sync fails closed; the projection never repairs its
  owners.
- Project memory, Context Anchor and Workflow Snapshot may read records but cannot write
  them. Legacy Markdown is migration-only input and has no compatibility
  writer.

## 6.1 Machine-Local User Skill Overlays

An external Overlay source contains one strict manifest beside its Skill:

```ts
interface SkillOverlayManifest {
  kind: 'peers-touch-skill-overlay';
  name: string;
  target: 'pt-ew';
  entry: 'SKILL.md';
  priority: number;
}
```

The manifest and `SKILL.md` use the same kebab-case `name`, and the source
directory name matches it. `priority` is an integer from 0 through 1000; lower
values resolve first. The manifest is closed and unversioned.

The machine registry is:

```ts
interface SkillOverlayRegistry {
  kind: 'peers-touch-skill-overlay-registry';
  overlays: Record<string, {
    name: string;
    target: 'pt-ew';
    digest: string;
    priority: number;
    enabled: boolean;
    installedAt: string;
  }>;
}
```

Storage:

```text
~/.peers-touch/dev/skill-overlays/
├── registry.json
├── registry.lock
└── store/<name>/<digest>/
    ├── overlay.json
    └── SKILL.md
```

Rules:

- install input may be outside the repository, but it must be a real directory
  with regular files only and no symlink at any depth;
- the digest covers every relative file path, mode, size, and SHA-256;
- installation stages and verifies a complete copy before atomically publishing
  the registry pointer;
- the installed copy is immutable by contract; a changed source has no effect
  until an explicit replacement install;
- replacing different content under the same name requires `--replace`;
- install, enable, disable, and uninstall hold the machine registry lock and
  write `registry.json` atomically with owner-only permissions;
- list and resolve hold the same lock for a consistent read but do not mutate
  registry or store state;
- resolution validates the closed registry and rehashes every enabled installed
  copy before returning its absolute `skillPath`;
- resolution order is ascending `priority`, then `name`;
- no registry or manifest field carries a workflow or schema version;
- the registry controls interaction policy only and is not Plan, Session,
  declaration, authorization, or Acceptance state.

## 6.2 Workflow Binding Projection

Raw host identities are never persisted. Each host adapter extracts exactly
the fields defined for that host and hashes them independently:

| Host | OWNER identity key | Assigned-child identity key |
|---|---|---|
| TRAE | `chat_session_id` | `session_id` |
| Cursor | `conversation_id` | `conversation_id` |
| Codex | `session_id` | `session_id` |

An absent required root-chat field produces `OBSERVE_ONLY`. Adapters do not
probe aliases from another host and do not read process-global identity
fallbacks.

The create-once OWNER binding is:

```ts
interface WorkflowOwnerBinding {
  kind: 'peers-touch-workflow-owner-binding';
  host: 'trae' | 'cursor' | 'codex';
  rootChatHash: string;
  role: 'OWNER';
  executionRoot: string;
  workspaceId: string;
  boundAt: string;
  bindingEvent: 'PRE_TOOL_USE';
  digest: string;
}
```

An active OWNER or child may issue a bounded child assignment:

```ts
interface WorkflowBindingAssignment {
  kind: 'peers-touch-workflow-binding-assignment';
  assignmentId: string;
  role: 'WORKER' | 'REVIEWER';
  rootBindingDigest: string;
  parentBindingDigest: string;
  workflowSessionId: string;
  operationId: string;
  issuedAt: string;
  leaseUntil: string;
  digest: string;
}

interface WorkflowAssignmentClaim {
  kind: 'peers-touch-workflow-assignment-claim';
  assignmentDigest: string;
  rootBindingDigest: string;
  host: 'trae' | 'cursor' | 'codex';
  executionSessionHash: string;
  workflowSessionId: string;
  digest: string;
}

interface WorkflowChildBinding {
  kind: 'peers-touch-workflow-child-binding';
  host: 'trae' | 'cursor' | 'codex';
  executionSessionHash: string;
  role: 'WORKER' | 'REVIEWER';
  assignmentDigest: string;
  rootBindingDigest: string;
  parentBindingDigest: string;
  workflowSessionId: string;
  executionRoot: string;
  workspaceId: string;
  boundAt: string;
  digest: string;
}

interface WorkflowChildTerminalReceipt {
  kind: 'peers-touch-workflow-child-terminal';
  childBindingDigest: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
  terminalAt: string;
  digest: string;
}
```

Assignment creation requires a current lineage projection and an active
matching Development Session. Its `rootBindingDigest` always names the OWNER;
its `parentBindingDigest` names the direct issuer. Before publishing a child
binding, claim writes one assignment-keyed create-once record. The first
execution-session hash wins; an idempotent retry by that session reuses the
claim, while every different session is rejected. A child is live only before
`leaseUntil` and before a terminal receipt exists. OWNER liveness has no
generic TTL.

Every hook and claim consumes one read-only projection:

```ts
interface WorkflowBindingProjection {
  kind: 'peers-touch-workflow-binding-projection';
  host: 'trae' | 'cursor' | 'codex';
  role: 'OWNER' | 'WORKER' | 'REVIEWER';
  bindingDigest: string;
  rootBindingDigest: string;
  parentBindingDigest: string | null;
  assignmentDigest: string | null;
  workflowSessionId: string | null;
  executionRoot: string;
  workspaceId: string;
  subjectRoots: string[];
  toolRoot: string | null;
  targetRoots: string[];
  released: boolean;
  childState: null | 'ASSIGNED' | 'LEASED' | 'TERMINAL';
}
```

`executionRoot` is canonicalized through Git plus `realpath` and inherited by
the entire lineage. `subjectRoots`, `toolRoot`, and `targetRoots` are per-event
facts and never change authority. Status, readiness, handoff, Stop, worker
result, and Completion Review use this same projection rather than searching
for an arbitrary unreleased binding by worktree.

For a new OWNER in a multi-root workspace, every Hook projection location is
excluded from root selection. An explicit host task root must match one
declared workspace root; otherwise all mutation targets must resolve to one
root. Zero or multiple candidates produce `WORKTREE_SELECTION_REQUIRED`.

The latest Anchor receipt is atomically replaceable because it projects current
owner state:

```ts
interface WorkflowAnchorReceipt {
  kind: 'peers-touch-workflow-anchor-receipt';
  rootBindingDigest: string;
  anchorDigest: string;
  renderedAt: string;
  status: string;
  content: string;
  digest: string;
}
```

The release receipt is create-once:

```ts
interface WorkflowOwnerRelease {
  kind: 'peers-touch-workflow-owner-release';
  rootBindingDigest: string;
  anchorDigest: string;
  releasedAt: string;
  digest: string;
}
```

Context compaction persists one bounded receipt per binding lineage:

```ts
interface WorkflowCompactLineage {
  kind: 'peers-touch-workflow-compact-lineage';
  compactId: string;
  role: 'OWNER' | 'WORKER' | 'REVIEWER';
  bindingDigest: string;
  rootBindingDigest: string;
  parentBindingDigest: string | null;
  assignmentDigest: string | null;
  workflowSessionId: string | null;
  executionRoot: string;
  workspaceId: string;
  preCompactAt: string;
  postCompactAt: string | null;
  digest: string;
}
```

`PreCompact` atomically replaces only the receipt keyed by the current
`bindingDigest`. `PostCompact` resolves the actor again, loads that exact
lineage receipt, and completes it only when every lineage and workspace field
is unchanged. Concurrent OWNER, WORKER, and REVIEWER compactions therefore do
not share a writable slot.

OWNER release succeeds only when the exact rendered Anchor is observable in
the assistant response or host transcript. A conflicting second release fails
closed. It does not terminate or revive a child; child terminal receipts own
that lifecycle.

This schema is a hard cut. Ordinary `skills` projection is non-destructive and
does not require a Hook-issued Action Grant. It is serialized by the machine
ledger lock and validates source, workspace, host paths, Hook shape, and
callback proof before publishing its installation lifecycle receipt.

`skills-hard-cut` requires no live declaration, child assignment, or workflow
action on the machine other than the current OWNER-bound cleanup command
identified by its exact Action Receipt, then deletes exactly:

```text
~/.peers-touch/dev/conversations/
~/.peers-touch/dev/workspaces/*/workflow/actions/
```

The Kernel creates create-once grants only for exact OWNER `skills-hard-cut`
and `skills-gc` actions. A cleanup command completes fallible catalog,
host-root, workspace, and Hook preflight before consuming its grant. It then
requires exactly one such live action, atomically consumes the grant, publishes
`INSTALLING`, and only then starts deletion. A seeded receipt, missing action,
another action ID, or a second invocation has no cleanup authority; failure
publishes `BLOCKED`.

Canonical Completion Review requests, reviewer capabilities, and receipts use
schema version `3` under
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/completion-reviews-v3/`.
The `completion-reviews/` and `completion-reviews-v2/` namespaces are not read,
imported, migrated, or deleted.

It does not delete Plan mounts, ExecutionPlanSnapshots, ExecutionRuns,
active-work, Development Sessions, Completion Review records, runtime leases,
or Acceptance evidence.
After the reset it publishes the current participating-root Hook projections.
No legacy parser, importer, alias, or dual-write exists.

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
      | 'service'
      | 'account'
      | 'client'
      | 'device'
      | 'client.storage'
      | 'fixture'
      | 'automation.session'
      | 'resource.plan';
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
  planVersionDigest: string | null;
  mountId: string | null;
  runId: string | null;
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
explicitly untracked; it never means "discover a Plan". A non-null `planPath`
is repository-relative, resolves inside the declared worktree, and must match
the live `mountId`, immutable `planVersionDigest`, `runId`, `planId`, and the
ExecutionRun's current `taskId`. Once a workspace is mounted, locator-less
declarations are rejected with `WORKSPACE_PLAN_DECLARATION_REQUIRED`. There is
no mixed-version binding fallback.

Publication uses lock, closed-schema validation, atomic replace and digest
readback. Declaration intent never substitutes for a live runtime lease.
Relay and database claims provide machine-wide planning visibility only; they
do not create deployment, mutation or lease authority.

### 8.1 Module Impact And Plan Resource Plan

Every domain classifier returns one closed module contribution:

```ts
interface ModuleImpact {
  kind: 'peers-touch-module-impact';
  schemaVersion: 1;
  moduleId: string;
  state:
    | 'DECIDED'
    | 'POLICY_REQUIRED'
    | 'OWNERSHIP_SPLIT_REQUIRED'
    | 'NOT_APPLICABLE';
  changedPaths: string[];
  changeKinds: string[];
  moduleDependencies: string[];
  requirements: {
    focusedCheckSelectors: string[];
    targetSelectors: string[];
    journeySelectors: string[];
    gateSelectors: string[];
    resourceRequirements: ResourceRequirement[];
  };
  classification: object;
  proof: object;
}
```

`ModuleImpact` is declarative. It cannot contain commands, selected account or
device IDs, ports, process IDs, lease files, or a concrete deployment sequence.

```ts
interface ResourceRequirement {
  requirementId: string;
  resourceKind: string;
  quantity: number;
  mode: 'shared' | 'exclusive';
  lifecycleScope: 'task' | 'suite' | 'scenario';
  isolationKey: string;
  compatibilityKey: string;
  reusePolicy:
    | 'REUSE_IF_HEALTHY'
    | 'RESTART_IF_COMPATIBLE'
    | 'BUILD_IF_SOURCE_DRIFT'
    | 'FRESH';
  readinessProbe: {
    kind: string;
    ref: string | null;
  };
  mandatory: boolean;
  candidateIds: string[];
  expectedDigests: {
    source: `sha256:${string}` | null;
    artifact: `sha256:${string}` | null;
    runtime: `sha256:${string}` | null;
  };
}
```

The Plan-level input joins all module impacts with the accepted target graph and
the current Runtime Owner inventory:

```ts
interface ResourceTarget {
  targetId: string;
  dependsOn: string[];
  focusedCheckSelectors: string[];
  journeySelectors: string[];
  gateSelectors: string[];
  resourceRequirements: ResourceRequirement[];
}

interface RuntimeResourceCandidate {
  resourceId: string;
  resourceKind: DevelopmentResourceIntent['runtimeClaims'][number]['kind'];
  compatibilityKey: string;
  state: 'HEALTHY' | 'STALE' | 'ABSENT' | 'QUARANTINED' | 'UNAVAILABLE';
  capacity: number;
  reusable: boolean;
  provisionable: boolean;
  owner: string;
  manifestRef: string | null;
  digests: {
    source: `sha256:${string}` | null;
    artifact: `sha256:${string}` | null;
    runtime: `sha256:${string}` | null;
  };
}

interface PlanResourceRequest {
  kind: 'peers-touch-plan-resource-request';
  schemaVersion: 1;
  planId: string;
  taskId: string;
  source: {
    commit: string;
    workspaceDigest: 'clean' | `sha256:${string}`;
  };
  satisfiedModuleIds: string[];
  moduleImpacts: ModuleImpact[];
  targets: ResourceTarget[];
  inventory: RuntimeResourceCandidate[];
}
```

The target graph comes from the accepted Plan and Gate/runtime registries.
Inventory comes from the owning Local Dev or Acceptance Suite Runtime. A module
policy cannot define either as a private substitute.

The output is one machine-local `PlanResourcePlan`:

```ts
interface PlanResourcePlan {
  kind: 'peers-touch-plan-resource-plan';
  schemaVersion: 1;
  planId: string;
  taskId: string;
  workItemId: string;
  workspaceId: string;
  sourceHead: string;
  inputDigest: `sha256:${string}`;
  allocationDigest: `sha256:${string}`;
  fencingToken: number;
  preparationState: 'RESERVING' | 'COMMITTED';
  allocationState: 'READY' | 'PARTIALLY_READY' | 'PARKED';
  runtimeState: 'READY' | 'PENDING' | 'PARKED' | 'QUARANTINED';
  proofAction:
    | 'REUSE_CANDIDATE'
    | 'REUSE_ALLOWED'
    | 'REPROVE_REQUIRED'
    | 'POLICY_REQUIRED';
  selectedTargetIds: string[];
  executionWaves: string[][];
  targets: Array<{
    targetId: string;
    wave: number;
    state: 'ALLOCATED' | 'PARKED';
    dependsOn: string[];
    requirementIds: string[];
    blockers: object[];
  }>;
  requirements: Array<{
    idempotencyKey: string;
    requirementId: string;
    peakQuantity: number;
    targetIds: string[];
  }>;
  capacity: Array<{
    resourceKind: string;
    compatibilityKey: string;
    isolationKey: string;
    mode: 'shared' | 'exclusive';
    lifecycleScope: 'task' | 'suite' | 'scenario';
    peakQuantity: number;
    waveQuantities: Array<{ wave: number; quantity: number }>;
  }>;
  runtimeClaims: DevelopmentResourceIntent['runtimeClaims'];
  baseRuntimeClaims: DevelopmentResourceIntent['runtimeClaims'];
  plannedRuntimeClaims: DevelopmentResourceIntent['runtimeClaims'];
  declarationRuntimeClaims: DevelopmentResourceIntent['runtimeClaims'];
  resourceResults: Array<{
    resourceKind: string;
    resourceId: string;
    status: 'READY' | 'PENDING' | 'QUARANTINED';
    targetIds: string[];
    requirementIds: string[];
    idempotencyKeys: string[];
  }>;
  receiptDigest: `sha256:${string}`;
}
```

The resource-plan path is
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/<workItemId>/resource-plan.json`.
It is a current execution receipt, not repository state or Acceptance evidence.

Allocation rules:

- target dependency closure is resolved before capacity;
- module dependencies become target dependencies; a module with no direct
  target still inherits the readiness of its impacted dependencies;
- requirements with the same
  `planId + lifecycleScope + requirementId + compatibilityKey` are idempotent;
- peak quantity is computed per parallel execution wave;
- mandatory bundles are allocated before optional demand in the same wave, so
  optional reuse cannot park a mandatory target;
- mandatory demand is solved across the complete wave with deterministic
  rematching; constrained targets are considered first when capacity cannot
  satisfy every target, so flexible demand cannot consume a pinned candidate;
- resource selection prefers `REUSE`, then `RESTART`, `BUILD`, and
  `PROVISION`;
- selected resources, including `REUSE`, remain `PENDING` until the named
  Runtime Owner returns a valid fenced result;
- one physical resource cannot satisfy conflicting non-null expected digests;
  incompatible co-allocation fails with `RESOURCE_REQUIREMENT_CONFLICT`;
- quarantined and unavailable resources are never selected;
- one target's declaration claims are all-or-none;
- claims are sorted canonically and atomically merged into the existing
  `DevelopmentResourceDeclaration`;
- unavailable capacity parks the affected target and dependent targets, not
  unrelated targets or the whole Plan.

The resource-plan fencing token increments when request or source identity
changes. A Runtime Owner result with a stale token, wrong allocation digest,
wrong owner, unplanned resource, or mismatched expected digest is rejected.
Heartbeat extends declaration liveness but does not mint a new fencing token.
Preparation writes `RESERVING` before updating the public declaration and
`COMMITTED` only after declaration readback. The `RESERVING` receipt retains
the union of prior and proposed planner-owned claims, so interruption cannot
reclassify an old planner claim as base intent. It is non-authorizing and is
reconciled idempotently on the next prepare.

`PlanResourcePlan` is not a live physical lease. Local Dev and Acceptance Suite
Runtime own process/resource leases, readiness probes, manifests, cleanup and
quarantine. A Gate may consume their manifest but cannot perform lifecycle
operations.

Runtime owners return:

```ts
interface ResourceOwnerResult {
  kind: 'peers-touch-resource-owner-result';
  schemaVersion: 1;
  allocationDigest: `sha256:${string}`;
  fencingToken: number;
  resourceKind: string;
  resourceId: string;
  owner: string;
  status: 'READY' | 'QUARANTINED';
  manifestRef: string;
  digests: {
    source: `sha256:${string}` | null;
    artifact: `sha256:${string}` | null;
    runtime: `sha256:${string}` | null;
  };
}
```

The recorder serializes with prepare under the workspace lifecycle lock and
accepts an idempotent identical result. A second result with different content
for the same fenced resource is `RESOURCE_RESULT_CONFLICT`.
Expected-digest validation joins through the exact `idempotencyKeys`; a bare
`requirementId` never links results across compatibility or lifecycle scopes.
Planner-owned lease admission requires a valid `allocationDigest`, a positive
`fencingToken`, and exactly one matching resource result in `READY`; `PENDING`,
`QUARANTINED`, missing, or duplicate results fail closed.
`baseRuntimeClaims` preserves declaration claims that predate the planner.
Replanning removes only prior `plannedRuntimeClaims`; it never adopts or
releases a pre-existing claim with the same resource identity. Physical lease
admission requires a matching `COMMITTED` receipt for planner-owned claims. A
shared `resource.plan:<workItemId>` marker makes missing-receipt provenance
fail closed without acting as a physical lease. The marker is reserved for the
planner and is invalid as a module requirement or Runtime Owner inventory item.

## 8.2 Development Close Receipt

One exact workspace/work-item close is persisted at:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/<workItemId>/development-close.json
```

```ts
interface DevelopmentCloseReceipt {
  kind: 'peers-touch-development-close-receipt';
  receiptId: string;
  workspaceId: string;
  workItemId: string;
  mode: 'tracked' | 'standalone';
  closeReason: 'completed' | 'cancelled' | 'owner-abandon';
  environmentPolicy: 'retain' | 'unregister';
  owner: string;
  mountId: string | null;
  runId: string | null;
  state: 'CLOSING' | 'BLOCKED' | 'CLOSED';
  resources: {
    runtimeLeases: 'PENDING' | 'RELEASED';
    session:
      | 'PENDING'
      | 'ARCHIVED'
      | 'ABANDONED'
      | 'NOT_APPLICABLE';
    activeWork: 'PENDING' | 'CLOSED' | 'NOT_APPLICABLE';
    declaration: 'PENDING' | 'RELEASED' | 'NOT_APPLICABLE';
    planMount: 'PENDING' | 'RELEASED' | 'NOT_APPLICABLE';
    environmentRegistration:
      | 'PENDING'
      | 'RETAINED'
      | 'UNREGISTERED'
      | 'NOT_REGISTERED';
  };
  blocker: null | {
    code: string;
    message: string;
    details: object;
  };
  createdAt: string;
  updatedAt: string;
  revision: number;
  recordDigest: string;
}
```

Rules:

- the selector and close policy are immutable after revision 1;
- every stage invokes the existing owner and persists its readback before the
  next stage;
- `CLOSED` permits no `PENDING` resource;
- only `BLOCKED` carries a blocker;
- normal completion/cancellation archives only terminal Sessions;
- `owner-abandon` may archive a non-terminal Session as `ABANDONED` but cannot
  change its Development state or claim success;
- tracked close releases only the exact mount owner; deleted-worktree recovery
  requires explicit `workspaceId + mountId`;
- standalone close requires `planMount=NOT_APPLICABLE`;
- `retain` is the normal environment policy; `unregister` is reserved for
  authorized worktree removal after all live owners are absent;
- `implementation-ready` and `delivery-ready` do not require this receipt;
  `close-ready` requires its exact current `CLOSED` record.

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

A proposed operation resolves authorization from two explicit sources:

1. an exact user grant in the current Development Run; and
2. the accepted Plan's matching `ExecutionAuthorization` field or exact runtime
   scope.

Mere Plan existence, a public declaration, or an unrelated prior command does
not grant authority. When either explicit source grants the exact operation,
that authorization remains valid throughout the Plan Run and the operation
executes directly after the remaining Guardian checks pass. Operation category,
Task handoff, retry, context compaction, and host change do not consume or
invalidate the grant.

`OPERATION_AUTHORIZATION_REQUIRED` is an admission result used only when the
operation is denied or outside every explicit grant. Session failure
`AUTHORIZATION_REQUIRED` records an actual external permission, credential, or
scope failure returned after an admitted operation was attempted. The latter
cannot be manufactured preemptively from the operation category.

A Plan Run adds no second authorization schema. One explicit continuation
request consumes this accepted envelope across Task and Goal Slice transitions;
Task handoff, agent review, source-backed remediation, Context Anchor output,
and context compaction do not reset it.

### 9.1 Host Adapter Contract

```ts
interface HostCapabilityRequest {
  requestId: string;
  actionId: string;
  sessionId: string;
  workItemId: string;
  planId: string;
  taskId: string;
  workspaceId: string;
  journeyId: string;
  sourceCommit: string;
  runtimeBindingRef: string | null;
  host: string;
  operation: 'execute' | 'cleanup' | 'inspect-quarantine';
  capability: 'worker' | 'browser-ui' | 'desktop-ui' | 'diagnostic';
  nativeAttempted: boolean;
  expectedPostcondition: string;
  cleanupHandle?: string;
  cleanupAttempt?: 1;
}
```

The scheduler projects the request but never invokes the adapter. Dev Workflow
invokes it only after Guardian admission and owns retries, cleanup, parking, and
durable state. Cleanup has one admitted attempt; failure becomes a bounded
quarantine followed by one read-only post-expiry observation.

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
  hostRequests?: DevelopmentFailure[];
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
a Task. `hostRequests` is additive and bounded; legacy states without it read as
an empty history.

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

`FUNCTIONAL_PASS` requires `FUNCTIONAL_CHECK/PASS` and may be committed only
from `FUNCTIONAL_RUNNING` by the owner-run current-closure Development runner.
The owner validates Plan/Task/Journey/work item/workspace/source identity and
every required Gate/source/runtime/cleanup artifact, publishes a create-once
content-addressed evidence seal, then commits the Session journal. Callers
cannot submit their own PASS file or select only part of the closure.
`SESSION_PROJECTION_STALE` and `SESSION_EVIDENCE_OUT_OF_SEQUENCE` prevent stale,
substituted, or partial evidence from closing the Task.
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
    | 'HOST_CAPABILITY_UNAVAILABLE'
    | 'HOST_CAPABILITY_AVAILABLE'
    | 'HOST_CLEANUP_QUARANTINED'
    | 'HOST_CLEANUP_RELEASED'
    | 'HOST_CLEANUP_ESCALATION_REQUIRED'
    | 'CANCELLED';
  stage: DevelopmentState;
  journeyStepId?: string;
  owner:
    | 'product'
    | 'source'
    | 'local-dev-control-plane'
    | 'runtime'
    | 'journey-driver'
    | 'host-adapter'
    | 'authorization';
  summary: string;
  diagnosticRef?: string;
  requestId?: string;
  actionId?: string;
  host?: string;
  capability?: 'worker' | 'browser-ui' | 'desktop-ui' | 'diagnostic';
  sessionId?: string;
  workItemId?: string;
  planId?: string;
  taskId?: string;
  workspaceId?: string;
  journeyId?: string;
  sourceCommit?: string;
  runtimeBindingRef?: string;
  nativeAttempted?: boolean;
  adapterAttempted?: true;
  resourceId?: string;
  cleanupHandle?: string;
  cleanupAttempt?: 1;
  leaseExpiresAt?: string;
  observationRef?: string;
  retryable: boolean;
}
```

Only the current first failure lives in `session.json`. Resolution appends a new
transition event and clears `currentFailure`. Host transport records bind
immutable request/action/session/Plan/Task/workspace/Journey/source/runtime
identity. While blocked, only `UNAVAILABLE -> AVAILABLE` or post-expiry
`QUARANTINED -> RELEASED | ESCALATION_REQUIRED` may update the observation.

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
- `completionClass=functional` with `service|native-*`:
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

Normal Session archive accepts only these terminal states. Explicit
`owner-abandon` close may move a non-terminal journal/snapshot into its archive
without changing the stored Development state; the close receipt records that
resource as `ABANDONED`, never as a successful terminal transition.

Unknown, skipped or work-class-incompatible edges are invalid.


## 16. Storage Contract

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/
├── <workItemId>/
│   ├── session.json
│   ├── events.ndjson
│   ├── session.lock
│   ├── checks/<record-id>.json
│   └── artifacts/<attempt-id>/

~/.peers-touch/dev/bindings/
├── owners/<host>/<rootChatHash>/
│   ├── owner-binding.json
│   ├── anchor-receipt.json
│   ├── compact-lineage/<bindingDigest>.json
│   ├── assignments/<assignmentId>.json
│   ├── assignment-claims/<assignmentDigest>.json
│   └── releases/<anchorDigest>.json
└── children/<rootBindingDigest>/<host>/<executionSessionHash>/
    ├── child-binding.json
    └── terminal.json

~/.peers-touch/dev/workspaces/<workspaceId>/workflow/actions/
├── <rootBindingDigest>.json
├── <actionGrantHash>.grant.json
└── <actionGrantHash>.grant-consumed.json
```

Constraints:

- owner-only permissions;
- atomic event-log and `session.json` replacements under one lock;
- logically append-only bounded events with replay repair;
- injected clock for deterministic tests;
- no credential or private key;
- no raw host conversation identifier;
- no legacy conversation/action store compatibility;
- no repository writer;
- no fallback to Acceptance Evidence Store.
