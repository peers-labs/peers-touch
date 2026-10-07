# Development Workflow

This is the operating guide for Peers-Touch development. It describes the
commands that exist now, their state owners, and the failure states a developer
must act on.

---

## Start Here

For a new or updated worktree integration:

```bash
make skills IDE=trae
make workflow-doctor
```

When upgrading from the retired frozen-version contract, first close every live
Development Run and then run `make plan-state-migrate` once. The migration
refuses live work and does not install a legacy runtime fallback.

The installer projects repository-owned Skills and supported blockable hooks
into the current worktree. The Doctor verifies the public promises below. A
`BLOCKED` result names the owner that must be repaired; it is not permission to
bypass the workflow or create another worktree.

For a TRAE multi-root workspace, install with
`make skills IDE=trae WORKSPACE=<absolute-.code-workspace-path>`. The
selected source root, descriptor bootstrap root, and existing TRAE-participating
roots receive equivalent ingress to one canonical Kernel; Hook location never
selects execution authority. Normal installation is non-destructive and does
not require machine-wide workflow quiescence. Explicit `skills-hard-cut` and
`skills-gc` own separately authorized global-idle cleanup.

| Promise ID | What must be true | Normal recovery |
|---|---|---|
| `dev.integration.installed` | The selected host has the exact current Skill and hook projection, callback proof, and install receipt. | Run `make skills IDE=<host>` at a durable boundary. |
| `dev.plan.mount` | Tracked work resolves one stable Plan mount, current immutable execution snapshot, and mutable Execution Run; explicit standalone work remains unmounted. | Mount the Plan for tracked work, record source changes with `plan-amend`, resolve a typed identity failure, or preserve the user's explicit no-Plan standalone policy. |
| `dev.workflow.current` | Plan, current Task, Development Session, declaration, active-work, and reduced Action Receipt state agree. | Repair the typed owner mismatch; never edit machine state directly. |
| `dev.review.current` | Active work has no failed or stale review; completed work has a current independent `PASS`. | Run a fresh independent Completion Review after source or obligation drift. |
| `dev.docs.executable` | This guide declares each public Workflow Doctor promise exactly once. | Update the executable contract and this guide in the same change. |

<!-- workflow-doctor:dev.integration.installed -->
<!-- workflow-doctor:dev.plan.mount -->
<!-- workflow-doctor:dev.workflow.current -->
<!-- workflow-doctor:dev.review.current -->
<!-- workflow-doctor:dev.docs.executable -->

## 1) Read before coding

1. [project-identity.md](./project-identity.md)
2. [architecture.md](./architecture.md)
3. [domain-model.md](./domain-model.md)
4. [docs/README.md](../README.md)

Then select platform docs:
- Desktop: `docs/client/desktop/`
- Mobile: `docs/client/mobile/`
- Station: `docs/station/`

### Work depth

Small, standard, and large work use the same binding, declaration, execution,
review, delivery, and coordinated-close lifecycle. The depth changes required
artifacts and proof, not ownership or cleanup:

| Depth | Use when | Required depth |
|---|---|---|
| Small | The change is local, uses accepted contracts, and does not alter product or architecture decisions. | Exact source claim, focused checks, findings-first review, standalone or mounted delivery, and `dev-close`. |
| Standard | The change crosses modules or changes an existing product/runtime behavior covered by accepted sources. | Affected `ModuleImpact` records, dependency-aware implementation, focused functional proof where product behavior changes, applicable Acceptance, review, and `dev-close`. |
| Large | The change introduces or replaces product journeys, architecture boundaries, ownership, protocol, persistence, security, or rollout policy. | Accepted product and architecture contracts before implementation; a tracked stable Plan only when the owner explicitly accepts and mounts one; full required Journey and Acceptance evidence. |

Work depth never overrides Plan policy. Explicit standalone no-Plan work remains
standalone at every depth. If a large standalone request lacks an accepted
product or architecture decision, report that missing decision instead of
creating a Plan.

---

## 2) Bind the active worktree

When the user starts by saying which worktree to use, that worktree becomes the
task's active worktree.

The Workflow Kernel represents that authority as one canonical
`BindingProjection`. One visible chat has one immutable `OWNER`; internal
`WORKER` and `REVIEWER` sessions require create-once assignments with exact
root/parent lineage and bounded leases. TRAE uses `chat_session_id` for OWNER
and `session_id` only for execution-session identity. No host-field alias,
legacy conversation record, process-global identity, or worktree-wide binding
enumeration may select authority.

