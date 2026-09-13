# Development Workflow Control Plane - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
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

Classification changes require an explicit plan amendment. A product defect
cannot be downgraded to infrastructure or documentation to avoid a runtime
Journey.

## 2. Development Work Item

```ts
interface DevelopmentWorkItem {
  schemaVersion: 1;
  id: string;
  workClass: DevelopmentWorkClass;
  planRef: string;
  workstreamId: string;
  productRefs: string[];
  architectureRefs: string[];
  journeyIds: string[];
  scope: {
    include: string[];
    exclude: string[];
  };
  resources: DevelopmentResourceIntent;
  authorization: ExecutionAuthorization;
}
```

The work item is durable plan-derived input. It does not store command output,
runtime credentials, screenshots or Acceptance results.

## 3. Machine-Wide Resource Declaration

Every work item publishes preliminary intent after read-only intake and before
its first repository write or runtime acquisition. PRODUCT, DESIGN and PLAN
scope changes atomically replace the same declaration. Before `BOUND`, the
declaration must equal the final plan-derived source and runtime claims:

```text
~/.peers-touch/dev/work.json
```

```ts
interface MachineDevelopmentWorkLedger {
  schemaVersion: 1;
  kind: 'peers-touch-development-work-ledger';
  updatedAt: string;
  declarations: Record<string, DevelopmentResourceDeclaration>;
}

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
      | 'client.storage'
      | 'fixture';
    resourceId: string;
    mode: 'shared' | 'exclusive';
  }>;
}

interface DevelopmentResourceDeclaration
  extends DevelopmentResourceIntent {
  declarationId: string;
  workItemId: string;
  sessionId: string;
  workspaceId: string;
  branch: string;
  sourceHead: string;
  owner: string;
  purpose: string;
  state: 'DECLARED' | 'ACTIVE' | 'RELEASING' | 'RELEASED' | 'STALE';
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
  declarationDigest: string;
}
```

Publication is atomic:

1. Acquire `~/.peers-touch/dev/work.lock`.
2. Read and validate the complete ledger.
3. Reconcile expired declarations and live Local Dev leases.
4. Reject conflicting active declarations.
5. Write a same-directory temporary file, flush and atomically replace.
6. Read the declaration back and verify its digest before entering `BOUND`.

The lock binds PID plus OS-observed process-start identity. A dead or
identity-mismatched owner is stale; malformed metadata or an unverifiable live
owner fails closed. Declaration and ledger objects use closed schemas: unknown
fields, invalid states, non-canonical IDs and digest mismatches are rejected
before mutation.

Conflict rules:

- overlapping `exclusive-write` claims from different workspaces block;
- two worktrees writing the same branch block;
- generated outputs, lockfiles, plan status and delivery branch are exclusive;
- `station.connect` may be shared;
- slot, client storage, Fixture mutation, deploy and reset are exclusive;
- a declaration announces intent but never substitutes for a live runtime lease;
- `dev-start` may replace a `RELEASED` or `STALE` declaration with a new
  session; `dev-update` cannot revive terminal state;
- secrets, credentials and raw actor/device handles are forbidden.

## 4. Execution Authorization

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

Authorization is capability-specific:

- local commit does not imply push;
- deploy does not imply reset;
- PR does not imply merge;
- merge does not imply branch rewrite;
- a named reset scope does not authorize another Fixture or Station.

## 5. Journey Contract

```ts
interface DevelopmentJourney {
  schemaVersion: 1;
  id: string;
  domain: string;
  title: string;
  productAcceptanceRefs: string[];
  workClasses: DevelopmentWorkClass[];
  runtimeClass:
    | 'source-only'
    | 'service'
    | 'browser'
    | 'native-desktop'
    | 'native-mobile';
  actorRoles: string[];
  clientRoles: string[];
  requiredServiceRoles: string[];
  steps: JourneyStep[];
  budgets: JourneyBudgets;
  promotionGateIds: string[];
}

interface JourneyStep {
  id: string;
  action: string;
  expected: string[];
  receiverRole?: string;
  negative?: string[];
}

interface JourneyBudgets {
  focusedCheckSeconds: number;
  deploySeconds?: number;
  functionalRunSeconds: number;
  cleanupSeconds: number;
}
```

Rules:

- `productAcceptanceRefs` own behavior semantics; the Journey must not redefine
  them.
- At least one receiver assertion is required when the behavior crosses a
  process, device, actor or Station boundary.
- `runtimeClass` must match the product claim. Browser cannot prove a required
  Native claim.
- Every budget is positive and explicit. No implicit infinity exists.
- `promotionGateIds` identify formal Acceptance destinations, not commands to
  run during the red development loop.

## 6. Development Session

```ts
type DevelopmentState =
  | 'DECLARING'
  | 'BOUND'
  | 'REPRODUCING'
  | 'REPRODUCED'
  | 'IMPLEMENTING'
  | 'FOCUSED_CHECKING'
  | 'FOCUSED_PASS'
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

interface DevelopmentSession {
  schemaVersion: 1;
  sessionId: string;
  workItemId: string;
  workspaceId: string;
  branch: string;
  journeyId: string;
  state: DevelopmentState;
  source: SourceCheckpoint | null;
  runtimeBindingRef: string | null;
  verificationRecords: VerificationRecord[];
  currentFailure: DevelopmentFailure | null;
  startedAt: string;
  updatedAt: string;
}
```

Only one state is current. A history is reconstructed from bounded
`events.ndjson`; it is not copied into `session.json` or an execution plan.

## 7. Source Checkpoint

