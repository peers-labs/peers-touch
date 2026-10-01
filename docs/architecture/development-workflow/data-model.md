# Development Workflow Control Plane - Data Model

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-01
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

## 2. Plan Package Manifest

`plan.md` contains one fenced `Plan Package` JSON object:

```ts
interface PlanPackage {
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
`initialHead` is the immutable audit baseline. Advancing source identity is
owned outside tracked Plan content: Git is physical truth,
`DevelopmentResourceDeclaration.sourceHead` authorizes the current mutation
slice, `DevelopmentSession.source.commit` identifies a clean runtime
checkpoint, and the consuming workspace's active-work `expectedHead` is the
durable resume projection.
Sibling worktree inventory is machine topology and is not part of this binding.

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
block outside the Plan Package:

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
stores an immutable machine-local proof containing the prior manifest digest,
the first-failure reference, and every invalidated durable-evidence reference
before atomically replacing the Plan lifecycle projection.

The projection is computed from manifest lifecycle and Task titles. It is not
persisted. A non-blocked active package always exposes one
`nextProgressBoundary`. Prepared, blocked, completed and superseded packages
expose `null`.

The endpoint is derived from integer Task counts:

```text
completedAfter = completed + 1
percentageAfter = round(100 * completedAfter / total, 2)
percentagePointDelta = round(percentageAfter - percentage, 2)
```

`percentageAfter` is never derived by adding a rounded delta to
`percentage`. Newly unlocked Tasks remain pending and do not contribute to
`completedAfter`.

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

## 5.1 Generation-Bound Workspace Plan Binding

```ts
interface WorkspacePlanBinding {
  schemaVersion: 2;
  kind: 'peers-touch-workspace-plan-binding';
  generation: number;
  workspaceId: string;
  canonicalRoot: string;
  planId: string;
  planPath: string;
  boundAt: string;
  boundBy: string;
  recordDigest: string;
}
```

The current pointer and immutable generation history are stored at:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding-history/generation-<N>.json
```

Rules:

- generation 1 creation is explicit and atomic;
- the same `planId + planPath` request is idempotent within the current
  generation;
- ordinary bind with a different tuple returns `WORKSPACE_PLAN_REBIND_DENIED`;
- only explicit generation advance may change the tuple;
- advance requires current status `completed`, expected-generation CAS, no live
  declaration, no active-work record, and no live runtime lease;
- every generation record is create-once, digest-verified, and owner-controlled;
- the current pointer is atomically replaced only after the next immutable
  generation record is durable;
- a schema-1 record resolves as generation 1 without rewriting it and migrates
  only during successful advance;
- there is no unbind operation;
- `planPath` is repository-relative and resolves inside `canonicalRoot`;
- the referenced package must claim the same `workspaceId`;
- repository/branch scans, Plan status and declaration recency never select a
  Plan;
- CI does not consume this machine-local record and requires an explicit Plan
  input.

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
  planId: string;
  planPath: string;
  planStatus: 'draft' | 'prepared' | 'active' | 'blocked' | 'completed' | 'superseded';
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
- `planId/planPath` must equal the current workspace Plan generation. The record
  cannot establish, replace or repair that binding.
- `currentTaskId/currentTaskPath/taskStatus` mirror the declaration-selected
  Task and its manifest lifecycle.
- `devState` is a projection of the current Development Session, or `null`
  before a Session exists.
- `initialHead` comes from the immutable Plan; `expectedHead` comes from the
  active declaration and must equal Git at sync time.
- Every update holds a workspace-local lock, verifies optional CAS revision,
  increments `revision`, recalculates `recordDigest`, atomically replaces the
  file, fsyncs the directory and reads back the record.
- On owner disagreement, sync fails closed; the projection never repairs its
  owners.
- Project memory, Context Anchor and Peers Dev may read records but cannot write
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

For a new OWNER in a multi-root workspace, the bootstrap location is excluded
from root selection. An explicit host task root must match one declared
workspace root; otherwise all mutation targets must resolve to one root.
Zero or multiple candidates produce `WORKTREE_SELECTION_REQUIRED`.

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

This schema is a hard cut. Installation requires no live declaration, child
assignment, or workflow action on the machine other than the current
OWNER-bound installer command identified by its exact Action Receipt, then
deletes exactly:

```text
~/.peers-touch/dev/conversations/
~/.peers-touch/dev/workspaces/*/workflow/actions/
```

The Kernel creates a create-once grant for that exact OWNER `skills` action.
The installer completes fallible catalog, host-root, workspace, and hook
preflight before consuming the grant. It then requires exactly one such live
action, atomically consumes its grant, publishes `INSTALLING`, and only then
starts destructive reset. A seeded receipt, missing action, another action ID,
or a second invocation has no installation authority; reset failure publishes
`BLOCKED`.

Canonical Completion Review requests and receipts use schema version `2` under
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/completion-reviews-v2/`.
The pre-hard-cut `completion-reviews/` namespace is not read, imported,
migrated, or deleted.

It does not delete Plan bindings, Plan generations, active-work, Development
Sessions, Completion Review records, runtime leases, or Acceptance evidence.
After the reset it publishes the current bootstrap. No legacy parser, importer,
alias, or dual-write exists.

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
declaration and current workspace Plan generation. Once a workspace is bound,
locator-less declarations are rejected with
`WORKSPACE_PLAN_DECLARATION_REQUIRED`. During the mixed-version rollout,
legacy terminal records may omit the tuple; they are historical only and
cannot authorize new mutation.

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