The OWNER root ID is retained only in owner-controlled machine-local state.
Registrations, Development declarations, Sessions, active-work, and Workflow
Snapshot expose the same verified owner reference; Git author/email is never a
conversation identity.

Default rule:
- All edits, generated files, staging, commits, and PR operations must stay
  inside the active worktree.
- Other worktrees are read-only unless the user explicitly grants write scope
  for another path.
- IDE-open files, search results, shell defaults, and previous conversation
  context do not override the active worktree.
- Before editing or staging, verify `pwd` and `git rev-parse --show-toplevel`
  point to the active worktree.
- If a required change appears to belong in another worktree, stop and ask
  before writing.

Cross-worktree comparison is allowed for investigation, conflict analysis, and
PR review, but write scope remains bound to the active worktree.

Agents must not create a worktree merely to bypass Plan mount, lifecycle, or
resource conflicts. A worktree is created only when the user explicitly
chooses isolation or concurrency. After that explicit choice, use the
owner-aware command rather than raw `git worktree add`:

```bash
make worktree-create \
  WORKTREE=<absolute-path> \
  BRANCH=<new-branch> \
  PURPOSE='<why this worktree exists>' \
  [START=<ref>]
```

The command writes
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/worktree-creation.json`
with the creating main-session ID, its verified OWNER binding digest, the
source workspace, initial branch/HEAD, purpose, and the creation Action
Receipt. The receipt is execution provenance, not a substitute for the user's
explicit authorization. `make worktree-creation-status` reads that record.

Before an explicitly authorized worktree removal, stop its runtime resources
and run the coordinated close with `ENVIRONMENT_POLICY=unregister`. Never
release individual records or delete a machine registry row by hand:

```bash
make dev-close WORK_ITEM=<id> MODE=<tracked|standalone> \
  CLOSE_REASON=<completed|cancelled|owner-abandon> \
  ENVIRONMENT_POLICY=unregister [MOUNT=<mount-id>]
```

For tracked work, the Plan has one stable identity independent from execution
placement. An explicit owner action mounts it to one selected execution
worktree:

```bash
make plan-mount PLAN=<plan.md>
make plan-mount-status
```

The worktree remains occupied until the run completes, is cancelled, or the
owner explicitly unmounts it:

```bash
make plan-unmount MOUNT=<mount-id> \
  REASON=<completed|cancelled|owner-unmount>
```

The command requires the exact mount owner. Agents cannot change the execution
worktree or unmount an unfinished run without explicit `owner-unmount`
authority. Repository discovery never replaces a mount. A deleted worktree is
recoverable only through exact
`workspaceId + mountId + mountedBy` identity.

Plan authoring first produces a non-executable candidate. Review the
source-backed objective, criteria, and criterion coverage, then record the
user's explicit decision:

```bash
make plan-validate PLAN=<plan.md>
make plan-approve-north-star PLAN=<plan.md> \
  DECISION_REF=<durable-user-decision-ref>
make plan-mount PLAN=<plan.md>
```

`plan-validate` reports `candidate`, `stale`, or `approved`; it never infers
approval. Mount and execution fail as `NORTH_STAR_APPROVAL_REQUIRED` unless the
stored approval matches the current `planId + northStar` digest.

Ordinary execution discoveries are amended in place without changing
`planId`, `mountId`, or `runId`:

```bash
make plan-amend PLAN=<plan.md> \
  REASON='<why the current execution model changed>' \
  CHANGE='<what changed>'
```

The command appends the audit record, derives affected Task and Gate IDs,
publishes a new immutable internal snapshot, and atomically revalidates the
Execution Run. Gate/write-set/dependency/check/task-order/implementation-path
changes are Agent-owned. Only a change to the accepted `northStar` requires
a fresh `plan-approve-north-star` record followed by
`APPROVAL=owner DECISION_REF=<same-ref>` after the user receives the conflict,
impacted goal, options/tradeoffs, and recommendation. `criterionCoverage`
changes preserve approval while the North Star digest is unchanged. Expanding
operation authorization remains a separate explicit authorization boundary.

### Explicit standalone no-Plan work

When the user explicitly says `no plan`, `不要 plan`, or otherwise directs the
Agent to execute the current task without creating a Plan, that instruction is
the Plan policy for the request:

- do not invoke Plan modeling or persistence;
- do not create a Plan, Task Slice, PlanMount, ExecutionPlanSnapshot,
  ExecutionRun, Development Session, active-work record, or Context Anchor;
- do not convert repository size, test requirements, or delivery tooling into
  an implicit reason to create a Plan;
- publish the normal untracked Development declaration before the first write,
  preserve unrelated dirty files, run focused verification and review, and
  deliver as a standalone change;
- keep formal Acceptance explicitly `NOT RUN/UNPROVEN` when standalone
  execution has no source-bound Acceptance session.

The standalone lifecycle is:

```text
bind -> declare -> implement -> focused verification -> review
     -> standalone delivery -> release
