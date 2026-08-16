# Peers-Touch Quality Framework

> Status: active baseline
> Owner: Architecture
> Scope: review, acceptance, knowledge, deterministic gates, and agent-led quality judgment.

---

## 1. Purpose

Peers-Touch quality assurance is a closed loop, not a single CI gate.

The system combines:

- deterministic gates that catch machine-checkable violations;
- Acceptance Framework evidence that proves product capabilities;
- operational knowledge that preserves invariants, pitfalls, and playbooks;
- agent-led review that makes the final merge judgment;
- human owner escalation only for decisions that cannot be derived from code and evidence.

The target outcome is:

```text
PR / diff
  -> change routing
  -> quality evidence plan
  -> deterministic gates
  -> acceptance evidence
  -> knowledge delta review
  -> agent code review judgment
  -> owner escalation when needed
  -> merge / hold / reject
  -> review learning classification
  -> knowledge, gate, fixture, skill, or CI growth
```

---

## 2. Responsibilities

| Layer | Responsibility | Not Responsible For |
|---|---|---|
| Review Framework | route review profiles, hard-rule evidence, review output discipline | proving product completion |
| Acceptance Framework | product capability evidence: proven / unproven / risk | final merge decision |
| Quality Check | evidence aggregation and gap reporting | approving or rejecting a PR |
| Knowledge Layer | path-owned invariants, pitfalls, and playbooks | generic project wiki |
| GitHub Review Skill | agent-led review judgment from code, docs, knowledge, and evidence | replacing required owner decisions |
| CI | deterministic baseline and cheap evidence | all environment-heavy product acceptance |
| Human Owner | architecture, security, product, rollout, and hard-rule waiver decisions | re-reviewing everything the agent already proved |

---

## 3. Quality Evidence Plan

Every non-trivial review should produce or reconstruct the same evidence model:

```bash
make quality-evidence REVIEW_RANGE=<base>...<head>
```

This writes:

- `tooling/acceptance/reports/latest-quality-evidence.json`
- `tooling/acceptance/reports/latest-quality-evidence.md`

```json
{
  "range": "<base>...<head>",
  "review_profiles": ["station", "desktop"],
  "acceptance": {
    "impacted_features": ["chat-service-contract"],
    "selected_gates": ["station-messaging-unit", "chat-desktop-gateway-e2e"],
    "run": ["station-messaging-unit"],
    "not_run": ["chat-desktop-gateway-e2e"],
    "unproven_scope": ["native multi-client message delivery"]
  },
  "knowledge": {
    "matched": ["docs/knowledge/invariants/..."],
    "delta_review": "no invariant violation found"
  },
  "tests": {
    "run": ["go test ./app/subserver/messaging/..."],
    "not_run": ["Desktop Tauri build"]
  }
}
```

The evidence plan is not an approval. It is the input to agent review.

---

## 4. Submit-Time Review Pipeline

When a user asks an agent to submit an MR/PR, the quality lifecycle starts before
the PR is created. The agent must run the submit-time pipeline against the target
base branch:

```bash
make review-submit REVIEW_BASE=origin/master
```

The pipeline performs:

1. quality evidence generation;
2. strict review framework checks;
3. acceptance domain validation and coverage report;
4. acceptance planning for the PR range;
5. selected `ci-structure` and `ci-cheap` acceptance gates;
6. acceptance report generation.

If the submit-time pipeline fails, the agent must not open a normal ready-for-review
PR. It must either fix the failure, ask the user whether to open a draft with
explicit evidence gaps, or record an owner-approved waiver.

The PR body must include the generated evidence summary, matched knowledge,
tests/checks run, unproven scope, and Framework Growth Opportunities.

After PR creation, GitHub Actions rerun the review workflow and attach CI evidence
artifacts. CI is the second execution of the same lifecycle, not the first time
quality review starts.

---

## 5. Acceptance Evidence Tiers

Acceptance gates should not all run in PR CI. Each gate should be classified by execution tier:

| Tier | Use |
|---|---|
| `ci-structure` | schema, registry, feature, capability, and gate consistency |
| `ci-cheap` | local unit, proto, typecheck, and low-cost product gates |
| `local-evidence` | developer or agent-run evidence that is useful but not universal |
| `env-evidence` | gates requiring fedp5, Desktop gateway, browser, or simulator |
| `nightly` | heavier multi-node and long-running product confidence |
| `release` | full release acceptance before shipping |

`tooling/acceptance/gates.yaml` carries the explicit `tier` field. Reviewers must not infer product proof from a selected gate alone. A gate is proven only when there is matching run evidence for that gate and environment.

Executable tier entry points:

- `make acceptance-run-ci` runs selected `ci-structure` and `ci-cheap` gates.
- `make acceptance-run-local-evidence` runs selected `local-evidence` gates.
- `make acceptance-run-env-evidence` runs selected `env-evidence` gates only when the target environment is available.
- `make acceptance-run-nightly` runs selected `nightly` gates in scheduled or manually prepared environments.

