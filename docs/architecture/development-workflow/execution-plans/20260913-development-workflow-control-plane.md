# Development Workflow Control Plane - Execution Plan

> **Status**: complete
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team

---

## 1. Goal

Implement the accepted Development Workflow architecture so every non-trivial
task:

1. publishes machine-visible source and runtime intent before its first write;
2. follows the product-first Development state machine;
3. reaches exact-source `FUNCTIONAL_PASS` before Acceptance promotion;
4. keeps Development records separate from formal Acceptance evidence;
5. releases declarations and runtime resources at closure.

## 2. Architecture Sources

- `docs/architecture/development-workflow/README.md`
- `docs/architecture/development-workflow/design.md`
- `docs/architecture/development-workflow/data-model.md`
- `docs/architecture/development-workflow/decisions.md`
- `docs/architecture/development-workflow/integration.md`
- `docs/architecture/local-dev-control-plane/README.md`
- Decisions `DWF-D01` through `DWF-D12`.

## 3. Scope

In scope:

- Machine-wide `work.json` declaration CLI and focused tests.
- Make entrypoints for start, update, status, status-all, check, heartbeat and
  release.
- `pt-dev-workflow` as the one complete-development orchestrator.
- Downstream Skill contracts for execution, defect closure, runtime handoff,
  completion audit and god-view dispatch.
- Global workflow/agent rules and one path-owned knowledge invariant.
- Skill freshness enforcement and focused verification.

Out of scope:

- Product feature implementation.
- Running broad or environment-backed product Acceptance.
- Local Dev Control Plane registry migration or Acceptance-root migration.
- Automatic Git commit, Station deployment, Fixture reset, push or history
  rewrite.
- Generic Journey runtime implementation beyond the workflow contracts.

## 4. Traceability

| Requirement | Decision | Workstream | Evidence |
|---|---|---|---|
| Public pre-write declaration | DWF-D11 | DWF-W1 | CLI tests and two-worktree conflict scenario |
| One workflow Skill | DWF-D12 | DWF-W2 | Skill contract check |
| Product-first state machine | DWF-D01/D02/D03 | DWF-W2 | required marker checks |
| Shared Journey semantics | DWF-D04 | DWF-W2 | Skill dependency and anti-pattern checks |
| Checkpoint authorization | DWF-D05 | DWF-W2 | Skill and docs checks |
| Separate Dev records | DWF-D06/D08 | DWF-W1/W3 | path resolver and repository scan |
| First failure and budgets | DWF-D07 | DWF-W2 | Skill marker checks |
| Proof vocabulary | DWF-D09 | DWF-W2/W3 | Completion Auditor markers |
| Chat-first pilot boundary | DWF-D10 | DWF-W3 | explicit non-claim |

## 5. Dependency Graph

```text
DWF-W0 Accepted architecture and preliminary declaration
  -> DWF-W1 Machine public declaration
       -> DWF-W2 Workflow Skill cutover
            -> DWF-W3 Governance and verification closure
```

The implementation is serial:

- W2 consumes the exact W1 command and state vocabulary.
- W3 verifies the combined source and Skill contract.
- Shared Make, Skill and review files retain one integrator owner.

## 6. Workstreams

### DWF-W0: Accepted Architecture And Plan

Deliverables:

- Architecture status `active`; decisions `accepted`.
- Preliminary public resource declaration.
- This execution plan and tracked-work registration.

Done when:

- Worktree binding and declaration digest are verified.
- Plan contains no execution-log appendix or Context Anchor section.

### DWF-W1: Machine Public Work Ledger

Target:

- `tooling/scripts/local-dev/dev-work.mjs`
- `tooling/scripts/local-dev/dev-work.test.mjs`
- `tooling/scripts/lib/machine-dev-paths.mjs`
- `tooling/scripts/lib/machine-dev-paths.test.mjs`
- `tooling/make/local-dev.mk`
- `Makefile`

Deliverables:

- Atomic `work.json` and lock handling.
- Strict declaration schema and canonical digest.
- Source/runtime conflict detection.
- Expiry, stale, heartbeat, release and readback semantics.
- Commands: `start`, `update`, `status`, `status-all`, `check`, `heartbeat`,
  `release`.

Failure behavior:

- Invalid input, malformed ledger, lock timeout, conflict and readback mismatch
  fail before mutation or return a typed non-zero error.
- A declaration never grants a runtime capability.

Focused checks:

```bash
node --test tooling/scripts/local-dev/dev-work.test.mjs
make dev-status-all
```

### DWF-W2: Workflow Skill Cutover

Target:

- `tooling/skills/pt-dev-workflow/SKILL.md`
- `tooling/skills/pt-execution-plan-guardian/SKILL.md`
- `tooling/skills/pt-defect-closure/SKILL.md`
- `tooling/skills/pt-dev-runtime-handoff/SKILL.md`
- `tooling/skills/pt-completion-auditor/SKILL.md`
- `tooling/skills/pt-god-view/SKILL.md`

Deliverables:

- `pt-dev-workflow` owns intake-to-close orchestration.
- Every stage permits read-only inspection but requires declaration before
  writes or runtime acquisition.
- EXECUTE enforces the accepted Development state machine.
- `FUNCTIONAL_PASS` fences Acceptance injection/execution.
- Downstream Skills retain specialist ownership without a second orchestrator.
- Close/cancel releases public declaration and runtime leases.

Old behavior deleted:

