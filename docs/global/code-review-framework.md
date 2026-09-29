# Peers-Touch Code Review Framework

> Status: canonical proposal. Owner: architecture + platform owners.
> Scope: review process, review automation, review skill freshness, knowledge freshness, and self-growth loop.

## 1. Purpose

Peers-Touch review is not a style pass. It is a project safety system for catching:

- architecture boundary violations across Client, Model, and Station;
- source-of-truth drift from `model/domain/*.proto`, architecture docs, and platform docs;
- regressions against operational knowledge in `docs/knowledge/`;
- hard-rule violations from `AGENTS.md`;
- missing verification for changed platforms;
- review-system drift, including stale skills and stale knowledge.

Review is complete only when the changed code, changed docs, review skill, and matched knowledge entries all pass their own freshness checks.

## 2. Review Operating System

```text
git diff range
  -> route-change.sh
  -> knowledge-match.sh
  -> hard-rules.sh
  -> structure-signals.mjs for advisory structural triage
  -> pt-code-structure-review source-bound decision for authored source
  -> skill-check.sh when review skill or upstream rules changed
  -> platform verification commands
  -> quality-evidence.py aggregates the structural decision
  -> AI review using tooling/skills/pt-github-review/SKILL.md
  -> human owner review
  -> knowledge / skill growth proposal when needed
```

The scripts are under `tooling/scripts/review/` and are exposed through `make review`.

## 3. Severity

| Severity | Meaning | Merge decision |
|---|---|---|
| `critical` | security, data loss, privacy leak, crash, broken migration, secret exposure | block |
| `bug` | user-visible wrong behavior or correctness regression | block |
| `convention` | project iron-law or source-of-truth violation | block |
| `suggestion` | maintainability or performance improvement without correctness risk | non-blocking |
| `question` | intent unclear; reviewer needs author context | non-blocking unless answer exposes a blocker |

Review comments must lead with the finding, cite a file and line where possible, and include a concrete fix direction.

## 4. Source Hierarchy

When a review needs authority, use this order:

1. `docs/architecture/**` and `docs/global/architecture.md`
2. platform sources: `docs/client/**`, `docs/station/**`
3. coding guides: `docs/global/coding-guide/**`
4. operational knowledge: `docs/knowledge/**`
5. local README / code comments

Lower layers may refine implementation details but cannot redefine upper-layer boundaries.

## 5. Review Profiles

`route-change.sh` maps changed paths to profiles:

| Path | Profile | Required focus |
|---|---|---|
| `model/domain/**` | `proto` | proto-first, generated artifact consistency, no manual parallel models |
| `apps/station/**` | `station` | Station owns shared business truth; `app` depends on `frame`, not the reverse; DDD subserver boundaries |
| `apps/desktop/**` | `desktop` | Tauri command path, Page / Runtime / Boot contract, i18n, logger, runtime projections |
| `apps/mobile/**` | `mobile` | Tauri Mobile mainline, Web UI + Rust kernel + native plugin boundaries, Station truth ownership |
| `packages/locales/**` | `locales` | user-facing strings are locale keys, not component literals |
| `packages/**` | `packages` | shared API compatibility, workspace checks, no hidden platform dependency |
| `docs/knowledge/**` | `knowledge` | frontmatter, `owns:` validity, lifecycle rules, append-only supersession |
| `tooling/acceptance/**`, `tooling/scripts/acceptance-*.py` | `acceptance` | product acceptance contracts, domain onboarding, gate determinism, report freshness |
| `tooling/skills/**` | `skill` | skill schema, freshness, safety, golden cases |
| non-generated authored source | `code-structure` | domain fidelity, ownership, cohesion, dependency direction, locality, lifecycle, proportionality, cutover, testability |
| `.github/**` | `ci` | gates still match framework and PR template |

Multiple profiles may apply to one PR.

## 6. Code Structure Contract

`pt-code-structure-review` is the specialist evidence owner for structural
quality. It uses stable rule IDs:

| Rule | Required property |
|---|---|
| `STRUCT-01 DOMAIN_FIDELITY` | Names, APIs, and models express one accepted domain truth |
| `STRUCT-02 SINGLE_OWNER` | Each policy, state, and transition has one authoritative owner |
| `STRUCT-03 COHESION` | Units group one reason to change and separate unrelated control flow |
| `STRUCT-04 DEPENDENCY_DIRECTION` | Dependencies follow architecture and remain acyclic |
| `STRUCT-05 CHANGE_LOCALITY` | Routine changes stay inside their natural owner boundary |
| `STRUCT-06 EXPLICIT_LIFECYCLE` | Side effects, errors, cancellation, cleanup, and observability are explicit |
| `STRUCT-07 PROPORTIONAL_ABSTRACTION` | Abstraction cost matches real complexity and variability |
| `STRUCT-08 COMPLETE_CUTOVER` | Replacements remove dual truth and unbounded compatibility residue |
| `STRUCT-09 TESTABLE_BOUNDARY` | Behavior and failures are verifiable through stable public boundaries |

The authoritative blocking conditions, exceptions, and examples live in:

- `tooling/skills/pt-code-structure-review/references/rubric.md`
- `tooling/skills/pt-code-structure-review/references/examples.md`
- `tooling/review-fixtures/code-structure/cases.json`

Verdicts are `PASS`, `PASS_WITH_SUGGESTIONS`, or `REFACTOR_REQUIRED`. A blocker
requires a primary stable rule ID, concrete evidence, concrete change or
failure cost, and no applicable documented exception. Related rule IDs record
consequences resolved by the same correction and do not duplicate findings.
Naming taste, formatting, file or function length, nesting, fan-out, and
optional file splits do not block by themselves.

`structure-signals.mjs` reports deterministic investigation signals. Its output
is always advisory and cannot produce a merge verdict.
`code_structure_decision.py prepare` accepts one target selector (`--range`,
`--path [--depth]`, or `--pr`) and derives the exact source scope, exclusions,
signals, source identity, and rubric hash. `record` accepts findings only,
derives the verdict and per-file coverage receipt, and publishes the
source-bound result to the external Evidence Store. Fixture validation proves
schema and rubric-reference integrity only; cross-model conformance requires a
separate evaluation run.
Local review automation fails closed when the routed decision is missing,
invalid, stale, or blocking. CI reports a missing semantic decision as pending
review work because deterministic automation must not impersonate an agent
reviewer.

## 7. Hard Gates

These checks are automatic and blocking:

- no raw debug statements in source code: `console.log`, `fmt.Println`, `println!`, `print()`, `debugPrint`;
- no hardcoded secrets or credentials;
- no manual edits to generated protobuf files;
- no frontend-backend mock API substitution unless the PR explicitly declares it and the reviewer approves it;
- no silent error swallowing;
- no cross-app shared model defined outside `model/domain/*.proto`;
- no user-facing string literal in UI surfaces when it should use i18n.
- no absolute path rooted in a developer or CI user's home directory in
  committed documentation-like files; require repo-relative paths or portable
  placeholders.

Hard gates are intentionally conservative. A false positive should be fixed by narrowing the script rule and adding a fixture, not by bypassing review.

## 8. Required Verification

The review report must list the profile-driven commands that were run or explicitly explain why they were not run.

| Profile | Commands |
|---|---|
| `proto` | `./model/build.sh`; mobile proto generation when mobile contracts are affected |
| `station` | `cd apps/station/app && gofmt -l . && go test ./...`; `./tooling/scripts/check-go-style.sh apps/station/app` when style-sensitive |
| `desktop` | `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build`; Tauri build for app-path changes |
| `mobile` | `pnpm mobile:check`; native Android/iOS build when plugin or generated native project changed |
| `packages` | `pnpm -r --if-present run check`; package-specific build/test |
| `knowledge` | `tooling/scripts/review/knowledge-match.sh --range <range>` plus structure validation |
| `acceptance` | `make acceptance-validate`; `make acceptance-coverage-report`; targeted domain gates when product contracts changed |
| `skill` | `tooling/scripts/review/skill-check.sh` |
| `code-structure` | `python3 tooling/scripts/review/code_structure_decision.py prepare --range <range>`; review the prepared files; record findings with the same selector; `python3 tooling/scripts/review/code_structure_decision.py verify --range <range>` |

## 9. Review Skill Freshness

`tooling/skills/pt-github-review/SKILL.md` is fresh only when all of the following hold:

- it declares trigger conditions, scope detection, severity, hard rules, platform profiles, knowledge lookup, output format, and anti-patterns;
- `tooling/skills/pt-github-review/FRESHNESS.md` records the upstream rule files it claims to cover and their current hash;
- `skill-check.sh` passes;
- every fixture in `tooling/review-fixtures/` has a schema-valid expected
  finding and every rubric fixture reference resolves;
- upstream rule changes force either a skill update or a conscious freshness hash update in the same PR.

The skill is not considered complete because it sounds comprehensive. It is complete because a script can prove that required sections, upstream hashes, and regression fixtures are present.

## 10. Knowledge Freshness

`docs/knowledge/` is fresh only when:

- every knowledge entry has valid frontmatter;
- every active `owns:` path exists or is a valid directory prefix;
- each invariant has a `How to verify` section;
- each pitfall has a recurrence detection section;
- each playbook has a checklist or ordered procedure;
- PRs that fix bugs, discover invariants, or repeat a task class update knowledge or explicitly explain why not.

`knowledge-match.sh` is the review-time enforcement layer. It proves whether a PR touched paths covered by operational knowledge and lists the entries that must be read.

## 11. Self-Growth Loop

The Review Skill may propose its own growth but must not silently rewrite itself.

```text
finding accepted or escaped defect found
  -> classify as one-off, invariant, pitfall, playbook, or skill-rule gap
  -> add or update fixture
  -> update knowledge or skill
  -> run skill-check.sh
  -> human owner review
  -> merge
```

Growth triggers:

- one critical or bug-level escaped defect -> add a fixture and update the skill;
- same issue class appears twice -> propose a pitfall or invariant;
- same task procedure repeats twice -> propose a playbook;
- same false positive appears three times -> narrow the rule and add a non-regression fixture.

The review system is therefore reviewed by the same system it enforces.
