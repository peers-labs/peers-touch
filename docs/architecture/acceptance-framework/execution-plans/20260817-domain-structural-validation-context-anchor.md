# Acceptance Domain Structural Validation And Context Anchor - Execution Plan

> **Status**: implementation complete — DELIVER
> **Version**: v1.0
> **Created**: 2026-08-17 | **Updated**: 2026-08-17
> **Owner**: Acceptance Architecture
> **Module**: `tooling/acceptance/`, `tooling/skills/`

---

## Context Anchor

| Field | Current value |
|---|---|
| Main task | Complete domain-scoped Acceptance structural validation and restore durable Context Anchor governance |
| Plan source | `docs/architecture/acceptance-framework/execution-plans/20260817-domain-structural-validation-context-anchor.md` |
| Tracking source | This plan's workstream table |
| Worktree | `<repo-root>` |
| Branch | `fix/acceptance-domain-structural-validation` |
| Stage | `DELIVER` |
| Current workstream | All implementation workstreams complete |
| Current step | Open a Draft PR with explicit evidence gaps |
| Progress | `CAS-W1` through `CAS-W5` complete |
| Last completed | Commit-range review found no P0-P2 defects; submit pipeline then failed closed on two declared out-of-scope coverage gaps |
| Current action | Push the dedicated branch and create a Draft PR without weakening Quality Evidence policy or staging unrelated generated files |
| Next action | Inspect Draft PR checks and request owner judgment on the declared gaps |
| Blockers | Project memory namespace is externally contaminated with unrelated Big-A content, so `active_work` cannot be safely updated in this run |
| Decisions required | none for repository delivery; memory namespace ownership requires external repair |
| Evidence | Framework self-tests 105/105 PASS; validator 7/7 PASS; Skill check PASS; Applet, Station Dashboard, and Chat structural validation PASS; Federation reports only missing `fedp5` wiring/contract; source-bound Acceptance Gates PASS and Gap Detector `PROVEN`; static review found no P0-P2 defects; submit pipeline failed at Quality Evidence on two declared out-of-scope coverage gaps; Messaging Infra subset restored to HEAD; full hard-rules blocked only by two pre-existing Agent generated files |
| Last updated | 2026-08-17 |

## 1. Goal

Make `acceptance-validate` fail closed on incomplete business-domain injection
without allowing unrelated domains to block each other. Restore
`pt-context-anchor` as a canonical project skill so worktree, branch, plan,
evidence, blockers, and next action remain synchronized across sessions.

## 2. Scope

In scope:

- Domain-scoped Feature, Capability, Gate, environment contract, and
  Provisioner closure validation.
- Regression fixtures for missing Gates, malformed contracts, missing or
  mismatched Provisioners, and unrelated-domain isolation.
- Correct Gate Environment Wiring documentation.
- Canonical `pt-context-anchor` and integration with project workflow skills.
- Removal of only the Acceptance Infra edits misplaced in the Messaging
  worktree after the target worktree passes verification.

Out of scope:

- Creating `fedp5` or native Tauri business environment implementations.
- Changing Chat or Federation product assertions.
- Modifying generated proto outputs.
- Cherry-picking the unrelated LobeHub Agent feature commit that first carried
  the Context Anchor skill.

## 3. Workstreams

| ID | Workstream | Status | Completion evidence |
|---|---|---|---|
| `CAS-W1` | Correct worktree and establish plan | complete | Git root, branch, HEAD, and dirty ownership verified |
| `CAS-W2` | Domain structural closure | complete | Validator tests 7/7; domain validation isolates unrelated Gates and resolves Provisioner closure |
| `CAS-W3` | Context Anchor governance | complete | Canonical Skill, workflow references, path hard rule, and fixture added |
| `CAS-W4` | Misplaced-edit cleanup | complete | Messaging worktree retains only its pre-existing Messaging changes |
| `CAS-W5` | Review and delivery evidence | complete | Framework self-tests 105/105, Skill check, plan/run Gates, Gap Detector, diff checks, and worktree ownership audit complete |

## 4. Dependency Order

1. `CAS-W1` establishes the only writable worktree and branch.
2. `CAS-W2` lands the runtime structural contract and regression fixtures.
3. `CAS-W3` restores durable tracking before completion claims.
4. `CAS-W4` runs only after the target worktree contains and verifies the
   migrated behavior.
5. `CAS-W5` reviews the integrated result and reports remaining business-domain
   injection gaps as `UNPROVEN`, not framework failures.

## 5. Acceptance Criteria

- Validation considers only the selected Domain's Capability, Feature, Gate,
  and validation-Gate closure.
- Every Feature-required Gate exists in `gates.yaml`.
- Every selected non-local Gate declares `provisioner == environment`.
- Every selected environment contract exists, parses, matches its file ID, and
  resolves through the Provisioner registry.
- Missing closure emits actionable, aggregated failure codes with no bypass.
- An invalid unrelated Gate does not fail another Domain's validation.
- `pt-context-anchor` exists only under canonical `tooling/skills/`, is
  registered in `AGENTS.md`, and is integrated with planning, execution,
  completion, and resume workflows.
- Persisted Anchors use `<repo-root>` rather than user-home absolute paths.
- Existing unrelated generated and Messaging changes remain untouched.

## 6. Verification

```bash
python3 tooling/scripts/acceptance-validate-test.py
python3 -m py_compile tooling/scripts/acceptance-validate.py
make acceptance-validate DOMAIN=applet
make acceptance-validate DOMAIN=station-dashboard
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=HEAD
tooling/scripts/review/skill-check.sh
git diff --check -- tooling/acceptance tooling/scripts tooling/skills AGENTS.md docs/architecture/acceptance-framework
```

Chat and Federation validation may fail only with explicit business-owned
Provisioning closure errors until those domains provide their contracts and
Provisioners.
