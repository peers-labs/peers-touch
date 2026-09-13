# Development Workflow Control Plane - Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team

---

## 1. Existing System Mapping

| Existing owner/path | Current role | Target relationship |
|---|---|---|
| `docs/global/workflow.md` | Outer development stages | Retains outer stages; points `EXECUTE` to this control plane |
| `tooling/skills/pt-dev-workflow` | Stage classification and dispatch | Dispatches and reports inner Development state |
| `tooling/skills/pt-execution-plan-guardian` | Scope, queue and plan conformance | Selects one Journey and delegates its loop |
| `tooling/skills/pt-defect-closure` | Bug fix plus Acceptance growth | Inserts exact-source functional verification before Acceptance injection |
| `tooling/skills/pt-dev-runtime-handoff` | Native Acceptance runtime preparation | Splits reusable runtime handoff from formal Acceptance publication |
| `docs/architecture/local-dev-control-plane/` | Machine resource ownership | Supplies workspace binding, Profile, slot and capability leases |
| `tooling/scripts/local-dev/` | Current Make-backed runtime commands | Remains sole deploy/start path; gains workflow-facing entrypoints |
| `tooling/acceptance/` | Formal product proof | Runs only after Development functional promotion |
| `docs/architecture/quality-framework/` | Review and merge lifecycle | Consumes formal evidence at delivery |
| execution plans | Scope and milestone status | Stop storing raw attempts; retain only current state and durable references |

## 2. Control-Plane Composition

```text
Development Workflow
  |
  | resolve work item and Journey
  v
Execution Plan -------------------------- product/domain contract
  |
  | request runtime capability
  v
Local Dev Control Plane ---------------- environment repository
  |
  | resolved profile + leases
  v
Make / platform runtime owners
  |
  | exact-source live runtime
  v
Shared business Journey
  |                         \
  | Dev policy               \ Acceptance policy
  v                           v
Development record        Evidence Store
```

No layer duplicates another layer's state:

- Development Workflow stores transition state, not port or lease truth.
- Local Dev Control Plane stores allocation, not task completion.
- Journey stores behavior, not environment topology.
- Acceptance stores formal evidence, not development iteration history.

## 3. Command Surface

```bash
make dev-start WORK_ITEM=<id> PURPOSE=<text> SOURCE_CLAIMS=<claims>
make dev-update WORK_ITEM=<id>
make dev-status [WORK_ITEM=<id>]
make dev-status-all
make dev-check WORK_ITEM=<id>
make dev-heartbeat WORK_ITEM=<id>
make dev-release WORK_ITEM=<id>
```

`make dev-start` atomically publishes the current worktree's source and runtime
claims to `~/.peers-touch/dev/work.json` and reads the declaration back. It
refuses same-workspace source conflicts, same-branch parallel writes and
exclusive runtime conflicts. Source overlap between different worktrees on
different branches is allowed and reported as `SOURCE_OVERLAP_WARNING` for
later semantic reconciliation. `make dev-status-all` gives every worktree the
same public view of declarations, owners, expiry and observed leases.
`make dev-update` replaces explicitly supplied scope and refreshes branch/HEAD;
an explicit empty `RUNTIME_CLAIMS=` clears planned runtime intent.
`make dev-check` verifies workspace, optional session, branch and HEAD before a
mutation slice.

The current control-plane implementation does not include a generic Journey
runner. A future `make dev-run` may perform one orchestrated transition, but it
must not become an alias for full Acceptance. Such a runner would:

1. Loads the current work item and Journey.
2. Confirms the public declaration still matches this session.
3. Resolves current Development state.
4. Runs only the next legal action.
5. Acquires resources through Local Dev Control Plane.
6. Prints one bounded status and first failure.
7. Persists transient state below the machine Dev root.

It must not:

- invoke `acceptance-plan`, coverage or broad Gate bundles;
- edit source or acquire runtime resources before `dev-start`;
- create a commit without `localCommit: allowed`;
- push, reset or rewrite history without the corresponding capability;
- select a Profile from another worktree;
- bypass `make station`, `make desktop` or platform-owned launch APIs.

