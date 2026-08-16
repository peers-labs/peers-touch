---
name: "pt-acceptance-engineering"
description: "Adds, completes, upgrades, or audits Peers-Touch Acceptance coverage. Invoke for any module/domain Acceptance onboarding, gate work, or framework change."
stage: "cross-stage"
requires: ["Acceptance request or coverage gap", "governing product and architecture sources"]
produces: ["classified Acceptance work", "contract and coverage gap matrix", "stage dispatch", "gates and evidence when execution is authorized"]
---

# Acceptance Engineering

Use this skill as the deterministic entry point for all Acceptance engineering.
It translates "add, complete, upgrade, or audit Acceptance" into the correct
product, architecture, planning, execution, runtime, and evidence workflow.

It is governed by:

- `docs/architecture/acceptance-framework/domain-onboarding.md`
- `docs/architecture/acceptance-framework/design.md`
- `docs/architecture/acceptance-framework/decisions.md`
- `tooling/acceptance/README.md`

Do not infer a local onboarding process when these sources define one.

## Invoke When

Invoke when the user asks to:

- Add Acceptance for a new module, domain, feature, capability, or journey.
- Complete missing, partial, stale, or unproven Acceptance coverage.
- Upgrade Acceptance Core Runtime, Driver, Fixture, Harness, Evidence, planning,
  validation, reporting, or environment lifecycle.
- Audit whether a module is properly covered by Acceptance.
- Add or change an Acceptance Gate, domain profile, capability contract,
  feature contract, registry rule, or evidence report.

`pt-god-view` must route all such requests here before choosing a stage skill.

## Core Rule

Acceptance work follows:

```text
Product promise and receiver journey
  -> Feature contract
  -> Capability proof contract
  -> Domain profile
  -> Impact mapping
  -> Stable Gate definition
  -> Runtime and fixture provisioning
  -> Gate execution
  -> Source-bound evidence
  -> Proven / Unproven judgment
  -> Coverage and knowledge update
```

Never start from "write a Gate." A Gate is executable evidence for an accepted
product assertion; it is not the source of product meaning.

## Work Modes

Classify the request before editing.

| Mode | Entry condition | First action | Stage rule |
|------|-----------------|--------------|------------|
| `ADD` | A module/domain/feature has no Acceptance contract | Inventory product journeys and existing coverage | Missing journeys or receiver assertions -> `PRODUCT`; new runtime/ownership/contract boundary -> `DESIGN`; otherwise `PLAN` |
| `COMPLETE` | Contracts exist but coverage is partial, stale, or unproven | Build a coverage gap matrix from current contracts and evidence | Undefined product assertion -> `PRODUCT_AMENDMENT_REQUIRED`; undefined architecture semantic -> `DESIGN_AMENDMENT_REQUIRED`; known closure -> `PLAN` or `EXECUTE` |
| `UPGRADE` | Acceptance framework/core/schema/driver/environment behavior changes | Read framework architecture and inventory all consumers | Always enter `DESIGN` unless an accepted design and approved plan already cover the exact upgrade |
| `AUDIT` | User asks what is covered, missing, valid, or proven | Run read-only structural and evidence audit | Stay in review/audit; do not edit unless the user asks to fix findings |

Do not treat a new source file as a new Domain. Use the smallest valid scope:

```text
existing Feature update
  < new Feature in an existing Capability
  < new Capability in an existing Domain
  < new Domain
```

## Required Source Pass

Before classification, read:

1. `docs/architecture/acceptance-framework/domain-onboarding.md`
2. `docs/architecture/acceptance-framework/design.md`
3. `docs/architecture/acceptance-framework/decisions.md`
4. `tooling/acceptance/domains/index.yaml`
5. The target Domain profile, Capability file, and Feature contracts when they
   exist.
6. `tooling/acceptance/registry.yaml`
7. `tooling/acceptance/gates.yaml`
8. Relevant product, architecture, platform, execution-plan, and operational
   knowledge sources for the target module.
9. Current Acceptance reports when the request concerns completion or proof.

Inspect code and runtime entrypoints. Do not trust document file counts or
coverage claims without repository evidence.

## Mandatory Procedure Manual

Before acting on an Acceptance request, read
[`PROCEDURES.md`](./PROCEDURES.md) in full. It is the executable part of this
Skill and defines all nine steps using the required shape:

```text
Inputs
Procedure
Commands
Artifacts
Failure states
Exit criteria
```

No step is complete because its command returned zero. Its artifacts and exit
criteria must also be satisfied. Stop on any named failure state instead of
improvising a workaround.

The mandatory execution order is:

```text
1. Identify scope and ownership
2. Build the coverage gap matrix
3. Dispatch the correct project stage
4. Connect or update Acceptance contracts
5. Define the runtime scenario and resource manifest
6. Plan Gates from the actual change surface
7. Provision runtime, Fixture, Harness, credentials, and isolation
8. Execute Gates and judge structure separately from proof
9. Report, release resources, and update coverage
```

Steps 1 through 3 are always required. `AUDIT` may stop after Step 3 or continue
read-only through Steps 6, 8, and 9. `ADD`, `COMPLETE`, and `UPGRADE` continue
only through the stage skill selected by Step 3.

