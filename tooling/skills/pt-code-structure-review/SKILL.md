---
name: pt-code-structure-review
description: Reviews source structure with stable rule IDs and verdicts. Use for PRs, diffs, completion review, or elegance questions. Do not use for formatting-only checks.
---

# Code Structure Review

Review whether changed source expresses the intended design with the minimum
necessary complexity. Correctness, security, and performance remain mandatory;
this Skill decides whether ownership, dependencies, state, lifecycle, and
change boundaries are structurally sound.

## Invoke When

- `route-change.sh` selects the `code-structure` profile.
- A PR, diff, refactor, or completion claim needs maintainability review.
- The user asks whether code is elegant, over-engineered, tangled, or easy to
  change.
- `pt-github-review` needs specialist structural evidence.

Do not invoke for formatting-only changes, generated files, vendored code, or
pure data snapshots with no authored control flow.

## Core Rule

Elegant code has the smallest necessary structure that makes these facts
obvious:

- domain intent;
- one owner for each rule and state;
- dependency direction;
- change boundary;
- lifecycle and side effects;
- migration completeness;
- test boundary.

Do not use a numeric beauty score. File size, function length, nesting, fan-out,
and vocabulary counts are investigation signals only. They never block by
themselves.

## Stable Rule IDs

| Rule ID | Contract |
|---|---|
| `STRUCT-01 DOMAIN_FIDELITY` | Names, APIs, and models express the accepted domain without parallel truth |
| `STRUCT-02 SINGLE_OWNER` | Each behavior, state transition, and policy has one authoritative owner |
| `STRUCT-03 COHESION` | A unit groups one reason to change and separates unrelated control flow |
| `STRUCT-04 DEPENDENCY_DIRECTION` | Dependencies follow architecture boundaries and remain acyclic |
| `STRUCT-05 CHANGE_LOCALITY` | A normal requirement change stays within its natural owner boundary |
| `STRUCT-06 EXPLICIT_LIFECYCLE` | State, side effects, errors, cleanup, and observability are explicit |
| `STRUCT-07 PROPORTIONAL_ABSTRACTION` | Abstraction cost is proportional to actual variability and complexity |
| `STRUCT-08 COMPLETE_CUTOVER` | Replacements remove old paths, duplicate truth, and compatibility residue |
| `STRUCT-09 TESTABLE_BOUNDARY` | Public behavior and failure paths can be verified through stable boundaries |

[`references/rubric.md`](./references/rubric.md) is authoritative for
blocking conditions and legal exceptions. Read it in full before deciding.
Use [`references/examples.md`](./references/examples.md) to calibrate ambiguous
cases. Before the first verdict in each review session, read
`tooling/review-fixtures/code-structure/cases.json` as the cross-model decision
anchors. The fixture validator proves schema and reference integrity, not model
conformance. Cross-model claims require a separate evaluation run.

## Workflow

1. Select exactly one target. Omit the selector for current uncommitted work:

   ```bash
   # Current worktree diff, including untracked files
   python3 tooling/scripts/review/code_structure_decision.py prepare

   # Explicit diff
   python3 tooling/scripts/review/code_structure_decision.py prepare \
     --range <base>...<head>

   # Current files under one path; depth 1 means direct files only
   python3 tooling/scripts/review/code_structure_decision.py prepare \
     --path apps/desktop/src --depth 1

   # Pull request number or URL; requires gh
   python3 tooling/scripts/review/code_structure_decision.py prepare --pr <pr>
   ```

2. Treat the preparation output as the exact review scope. It derives the
   source identity, authored files, generated/vendor exclusions, rubric hash,
   scope ID, and advisory signals.
3. Read the accepted product and architecture sources for the touched owners.
4. Inspect every `target.reviewedFiles` entry and each advisory signal in
   context. Read enough surrounding code to evaluate all nine rule IDs.
5. For every issue, identify the owner that should contain the behavior and the
   concrete consequence of leaving the structure unchanged.
6. Apply legal exceptions only when their preconditions are evidenced. Record
   the exception in the finding.
7. Build only the semantic findings payload below. Use one primary rule for
   each root cause and list consequence rules separately.
8. Record with the same target selector:

   ```bash
   python3 tooling/scripts/review/code_structure_decision.py record \
     --range <base>...<head> <<'JSON'
   {
     "findings": []
   }
   JSON
   ```

9. Use the recorder output as the final machine-readable decision. It derives
   signals, per-file coverage, verdict, primary rule sets, hashes, and source
   binding. Never hand-write those fields.

Explicit ranges require a clean workspace checked out at the range head.
Review uncommitted work with `--range HEAD`, which binds the complete workspace
digest and includes untracked files. Path review always binds the current
workspace snapshot. `--range`, `--path`, and `--pr` are mutually exclusive.

