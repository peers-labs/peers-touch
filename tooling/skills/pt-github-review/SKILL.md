---
name: pt-github-review
description: >
  Use when the user asks to review a pull request, audit a diff, provide code
  review feedback, or decide whether a Peers-Touch change is safe to merge.
  The agent is the primary reviewer; scripts, CI, pt-quality-check, and acceptance
  reports provide evidence, not a replacement for code reading and architectural
  judgment.
stage: "DELIVER"
requires: ["open PR"]
produces: ["review feedback or merge decision"]
---

# GitHub Review

Run an agent-led Peers-Touch code review. The goal is a risk-focused merge
recommendation with concrete findings. Repository instruction files are
constraints only; do not answer by saying they were read.

## Review Philosophy

1. **Agent-led judgment** - the agent owns the review decision; automation owns
   evidence.
2. **Evidence over confidence** - CI, hard rules, pt-quality-check, acceptance, and
   knowledge matching are inputs to judgment, not the judgment itself.
3. **Findings first** - defects, missing evidence, and unresolved questions lead
   the response.
4. **Fail closed on missing evidence** - invalid diff ranges, unavailable CI,
   failed knowledge matching, or missing acceptance plans are review findings.
5. **Escalate precisely** - humans handle owner intent, product tradeoffs,
   security posture, rollout risk, and hard-rule waivers.

## Review Workflow

### 1. Establish The Target

Accept a PR number, PR URL, commit, explicit git range, or supplied diff.

For a local target, first verify the persisted Worktree Binding under
`AGENTS.md §13.5.1` from the bound root. Review must stop on
`WORKTREE_IDENTITY_UNAVAILABLE` or `WORKTREE_IDENTITY_MISMATCH`; it must not
repair identity by switching branches or creating/selecting another worktree.

For a PR:

```bash
gh pr view <pr-number> --json number,title,body,baseRefName,headRefName,mergeStateStatus,reviewDecision,files,commits
gh pr diff <pr-number> --name-only
gh pr diff <pr-number>
gh pr checks <pr-number>
```

For a local range:

```bash
git diff --name-only <base>...<head>
git diff --stat <base>...<head>
git diff <base>...<head>
```

Verify range endpoints before trusting any report derived from them.

### 2. Collect Quality Evidence

Prefer using the `pt-quality-check` skill before making the final review judgment.
For local ranges, the preferred executable entry is:

```bash
make quality-evidence REVIEW_RANGE=<base>...<head>
```

At minimum, or when reconstructing manually, collect:

```bash
tooling/scripts/review/route-change.sh --range <base>...<head>
tooling/scripts/review/knowledge-match.sh --range <base>...<head> --strict
tooling/scripts/review/hard-rules.sh --range <base>...<head>
python3 tooling/scripts/execution-plan.py --require-complete
python3 tooling/scripts/acceptance-plan.py --active-plan --completion
```

CI has no machine workspace binding. The PR body must declare every owned Plan
under `## Execution Plans / 执行计划`; CI passes each path through `--plan` and
must not infer a Plan from the PR branch.
Reject Plan Packages that retain mutable `expectedHead`; current source
identity belongs to the Development declaration, Session checkpoint, and
`active_work` projection rather than tracked Plan content.

If the PR touches review or skill infrastructure, also run:

```bash
tooling/scripts/review/skill-check.sh
```

If the PR touches acceptance infrastructure, also run:

```bash
make acceptance-validate
make acceptance-coverage-report
make acceptance-plan
```

For selected acceptance gates, record which were run, which were not run, and
why. Unrun gates are unproven, never passed.

Before a ready/approve/merge decision, invoke `pt-acceptance-gap-detector` for
the PR's exact completion claim. A blocking detector gap prevents approval.

### 3. Read By Risk

Review in this order:

1. code that owns truth sources, security, privacy, persistence, protocol,
   runtime freshness, or CI gates;
2. files matched by `docs/knowledge`;
3. acceptance feature/capability contracts selected by the diff;
4. public APIs and generated contract changes;
5. tests, fixtures, and reports that claim coverage;
6. documentation and PR template claims.