Domain-friendly aliases may exist:

```bash
make dev-chat JOURNEY=direct
make dev-chat JOURNEY=group
```

Aliases only bind a known Journey ID. They do not implement another runner.

## 4. Skill Integration

### Target `pt-dev-workflow` Contract

`pt-dev-workflow` remains the only complete-development entry point.

Proposed trigger description:

```yaml
description: >-
  Orchestrates Peers-Touch development from requirement classification through
  resource declaration, product/design/plan gates, product-first execution,
  Acceptance promotion, review and delivery. Invoke for every non-trivial
  development task or when resuming tracked work.
```

Required inputs:

- explicit worktree;
- requirement or tracked plan;
- work classification;
- Journey IDs when product behavior is in scope;
- preliminary resource intent;
- authorization envelope.

Required discipline:

1. Inspection may be read-only before declaration.
2. Before the first write, publish and confirm the machine-wide declaration.
3. Update the declaration atomically when stage scope changes.
4. Dispatch PRODUCT, DESIGN and PLAN through existing stage Skills.
5. During EXECUTE, require the Development state machine.
6. Refuse Acceptance expansion before `FUNCTIONAL_PASS`.
7. Enter DELIVER only after required formal proof and completion audit.
8. Release the public declaration and machine leases on close or cancellation.

Required output:

```text
work item + public declaration
  -> accepted product/design/plan artifacts
  -> exact-source functional result
  -> formal Acceptance result
  -> delivery result
  -> released resource declaration
```

### `pt-dev-workflow`

Add pre-write declaration across every stage, the inner `EXECUTE` state machine
and Journey-based progress claims. Gate counts and file counts remain secondary
diagnostics.

### `pt-execution-plan-guardian`

Before implementation:

- select one dependency-ready workstream;
- bind one P0 Journey;
- record the authorization envelope;
- choose source lanes separately from the serial runtime lane.

During execution it must not dispatch Acceptance expansion until
`FUNCTIONAL_PASS`.

### `pt-defect-closure`

Target sequence:

```text
reproduce
  -> root-cause fix
  -> focused source checks
  -> checkpoint/deploy
  -> exact-source functional pass
  -> Acceptance injection
  -> final checkpoint
  -> exact-source Acceptance execution
  -> growth classification
```

An interaction contract may be defined before the fix. Prototype sync occurs
only when a product or prototype contract changed, not for every runtime-only
defect.

### `pt-dev-runtime-handoff`

Split its responsibilities:

- reusable runtime handoff: profile resolution, deploy, launch and cleanup;
- Acceptance mode: embedded WebDriver, immutable evidence and proof publication.

Dev mode uses the first part without allocating an Acceptance run.

The Journey adapter used by Dev mode is promoted into Acceptance rather than
copied. If promotion changes product code or shared Journey semantics, the
workflow returns to focused checking and functional execution. If it changes
only Acceptance packaging, the final Acceptance run becomes the exact-source
product proof.

### `pt-completion-auditor`

It must reject:

- readiness claims based only on source/static/UX checks;
- a product work item without a current functional Journey result;
- a formal completion claim without required Acceptance proof.

### Existing Skill Gap Matrix

| Skill | Retained responsibility | Missing contract to add |
|---|---|---|
| `pt-dev-workflow` | Outer stage dispatch | public declaration, lifecycle transitions, functional promotion |
| `pt-execution-plan-guardian` | plan scope and dependency queue | one active Journey, first-failure loop, Acceptance fence |
| `pt-defect-closure` | root-cause and regression growth | checkpoint/deploy/functional pass before Gate injection |
| `pt-dev-runtime-handoff` | Native runtime and Acceptance preparation | lightweight Dev policy without Evidence Store publication |
| `pt-completion-auditor` | readiness audit | verification class and current functional result |
| `pt-god-view` | initial classification and dispatch | route non-trivial development through the upgraded orchestrator |

No new orchestrator Skill is introduced. Runtime state remains implemented by
commands and machine data; Skills only enforce order, dispatch and claims.