- Direct EXECUTE dispatch without declaration.
- Defect Gate injection before exact-source functional pass.
- Runtime handoff that exposes only formal Acceptance mode.
- Completion claims without verification class.

Focused checks:

```bash
tooling/scripts/review/skill-check.sh
rg -n "FUNCTIONAL_PASS|dev-start|work.json|first failure" tooling/skills
```

### DWF-W3: Governance And Verification Closure

Target:

- `AGENTS.md`
- `docs/global/workflow.md`
- `docs/architecture/local-dev-control-plane/{README.md,design.md,data-model.md,integration.md}`
- `docs/knowledge/invariants/dev-resource-declaration-before-write.md`
- `tooling/scripts/review/skill-check.sh`
- `tooling/skills/pt-github-review/FRESHNESS.md`

Deliverables:

- Project rules point to the upgraded workflow.
- Local Dev docs distinguish public intent from allocation and live leases.
- Skill check prevents removal of declaration, functional fence, first-failure
  and cleanup requirements.
- Review freshness is recalculated after governing-doc updates.
- No duplicate workflow Skill or private worktree declaration path exists.

Focused checks:

```bash
node --test tooling/scripts/lib/machine-dev-paths.test.mjs \
  tooling/scripts/local-dev/dev-work.test.mjs
tooling/scripts/review/skill-check.sh
git diff --check
```

## 7. Acceptance Scenarios

### AS-DWF-01: Publish And Discover

- **Precondition**: Two temporary workspaces share one machine Dev root.
- **Action**: Workspace A starts a work item with one exclusive source claim.
- **Expected**: `status-all` returns the declaration with workspace, branch,
  owner, purpose, expiry and digest.
- **Failure variant**: malformed or unreadable ledger fails closed.
- **Evidence**: focused Node tests and `make dev-status-all`.
- **Status**: passed (`STRUCTURAL_CHECK`)

### AS-DWF-02: Cross-Worktree Conflict

- **Precondition**: Workspace A has an active exclusive source claim.
- **Action**: Workspace B declares an overlapping write claim.
- **Expected**: Workspace B receives `RESOURCE_DECLARATION_CONFLICT`; A remains
  unchanged.
- **Failure variant**: shared read claims coexist.
- **Evidence**: focused Node tests; live cross-worktree CLI probe returned
  `RESOURCE_DECLARATION_CONFLICT` without changing the ledger digest.
- **Status**: passed (`STRUCTURAL_CHECK`)

### AS-DWF-03: Expiry And Release

- **Precondition**: One declaration is expired and another is active.
- **Action**: Status reconciliation and explicit release run.
- **Expected**: Expired becomes `STALE`; release becomes `RELEASED`; neither
  blocks a later declaration.
- **Failure variant**: wrong workspace/session cannot release another owner.
- **Evidence**: Node test assertions.
- **Status**: passed (`SOURCE_CHECK`)

### AS-DWF-04: Skill Functional Fence

- **Precondition**: Canonical project Skills are loaded.
- **Action**: Run `skill-check.sh`.
- **Expected**: It proves one orchestrator, pre-write declaration,
  `FUNCTIONAL_PASS` before Acceptance, first-failure reporting and release on
  close.
- **Failure variant**: removing any marker fails the check.
- **Evidence**: skill-check output.
- **Status**: passed (`STRUCTURAL_CHECK`)

### AS-DWF-05: Repository Hygiene

- **Precondition**: Workflow implementation completed.
- **Action**: Search project sources.
- **Expected**: No second workflow orchestrator, no repository `work.json`, no
  private worktree declaration authority and no Dev artifact writer to the
  Acceptance Store.
- **Failure variant**: forbidden pattern produces a failing review check.
- **Evidence**: search output and `git diff --check`.
- **Status**: passed (`STRUCTURAL_CHECK`)

## 8. Atomic Cutovers

| Concern | New owner | Cutover | Old behavior removed |
|---|---|---|---|
| Development resource intent | machine `work.json` | W1 commands and tests pass | implicit/private intent |
| Complete workflow orchestration | `pt-dev-workflow` | W2 Skill contract passes | outer-stage-only orchestration |
| Bug sequence | revised `pt-defect-closure` | functional fence present | Gate before product pass |
| Runtime handoff policy | revised handoff Skill | Dev/Acceptance modes explicit | Acceptance-only handoff |
| Completion vocabulary | revised auditor | verification classes required | generic test-count readiness |

## 9. Risks And Non-Claims

- The first CLI is machine-local and does not distribute declarations across
  different physical machines.
- `work.json` advertises intent; Local Dev leases remain the live exclusion
  mechanism.
- This plan does not implement generic product Journey runners.
- Passing these checks proves workflow infrastructure and Skill contracts, not
  Chat or another product capability.
- Existing product Acceptance remains unchanged.

## 10. Implementation Status

| Workstream | Status | Completed | Evidence |
|---|---|---|---|
| DWF-W0 | done | 2026-09-13 | accepted design; public bootstrap declaration |
| DWF-W1 | done | 2026-09-13 | focused Node tests 20/20; closed schema/session/HEAD and atomic lock regressions; live concurrent status/check PASS |
| DWF-W2 | done | 2026-09-13 | one complete-development entry point; specialist Skill contracts cut over; skill-check PASS |
| DWF-W3 | done | 2026-09-13 | cross-worktree conflict blocked without ledger mutation; forbidden-pattern checks, syntax and diff hygiene PASS |
