# Development Workflow Experience Contract

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-07
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`, `tooling/scripts/plan/`

---

## DEV-J01: Install And Bind Agent Execution

1. The developer runs `make skills IDE=<host>`.
2. Installation verifies canonical source, projects supported host integration,
   and proves one callback through the installed path.
3. The first enforceable tool event creates one OWNER binding from the host's
   root conversation identity.
4. Internal worker/reviewer sessions use assigned child lineage and cannot
   create peer owners.

Missing host identity, blocking capability, callback proof, or root consistency
returns a typed failure.

## DEV-J02: Inspect A Running Plan

1. The developer runs `make workflow-snapshot`.
2. Snapshot lists discovered worktrees and joins PlanMount,
   ExecutionPlanSnapshot, ExecutionRun, current Task, declaration, Session,
   active-work, review, activity, and runtime health.
3. Work state and environment health remain independent.
4. Missing or conflicting owners are typed and never repaired by the
   projection.
5. The command emits one bounded redacted document and exits.

There is no browser UI, HTTP/SSE server, polling loop, fixed endpoint, or
state-changing Snapshot operation.

## DEV-J03: Review A Completion Claim

1. Implementation reaches its normal verification boundary.
2. Completion Review captures current source and declared obligations.
3. An independent reviewer receives an immutable request plus request-scoped
   capability and records findings.
4. Only a current `PASS` receipt can authorize Task or Plan completion.
5. Source, Plan, Gate, or evidence drift makes the receipt `STALE`.

Historical receipts remain audit data and cannot authorize completion.

## DEV-J04: Diagnose Workflow Truth

1. The developer runs `make workflow-doctor`.
2. Doctor checks integration, BindingProjection, PlanMount, snapshot/run,
   declaration, Session, active-work, Action Receipt, Completion Review, and
   Workflow Snapshot.
3. Every public operational promise maps to a machine check and typed result.
4. Any required false promise produces non-zero exit.

Doctor never exposes credentials, child execution-session identifiers,
canonical roots, or raw command logs. It may expose the verified main-session
root ID required for worktree attribution.

## DEV-J05: Mount And Amend A Stable Plan

1. Plan authoring produces one stable `planId`, a source-backed `northStar`,
   complete criterion coverage, and `northStarApproval=null`.
2. After review, the user explicitly approves the current North Star digest;
   `planctl approve-north-star` records the actor, time, and decision reference.
3. The owner explicitly selects an execution worktree.
4. `make plan-mount PLAN=<path>` creates one live PlanMount and the initial
   immutable ExecutionPlanSnapshot with `mountId`, `workspaceId`, branch, and
   initial HEAD.
5. Development Workflow creates the ExecutionRun and activates a ready Task.
6. When execution details change, the Agent runs `make plan-amend`, which
   appends the reason and impact, preserves mount/run identity, and advances the
   current snapshot.
7. The worktree remains occupied until completion, cancellation, or explicit
   owner unmount.

An unapproved or stale North Star cannot mount or execute. An Agent cannot
change the North Star, change the worktree, expand operation authorization, or
unmount an unfinished run without an explicit owner decision.

## DEV-J06: Prepare Cross-Module Runtime Resources

1. Module owners return standard `ModuleImpact`.
2. Dev Workflow merges impacts, resolves target dependencies, and computes
   concurrent waves.
3. Resource planning deduplicates accounts, services, clients, devices,
   Fixtures, and automation sessions.
4. Claims are acquired all-or-none; unavailable capacity parks only dependent
   targets.
5. Runtime owners build/restart/provision and return fenced manifests.
6. Business Gates attach to prepared manifests.

## DEV-J07: Close Or Recover A Development Run

1. Dev Workflow stops physical runtime owners and selects the exact workspace,
   work item, mode, close reason, and environment policy.
2. `make dev-close` verifies no live lease, then archives Session, closes
   active-work, releases declaration and PlanMount, and optionally unregisters
   the environment.
3. Each stage advances one machine-local `DevelopmentCloseReceipt`.
4. Interruption or owner failure leaves a resumable `CLOSING` or `BLOCKED`
   receipt; a new task is not admitted until the exact close resumes.
5. Completion audit accepts `close-ready` only after that receipt is `CLOSED`
   with no pending resource.

Normal completion retains the environment registration. Explicit worktree
removal uses `environmentPolicy=unregister`. If the worktree is already gone,
recovery requires exact workspace, mount, and owner identity.

## Recovery Contract

- Missing mount/snapshot/run: report the exact missing owner; never discover a
  Plan by branch or directory.
- Hook unavailable: block mutation and report the host capability.
- Source drift: stale the current review and follow DWF-D24.
- Loop/stall: project activity without changing Task state.
- Snapshot partial failure: retain valid owner projections and typed findings
  for failed owners.
- Overlay policy mutation: ignore it and return typed denial under DWF-D25.
- Interrupted close: resume the exact receipt; never infer or manually delete
  the remaining owner.