```ts
interface SourceCheckpoint {
  commit: string;
  tree: string;
  branch: string;
  clean: true;
  createdAt: string;
  purpose: 'development-runtime';
}
```

A checkpoint:

- is a local Git commit;
- may contain WIP-level commit history;
- is not a readiness, delivery or review claim;
- is required before remote deployment and exact-source functional execution;
- becomes stale when HEAD changes before deployment or the runtime reports a
  different source identity.

## 8. Verification Record

```ts
type VerificationClass =
  | 'SOURCE_CHECK'
  | 'STRUCTURAL_CHECK'
  | 'UX_REVIEW'
  | 'FUNCTIONAL_CHECK'
  | 'ACCEPTANCE_PROOF';

type VerificationResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

interface VerificationRecord {
  id: string;
  verificationClass: VerificationClass;
  result: VerificationResult;
  commandDigest?: string;
  sourceCommit?: string;
  journeyId?: string;
  runtimeBindingDigest?: string;
  startedAt: string;
  durationMs: number;
  firstFailure?: DevelopmentFailure;
  artifactRefs: string[];
}
```

`PROVEN` is reserved for the Acceptance Framework. Development records use
`PASS`; callers must inspect `verificationClass` before making a claim.

## 9. Development Failure

```ts
type DevelopmentFailureKind =
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

interface DevelopmentFailure {
  kind: DevelopmentFailureKind;
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

Failure mapping:

| Failure | Transition |
|---|---|
| Source or product assertion failure | `FAILED -> IMPLEMENTING` |
| Missing authorization or resource | `BLOCKED` |
| Driver failure before an assertion | `BLOCKED`; product remains unknown |
| Source/runtime identity mismatch | `STALE -> CHECKPOINTING` or `DEPLOYING` |
| Timeout | `CLEANING`, then `FAILED` or `BLOCKED` by owner |
| Cleanup failure | terminal `BLOCKED`; resource cannot be reused |

## 10. Run Identity And Deduplication

```text
developmentRunKey =
  sha256(
    workspaceId
    + workItemId
    + journeyId
    + sourceCommit
    + runtimeBindingDigest
    + commandDigest
  )
```

- An identical completed `PASS` may be reused within the same Dev Session.
- `FAIL` and `BLOCKED` are not silently retried.
- Changed source, profile, binding, client generation or command invalidates the
  key.
- Formal Acceptance never consumes a Development record as product evidence.

## 11. State Transition Guards

| Transition | Required guard |
|---|---|
| `DECLARING -> BOUND` | machine declaration published, conflict-free and read-back verified |
| `BOUND -> REPRODUCING` | worktree, scope and Journey resolve |
| `REPRODUCED -> IMPLEMENTING` | first failure and owner recorded |
| `FOCUSED_PASS -> CHECKPOINTING` | required focused records all pass |
| `CHECKPOINTED -> DEPLOYING` | clean commit and deploy authorization |
| `DEPLOYED -> FUNCTIONAL_RUNNING` | live runtime source/binding match |
| `FUNCTIONAL_RUNNING -> FUNCTIONAL_PASS` | every Journey step passes |
| `FUNCTIONAL_PASS -> ACCEPTANCE_READY` | no source/runtime drift |
| `ACCEPTANCE_READY -> ACCEPTANCE_UPDATING` | missing regression coverage identified |
| `ACCEPTANCE_READY -> FINAL_CHECKPOINTED` | existing promoted Gate already covers Journey |
| `ACCEPTANCE_UPDATING -> FINAL_CHECKPOINTED` | changed adapters/contracts pass focused checks and are committed |
| `FINAL_CHECKPOINTED -> ACCEPTANCE_RUNNING` | final source and runtime identities match |
| `ACCEPTANCE_RUNNING -> ACCEPTANCE_PASS` | required formal Gate evidence passes |
| `ACCEPTANCE_PASS -> DELIVERY_READY` | plan-required Quality obligations pass |

`make dev-check` performs the final worktree/branch/source-HEAD readback and
promotes the public declaration from `DECLARED` to `ACTIVE`. An authorized
commit, rebase or merge requires `make dev-update` before the next mutation
slice so the public declaration exposes the new HEAD.

Forbidden transitions:

- `SOURCE_CHECK -> FUNCTIONAL_PASS`;
- `STRUCTURAL_CHECK -> FUNCTIONAL_PASS`;
- `UX_REVIEW -> FUNCTIONAL_PASS`;
- `BLOCKED -> PASS` without a new run identity;
- `FUNCTIONAL_PASS -> DELIVERY_READY` when formal evidence is required;
- any mutation without the matching authorization capability.

Invalidation rules:

- Product source or shared Journey semantics changed after `FUNCTIONAL_PASS`:
  return to `FOCUSED_CHECKING`.
- Acceptance-only catalog, wrapper or evidence code changed: keep the diagnostic
  functional result, create `FINAL_CHECKPOINTED`, then run formal Acceptance on
  final source.
- Profile, service binding, client generation or live runtime identity changed:
  return to `DEPLOYING`.
- Documentation-only changes do not alter the Dev result, but formal
  commit-bound Acceptance still reruns when its source contract requires it.

## 12. Storage Contract

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/<workItemId>/
├── session.json
├── events.ndjson
├── checks/<record-id>.json
├── runs/<run-id>.json
└── artifacts/<run-id>/
```

Constraints:

- owner-only permissions;
- atomic `session.json` replacement;
- append-only bounded event records;
- artifact size and retention limits declared by the Journey;
- no secret, token, password, private key or raw credential;
- no repository writer;
- no fallback to Acceptance Evidence Store or product Application Support.
