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
2. Establish review profiles:

   ```bash
   tooling/scripts/review/route-change.sh --range <base>...<head>
   ```

3. When `code-structure` is selected, invoke
   `pt-code-structure-review`. Prepare the exact scope, review it, and record
   findings before aggregation:

   ```bash
   python3 tooling/scripts/review/code_structure_decision.py prepare \
     --range <base>...<head>
   # After semantic review, record a findings-only payload with the same selector.
   ```

   The recorder derives the files, exclusions, signals, coverage, hashes, and
   verdict. Do not hand-build those fields.

4. Run the executable evidence aggregator. It verifies the current
   source-bound decision:

   ```bash
   make quality-evidence REVIEW_RANGE=<base>...<head>
   ```

4A. When the change contains material UI, a prototype confirmation, or the
Experience Design Control Plane itself, read
`docs/architecture/engineering/experience-design/README.md` and verify the
task-owned ReviewResult:

   ```bash
   node tooling/scripts/experience-design/experience-design.mjs \
     review-verify <review-result.json> \
     --repo-root <repo-root> \
     --package-root <package-root> \
     --run-envelope <package-relative-run-envelope> \
     --case <package-relative-case> \
     --manifest <package-relative-manifest> \
     --rubric <package-relative-rubric>
   node tooling/scripts/experience-design/experience-design.mjs \
     review-admission <review-result.json> <independent-review.json> \
     --repo-root <repo-root> \
     --package-root <package-root> \
     --run-envelope <package-relative-run-envelope> \
     --case <package-relative-case> \
     --manifest <package-relative-manifest> \
     --rubric <package-relative-rubric>
   ```

Record current binding, verdict, primary candidate/tuple, independent review,
admission result and scoped `UNPROVEN` entries. `NO_BLOCKING_FINDING` is not an
approval by itself.

Admission revalidates current package links and source bytes. Canonical
calibration/holdout commands consume `--package-root` for external fixtures;
historical blind integrity and current reevaluation are distinct results.

For a Quality-owned blind run, verify the sealed package and Exposure Ledger
before execution, the complete report hash before `scoring`, and the score plus
promotion decision before `retired`. Never expose the answer key before
`scoring`. EDX-B01 through EDX-B06 are training inputs and are permanently
ineligible for fresh promotion.

5. Read the external Evidence Store artifacts through the canonical operator
   interface:

   ```bash
   python3 tooling/scripts/acceptance-artifact.py cat \
     --gate quality-evidence --role quality-markdown
   python3 tooling/scripts/acceptance-artifact.py cat \
     --gate quality-evidence --role quality-json
   ```
6. If the aggregator is unavailable, reconstruct the evidence manually:

   ```bash
   tooling/scripts/review/route-change.sh --range <base>...<head>
   python3 tooling/scripts/review/code_structure_decision.py verify \
     --range <base>...<head>
   tooling/scripts/review/knowledge-match.sh --range <base>...<head> --strict
   python3 tooling/scripts/acceptance-plan.py --range <base>...<head>
   ```

7. If an explicit Plan Version was supplied, read only that version and select
   its completion Gates. Without a Plan, derive Gates from the exact diff and
   stated completion obligations. Run only deterministic cheap Gates.
   Environment availability is not authorization:
   do not run environment/full Gates unless the user explicitly requested
   release/full Acceptance or the accepted Plan Run authorization names the
   exact environment and Gate scope.
8. Record every selected gate that was not run and why.
9. Read acceptance feature/capability contracts for selected features and copy
   their proven/unproven scope into the report.
10. Invoke `pt-acceptance-gap-detector` for the exact readiness claim. A
   detector gap makes `Ready for pt-github-review: no`.
11. When the range changes material UI or its Product/Prototype contracts,
    consume the Experience Design Control Plane artifacts named by the change:
    case, evaluator result, independent review receipt, and exact evidence
    cells. Run:

    ```bash
    node tooling/scripts/experience-design/experience-design.mjs check
    node tooling/scripts/experience-design/experience-design.mjs evaluate \
      <case.json>
    node tooling/scripts/experience-design/experience-design.mjs \
      validate-review <case.json> <result.json> <receipt.json>
    ```

    Report canonical finding IDs and owners, review decision, matched/unproven
    L1-L4 cells, drift status, and claim boundary. The canonical method is
    `docs/client/common/interaction-design-methodology.md`; do not duplicate
    its Rule Catalog or UI Grammar in this Skill.

For Acceptance Infra changes, classify capability evidence by direction:

- `acceptance_core_self_validation`: blocking Infra readiness evidence.
- `product_domain_validates_acceptance`: informational reverse evidence.
- Business Domain injection/proof gaps: report separately; never block Infra
  unless they expose a defect in the generic injection mechanism.

## Evidence Rules

- A gate that did not run is `unproven`, never `passed`.
- Zero Experience Design findings is only
  `ready-for-independent-review`; an absent, stale, author-overlapping, or
  digest-mismatched receipt is not acceptance.
- Screenshot or artifact existence never proves visual, dynamic,
  accessibility, performance, or runtime cells without an exact current-source
  evidence match.
- A dry run is planning evidence, not product evidence.
- `knowledge-match.sh` only proves knowledge entries were selected; semantic
  knowledge delta belongs to review.
- A `code-structure` profile requires a source-bound decision. A missing,
  invalid, stale, or `REFACTOR_REQUIRED` local decision makes the evidence
  incomplete. CI reports a missing semantic decision as reviewer work because
  CI does not impersonate an agent reviewer.
- `acceptance-validate` without `--require-proven` proves structure only.
- Environment-dependent gates (registered remote runtime, Desktop gateway,
  browser, simulator) are evidence requests unless the environment is actually
  available.
- Missing, stale, non-independent, or non-admitted Experience Review evidence
  makes material UI scope unproven.
- A visible calibration fixture or previously exposed blind case cannot prove
  fresh Experience Reasoning promotion.
- Business `FAILED/BLOCKED/UNPROVEN` is not an Acceptance Infra failure.

## Output

Use this shape:

```markdown
## Quality Evidence

- Range:
- Review profiles:
- Code structure decision status / primary rule IDs:
- Acceptance impacted features:
- Selected gates:
- Gates run:
- Gates not run:
- Matched knowledge:
- Deterministic checks:
- Experience Review binding / verdict / admission / unproven:
- Product proven scope:
- Product unproven scope:
- Experience case/result/review status and finding owners:
- Experience L1/L2/L3/L4 matched and unproven cells:
- Human/owner hard-boundary evidence needed:

## Evidence Gaps

1. <gap>
   - Impact:
   - Suggested next evidence:
```

End with `Ready for pt-github-review: yes/no`. Say `no` when range validation,
acceptance planning, knowledge matching, or required local code-structure
evidence could not be performed, or when its verdict is
`REFACTOR_REQUIRED`.

## Handoff To Review

Pass the report to `pt-github-review`. That skill decides whether evidence gaps are
blocking, acceptable follow-up, source-backed remediation inside the Plan Run,
or require one precise human owner decision under DWF-D20. Never send the user
the entire review task.
