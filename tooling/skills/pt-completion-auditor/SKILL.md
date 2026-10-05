---
name: pt-completion-auditor
description: Audits exact Peers-Touch implementation, delivery, or close readiness. Use before non-trivial readiness claims or when the user asks what remains incomplete.
---

# Peers-Touch Completion Auditor

Audit one exact target. Report concrete findings before any readiness summary.
This Skill owns completion judgment; its script validates lifecycle evidence
only and never replaces code, architecture, security, or product review.

Architecture source:
`docs/architecture/development-workflow/README.md`.

## Invoke When

- Before claiming non-trivial work is implementation-ready, delivery-ready, or
  fully closed.
- The user asks whether work is complete, safe to continue, ready to deliver,
  or still blocked.
- A refactor or cross-layer change needs an overclaim and residual-risk audit.

Do not use as a generic code review, security-only review, or substitute for
formal Acceptance.

## Exact Target

Select exactly one:

- workspace ID plus work item ID;
- repository root plus work item ID;
- the same selector plus mount ID for tracked work.

Declare:

```text
mode = tracked | standalone
claimClass = implementation-ready | delivery-ready | close-ready
```

Never infer the target from branch scans, synchronized Plan files, chat
history, a nearby worktree, or the newest declaration.

Run the lifecycle validator:

```bash
node tooling/skills/pt-completion-auditor/scripts/completion-audit.mjs \
  --repo-root <root> \
  --work-item <id> \
  --mode <tracked|standalone> \
  --claim-class <implementation-ready|delivery-ready|close-ready> \
  [--mount-id <id>]
```

For deleted-worktree recovery, replace `--repo-root` with
`--workspace-id <id>` and provide `--mount-id`.

## Claim Classes

### `implementation-ready`

Use while source work is active.

- Require the exact ACTIVE Development declaration.
- Tracked mode requires the exact mounted Plan and non-terminal Execution Run.
- Standalone mode requires no PlanMount, Development Session, or active-work.
- This claim says only that implementation may proceed. It does not claim
  product behavior, Acceptance proof, or delivery readiness.

### `delivery-ready`

Use after implementation and required review, before resource close.

- Tracked mode requires a completed Execution Run and terminal Session.
- Standalone mode remains unmounted with no tracked projections.
- Independently verify requested scope, code structure, tests, docs, security,
  product-functional evidence, and formal Acceptance obligations.
- Keep absent formal proof `NOT RUN/UNPROVEN`.

### `close-ready`

Use only after `make dev-close`.

- Require one exact `DevelopmentCloseReceipt` in `CLOSED`.
- Require its resource matrix to contain no `PENDING` state.
- Require declaration and tracked projections to be released/absent.
- Tracked mode requires the exact PlanMount to be `released`.
- Standalone mode must remain unmounted.
- A released declaration alone is never close-ready evidence.

## Required Audit Dimensions

### Scope

List each requested outcome as:

`DONE | PARTIAL | UNPROVEN | NOT STARTED | OUT OF SCOPE`

Trace product-facing outcomes to accepted capability/Journey/state sources.
Separate conversation progress from durable owner state.

### Architecture

Verify ownership and dependency direction across every changed layer:

- Desktop remains a host/client shell; Station owns backend truth.
- Agent owns orchestration/provider/runtime decisions.
- Applets use declared SDK/Host capabilities and permissions.
- Proto/model, generated clients, persistence, service, native gateway, and UI
  representations agree.
- Prototypes and mocks are not reported as production runtime.

### Security And Robustness

Check actor/session context, ownership, permission denial, dangerous
operations, data leakage, malformed input, duplicate/replay behavior,
idempotency, failure states, cleanup, and irreversible actions.

Use `P0` for dangerous correctness/security/data-integrity failures, `P1` for
merge-blocking completion or architecture gaps, and `P2` for non-blocking
maintainability/docs/evidence debt.

### Code And Documentation

- Consume the current source-bound `pt-code-structure-review` decision when
  authored source changed.
- Check for duplicated owners, compatibility shims, dead paths, misleading
  names, fake APIs, and broad helpers.
- Confirm governing docs and operational knowledge match the implementation.
- For structural changes, require one current source of truth and zero live
  references to the removed path.

### Verification And Proof

Classify every command:

`PASS | FAIL | NOT RUN | NOT APPLICABLE | INSUFFICIENT`

Never substitute:

- typecheck/unit tests for a product Journey;
- mock/fake host checks for native runtime proof;
- manifest validation for permission-deny proof;
- Suite lifecycle conformance for business proof;
- Development records for formal Acceptance evidence.

Use `pt-acceptance-gap-detector` only when the audited claim includes formal
product/runtime proof. Carry every detected gap as `UNPROVEN`; do not invoke it
for source-only standalone work with no proof claim.

## Mode Rules

### Tracked

- Consume only the selected PlanMount, immutable snapshot, Execution Run,
  declaration, Session, active-work, review, and evidence records.
- Do not require release for `implementation-ready` or `delivery-ready`; close
  happens afterward.
- Require a `CLOSED` close receipt only for `close-ready`.
- Do not infer completion from archive, chat, task count, or a synchronized
  foreign Plan.

### Standalone

- Do not require or manufacture a Plan, Task, Session, active-work, Context
  Anchor, BindingProjection, or Completion Review receipt.
- Use the explicit request, accepted architecture sources, diff, focused
  checks, and findings-first review as the completion basis.
- Require the standalone close receipt only for `close-ready`.
- Formal Acceptance remains `NOT RUN/UNPROVEN` unless exact standalone proof
  was actually produced by its normal owner.

## Workflow

1. Establish the exact selector, mode, claim class, user request, changed
   range, and touched domains.
2. Run `completion-audit.mjs`; carry every blocked lifecycle check into
   findings.
3. Read accepted product/architecture sources and the changed code plus
   cross-layer counterparts.
4. Run the applicable structure, quality, security, and Acceptance owners.
5. Build the completion matrix and report findings ordered by severity.
6. Remediate source-backed findings inside the Development Run and re-audit.
7. End with the strongest claim fully supported by current evidence.

## Output

```markdown
**Audit Target**
- Selector:
- Mode:
- Claim class:
- Sources:

**Findings**
- `P0/P1/P2` <title> - <location>
  Impact:
  Evidence:
  Fix:

**Completion Matrix**
| Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- |

**Verification**
- `<command>`: PASS/FAIL/NOT RUN/NOT APPLICABLE/INSUFFICIENT - <scope>

**Residual Risk**
- <remaining unproven area>

**Readiness**
- Ready for implementation | Ready for delivery | Close-ready | Not ready
```

If there are no concrete defects, say so and still list residual unproven
areas. Use the weakest readiness claim supported by the evidence.

## Verification

```bash
node --test \
  tooling/skills/pt-completion-auditor/scripts/completion-audit.test.mjs
node tooling/skills/pt-completion-auditor/scripts/completion-audit.mjs \
  --repo-root "$PWD" \
  --work-item <id> \
  --mode <tracked|standalone> \
  --claim-class <claim>
tooling/scripts/review/skill-check.sh
```

## Anti-Patterns

Never:

- audit an unspecified branch, worktree, Plan, or "latest" task;
- require a formal Plan or BindingProjection for explicit standalone work;
- require released resources before a delivery-ready audit;
- claim close-ready without consuming `DevelopmentCloseReceipt`;
- infer product readiness from static checks, Gate count, docs, or mocks;
- let the lifecycle script replace architecture/security/code judgment;
- send source-backed findings to the user instead of remediating them inside
  the authorized Development Run.
