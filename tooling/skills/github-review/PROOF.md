# GitHub Review Skill Completeness Proof

> This file states what must be machine-checked before claiming the Peers-Touch review skill is complete and fresh.

## Claim

`tooling/skills/github-review/SKILL.md` satisfies the Peers-Touch Code Review Framework when:

1. the skill contains all required review sections;
2. the skill covers every hard rule and platform profile defined by `docs/global/code-review-framework.md`;
3. the skill's upstream rule hash in `FRESHNESS.md` matches the current source documents;
4. every golden fixture has an expected finding and the hard-rule engine detects it;
5. operational knowledge matching and semantic Knowledge Delta Review are wired into the review workflow;
6. quality-check and Acceptance Framework evidence are consumed before merge judgment;
7. Review Learning Check classifies every reusable lesson into a durable repository asset or records `no_growth_needed`;
8. MR/PR submission starts the quality lifecycle before PR creation;
9. self-growth is constrained to PR-reviewed updates with fixtures, gates, knowledge, skills, CI/tooling, and owner review.

## Proof Command

```bash
tooling/scripts/review/skill-check.sh
```

The command fails if any required section, growth decision, rule reference,
upstream hash, fixture, fixture detection, or dangerous skill instruction check
fails.

## Covered Evidence

| Evidence | Enforced by |
|---|---|
| Required skill sections | `skill-check.sh required_sections` |
| Growth decision coverage | `skill-check.sh growth_decisions` |
| Hard-rule coverage | `skill-check.sh required_rules` |
| Upstream source freshness | `FRESHNESS.md covered_docs_hash` |
| Golden fixture existence | `tooling/review-fixtures/*/expected.yml` |
| Golden fixture detection | `skill-check.sh` invoking `hard-rules.sh --fixture-dir` |
| Knowledge freshness path | `knowledge-match.sh --strict` plus Knowledge Delta Review in `SKILL.md` |
| Quality evidence handoff | `quality-evidence.py`, `make quality-evidence`, and `tooling/skills/quality-check/SKILL.md` |
| Submit-time lifecycle entry | `submit-pipeline.sh`, `make review-submit`, `github-pr/SKILL.md`, and `.github/PULL_REQUEST_TEMPLATE.md` checks in `skill-check.sh` |
| Acceptance evidence path | `acceptance-plan.py --range`, `acceptance-validate`, and Acceptance Review in `SKILL.md` |
| Acceptance tier filtering | `acceptance-run.py --tier` regression in `skill-check.sh` |
| Fail-closed script behavior | invalid range regressions in `skill-check.sh` |
| Knowledge directory matching | trailing-slash `owns:` regression in `skill-check.sh` |
| Growth protocol fixtures | `tooling/review-fixtures/growth-*/growth.yml` |
| Review OS integration | `make review` and `.github/workflows/review.yml` |

## Current Golden Fixtures

- `debug-statement`
- `secret-exposure`
- `generated-file-edit`
- `silent-error`
- `mock-api`
- `hardcoded-ui-string`

## Current Growth Fixtures

- `growth-pitfall-required`
- `growth-acceptance-gap`
- `growth-hard-rule-gap`
- `growth-skill-blindspot`

## Non-Bypass Rule

The skill may propose updates to itself, fixtures, `docs/knowledge`, acceptance
contracts/gates, or CI/tooling, but those changes must pass `skill-check.sh` and
CODEOWNER review before merge.
