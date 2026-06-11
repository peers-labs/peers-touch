# Quality Lifecycle

> Source: Peers-Touch Quality Framework
> Scope: task execution, submit-time review, CI evidence, agent review, merge, and framework growth.

## 1. Lifecycle Overview

Quality starts when a change is prepared, not after a PR is opened.

```text
task / issue
  -> implementation
  -> local verification
  -> submit-time review pipeline
  -> PR/MR creation with evidence
  -> CI evidence regeneration
  -> agent review judgment
  -> owner escalation when needed
  -> merge / hold / reject
  -> framework growth classification
  -> repository asset update
```

The lifecycle has two evidence runs:

1. **Submit-time evidence**: run by the agent before opening or updating a PR.
2. **CI evidence**: rerun by GitHub Actions after the PR exists.

CI is a second execution of the quality lifecycle, not the first quality check.

## 2. Submit-Time Phase

Trigger: the user says "submit MR", "create PR", "open merge request", or asks
the agent to hand off work for review.

Required command:

```bash
make review-submit REVIEW_BASE=origin/master
```

The command runs:

1. `make quality-evidence REVIEW_RANGE=<base>...HEAD`
2. `tooling/scripts/review/run.sh --range <base>...HEAD --strict-knowledge`
3. `make acceptance-validate`
4. `make acceptance-coverage-report`
5. `make acceptance-plan ACCEPTANCE_RANGE=<base>...HEAD`
6. `make acceptance-run-ci`
7. `make acceptance-report`

If this phase fails, the agent must not open a normal ready-for-review PR. The
allowed outcomes are:

- fix the failure and rerun the pipeline;
- open a draft PR only after the user agrees and the PR body names the evidence gaps;
- record an explicit owner-approved waiver in the PR body.

## 3. PR/MR Creation Phase

The PR body must include:

- review profiles;
- matched operational knowledge;
- quality evidence summary;
- acceptance impacted features;
- gates run and not run;
- product proven and unproven scope;
- Framework Growth Opportunities.

The PR template is part of the framework. Removing evidence or growth sections is
a framework change and must pass `skill-check.sh`.

## 4. CI Phase

GitHub Actions rerun the review framework and quality evidence:

- review route;
- hard rules;
- knowledge matching;
- review skill freshness;
- quality evidence JSON and Markdown artifacts.

CI output is evidence, not approval. A green CI run can still be blocked by agent
review if product scope is unproven, knowledge is stale, or owner escalation is
required.

## 5. Agent Review Phase

The review agent consumes:

- code diff;
- quality evidence;
- acceptance contracts and reports;
- matched knowledge;
- CI results;
- PR body claims.

The agent decides:

```text
merge | hold | reject
```

The agent must list blocking findings first. Missing or invalid evidence is a
finding, not an implementation detail.

## 6. Growth Phase

After findings and evidence gaps are identified, the agent performs the Review
Learning Check:

```text
for each finding or evidence gap:
  reusable lesson? -> classify growth target
  one-off?         -> record no_growth_needed reason
```

Growth targets are repository assets:

- `docs/knowledge/**`
- `tooling/review-fixtures/**`
- `tooling/scripts/review/**`
- `tooling/acceptance/**`
- `tooling/skills/**`
- `.github/workflows/**`
- `tooling/make/**`

The next agent inherits only what is committed to the repository.

## 7. Release / Post-Merge Phase

After merge, no extra hidden quality state exists. The merged repository is the
source of truth. If the review uncovered a reusable lesson but it was deferred,
the follow-up issue or PR must name the target asset and the reason it was not
included.
