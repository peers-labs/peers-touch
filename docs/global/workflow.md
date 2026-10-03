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

The installer projects repository-owned Skills and supported blockable hooks
into the current worktree. The Doctor verifies the public promises below. A
`BLOCKED` result names the owner that must be repaired; it is not permission to
bypass the workflow or create another worktree.

For a TRAE multi-root workspace, install with
`make skills IDE=trae WORKSPACE=<absolute-.code-workspace-path>`. The
descriptor's first folder hosts the only managed bootstrap, but it never
selects execution authority. Installation requires machine-wide workflow
quiescence and hard-deletes only the old conversation and workflow-action
stores; there is no compatibility reader or migration.

| Promise ID | What must be true | Normal recovery |
|---|---|---|
| `dev.integration.installed` | The selected host has the exact current Skill and hook projection, callback proof, and install receipt. | Run `make skills IDE=<host>` at a durable boundary. |
| `dev.plan.binding` | This worktree resolves one current Plan generation whose workspace and branch match current source. | Bind generation 1, or explicitly advance a completed and quiescent generation. |
| `dev.workflow.current` | Plan, current Task, Development Session, declaration, active-work, and reduced Action Receipt state agree. | Repair the typed owner mismatch; never edit machine state directly. |
| `dev.review.current` | Active work has no failed or stale review; completed work has a current independent `PASS`. | Run a fresh independent Completion Review after source or obligation drift. |
| `dev.server.live` | The machine-wide Peers Dev endpoint is live and exposes compatible source freshness. | Run `make dev-ui`; stop a stale incompatible listener first. |
| `dev.docs.executable` | This guide and `apps/dev/README.md` declare each public promise exactly once. | Update code and both guides in the same change. |

<!-- workflow-doctor:dev.integration.installed -->
<!-- workflow-doctor:dev.plan.binding -->
<!-- workflow-doctor:dev.workflow.current -->
<!-- workflow-doctor:dev.review.current -->
<!-- workflow-doctor:dev.server.live -->
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

Agents must not create a worktree merely to bypass Plan binding, lifecycle, or
resource conflicts. A worktree is created only when the user explicitly
chooses isolation or concurrency.

Before an explicitly authorized worktree removal, stop its runtime resources,
release its declaration, and run `make env-unregister` from that worktree.
Never delete a machine registry row by hand.

Plan binding is immutable within one generation:

```bash
make plan-bind PLAN=<package-plan.md>
make plan-binding
```

After that Plan is `completed` and its declaration, active-work projection, and
runtime leases are released, the same workspace may explicitly advance:

```bash
make plan-binding-advance \
  PLAN=<next-package-plan.md> \
  EXPECTED_GENERATION=<current-generation>
```

There is no unbind or discovery-based replacement path.

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
- Completion, cancellation and abandonment require
  `make dev-release WORK_ITEM=<id>`.

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
`docs/architecture/development-workflow/README.md`.

### Tracked Task Command Path

```text
bind -> declare -> session -> implement -> functional proof
     -> Acceptance -> independent review -> close -> release
```

Use owner commands rather than editing machine state or Plan lifecycle fields:

```bash
make dev-session-start \
  WORK_ITEM=<stable-id> \
  PLAN=<package-plan.md> \
  TASK=<current-task-id> \
  JOURNEY=<journey-id>

make dev-check WORK_ITEM=<stable-id>
make workflow-snapshot
make completion-review-prepare WORK_ITEM=<stable-id> SCOPE=<task|plan>
make completion-review-submit \
  REVIEW=<review-id> \
  VERDICT=PASS \
  ASSESSMENT=<owner-only-json-file>
make dev-release WORK_ITEM=<stable-id>
```

`completion-review-prepare` resolves the exact current OWNER Action Receipt and
creates the REVIEWER assignment recorded by the immutable request.
`completion-review-submit` accepts only a live child projection with that exact
assignment. Stale, expired, terminal, unassigned, wrong-parent, and historical
bindings never participate in selection.

`make plan-advance` closes or parks a Task only after the required journal-backed
Session and current Completion Review pass. `make plan-reopen` reopens the
earliest completed closure invalidated by source or obligation drift.

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
and reruns the affected review. Escalate only when the next step requires an
operation outside the accepted authorization, destructive or irreversible
work, an external grant/resource, an unresolved material semantic choice, or
fixed-point exhaustion.

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
the detected host. It may not decide PASS, weaken required proof, run the
repository-native fallback, or become a Task blocker when a project-owned path
can continue. Missing capability degrades only that transport. Cleanup failure
has one bounded quarantine and one post-expiry observation, never a recursive
cleanup loop.

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
  that accepted sources cannot determine;
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
or coordinate evidence, or become a Task blocker when a repository-native path
can continue.

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
`docs/architecture/acceptance-framework/decisions.md` D-12.

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

Before `FUNCTIONAL_PASS`, do not run coverage, Gap Detector, Completion Auditor,
cross-platform matrices, submit pipeline, or unrelated broad Gate bundles.

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
cd apps/mobile/android && ./gradlew build
cd apps/mobile/ios && xcodebuild -scheme PeersTouch -configuration Debug build
```

### Station

```bash
cd apps/station
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
- Public resource declaration and runtime leases are released

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