## Scenario Calibration

After reading the procedure manual, read
[`SCENARIOS.md`](./SCENARIOS.md) before the first invocation in a session. It
calibrates the procedure against:

- Native two-actor Chat Acceptance.
- Station Dashboard service and web Acceptance.
- Applet local-evidence Acceptance.

The scenarios are examples of applying the procedure, not alternate sources of
truth. If a scenario conflicts with the current Gate Catalog, profile,
architecture, or code, current sources win and the mismatch is reported as
`ACCEPTANCE_SCENARIO_STALE`.

## Lifecycle Checkpoints

These are workflow checkpoints, not application event-bus messages. The Agent
records them in the execution plan progress table, Gate report, or handoff
report as specified below.

| Checkpoint | Producer | Required record | Next action |
|------------|----------|-----------------|-------------|
| `ACCEPTANCE_REQUEST_CLASSIFIED` | Procedure Step 1 | Mode, target Domain, current stage, reason | Inventory source ownership |
| `ACCEPTANCE_SCOPE_INVENTORIED` | Procedure Step 1 | Existing IDs, truth source, receiver, surfaces, Gates, evidence | Build gap matrix |
| `ACCEPTANCE_GAP_MATRIX_READY` | Procedure Step 2 | Every assertion/runtime cell and proof state | Dispatch owning stage |
| `ACCEPTANCE_STAGE_DISPATCHED` | Procedure Step 3 | Stage skill and blocking/amendment status | Run selected stage skill |
| `ACCEPTANCE_CONTRACTS_CONNECTED` | Procedure Step 4 | Feature -> Capability -> Domain -> Registry -> Gate traceability | Define runtime scenario |
| `ACCEPTANCE_PLAN_SELECTED` | Procedure Step 6 | Changed paths, impacted Features, selected Gates, environments | Provision selected environments |
| `ACCEPTANCE_RUNTIME_PREFLIGHTED` | Procedure Step 7 | Profile, services, actors, ports, storage, credential variable names, cleanup policy | Prepare Fixture |
| `ACCEPTANCE_FIXTURE_READY` | Procedure Step 7 | Setup/reset target, authorization, initial-state assertion | Load clients and Harness |
| `ACCEPTANCE_HARNESS_READY` | Procedure Step 7 | Namespace, production actions, runtime identity | Start proof Gate |
| `ACCEPTANCE_GATE_FINISHED` | Procedure Step 8 | Gate status, duration, first failed step, log | Validate evidence |
| `ACCEPTANCE_EVIDENCE_EMITTED` | Procedure Step 8 | Source artifacts, redaction, receiver/runtime/build identity | Judge proof |
| `ACCEPTANCE_PROOF_JUDGED` | Procedure Step 8 | Proven / Partial / Unproven / Blocked per Capability and runtime cell | Release resources |
| `ACCEPTANCE_RESOURCES_RELEASED` | Procedure Step 9 | Processes, ports, storage, sessions, Fixture cleanup | Update reports |
| `ACCEPTANCE_COVERAGE_UPDATED` | Procedure Step 9 | Final coverage matrix and remaining gaps | Quality/review handoff |

For non-trivial work, progress reports must name the latest completed checkpoint
and the next checkpoint.

## Output Contract

Every invocation returns:

```markdown
**Acceptance Mode**
- ADD | COMPLETE | UPGRADE | AUDIT

**Sources**
- Governing product, architecture, onboarding, and plan paths

**Coverage Gap Matrix**
- Journey/assertion rows with proof states

**Stage Decision**
- PRODUCT | DESIGN | PLAN | EXECUTE | REVIEW
- Skill dispatched and reason

**Execution / Evidence**
- Commands and evidence, or NOT RUN with reason

**Claim**
- Strongest claim supported by current evidence

**Next Checkpoint**
- Exact lifecycle checkpoint and required input
```

## Verification

For contract or framework changes, run:

```bash
make acceptance-validate
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
git diff --check -- tooling/acceptance docs/architecture/acceptance-framework tooling/skills AGENTS.md
```

Run selected cheap/local Gates. Environment-backed Gates remain `UNPROVEN`
unless the declared environment was actually provisioned and exercised.

## Anti-Patterns

Never:

- Write a Gate before locating its Feature and Capability assertion.
- Create a new Domain for a single implementation file or component.
- Put product truth, visible-state semantics, or negative constraints in
  Registry or Gate Catalog.
- Let a Gate redefine its own success after seeing available evidence.
- Treat type-check, dry-run, smoke, screenshot, API response, or structural
  validation as proof of a stronger receiver journey.
- Run destructive fixture reset without explicit authorization and target
  verification.
- Hide missing environment, credentials, runtime cells, or evidence.
- Add permanent compatibility paths during framework upgrades.
- Modify Acceptance Core under `COMPLETE`; Core changes are `UPGRADE` and
  require architecture review.
- Claim a Domain `active` before its onboarding artifacts and structural
  validation pass.
- Claim a Capability `PROVEN` before proof validation passes for every required
  Gate and claimed runtime/platform cell.