---

## 6. CI Evidence

The GitHub review workflow runs review gates, generates quality evidence, writes the Markdown evidence report into the job summary, and uploads JSON/Markdown artifacts. CI evidence is a review input, not an approval.

---

## 7. Knowledge Delta Review

`knowledge-match.sh` is a path resolver. It does not decide whether code violates or obsoletes knowledge.

The agent review must perform the semantic delta:

- matched invariant violated by code -> block;
- matched pitfall root cause reintroduced -> block or require evidence;
- matched playbook skipped -> block unless the PR explains why it does not apply;
- code changes the truth behind knowledge -> require knowledge update or owner-reviewed supersession;
- bug fix discovers reusable root cause -> require pitfall or explicit waiver;
- repeated procedure appears again -> propose playbook;
- new stable rule emerges -> propose invariant or acceptance gate.

---

## 8. Merge Decision Model

The final merge decision belongs to agent-led review, using the evidence plan:

| Decision | Meaning |
|---|---|
| `merge` | required evidence is sufficient, no blocking findings remain |
| `hold` | missing evidence, unproven acceptance scope, knowledge mismatch, or owner decision remains |
| `reject` | code violates architecture, hard rules, data safety, security, or product correctness |

Acceptance can prove capability scope, but it cannot approve a PR. Review can approve a PR, but it must account for acceptance evidence honestly.

---

## 9. Growth Loop

The review framework is designed for review agents, not only humans. It must
improve as the product and business domains evolve. The durable learning target
is the repository, not an individual agent's private memory.

Every review must run this growth protocol after findings and evidence gaps are
identified:

```text
for each finding or evidence gap:
  decide whether the lesson is reusable
  if reusable, classify the repository asset that should grow
  if not reusable, record the no-growth reason
```

Growth decisions are restricted to these stable categories:

| Decision | Repository Asset |
|---|---|
| `knowledge_invariant` | `docs/knowledge/invariants/**` |
| `knowledge_pitfall` | `docs/knowledge/pitfalls/**` |
| `knowledge_playbook` | `docs/knowledge/playbooks/**` |
| `hard_rule` | `tooling/scripts/review/hard-rules.sh` plus fixture |
| `review_fixture` | `tooling/review-fixtures/**` |
| `acceptance_contract` | `tooling/acceptance/features/**` or `capabilities/**` |
| `acceptance_gate` | `tooling/acceptance/gates.yaml` or `tooling/acceptance/gates/**` |
| `skill_update` | `tooling/skills/pt-github-review/SKILL.md` or `pt-quality-check/SKILL.md` |
| `ci_tooling_update` | `.github/workflows/**`, `tooling/make/**`, or `tooling/scripts/**` |
| `no_growth_needed` | explicit review note explaining why the lesson is one-off |

After every accepted finding or escaped defect, classify the missing guard:

| Trigger | Expected Growth |
|---|---|
| escaped bug | `docs/knowledge/pitfalls/**` and fixture |
| new invariant | `docs/knowledge/invariants/**` |
| repeated task procedure | `docs/knowledge/playbooks/**` |
| missing product evidence | acceptance feature / capability / gate |
| hard-rule gap | review fixture and rule update |
| review behavior gap | `pt-github-review` or `pt-quality-check` skill update |

The quality system improves only when review conclusions feed back into
knowledge, gates, fixtures, skills, and CI/tooling.

## 10. Proof Obligations

The framework does not claim an agent will never miss a bug. It proves narrower,
engineering-testable properties:

| Property | Proof |
|---|---|
| Every review protocol includes growth evaluation | `pt-github-review` requires `Review Learning Check` and `Framework Growth Opportunities` |
| Growth decisions have durable repository targets | decision categories map to concrete repo paths |
| The growth protocol cannot be silently removed | `skill-check.sh` requires the sections and decision categories |
| Learned behavior is reusable by future agents | knowledge, skills, fixtures, gates, and CI live in the repo |
| Regressions in the protocol are caught | growth fixtures under `tooling/review-fixtures/growth-*` are checked |

Therefore the proof target is:

```text
once a reusable review lesson is recognized and merged into a repository asset,
future agents executing the same framework inherit that lesson through checked
repo state instead of private conversational memory.

## 11. Document Set

This directory is the source of truth for the quality framework:

| Document | Purpose |
|---|---|
| `README.md` | architecture overview, responsibilities, proof target |
| `lifecycle.md` | end-to-end quality lifecycle from task to merge and growth |
| `agent-operation.md` | concrete operating procedure for agents executing the framework |
| `proof-model.md` | what is machine-proven, what is review-proven, and what is not claimed |
| `maintenance.md` | how to evolve routes, gates, skills, fixtures, and knowledge safely |

Agents should read `agent-operation.md` when asked to submit an MR/PR or perform
review. Framework maintainers should read `maintenance.md` before changing the
quality system itself.
```
