# Development Workflow

> This is the single human-facing standard for Peers-Touch development.
> Architecture documents define why the control plane works; Skills and
> commands implement it.

## One Flow

Every change follows the same control flow:

```text
understand intent and accepted sources
  -> bind one worktree
  -> choose the required artifact depth
  -> declare source/runtime intent
  -> execute the current closure
  -> prove functional behavior
  -> run required formal Acceptance
  -> review and deliver within authorization
  -> release resources
```

Task size changes documentation and proof depth, not ownership, worktree,
authorization, or evidence rules.

| Change class | Required artifacts |
|---|---|
| Small | Existing product/architecture sources must already decide the behavior. Use one bounded mutation slice and focused regression proof. No placeholder Plan or new design document. |
| Standard | Use a compact Plan Package with independently closable Task Slices. Add a product or architecture amendment only when an accepted source does not decide the required behavior. |
| Large | Establish accepted product Journeys and states, architecture ownership/contracts, optional UI prototype, then a dependency-ordered Plan Package before implementation. |

Undefined user-visible behavior returns `PRODUCT_AMENDMENT_REQUIRED`. Undefined
ownership, protocol, persistence, or failure semantics returns
`DESIGN_AMENDMENT_REQUIRED`. Stale but already-decided inventory or dependency
mapping returns `PLAN_AMENDMENT_REQUIRED`.

## Execute

1. Read `project-identity.md`, `architecture.md`, `domain-model.md`,
   `docs/README.md`, and the affected platform/domain sources.
2. Select one explicit worktree. Verify its canonical root, branch,
   `workspaceId`, and expected HEAD. Never infer it from a Skill path, open
   editor file, branch proximity, or chat history.
3. For tracked work, resolve only the workspace's immutable Plan binding and
   current Task. Synchronized foreign Plans do not participate.
4. Before the first repository write or runtime acquisition, publish intent:

   ```bash
   make dev-start \
     WORK_ITEM=<stable-id> \
     PURPOSE='<purpose>' \
     SOURCE_CLAIMS='<mode>:<repo-path>[;...]' \
     RUNTIME_CLAIMS='<mode>:<kind>:<resource-id>[;...]' \
     [PLAN=<plan.md>] [TASK=<task-id>] [JOURNEY=<journey-id>]
   make dev-check WORK_ITEM=<stable-id>
   ```

5. Execute the current closure at its owning layer. Record the first actionable
   failure, fix the root cause, and rerun focused checks. Update the declaration
   before scope growth and heartbeat long-running work.
6. Run `make workflow-snapshot` for tracked execution:
   - `CONTINUE`: perform the next legal owner repair, review, Task handoff, or
     dependency-ready action without asking for confirmation;
   - `HARD_BLOCK`: stop only at the reported typed boundary after the runnable
     frontier is exhausted;
   - `COMPLETE`: close the Plan Run.
7. Persist transitions only through the owning Plan, Session, declaration, and
   active-work commands. Projections never repair their inputs.
   Context Anchor uses
   `make workflow-snapshot WORKFLOW_SNAPSHOT_PROJECTION=anchor`; timing is
   derived from the existing bounded Session journal and never creates a
   metrics write or lifecycle owner.
8. Run agent-led review, fix source-backed findings, and rerun review. The user
   is not the default reviewer.
9. Deliver only operations allowed by the exact user grant or Plan
   authorization, then release runtime resources, the declaration, and the
   workspace active-work record.

Use `make dev-update` after an authorized commit, merge, or rebase changes HEAD.
Use `make dev-release WORK_ITEM=<id>` on completion or cancellation.

## Continuous Plan Run

One explicit `continue`, `resume`, `execute the plan`, or equivalent request
authorizes the accepted Plan Run within its recorded scope and authorization
envelope. A Goal Slice is a single-Task internal scheduling unit, not a user
handoff.

Task closure, successor activation, review, Context Anchor output, retry, and
context compaction do not consume that authorization.
Already-authorized operations execute directly. Ask only for an out-of-envelope or denied
operation, an actual external permission failure, an unavailable external
resource, a destructive action without an exact grant, an unresolved material
semantic decision, or fixed-point exhaustion.

The responsibility chain is:

