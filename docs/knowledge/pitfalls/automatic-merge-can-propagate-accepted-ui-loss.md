---
kind: pitfall
title: Automatic merges can propagate a previous merge's accepted behavior loss
status: active
owns:
  - tooling/scripts/review/
  - tooling/skills/pt-branch-conflict-guardian/
  - tooling/skills/pt-github-review/
  - tooling/skills/pt-github-pr/
  - tooling/make/review.mk
  - .github/workflows/review.yml
  - .github/workflows/integration-evidence.yml
referenced-by:
  - docs/architecture/engineering/quality/integration-review.md
related:
  - docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  - docs/knowledge/pitfalls/settings-merge-can-drop-cascade-root.md
detected: 2026-11-15
---

# Automatic merges can propagate accepted behavior loss

## Failure

Settings PR #186's layout was lost during merge `4fcb884ed` and propagated by
`78f349a89`. The local Settings file still matched the merge base, so Git
automatically selected the regressed peer file without a text conflict.
Conflict-only inspection and unrelated green checks missed the lost layout.

## Detection and correction

The integration contract belongs to
`docs/architecture/engineering/quality/integration-review.md`.
Inventory both complete diffs and the candidate against both parents.
Historical blob reappearance triggers explicit preservation analysis and an
independent reviewer counterexample; it does not itself prove a bug.
Mandatory proof is selected from the affected contracts before execution,
including original assertions and actual rendered UI interactions.

## How to detect a recurrence

- Run `python3 tooling/scripts/review/integration_review_test.py` for real Git
  topology, populated weak-standard claims and release-entrypoint negatives.
- With historical objects present, add `--historical-repo <checkout>` to replay
  the exact Settings blobs and verify the actual parent/base/candidate fence.
- Verify submit, merge commit, reverse-sync and GitHub merge consume the same
  source-bound plan, original results and independent review.
- Inspect active server required checks and update policy. A workflow file or
  keyword-only skill test does not prove the gate runs or prevents a merge.