## 5. Journey Reuse Boundary

Target dependency direction:

```text
Domain Journey
  -> domain service/driver interfaces

Dev Runner
  -> Domain Journey
  -> Development record writer

Acceptance Gate
  -> Domain Journey
  -> Acceptance provisioning/evidence interfaces
```

Forbidden:

- Domain Journey imports Evidence Store.
- Domain Journey creates or resets Fixture.
- Acceptance Gate has a second copy of UI actions or assertions.
- Dev Runner weakens assertions to improve speed.
- Harness-only operations replace visible user actions.

## 6. Plan And Status Integration

Execution plans retain one compact table:

| Workstream | Journey | Dev state | Checkpoint | Functional result | Acceptance result | Blocker |
|---|---|---|---|---|---|---|

Plan rules:

- update the row in place;
- record only milestone commits and final evidence references;
- do not append per-run narrative;
- keep diagnostic details in the Development session directory;
- `active_work.current_step` references the workstream and current Dev state;
- no new `active_work` schema field is required.

## 7. Authorization Integration

The execution plan or explicit Goal instruction supplies the authorization
envelope. Local Dev Control Plane enforces runtime capabilities; Git and
delivery tooling enforce source capabilities.

Development Workflow publishes the requested capabilities and source write
scope in `work.json`; this makes intent visible but does not grant authority.
The authorization envelope grants task permission, while the Local Dev lease
proves current exclusive possession.

| Action | Workflow capability | Runtime capability |
|---|---|---|
| Local checkpoint commit | `checkpoint.localCommit` | none |
| Remote Station deploy | profile allowlist | `station.deploy` lease |
| Fixture reset | reset scope allowlist | `station.reset` lease |
| Push | `delivery.push` | none |
| Pull request | `delivery.pullRequest` | none |
| Rebase/force-push | `history.rewrite` | none |

Missing capability is a typed `AUTHORIZATION_REQUIRED` block. It does not permit
an alternative deployment path.

## 8. Storage Integration

Development state resolves through the Local Dev Control Plane:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/
```

Acceptance continues using:

```text
~/.peers-touch/dev/acceptance/
```

The two stores do not share latest pointers, proof states or retention.
Development artifacts may be inspected for diagnosis but cannot be promoted by
copying. Formal Acceptance must execute the Journey and create its own evidence.

## 9. Reporting Integration

Before a command longer than 30 seconds:

```text
[DEV] action=<id> purpose=<one sentence> budget=<duration>
```

After completion:

```text
[DEV] result=PASS|FAIL|BLOCKED
      firstFailure=<one actionable failure or none>
      next=<one legal transition>
```

Detailed logs remain in machine-local artifacts. Chat updates do not list every
child Gate, retry or evidence file unless requested.

## 10. Migration Constraints

- Do not build a generic framework before the Chat pilot validates the model.
- Do not remove existing Acceptance commands during the pilot.
- Do not create a second Profile, lease, driver or Journey authority.
- Do not keep a private worktree-only resource declaration or infer another
  worktree's intent from branch names and process lists.
- Do not preserve old and new execution-state owners after cutover.
- Do not migrate historical raw logs into the new Development store.
- Do not rewrite existing execution plans wholesale; apply compact status rules
  to active work and archive historical plans separately.
- Do not infer checkpoint, deploy, reset, push or rewrite authorization from
  prior unrelated tasks.

## 11. Pilot Contract

The architecture pilot uses two Chat Journeys:

```text
chat.direct.native
  Alice sends -> Bob decrypts and displays -> Alice observes delivered

chat.group.native
  Alice opens Create Group -> selects Bob and Carol -> Group establishes
  -> all three clients project the same Group -> Bob and Carol decrypt a message
```

Pilot success requires:

- exact checkpoint and runtime identity;
- real Native windows and visible user actions;
- first-failure output;
- no broad Acceptance run before functional pass;
- no Development artifact written to the repository or Evidence Store;
- the promoted Acceptance Gate consuming the same business Journey;
- measured command count and elapsed time lower than the pre-cut workflow.
