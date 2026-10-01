# W12D Source Owner Amendment Review

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-26 | **Updated**: 2026-10-01
> **Owner**: Architecture Team

## Review Scope

Review the mechanical W12D source-owner correction in:

- `tasks/W12D.md`
- `../20260913-secure-content-work-items.yaml`
- `tooling/development/secure_content/schema_activation.py`
- `tooling/development/secure_content/test_schema_activation.py`
- `tooling/development/secure_content/test_work_item.py`
- `tooling/scripts/local-dev/dev-work-schema.mjs`
- `tooling/scripts/local-dev/dev-work.test.mjs`
- `apps/station/app/subserver/social/infrastructure/secure_content_reset_types.go`
- Station maintenance and reset regression tests covering that allowlist

## Accepted Sources

- `plan.md`: W12D exclusively owns source freeze and serial schema activation.
- `../20260925-mobile-runtime-source-plan-amendment-review-prompt.md`:
  W12D is the only source-freeze/schema-activation closure.
- Historical activation evidence remains under the existing `W12A` root and
  keeps the `W12A-FOUR` and `W12A-FIVEARM` child identities.

## Required Checks

1. Declarations, Sessions, and aggregate `task_id` bind to `W12D`.
2. The immutable source and activation evidence paths remain under `W12A`.
3. Activation child workstream IDs remain `W12A-FOUR` and `W12A-FIVEARM`.
4. The Station maintenance allowlist accepts `W12D` for
   `SCHEMA_ACTIVATION` and retains `W12` for `FINAL_CUT`.
5. W12D owns only the minimum activation-owner source and regression files.
6. No product Journey or formal Acceptance claim is added.
7. Push and pull-request authorization remain denied.
8. The closed runtime-resource kind set accepts the canonical Development
   Workflow resources without weakening unknown-kind rejection.
9. Table-driven parser coverage exercises every canonical runtime-resource
   kind plus one rejected unknown kind.

## Validation

- `make plan-validate PLAN=docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `python3 -m unittest tooling.development.secure_content.test_schema_activation tooling.development.secure_content.test_work_item`
- `node --test tooling/scripts/local-dev/dev-work.test.mjs`
- `git diff --check`

## v1.2 Review Request

Review the narrow W12D source amendment that synchronizes the canonical closed
runtime-resource kind set and adds its parser regression coverage. Product,
deployment, reset, and Acceptance semantics are unchanged.

**Review status**: PASS

Evidence:

- Canonical runtime-kind schema matches the Development Workflow owner.
- All 16 runtime kinds plus unknown-kind rejection have parser coverage.
- `node --test tooling/scripts/local-dev/dev-work.test.mjs`: 20 PASS.
- Plan validation, W12D work-item scope tests, and `git diff --check`: PASS.

## Reviewer Output

Return `PASS`, `CONDITIONAL_PASS`, or `HOLD`, followed by source-backed
findings ordered by severity.

## v1.1 Review Result

**Verdict**: PASS

Resolved findings:

- Added the work-item manifest and every modified owner/test file to the W12D
  Task write set, work-item projection, and active declaration.
- Added positive and negative Station task-allowlist coverage for both
  activation profiles and both reset intents.
- Replaced the over-broad `apps` declaration with the four exact app roots
  admitted by the Plan.
- Aligned the W12D parent and activation-child scope roots and copied the
  accepted registry-v2 owner paths into both activation child declarations.

Evidence:

- Plan validation: PASS.
- Schema activation and work-item tests: 59 PASS.
- Affected Station packages: PASS.
- Secure Content hard-cut checks: PASS.
- `git diff --check`: PASS.