For Goal, execution-skill, or tracked-work workflow changes, additionally
verify:

- execution mode is justified by dependencies, write sets, generated outputs,
  shared runtime resources, verification isolation, and integration order;
- parallel lanes reserve non-overlapping write sets and keep shared files under
  one integrator;
- only live, backend-addressable agents with the same Goal identity block new
  work;
- stale agent metadata is not converted into a persistent no-subagent rule;
- Context Anchors report completed delta, ready queue, execution mode and
  lanes, conflict controls, critical path, and an evidence-backed ETA or
  `unknown`;
- resume-time Anchor synchronization does not pause already-authorized
  execution.

### 4. Decide

Use the evidence, but decide from code and project contracts:

- Does the implementation preserve the correct source of truth?
- Does it violate a matched invariant or repeat a pitfall?
- Does acceptance evidence actually prove the claimed product scope?
- Are unproven scopes acceptable for this PR, or must they block?
- Is human owner approval required for architecture, security, federation,
  persistence, rollout, or product behavior?

### 5. Run Review Learning Check

For every finding and evidence gap, decide whether the lesson should improve the
repository review system. The agent must not end with "remember this next time";
growth must map to repository assets or be explicitly waived as one-off.

Allowed growth decisions:

| Decision | Use when |
|---|---|
| `knowledge_invariant` | the review exposed a stable rule future changes must preserve |
| `knowledge_pitfall` | the review exposed a repeatable bug root cause or escaped defect |
| `knowledge_playbook` | the review exposed a recurring task procedure |
| `hard_rule` | the review exposed a deterministic pattern scripts can catch |
| `review_fixture` | the review exposed a behavior that needs regression coverage |
| `acceptance_contract` | the review exposed missing or stale product capability scope |
| `acceptance_gate` | the review exposed missing executable product evidence |
| `skill_update` | the review exposed a repeatable agent judgment gap |
| `ci_tooling_update` | the review exposed missing or unreliable CI/tooling evidence |
| `no_growth_needed` | the lesson is genuinely one-off and the reason is recorded |

If a reusable lesson is found, name the target file or directory. If no growth is
needed, explain why the finding is not reusable.

## Review Profiles

| Profile | Focus |
|---|---|
| `proto` | Model source of truth, compatibility, generated artifact consistency |
| `station` | Station business truth, DDD subservers, typed errors, persistence |
| `desktop` | Tauri command path, runtime projection freshness, i18n, logger |
| `mobile` | Tauri Mobile mainline, native plugin boundaries, no Flutter expansion |
| `packages` | shared API compatibility and hidden platform dependency |
| `locales` | locale coverage and no raw user-facing strings |
| `knowledge` | frontmatter, owns, lifecycle, semantic delta |
| `acceptance` | capability/domain/feature/gate/report consistency and evidence honesty |
| `skill` | skill safety, freshness, self-growth, CODEOWNERS |
| `review-system` | fail-closed scripts, fixtures, CI portability |
| `ci` | GitHub Actions reliability, permissions, fork/range behavior |
| `code-structure` | AGENTS.md §7 structural health: single responsibility, no inline classes in non-component files, no duplicate imports, effect grouping, composition over dump |

## Script vs Skill Boundary

Scripts are evidence producers:

- `quality-evidence.py` aggregates review route, knowledge matching, acceptance
  plan, gate tiers, and capability proven/unproven scope.
- `route-change.sh` identifies review profiles.
- `hard-rules.sh` catches simple blocking patterns.
- `knowledge-match.sh` finds knowledge entries that must be read.
- The formal execution plan schedules Acceptance Gates.
- `acceptance-plan.py --active-plan` validates actual diff impact and projects
  the current or completion Gate set without becoming a second plan.
- `acceptance-validate.py` validates acceptance structure and, with
  `--require-proven`, latest gate evidence.
- `skill-check.sh` proves review skill structure and fixtures.

This skill owns the judgment scripts cannot make:

- architecture ownership and source-of-truth correctness;
- runtime projection completeness vs page refresh hacks;
- Station `app` / `frame` boundary correctness;
- proto compatibility and staged rollout safety;
- whether tests and acceptance gates prove the actual risk;
- whether knowledge or acceptance contracts are stale;
- whether a finding should become a fixture, invariant, pitfall, playbook, gate,
  skill update, or CI/tooling update.

## Hard Rules

Treat these as blocking unless the user explicitly asks for exploratory review:

| Code | Rule |
|---|---|
| `debug-statement` | raw `console.log`, `print`, `println!`, `fmt.Println`, `debugPrint`, or equivalent debug output |
| `secret-exposure` | hardcoded secrets, tokens, passwords, private keys, or credentials |
| `generated-file-edit` | manual edits to generated `.pb.go`, `.pb.dart`, prost `.rs`, or proto outputs |
| `proto-first` | shared model or inter-app contract defined outside `model/domain/*.proto` |
| `mock-api` | No mock frontend-backend collaborative APIs unless explicitly approved |
| `hardcoded-ui-string` | user-facing text literal outside i18n |
| `silent-error` | swallowed errors, ignored errors, empty catches, or missing context |
| `logging-security` | logs tokens, passwords, secrets, or PII |
| `architecture-boundary` | lower layer redefines architecture or platform ownership |
| `duplicate-side-effect-import` | same dynamic import path appears 2+ times in a single file |
| `user-home-absolute-path` | committed documentation-like text contains a developer or CI user-home absolute path instead of a repo-relative path or portable placeholder |
| `repository-debug-artifact` | repository-root `debug-*`, `.dbg/`, ad-hoc prompt, runtime log, trace, screenshot, DOM dump, or temporary report |
| `station-profile-bypass` | Station start, deployment, restart, or direct execution bypasses `make station` and the active profile pipeline |
| `unauthorized-environment-creation` | an agent creates, copies, derives, or registers a profile or deploy environment without explicit human approval for the exact name and target |

Keywords intentionally present for freshness checks: hardcoded secrets, No mock,
hardcoded-ui-string, silent error, generated, runtime projection, CODEOWNERS,
user-home-absolute-path, repository-debug-artifact, station-profile-bypass,
unauthorized-environment-creation.

## Operational Knowledge

Run knowledge matching for changed paths and then do semantic review.

Path matching means a knowledge file must enter review context. It does not prove
the code complies.

Knowledge Delta Review:

- matched invariant violated by code -> block;
- matched pitfall root cause reintroduced -> block or require evidence;
- matched playbook skipped -> block unless the PR explains why it does not apply;
- code changes the truth behind a knowledge entry -> require knowledge update or
  owner-reviewed supersession;
- bug fix discovers reusable root cause -> require pitfall or explicit waiver;
- repeated procedure appears again -> propose playbook.

## Acceptance Evidence

Acceptance Framework proves product capability scope. It does not approve PRs.

For Acceptance Infra PRs, judge merge readiness from
`acceptance_core_self_validation` and framework evidence. Treat
`product_domain_validates_acceptance` and business injection gaps as
informational unless the generic injection mechanism itself is defective.
Never require an Infra author to create or weaken business-owned injection.

For impacted acceptance features:

1. Read selected feature contracts under `tooling/acceptance/features/`.
2. Read capability evidence under `tooling/acceptance/capabilities/`.
3. Compare selected gates with gates run.
4. Copy proven and unproven scope into the review evidence.
5. Challenge over-claims: typecheck is not DOM E2E; gateway smoke is not full UI
   behavior; Station SSE proof is not Desktop live DOM consumption.

Block or hold when:

- a product capability changed but feature/capability contracts did not;
- a required gate is marked proven without run evidence;
- an environment gate was skipped and the missing scope is central to the PR;
- acceptance YAML says a truth source changed but code moved truth elsewhere;
- reports claim more than the gates actually prove.

## Platform Review Playbooks

### Proto Review

Check:

- shared concepts live in `model/domain/*.proto`;
- field numbers are stable and removed fields are reserved;
- generated files are not manually edited;
- Station, Desktop, and Mobile contract consumers are updated or staged safely.

### Station Review

Check:

- Station remains shared business truth;
- `apps/station/app` may depend on `frame`, not the reverse;
- business capability code follows subserver boundaries;
- handlers do not own domain decisions;
- errors use typed codes and include context;
- persistence changes include migration or compatibility reasoning.

### Desktop Review

Check:

- `desktop-web -> desktop-rust -> station` remains the business path;
- pages are pure renderers and do not own long-lived freshness;
- runtime-backed features have event consumption and reconciliation;
- user-facing strings use locale keys;
- logging uses project loggers.

### Mobile Review

Check:

- Mobile remains Tauri v2 Mobile + Web UI + Rust capability kernel + native plugins;
- native plugins provide device capability, not business truth;
- Flutter paths remain deprecated;
- Mobile does not create private protocols bypassing Station or proto.

### Knowledge Review

Check frontmatter, `owns:`, lifecycle, recurrence detection, append-only
supersession, and semantic consistency with the code diff.

### Review-System Review

Check scripts fail closed, fixtures cover positive and negative cases, workflow
permissions are minimal, CODEOWNERS are real, and review skill freshness remains
meaningful. Goal and execution workflow changes must also preserve explicit
concurrency decisions, identity-based live-agent conflict detection, reserved
write sets, integrator-owned reconciliation, and non-blocking Context Anchor
projection.

### Acceptance Review

Check domain, capability, feature, gate, report, and onboarding consistency.
Gate scripts must prove real product behavior or honestly report unproven scope.
Durable evidence must come from the current workspace's canonical latest
manifest, carry `DONE` / `PROVEN` result semantics, and pass artifact identity
and digest verification. Native Desktop claims must bind the requested runtime
cell, clean source commit, Station commit, binary digest, platform probes, and
reverse-order cleanup; evidence from one platform cannot prove another.

## Severity Levels

| Severity | Blocks merge? | Use when |
|---|---:|---|
| `critical` | yes | security/privacy leak, data loss, auth bypass, broken migration, unsafe CI fail-open |
| `bug` | yes | correctness regression, user-visible wrong behavior, runtime freshness failure |
| `convention` | yes | project iron-law or source-of-truth violation |
| `suggestion` | no | maintainability, performance, or test improvement without correctness risk |
| `question` | maybe | intent unclear; blocks only if answer exposes a blocker |

## Review Output Format

Use Markdown. Findings lead the response, ordered by severity:

```markdown
Overall: merge | hold | reject

### Findings

#### critical

1. <title>
   - File:
   - Problem:
   - Impact:
   - Suggested fix:
   - Confidence:

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

If no findings exist, say so and still list residual risk and checks not run.
The `Framework Growth Opportunities` section is required even when every item is
empty except `no_growth_needed`.

## Skill Freshness

This skill is fresh only if:

```bash
tooling/scripts/review/skill-check.sh
```

passes, and any upstream quality, review, knowledge, or acceptance rule change is
reflected here or explicitly waived in the PR.

## Self-Growth

After accepted findings or escaped defects:

1. classify each finding or evidence gap using the Review Learning Check
   decisions;
2. add or update review fixtures for deterministic hard-rule gaps;
3. update `docs/knowledge/**` for operational knowledge;
4. update acceptance contracts/gates when product evidence was missing;
5. update this skill when review behavior changes;
6. update CI/tooling when evidence generation or portability failed;
7. require CODEOWNERS review before merge.

Growth changes are reviewable product assets. They must be submitted through the
normal PR path and pass `skill-check.sh`; the agent must not silently weaken a
rule, refresh a hash, or delete a fixture without explaining the behavior change.

## Anti-Patterns

- Approving because CI is green.
- Treating `make review` or `make acceptance-run` as the review itself.
- Reporting script output without reading risky code.
- Marking unrun acceptance gates as proven.
- Refreshing hashes or fixtures as bookkeeping without explaining behavior.
- Asking humans to re-review everything instead of escalating precise decisions.
- Blocking on cosmetic style (naming, spacing, import order) while ignoring structural violations (mixed responsibility, duplicate logic, inline definitions).
- Ignoring missing evidence such as invalid range, unavailable CI, or failed
  knowledge/acceptance planning.
