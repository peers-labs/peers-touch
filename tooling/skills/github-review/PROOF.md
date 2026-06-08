# GitHub Review Skill Completeness Proof

> This file states what must be machine-checked before claiming the Peers-Touch review skill is complete and fresh.

## Claim

`tooling/skills/github-review/SKILL.md` satisfies the Peers-Touch Code Review Framework when:

1. the skill contains all required review sections;
2. the skill covers every hard rule and platform profile defined by `docs/global/code-review-framework.md`;
3. the skill's upstream rule hash in `FRESHNESS.md` matches the current source documents;
4. every golden fixture has an expected finding and the hard-rule engine detects it;
5. operational knowledge matching is wired into the review workflow;
6. self-growth is constrained to PR-reviewed updates with fixtures and owner review.

## Proof Command

```bash
tooling/scripts/review/skill-check.sh
```

The command fails if any required section, rule reference, upstream hash, fixture, fixture detection, or dangerous skill instruction check fails.

## Covered Evidence

| Evidence | Enforced by |
|---|---|
| Required skill sections | `skill-check.sh required_sections` |
| Hard-rule coverage | `skill-check.sh required_rules` |
| Upstream source freshness | `FRESHNESS.md covered_docs_hash` |
| Golden fixture existence | `tooling/review-fixtures/*/expected.yml` |
| Golden fixture detection | `skill-check.sh` invoking `hard-rules.sh --fixture-dir` |
| Knowledge freshness path | `knowledge-match.sh --strict` |
| Review OS integration | `make review` and `.github/workflows/review.yml` |

## Current Golden Fixtures

- `debug-statement`
- `secret-exposure`
- `generated-file-edit`
- `silent-error`
- `mock-api`
- `hardcoded-ui-string`

## Non-Bypass Rule

The skill may propose updates to itself, fixtures, or `docs/knowledge`, but those changes must pass `skill-check.sh` and CODEOWNER review before merge.
