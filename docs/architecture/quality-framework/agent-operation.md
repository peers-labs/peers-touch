# Quality Framework Agent Operation Guide

> Use this when an agent is asked to review, submit an MR/PR, or judge whether a
> change is ready for merge.

## 1. Operating Modes

| User request | Required mode |
|---|---|
| "review this PR/diff" | Review mode |
| "submit MR/PR" / "create PR" | Submit mode |
| "is this ready?" | Evidence + review judgment |
| "fix CI/review failure" | Diagnose failed evidence, then rerun affected pipeline |
| "improve the framework" | Maintenance mode |

## 2. Submit Mode

Before creating or updating a PR:

```bash
git fetch origin
make review-submit REVIEW_BASE=origin/master
```

Then read:

- `tooling/acceptance/reports/latest-quality-evidence.md`
- `tooling/acceptance/reports/latest-report.md`

Use the reports to fill the PR body. Do not claim a gate passed unless it appears
in run evidence. Do not hide unproven scope.

If `make review-submit` fails, stop normal PR creation. Either fix and rerun, ask
the user about a draft PR with explicit gaps, or record an approved waiver.

## 3. Review Mode

For a local range:

```bash
make quality-evidence REVIEW_RANGE=<base>...<head>
tooling/scripts/review/run.sh --range <base>...<head> --strict-knowledge
```

For a PR:

```bash
gh pr view <number> --json number,title,body,baseRefName,headRefName,mergeStateStatus,reviewDecision,files,commits
gh pr diff <number> --name-only
gh pr diff <number>
gh pr checks <number>
```

Review order:

1. truth-source code and protocol changes;
2. matched knowledge;
3. acceptance contracts and selected gates;
4. tests, reports, and PR claims;
5. framework growth opportunities.

## 4. Evidence Interpretation Rules

- Green CI is evidence, not approval.
- A selected gate is not proof until it has run evidence.
- A dry run proves planning only.
- `acceptance-validate` without `--require-proven` proves structure only.
- `knowledge-match.sh` proves only that knowledge was selected; semantic
  compliance is the review agent's responsibility.
- Environment gates are unproven unless the required environment actually ran.

## 5. Required Review Output

```markdown
Overall: merge | hold | reject

### Findings

### Evidence

- Range:
- Review profiles:
- Quality evidence:
- Acceptance evidence:
- Matched knowledge:
- Tests/CI:

### Merge Guidance

- Must fix before merge:
- Can follow up:
- Human owner review needed:

### Framework Growth Opportunities

- `knowledge_invariant`:
- `knowledge_pitfall`:
- `knowledge_playbook`:
- `hard_rule`:
- `review_fixture`:
- `acceptance_contract`:
- `acceptance_gate`:
- `skill_update`:
- `ci_tooling_update`:
- `no_growth_needed`:
```

If there are no findings, still include residual risks, checks not run, and
`no_growth_needed` reasoning.

## 6. Escalation Rules

Escalate to a human owner only for:

- architecture ownership changes;
- security/privacy posture;
- product behavior tradeoffs;
- rollout or migration risk;
- hard-rule waivers;
- environment evidence that cannot be run by the agent.

Do not ask humans to re-review everything the agent already proved.

## 7. Common Failure Handling

| Failure | Agent action |
|---|---|
| bad git range | fix the range; do not trust downstream reports |
| `knowledge-match --strict` fails | fix knowledge frontmatter/path freshness or block |
| acceptance plan fails | fix registry/gate references before PR |
| env gate not available | mark unproven scope and decide whether it blocks |
| skill-check fails | fix skill/proof/fixture drift before PR |
| PR template lacks evidence | update PR body before review |