```

If accepted product or architecture sources are insufficient to execute safely,
report the exact missing decision. Do not manufacture a Plan to satisfy the
workflow.

---

## 3) Declare development resources

Read-only investigation may happen before declaration. Before the first
repository write or runtime acquisition for any non-trivial task:

```bash
make dev-start \
  WORK_ITEM=<stable-id> \
  PURPOSE='<purpose>' \
  SOURCE_CLAIMS='<shared-read|exclusive-write>:<repo-path>[;...]' \
  RUNTIME_CLAIMS='<shared|exclusive>:<kind>:<resource-id>[;...]'
```

Rules:

- The command atomically publishes intent to
  `~/.peers-touch/dev/work.json`, checks cross-worktree conflicts, and reads the
  declaration back.
- Run `make dev-check WORK_ITEM=<id>` before each mutation slice.
- Use `make dev-update` before growing source or runtime scope.
- Refresh the declared source HEAD with `make dev-update` after an authorized
  commit, rebase or merge.
- Use `make dev-status-all` to inspect all worktree declarations.
- A declaration is public intent, not a Profile/Station lease or operation
  authorization.
- Completion, cancellation and abandonment require `make dev-close`; a
  declaration release alone is not complete cleanup.

For a runtime-bearing Task, the Agent gathers one `ModuleImpact` from each
affected module and prepares one combined resource plan before acquisition:

```bash
make dev-resources-prepare \
  WORK_ITEM=<id> \
  RESOURCE_INPUT=<plan-resource-request.json>
```

The Agent, not the developer, owns this command and its input. The result names
the target dependency waves, peak resource demand, reused resources,
build/restart/provision actions, and any parked target. Compatible accounts,
services, clients, devices, Fixtures, and automation sessions are deduplicated
across modules. One target's claims publish all-or-none; a conflict parks only
that target and its dependents.

Runtime and Acceptance Suite owners perform the physical lifecycle and return
manifest-bound results through `make dev-resource-record`. Business Gates only
attach to the prepared manifest. They never create accounts, launch clients,
deploy services, or release resources.

Architecture source:
`docs/architecture/engineering/development-workflow/README.md`.

### Tracked Task Command Path

```text
bind -> declare -> session -> implement -> functional proof
     -> Acceptance -> independent review -> close -> release
```

Use owner commands rather than editing machine state or Plan lifecycle fields:

```bash
make dev-session-start \
  WORK_ITEM=<stable-id> \
  PLAN=<plan-version.md> \
  TASK=<current-task-id> \
  JOURNEY=<journey-id>

make dev-check WORK_ITEM=<stable-id>
make workflow-snapshot
make completion-review-prepare WORK_ITEM=<stable-id> SCOPE=<task|plan>
make completion-review-submit \
  REVIEW=<review-id> \
  VERDICT=PASS \
  ASSESSMENT=<owner-only-json-file> \
  CAPABILITY=<reviewer-capability-json-file>
make dev-close WORK_ITEM=<stable-id> MODE=tracked \
  CLOSE_REASON=completed ENVIRONMENT_POLICY=retain MOUNT=<mount-id>
