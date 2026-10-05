---
name: "pt-acceptance-infra-engineering"
description: "Optimizes and audits Acceptance infrastructure while enforcing strict separation from business injection. Invoke for Acceptance Core, runtime, validation, evidence, or framework tooling changes."
stage: "cross-stage"
requires: ["Acceptance Infra request", "accepted Acceptance architecture or explicit design amendment"]
produces: ["Infra ownership matrix", "framework-only changes", "self-validation evidence", "business injection handoff"]
---

# Acceptance Infra Engineering

## Invoke When

Invoke for work on Acceptance infrastructure:

- Core contracts, base classes, state machines, and typed errors.
- Planner, validator, runner, reporter, coverage, and quality-evidence tooling.
- Evidence Store, ArtifactRef, manifests, durability, retention, and cleanup.
- Generic Provisioner, Driver, Fixture, and Harness interfaces or lifecycle.
- Suite-scoped runtime reuse contracts, lifecycle accounting, performance
  budgets, and attach-only Scenario enforcement.
- Registration mechanisms, schemas, templates, onboarding, and structural
  validation.
- Framework self-tests, synthetic fixtures, CI Gates, observability,
  portability, concurrency, isolation, or performance.
- Audits or optimization requests whose subject is Acceptance Infra itself.

Business Domain onboarding, Gate implementation, product proof, or missing
runtime evidence belongs to `pt-acceptance-engineering`, not this Skill.

## Core Rule

```text
Acceptance Infra defines how business modules inject.
Business modules provide what gets injected.
Infra validates injection structure.
Infra never manufactures, repairs, weakens, or completes business injection.
```

Ownership is determined by responsibility, not path. A file under
`tooling/acceptance/` can still be business-owned injection.

## Ownership Matrix

| Acceptance Infra owns | Business modules inject |
|---|---|
| Contract schemas and extension interfaces | Domain, Feature, and Capability instances |
| Planner, validator, runner, and report semantics | Product truth sources, journeys, assertions, and negative constraints |
| Evidence Store and generic artifact lifecycle | Product evidence and proof status |
| Generic Provisioner/Driver/Fixture/Harness abstractions | Concrete environment contracts and Provisioners |
| Registration and plugin mechanisms | Gate catalog entries and Gate implementations |
| Structural checks for injected content | Registry path mappings |
| Generic lifecycle, timeout, cancellation, isolation, and cleanup | Actor/client roles, credentials, datasets, and Domain Fixtures |
| Suite Runtime schema, lifecycle ledger, reuse metrics, and structural audit | Scenario IDs, concrete resource budgets, UI actions, and receiver assertions |
| Templates, onboarding contracts, synthetic fixtures, and self-validation | Product failure diagnosis and repair |

Infra may inspect concrete injection for compatibility and emit a gap. It may
not supply or modify that injection unless the user explicitly starts a
separate business-owned task.

## Required Discipline

### 1. Classify Before Editing

Verify the Context Anchor, worktree, branch, and formal plan. Produce:

```text
Infra scope
Business injection scope
Mixed/ambiguous paths
```

If a request mixes both scopes, split it. Continue only the Infra work in this
Skill.

### 2. Use Explicit Failure Ownership

When injected content is missing or invalid, return:

```text
BUSINESS_INJECTION_REQUIRED
- owner domain
- missing contract slot
- expected schema/interface
- affected Domain
- impact on that Domain
- impact on Acceptance Infra: non-blocking
```

The gap can block the affected Domain. It must not block Infra completion.

### 3. Optimize Only Framework Properties

Review and improve:

- domain neutrality;
- deterministic planning and validation;
- fail-closed behavior;
- extension-point isolation;
- lifecycle, cancellation, timeout, and reverse cleanup;
- evidence durability, traceability, and redaction;
- concurrency and worktree isolation;
- portability and path containment;
- diagnostics, observability, and operator ergonomics;
- bounded resource use and testability.
- explicit Plan/Task/Suite/Scenario/Step ownership and warm-reuse accounting.

Do not optimize a product journey or assertion under this Skill.

### 4. Use Synthetic Self-Validation

Framework tests use generic or temporary synthetic fixtures. Real business
Domains may be read for compatibility, but their missing Gates, environments,
credentials, or proof remain separate injection gaps.

Infra readiness is proven by `acceptance_core_self_validation` capabilities and
framework Gates. `product_domain_validates_acceptance` is optional reverse
evidence: report it, but never make it a generic Infra merge blocker.

### 5. Hand Off Business Work

If a business owner asks to close an injection gap, dispatch a separate
`pt-acceptance-engineering` task with the exact interface and gap artifact.
Do not silently continue in the Infra worktree or plan.

## Workflow

1. Verify physical context through `pt-context-anchor`.
2. Read Acceptance architecture, decisions, module layout, and active plan.
3. Build the Infra/Business Injection Ownership Matrix.
4. Stop or split any mixed ownership item.
5. Define framework invariants and synthetic failure cases.
6. Implement only generic contracts, lifecycle, validation, or tooling.
7. Run `pt-acceptance-pipeline-auditor` against at least one synthetic Suite
   contract and report; product-domain results remain reverse evidence only.
8. Run framework self-validation and failure-path tests.
9. Run Quality Evidence with capability-direction separation.
10. Report Infra readiness and Business Injection gaps in separate sections.
11. Dispatch business gaps without modifying them.

## Output

```markdown
**Acceptance Infra Mode**
- AUDIT | OPTIMIZE | UPGRADE | REVIEW

**Infra Scope**
- ...

**Explicit Non-Scope**
- ...

**Ownership Matrix**
- ...

**Infra Findings / Changes**
- ...

**Framework Self-Validation**
- PASS | FAIL | UNPROVEN

**Business Injection Gaps**
- BUSINESS_INJECTION_REQUIRED ...

**Infra Readiness**
- READY | HOLD | BLOCKED

**Next Infra Action**
- ...
```

Business Injection gaps are informational to Infra readiness unless they reveal
a defect in the generic injection mechanism itself.

## Verification

Minimum verification:

```bash
python3 tooling/scripts/acceptance-infra-boundary-test.py
python3 tooling/scripts/quality-evidence-test.py
python3 tooling/scripts/acceptance-validate-test.py
tooling/scripts/review/skill-check.sh
make acceptance-infra-validate
make acceptance-plan-self
git diff --check -- \
  AGENTS.md \
  docs/global/workflow.md \
  docs/architecture/engineering/acceptance \
  tooling/acceptance \
  tooling/scripts \
  tooling/skills
```

Run environment-backed product Gates only in a separately authorized business
task. Their absence is not an Infra verification failure.

## Anti-Patterns

Never:

- add or repair product Gate entries, implementations, or assertions;
- create concrete environment contracts, Provisioners, actor/client roles,
  credentials, or Domain Fixtures for a business module;
- modify business capability scope to make Infra Quality Evidence pass;
- downgrade or waive product assertions;
- use placeholders, mocks, defaults, fallbacks, or hardcoded identities;
- debug product behavior while claiming to optimize Infra;
- encode a Domain, actor, selector, scenario name, or product assertion in the
  generic Suite Runtime contract;
- treat business `UNPROVEN`, `FAILED`, or `BLOCKED` as Infra failure;
- require reverse-validation capabilities for every Infra PR;
- write into another worktree to close a business injection gap;
- claim product readiness from framework self-validation.
