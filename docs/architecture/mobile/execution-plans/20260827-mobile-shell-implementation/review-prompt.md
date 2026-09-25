# Mobile Shell Schema-v2 Recovery - Plan Review

## Decision Requested

Approve the recovered `mobile-shell-20260827` Plan Package for execution.

Approval authorizes the Development Workflow to select the first dependency-
ready Task, create its Development Session, and execute the accepted DAG. It
does not authorize commit, push, pull-request creation, destructive runtime
reset outside declared scopes, or any product-scope expansion.

## Accepted Inputs

- Product scope: `MS-C01..MS-C10` plus degraded `MS-C14`.
- Non-goals: `MS-C11` WeChat OAuth, `MS-C12` voice/video calls, and `MS-C13`
  Chat Docs.
- Architecture decisions: `MS-D01..MS-D24`, including the Owner-approved
  `MS-D16..MS-D24` amendment dated 2026-09-18.
- Prior evidence: all 21 completed Task closures and the original DWF-D13
  migration lineage remain preserved.

## Recovery Changes

- Migrates the manifest from schema v1 to schema v2.
- Preserves `planId`, branch, workspace ID, immutable initial HEAD, and
  completed evidence.
- Removes tracked `expectedHead` and stale sibling-worktree metadata.
- Resets the package to `prepared` with no current Task, exhaustion, or
  Development Session.
- Splits the stale owner blocker into Conversation consumer cutover
  (`W5-OWNER`) and Social authority (`W5-SOCIAL`).
- Adds Rust authenticated business transport (`W2-TRANSPORT`).
- Reworks pending source closures around accepted Access Gate, Chat action,
  Moments, Settings, and native lifecycle contracts.
- Makes W8 a semantic six-to-zero hard cut.
- Runs one post-W8 exact-source functional frontier before W9 aggregates
  `MS-PA01..MS-PA27`.

## Execution Boundary

After approval, each selected Task runs without micro-approval interruptions:

1. reproduce and verify its current source facts;
2. implement the owner/root contract;
3. complete producer and consumer/UI cutover;
4. run focused checks;
5. create an authorized exact-source checkpoint;
6. run the real functional Journey;
7. run only that closure's formal Acceptance when declared;
8. advance the manifest through the owner command.

External blockers park only the affected Task while independent ready work
continues. Architecture or product ambiguity returns to DESIGN; implementation
failures return to the owning Task.

## Review Checklist

- [ ] Schema-v2 manifest preserves identity and contains no `expectedHead`.
- [ ] The 21 completed Tasks and durable evidence are unchanged in meaning.
- [ ] Every pending source Task has exactly one direct same-workstream
  functional successor.
- [ ] Conversation and Social owner cutovers are independent and explicit.
- [ ] W8 requires six executable production callers to reach zero without a
  compatibility path.
- [ ] Final functional verification precedes W9 formal Native Acceptance.
- [ ] Delivery remains denied.

## Prepared Evidence

- `planctl validate`: PASS, schema v2, `prepared`.
- Progress projection: 21 of 42 Task closures complete (50%).
- Current Task and Development Session: none.
- Ready frontier: `W2`, `W2-TRANSPORT`, `W3-PROOF`, `W4-PROOF`,
  `CA-HC-PROOF`, `W5-OWNER`, and `W5-SOCIAL`.
- Immutable workspace binding: created for workspace `b0a926025d2b25b9`.
- Plan and binding regression suites: 119 of 119 tests pass.
- Baseline hard-cut inventory: exactly four Social and two Group executable
  callers remain.
- Documentation and Plan diff checks: PASS.

## Approval

Reply with **Approve Plan** to authorize current-Task selection and EXECUTE.
Any requested change keeps the package in `prepared`.
