---
name: pt-quality-check
description: >
  Use when a Peers-Touch change needs a quality evidence report before code
  review or merge judgment. Aggregates review profiles, acceptance plan/results,
  matched operational knowledge, deterministic gates, tests run/not run, and
  unproven product scope. Produces evidence only; pt-github-review makes the merge
  decision.
---

# Quality Check

Produce a quality evidence report for a PR, commit, or local git range.

This skill does not approve or reject changes. It gathers evidence and exposes
gaps so `pt-github-review` can make the final judgment.

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

3. Read the external Evidence Store artifacts through the canonical operator
   interface:

   ```bash
   python3 tooling/scripts/acceptance-artifact.py cat \
     --gate quality-evidence --role quality-markdown
   python3 tooling/scripts/acceptance-artifact.py cat \
     --gate quality-evidence --role quality-json
   ```
4. If the aggregator is unavailable, reconstruct the evidence manually:

   ```bash
   tooling/scripts/review/route-change.sh --range <base>...<head>
   tooling/scripts/review/knowledge-match.sh --range <base>...<head> --strict
   python3 tooling/scripts/acceptance-plan.py --range <base>...<head>
   ```

5. Resolve the current formal plan and run only its completion Gates that are
   deterministic and cheap. Environment availability is not authorization:
   do not run environment/full Gates unless the user explicitly requested
   release/full Acceptance or the accepted Plan Run authorization names the
   exact environment and Gate scope.
6. Record every selected gate that was not run and why.
7. Read acceptance feature/capability contracts for selected features and copy
   their proven/unproven scope into the report.
8. Invoke `pt-acceptance-gap-detector` for the exact readiness claim. A
   detector gap makes `Ready for pt-github-review: no`.

For Acceptance Infra changes, classify capability evidence by direction:

- `acceptance_core_self_validation`: blocking Infra readiness evidence.
- `product_domain_validates_acceptance`: informational reverse evidence.
- Business Domain injection/proof gaps: report separately; never block Infra
  unless they expose a defect in the generic injection mechanism.

## Evidence Rules

- A gate that did not run is `unproven`, never `passed`.
- A dry run is planning evidence, not product evidence.
- `knowledge-match.sh` only proves knowledge entries were selected; semantic
  knowledge delta belongs to review.
- `acceptance-validate` without `--require-proven` proves structure only.
- Environment-dependent gates (`fedp5`, Desktop gateway, browser, simulator)
  are evidence requests unless the environment is actually available.
- Business `FAILED/BLOCKED/UNPROVEN` is not an Acceptance Infra failure.

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
- Human/owner hard-boundary evidence needed:

## Evidence Gaps

1. <gap>
   - Impact:
   - Suggested next evidence:
```

End with `Ready for pt-github-review: yes/no`. Say `no` when range validation,
acceptance planning, or knowledge matching could not be performed.

## Handoff To Review

Pass the report to `pt-github-review`. That skill decides whether evidence gaps are
blocking, acceptable follow-up, source-backed remediation inside the Plan Run,
or require one precise human owner decision under DWF-D20. Never send the user
the entire review task.
