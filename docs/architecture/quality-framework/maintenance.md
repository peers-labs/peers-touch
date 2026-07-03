# Quality Framework Maintenance Guide

> Use this when changing review routes, hard rules, quality evidence,
> acceptance contracts, skills, CI, or framework documentation.

## 1. Maintenance Rule

Every framework change must answer:

```text
What behavior changed?
What evidence proves it?
What fixture or check prevents regression?
Does the review skill need updating?
Does the freshness hash need updating?
```

Refreshing hashes without explaining behavior is not maintenance.

## 2. Changing Review Routes

Files:

- `tooling/scripts/review/route-change.sh`
- `tooling/scripts/review/run.sh`
- `tooling/scripts/review/skill-check.sh`

Required checks:

```bash
tooling/scripts/review/route-change.sh --range <range>
make review REVIEW_RANGE=<range>
tooling/scripts/review/skill-check.sh
```

Add route coverage when a new path owns product truth, acceptance evidence,
knowledge, skills, CI, or generated contracts.

## 3. Changing Hard Rules

Files:

- `tooling/scripts/review/hard-rules.sh`
- `tooling/review-fixtures/<case>/expected.yml`
- `tooling/skills/pt-github-review/SKILL.md`

Required behavior:

- every deterministic rule needs a fixture;
- every fixture needs `expected_code` and `expected_severity`;
- `skill-check.sh` must invoke the fixture and see the expected code.

## 4. Changing Knowledge

Files:

- `docs/knowledge/invariants/**`
- `docs/knowledge/pitfalls/**`
- `docs/knowledge/playbooks/**`

Rules:

- entries are append-only;
- supersede with `status: superseded-by:<path>`, do not delete silently;
- `owns:` must cover paths where the knowledge applies;
- pitfalls need recurrence detection;
- invariants need verification guidance;
- playbooks need ordered steps or checklist.

Required check:

```bash
tooling/scripts/review/knowledge-match.sh --range <range> --strict
```

## 5. Changing Acceptance

Files:

- `tooling/acceptance/registry.yaml`
- `tooling/acceptance/gates.yaml`
- `tooling/acceptance/features/**`
- `tooling/acceptance/capabilities/**`
- `tooling/scripts/acceptance-*.py`

Rules:

- every gate has `tier` and `environment`;
- non-local environment gates cannot be `ci-*`;
- selected gates must not be reported as passed unless run evidence exists;
- capability `proven_scope` must not overclaim what gates prove;
- `unproven_scope` should be explicit.

Required checks:

```bash
make acceptance-validate
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=<range>
make quality-evidence REVIEW_RANGE=<range>
```

## 6. Changing Skills

Files:

- `tooling/skills/pt-github-review/SKILL.md`
- `tooling/skills/pt-quality-check/SKILL.md`
- `tooling/skills/pt-github-pr/SKILL.md`
- `tooling/skills/pt-dev-workflow/SKILL.md`
- `tooling/skills/pt-github-review/FRESHNESS.md`
- `tooling/skills/pt-github-review/PROOF.md`

Rules:

- project skills live only in `tooling/skills/**`;
- do not write IDE-private skill directories;
- preserve required sections and growth decisions;
- update `PROOF.md` when the proof contract changes;
- update `FRESHNESS.md` hash when covered docs change.

Required check:

```bash
tooling/scripts/review/skill-check.sh
```

## 7. Changing Submit Pipeline or CI

Files:

- `tooling/scripts/review/submit-pipeline.sh`
- `tooling/make/review.mk`
- `.github/workflows/review.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`

Rules:

- submit-time pipeline runs before PR creation;
- CI reruns evidence after PR creation;
- PR template keeps Quality Evidence and Framework Growth Opportunities;
- workflow permissions remain minimal;
- artifacts include quality evidence JSON and Markdown.

Required checks:

```bash
make review-submit REVIEW_BASE=origin/master
tooling/scripts/review/skill-check.sh
```

## 8. Updating Freshness Hash

`tooling/scripts/review/skill-check.sh` recomputes the upstream docs hash from
`tooling/skills/pt-github-review/FRESHNESS.md`.

Only update the hash after reviewing whether the docs change requires:

- skill behavior update;
- new fixture;
- new acceptance gate or contract;
- new knowledge entry;
- CI/tooling update.

The PR must describe that decision.
