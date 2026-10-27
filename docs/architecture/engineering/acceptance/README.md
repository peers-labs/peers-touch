# Acceptance Framework

> **Status**: active
> **Version**: v2.4
> **Created**: 2026-06-03 | **Updated**: 2026-10-26
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

## Authority

This directory is the current architecture authority for product Acceptance.
Documents marked `active` describe implemented contracts. Documents under
`proposals/` are non-normative until their decisions are accepted and merged
into the active documents. Git history and completed execution plans preserve
historical context; they are not current operating instructions.

## Purpose

Acceptance proves selected product capabilities against current source,
runtime, equipment, operations, observations, cleanup, and immutable evidence.
It complements unit and integration tests; it does not turn framework
self-validation into product proof.

The framework separates two ownership domains:

- Business modules own Capability, Feature, Gate, operation, Oracle, Fixture,
  evidence-strength, and cleanup requirements.
- Acceptance Core owns scope closure, dependency ordering, execution identity,
  budgets, provisioning lifecycle, evidence storage, proof admission, reporting,
  bounded continuation, and fail-closed validation.

Missing business injection remains `UNPROVEN` or
`BUSINESS_INJECTION_REQUIRED`. Core must not invent product semantics.

## Current Lifecycle

1. Capability and Feature contracts declare required Gates and proof surfaces.
2. Registry and explicit selection produce a closed requested scope.
3. Runner resolves prerequisites, runtime cells, execution inputs, and budgets.
4. Provisioners establish source-attested resources and typed service bindings.
5. Gates perform bounded operations and emit assertions plus immutable artifacts.
6. Cleanup and required finalizers complete before the run is sealed.
7. The formal proof reader validates source, identity, assertions, scans,
   cleanup, authority, and freshness.
8. Reporter publishes proven and unproven scope from the sealed run.

Plans may supply an explicit scope, but are optional. The Runner remains the
scope and execution authority for direct Gate, completion, and full modes.

## Proof Boundary

`PASS`, command exit zero, a reusable prerequisite, or a valid Suite lifecycle
does not independently establish `PROVEN`. Formal product proof requires the
current `EvidenceReport` contract and all required observations. Old proof is
invalid after relevant source, runtime, provider, Oracle, action-plan, or
cleanup changes.

Runtime artifacts live outside the repository, normally under
`~/.peers-touch/dev/acceptance`. Repository files contain contracts, schemas,
templates, validators, and intentional fixtures only.

## Current Documents

- [design.md](design.md): layers, contracts, runtime boundaries, and lifecycle.
- [decisions.md](decisions.md): accepted architecture decisions.
- [data-model.md](data-model.md): manifests, evidence, artifacts, and states.
- [module-layout.md](module-layout.md): implemented ownership and dependencies.
- [integration.md](integration.md): integration with Profiles, Fixtures, and Gates.
- [execution-budget.md](execution-budget.md): active budget and continuation rules.
- [domain-onboarding.md](domain-onboarding.md): business-domain onboarding.
- [coverage-report.md](coverage-report.md): current coverage projection and gaps.
- [operation-language-design.md](operation-language-design.md): operation-language
  authority and derived execution.

## Operational Entry Points

- [tooling/acceptance/README.md](../../../../tooling/acceptance/README.md):
  human and Agent operating guide.
- [gate-execution-summary.md](../../../../tooling/acceptance/templates/gate-execution-summary.md):
  human summary template; formal status still comes from sealed evidence.
- [pt-acceptance-engineering](../../../../tooling/skills/pt-acceptance-engineering/SKILL.md):
  business injection and product proof.
- [pt-acceptance-infra-engineering](../../../../tooling/skills/pt-acceptance-infra-engineering/SKILL.md):
  Core, Runner, Evidence Store, and framework validation.

## Proposed And Historical Material

- [Execution model proposal](proposals/execution-model/README.md) is a
  non-normative draft. Its landed portions are already represented in active
  documents; remaining ideas must not be used as current instructions.
- `execution-plans/` records bounded implementation intent and disposition.
- Git history is the source for superseded wording and implementation diaries.

## Reading Order

For architecture work, read this file, `design.md`, `decisions.md`, and the
path-matched entries in `docs/knowledge/`. For execution, use the tooling guide
and the selected Gate contracts. For product readiness, inspect the generated
report and immutable evidence references; never infer readiness from framework
self-tests.