```text
pt-god-view routes
  -> pt-dev-workflow owns the Development Run
  -> pt-goal-orchestrator proposes what is ready
  -> pt-execution-plan-guardian decides whether one action may run
  -> pt-dev-workflow executes through owner commands
  -> pt-context-anchor projects read-only status
```

Host-specific adapters are optional transports. Repository-native Make,
Harness, WebDriver, Appium, accessibility, and browser drivers define proof
strength. A missing host capability degrades only that transport.

## Evidence Order

```text
implementation
  -> SOURCE_CHECK / STRUCTURAL_CHECK / UX_REVIEW
  -> exact-source FUNCTIONAL_CHECK
  -> FUNCTIONAL_PASS
  -> required ACCEPTANCE_PROOF
  -> PROVEN
```

| Class | Proves |
|---|---|
| `SOURCE_CHECK` | Focused unit, type, build, or contract correctness |
| `STRUCTURAL_CHECK` | Source, registry, schema, or static relationship |
| `UX_REVIEW` | Prototype, screenshot, or interaction contract |
| `FUNCTIONAL_CHECK` | The named exact-source Journey or functional boundary works |
| `ACCEPTANCE_PROOF` | Formal capability evidence |

Focused checks, build success, coverage, and Gate counts do not establish
`FUNCTIONAL_PASS`. `PROVEN` is reserved for formal Acceptance. Completion/full
Acceptance, Gap Detector, and completion review run only after the required
functional frontier passes.

Acceptance scenarios come from product states, receiver outcomes, changed
failure semantics, and architecture risks. Do not impose a generic scenario
matrix on every closure.

## Route Acceptance work by ownership

| Work | Owner |
|---|---|
| Core contracts, planner, validator, runner, reporter, Evidence Store, generic lifecycle, framework self-tests | `pt-acceptance-infra-engineering` |
| Domain, Feature, Capability, Registry rule, Gate, Environment, Provisioner, Fixture, actor/client role, credential reference, product evidence | `pt-acceptance-engineering` |

A path under `tooling/acceptance/` does not determine ownership. Missing
business injection returns `BUSINESS_INJECTION_REQUIRED` and blocks only its
Domain; Acceptance Infra does not add mocks, placeholder identities, or weaker
assertions.
Business Gate `FAILED`, `BLOCKED`, or `UNPROVEN` does not block Acceptance
Infra completion.

## HEAD Lineage

The workflow snapshot uses forward-only HEAD tracking. When a Task makes commits
that advance the branch HEAD, those commits are recognized as forward progress —
not identity drift — as long as the recorded HEAD is an ancestor of the current
HEAD.

- `declaration.sourceHead` vs `git.commit`: skipped when sourceHead is an
  ancestor of the current commit.
- `activeWork.expectedHead` vs `git.commit`: skipped when expectedHead is an
  ancestor of the current commit.
- Non-ancestor divergence (force-push, rebase to unrelated history) is flagged
  as `WORKFLOW_OWNER_MISMATCH` error with verdict `DRIFT`.

## Source Evidence Advance

Tasks with `completionClass: source` may advance without a full Development
Session. Instead of `--session`, pass `--source-evidence <path>` to
`planctl advance`. The evidence file must contain:

```json
{
  "planId": "<plan-id>",
  "taskId": "<task-id>",
  "workspaceId": "<workspace-id>",
  "branch": "<branch>",
  "verifications": [
    { "verificationClass": "SOURCE_CHECK", "result": "PASS" }
  ]
}
```

This eliminates the declaration, binding verification, and Session lifecycle
overhead for implementation-only Tasks. Tasks with `completionClass: functional`
or `acceptance-aggregate` still require a journal-backed Session.

## Completion

A named scope is complete only when:

- implementation and required deletion are complete;
- focused checks pass;
- the required exact-source Journey has current `FUNCTIONAL_CHECK/PASS`;
- required formal capabilities have `ACCEPTANCE_PROOF/PASS`;
- Plan, Task, Session, declaration, Git, and active-work owners agree;
- review findings are resolved;
- unrun scope remains explicitly `UNPROVEN`;
- owned runtime resources and declarations are released.

Use affected-module commands from its architecture/platform documentation.
The control-plane command reference lives in
`docs/architecture/development-workflow/integration.md`; schema and state
details live in `data-model.md`.