```

`completion-review-prepare` binds the current successful Development Session,
source, obligations, candidate Plan, and evidence into an immutable request
and returns one owner-private reviewer capability path.
`completion-review-submit` accepts only that exact capability and derives the
delegation digest and assessment proof internally. This proves request-scoped
delegation, not reviewer independence; Dev Workflow must launch the independent
reviewer. Completion Review does not depend on an IDE Hook, Action Receipt,
Workflow Binding, or caller-provided identity.

`make plan-advance` closes or parks a Task only after the required journal-backed
Session and current Completion Review pass. `make plan-reopen` reopens the
earliest completed closure invalidated by source or obligation drift.

`make plan-cancel PLAN=<plan.md>` is the exact-owner cancellation path.
After delivery or cancellation, `dev-close` verifies no live lease remains,
archives the Session, closes active-work, releases the declaration and mount,
and writes a resumable `DevelopmentCloseReceipt`. New work is not admitted
while that receipt is `CLOSING` or `BLOCKED`.

### Development Skill responsibility chain

```text
pt-god-view routes
  -> pt-dev-workflow owns one Development Run
  -> pt-goal-orchestrator schedules WHAT is ready
  -> pt-execution-plan-guardian decides whether one proposed action MAY run
  -> pt-dev-workflow executes and persists through owner commands
  -> pt-context-anchor renders read-only status
```

`pt-architecture-execution-methodology` defines the vertical dependency model;
`pt-plan-and-document` only persists the accepted model. Router, scheduler,
policy guard, and status projection do not write Plan/Task/Session/workspace
active-work state.

The workflow implementation is maintained as canonical source in
`peers-dev-workflow`, then distributed to consuming worktrees. Every installed
copy derives the consuming worktree's canonical root and `workspaceId`; mutable
state stays under that workspace's machine directory. Project memory and chat
never become a shared runtime-state service.

### Continuous Plan Run

An explicit `continue`, `resume`, `execute the plan`, or equivalent request
authorizes Dev Workflow to drain the accepted Plan within its recorded
authorization envelope:

```text
Task Goal Slice
  -> focused verification
  -> agent review and remediation
  -> Task closure or parking
  -> dependency-ready successor
  -> repeat
```

Goal Slice remains one Task and one stage. Task closure, review success,
Context Anchor output, and context compaction are internal checkpoints, not
requests for another user confirmation.

Already-authorized operations execute directly. An exact user grant or an
explicit allowed field in the accepted Plan authorization envelope remains
valid across Task/Goal transitions, retries, context compaction, and host
changes. A sensitive operation category is not a reason to ask again.
`OPERATION_AUTHORIZATION_REQUIRED` applies only when the proposed action is
denied or outside every explicit grant. After admission, ask about permission
only when the attempted operation returns an actual external permission,
credential, or scope failure.

The agent runs the applicable methodology review plus `pt-quality-check`,
`pt-completion-auditor`, and `pt-github-review`; it fixes source-backed findings
and reruns the affected review. Escalate only when the next step requires:

- an operation the accepted Plan authorization explicitly denies or does not
  grant;
- destructive or irreversible work not already authorized;
- force push, history rewrite, merge, release, production mutation, data
  deletion/reset, environment creation, permission expansion, version/schema
  bump, worktree add/remove/prune, or secret access;
- a product, architecture, security, privacy, compatibility, or rollout choice
  that would change, weaken, or abandon the accepted North Star and cannot be
  resolved from accepted sources;
- an unavailable external resource or credential; or
- fixed-point exhaustion with no dependency-ready Task or legal remediation.

An Anchor emitted during the Run reports the autonomous horizon and stop
conditions. It never ends with `Continue?`.

### Host-Neutral Runtime And Tool Dispatch

Project owners do not depend on TRAE, Cursor, Codex, or another agent host:

```text
pt-dev-runtime-handoff -> repository-native command / product driver
pt-goal-orchestrator -> Host Capability Request
  -> Guardian ACTION_ALLOWED
  -> pt-dev-workflow
  -> pt-trae-host-adapter | pt-cursor-host-adapter | pt-codex-host-adapter
