---
name: quality-check
description: >
  Use when a Peers-Touch change needs a quality evidence report before code
  review or merge judgment. Aggregates review profiles, acceptance plan/results,
  matched operational knowledge, deterministic gates, tests run/not run, and
  unproven product scope. Produces evidence only; github-review makes the merge
  decision.
---

# Quality Check

Produce a quality evidence report for a PR, commit, or local git range.

This skill does not approve or reject changes. It gathers evidence and exposes
gaps so `github-review` can make the final judgment.

## Inputs

Accept one review target:

- PR number or URL;
- git range, for example `main...HEAD`;
- commit SHA;
- changed-file list plus supplied diff.

If no target is available, ask for one. Do not produce a generic checklist.

## Evidence Workflow

1. Establish the range and verify both endpoints exist.
2. Prefer the executable evidence aggregator:

   ```bash
   make quality-evidence REVIEW_RANGE=<base>...<head>
   ```

3. Read `tooling/acceptance/reports/latest-quality-evidence.md` and the JSON
   peer artifact when exact fields are needed.
4. If the aggregator is unavailable, reconstruct the evidence manually:

   ```bash
   tooling/scripts/review/route-change.sh --range <base>...<head>
   tooling/scripts/review/knowledge-match.sh --range <base>...<head> --strict
   python3 tooling/scripts/acceptance-plan.py --range <base>...<head>
   ```

5. Run deterministic gates that are cheap and relevant. Do not run environment
   gates unless the requested environment is available.
6. Record every selected gate that was not run and why.
7. Read acceptance feature/capability contracts for selected features and copy
   their proven/unproven scope into the report.

## Evidence Rules

- A gate that did not run is `unproven`, never `passed`.
- A dry run is planning evidence, not product evidence.
- `knowledge-match.sh` only proves knowledge entries were selected; semantic
  knowledge delta belongs to review.
- `acceptance-validate` without `--require-proven` proves structure only.
- Environment-dependent gates (`fedp5`, Desktop gateway, browser, simulator)
  are evidence requests unless the environment is actually available.

## Output

Use this shape:

```markdown
## Quality Evidence

- Range:
- Review profiles:
- Acceptance impacted features:
- Selected gates:
- Gates run:
- Gates not run:
- Matched knowledge:
- Deterministic checks:
- Product proven scope:
- Product unproven scope:
- Human/owner evidence needed:

## Evidence Gaps

1. <gap>
   - Impact:
   - Suggested next evidence:
```

End with `Ready for github-review: yes/no`. Say `no` when range validation,
acceptance planning, or knowledge matching could not be performed.

## Handoff To Review

Pass the report to `github-review`. That skill decides whether evidence gaps are
blocking, acceptable follow-up, or require human owner review.