## Blocking Boundary

Return `REFACTOR_REQUIRED` when at least one concrete blocker exists:

- multiple writable owners or duplicated business truth;
- behavior implemented in the wrong architectural layer;
- direct or transitive dependency cycle;
- hidden side effects, state transitions, resource lifetime, or cleanup;
- routine changes require unbounded edits across unrelated modules;
- incomplete cutover, compatibility shim without an accepted removal
  boundary, or simultaneous old/new paths;
- a public behavior or failure path cannot be verified without private
  implementation coupling.

Return `PASS_WITH_SUGGESTIONS` only when there is no blocker and the remaining
improvement is optional, local, and behavior-preserving.

Return `PASS` when no structural finding remains.

Naming taste, formatting, file length, function length, nesting depth, import
count, or an optional file split cannot independently produce
`REFACTOR_REQUIRED`.

## Output

Lead with blocking findings. Every finding must include:

- stable `primaryRuleId`;
- `relatedRuleIds` for consequences resolved by the same correction;
- `blocking: true|false`;
- source location;
- observed structure;
- concrete change or failure cost;
- required correction or optional improvement;
- applied exception, or `none`.

The recorder accepts this semantic payload:

```json
{
  "findings": [
    {
      "findingId": "stable-local-id",
      "primaryRuleId": "STRUCT-02",
      "relatedRuleIds": ["STRUCT-05"],
      "blocking": true,
      "location": {
        "path": "path/to/source.ts",
        "lineStart": 10,
        "lineEnd": 12
      },
      "observedStructure": "Two modules own the same transition.",
      "consequence": "A routine policy change can diverge.",
      "correction": "Move the transition into one owner.",
      "exception": "none"
    }
  ]
}
```

The recorded decision adds:

- `artifactKind` and `schemaVersion`;
- `target.selector`, `target.scopeId`, resolved base/head commits,
  `target.source`, and `target.reviewedFiles`;
- `rubricHash`;
- `signalsReviewed`, derived from the exact reviewed file set;
- `coverage`, with every scoped file classified as `PASS`, `FINDING`, or
  `SKIPPED` and a reason;
- the derived `verdict`, `blockingRuleIds`, `suggestionRuleIds`, and
  `exceptionsApplied`.

`blockingRuleIds` and `suggestionRuleIds` contain primary rule IDs only.
`relatedRuleIds` never create duplicate findings or change the verdict.
Recording asserts that every prepared authored file was reviewed. Files with
findings become `FINDING`; other authored files become `PASS`; generated,
vendored, fixture, and unsupported files retain the classifier's `SKIPPED`
reason.

## Relationship To Review

- `structure-signals.mjs` finds deterministic investigation signals.
- This Skill makes semantic structural judgments.
- `code_structure_decision.py` persists and verifies the source-bound verdict.
- `pt-quality-check` aggregates that verdict and fails closed on missing or
  stale local evidence.
- `pt-completion-auditor` checks whole-scope completion and maintainability.
- `pt-github-review` owns the final merge recommendation.

This Skill never approves a merge, replaces runtime or Acceptance proof, or
turns advisory metrics into hard rules.

## Verification

- Every finding maps to one stable rule ID and concrete evidence.
- Every blocking finding satisfies a documented blocking condition.
- Every exception satisfies its documented preconditions.
- All advisory signals were inspected or explicitly dismissed.
- Coverage contains every scoped file exactly once.
- The decision record agrees with the findings.
- Structure fixture schema and deterministic helpers pass:

  ```bash
  node tooling/skills/pt-code-structure-review/scripts/validate-fixtures.mjs
  node --test tooling/skills/pt-code-structure-review/scripts/structure-signals.test.mjs
  python3 tooling/scripts/review/code_structure_decision_test.py
  ```

- After a real review, the source-bound verification succeeds:

  ```bash
  python3 tooling/scripts/review/code_structure_decision.py verify --range <git-range>
  ```

## Anti-Patterns

Never:

- say code is elegant because it is short, layered, or uses design patterns;
- block on personal taste without a rule ID and concrete change cost;
- reward mechanical layer splitting that adds no ownership boundary;
- recommend an abstraction without naming the duplicated policy or expected
  variability it owns;
- accept a half-migration because both paths currently work;
- ignore errors, cleanup, cancellation, or observability while reviewing the
  happy path;
- let metric thresholds decide the verdict;
- claim fixture schema validation proves model conformance;
- hand-write target, file lists, signals, hashes, coverage, or verdict fields;
- reuse a decision from stale source;
- duplicate `pt-github-review` merge authority.