```

The generic owners define scheduling, Journey semantics, verification class,
Session transition, and cleanup. A host adapter only invokes tools exposed by
the detected host. It may not decide PASS, weaken a native Journey to browser
or coordinate evidence, run the repository-native fallback, or become a Task
blocker when a project-owned path can continue.

The scheduler only projects the required host capability. Dev Workflow invokes
the selected adapter after Guardian admission and owns retries, fallback,
cleanup, parking, and durable result handling. An adapter never runs the
repository-native fallback. Unavailable capability identity and attempted
transports are persisted; only a new available observation can unblock the
request. A failed cleanup has one bounded quarantine result, not a recursive
cleanup loop; the current resource-dependent Task parks while independent ready
Tasks continue. One post-expiry `inspect-quarantine` observation commits release
or escalates the still-live external resource. Repeated and pre-expiry
observations fail closed.

Host identity comes from explicit runtime metadata, corroborated by tool
inventory or host-injected environment markers. The presence of `.trae`,
`.cursor`, `.agents`, or an installed CLI is not identity. A missing optional
host capability returns a typed unavailable result and degrades to another
project-owned path or serial execution.

---

## 4) Route Acceptance work by ownership

Before changing Acceptance code, classify responsibility:

| Work | Required Skill | Ownership |
|---|---|---|
| Core contracts, planner, validator, runner, reporter, Evidence Store, generic lifecycle, registration mechanism, framework self-tests | `pt-acceptance-infra-engineering` | Acceptance Infra |
| Domain, Feature, Capability, Registry rule, concrete Gate, Environment, Provisioner, Fixture, actor/client role, credential reference, product evidence | `pt-acceptance-engineering` | Business module injection |

Rules:

- Infra defines how business modules inject; business modules provide the
  injected content.
- A path under `tooling/acceptance/` is not automatically Infra-owned.
- Missing business injection blocks only its Domain and is reported as
  `BUSINESS_INJECTION_REQUIRED`.
- Business Gate `FAILED`, `BLOCKED`, or `UNPROVEN` does not block Acceptance
  Infra completion.
- Mixed requests are split into separate work items and ownership contexts.
- Infra Agents must not add placeholders, mocks, default identities, concrete
  actor roles, or weakened product assertions to make framework checks pass.

Architecture source:
`docs/architecture/engineering/acceptance/decisions.md` D-12.

---

## 5) Use correct paths

- Desktop: `apps/desktop`
- Mobile Android: `apps/mobile/android`
- Mobile iOS: `apps/mobile/ios`
- Station App: `apps/station/app`
- Station Frame: `apps/station/frame`
- Domain Model: `model/domain`

---

## 6) Product-first implementation sequence

For every dependency-ready workstream:

1. Bind one product Journey or class-specific functional boundary.
2. Reproduce once and record the first actionable failure.
3. Define/adjust contracts (`model/domain` or Desktop Tauri contracts).
4. Implement the root correction at the owning layer.
5. Connect consumers and UI.
6. Run focused unit/type/contract checks.
7. Create an authorized checkpoint commit when exact-source runtime is needed.
8. Deploy/start through Local Dev Control Plane and Make.
9. Run the real Journey:
   - `FAIL` → return the first failure to implementation;
   - `BLOCKED` → park the environment or authorization edge;
   - `PASS` → record `FUNCTIONAL_PASS`.
10. Only after `FUNCTIONAL_PASS`, promote the same Journey into formal
    Acceptance and run final exact-source proof.

Acceptance scenarios are selected from product states, receiver outcomes,
changed failure semantics, and concrete architecture risks. Do not impose a
generic success/network/timeout/invalid/cancellation matrix on every closure.

Before required product `FUNCTIONAL_PASS`, do not run coverage, Gap Detector,
Completion Auditor `delivery-ready|close-ready`, cross-platform matrices,
submit pipeline, or unrelated broad Gate bundles. The lifecycle-only
`implementation-ready` claim remains available during source work.

---

## 7) Verification commands

### Desktop

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

App-only check:

```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```

### Mobile

```bash
pnpm mobile:check
```

### Station

```bash
cd apps/station/app
gofmt -l .
go test ./...
```

---

## 8) Verification classes

| Class | Meaning |
|---|---|
| `SOURCE_CHECK` | unit, typecheck, build, or focused contract check |
| `STRUCTURAL_CHECK` | source, registry, schema, or static relation |
| `UX_REVIEW` | prototype or screenshot contract |
| `FUNCTIONAL_CHECK` | exact-source real product Journey |
| `ACCEPTANCE_PROOF` | formal capability proof |

Only `FUNCTIONAL_CHECK` supports “this Journey works”. `PROVEN` is reserved for
formal Acceptance.

---

## 9) Completion criteria

Only mark task done when:
- Implementation is complete
- Relevant lint/check passes
- Build succeeds
- Tests pass
- Required exact-source Journeys have `FUNCTIONAL_CHECK`
- Required formal capabilities have `ACCEPTANCE_PROOF`
- Public resources are closed by `dev-close` and the exact
  `DevelopmentCloseReceipt` is `CLOSED`

Suggested report format:

```markdown
✅ Task Completed

## Implementation
- ...

## Verification
- ✅ check/lint
- ✅ build
- ✅ tests
- ✅ functional validation

## Files
- [file](file:///absolute/path)
```
