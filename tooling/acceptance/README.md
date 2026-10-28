# Acceptance Framework Operations

`tooling/acceptance/` is the executable product-proof layer. This guide is the
current operating entry point for humans and Agents. Architecture authority is
in [`docs/architecture/engineering/acceptance/`](../../docs/architecture/engineering/acceptance/README.md).

## What It Proves

Acceptance answers four separate questions:

1. What product capability was requested?
2. Which current-source operations and observations ran?
3. Did cleanup and evidence sealing complete?
4. Which scope is formally proven, unproven, failed, or blocked?

Framework self-tests prove framework conformance only. Harness observations,
API success, command exit zero, prerequisite reuse, and Suite lifecycle
conformance do not substitute for required UI or receiver-visible evidence.

## Ownership Map

- `capabilities/`: business capabilities and required proof.
- `features/`: feature contracts, visible surfaces, and required Gates.
- `registry.yaml`: changed-path impact mapping.
- `domains/`: domain status and validation profiles.
- `gates.yaml`: Gate commands, dependencies, inputs, timeouts, tiers, cells,
  and explicit E2E Journeys with references to existing implementations.
- `gates/`: stable product and framework evidence producers.
- `search_capture.py`: shared Search capture scripts for Messaging and Social
  Desktop/Mobile Gates and source-contract replays; domain-neutral Core owns no
  Search selectors.
- `behavior-rules/`: operation-language behavior rules.
- `environments/`: typed environment and service requirements.
- `runtime-cells/`: platform-cell contracts.
- `provisioners/`: resource lifecycle adapters.
- `fixtures/`: business-owned setup and reset operations.
- `input_owners/`: read-only execution-input observers.
- `core/`: domain-neutral scope, lifecycle, evidence, proof, and reporting logic.
- `templates/`: contract and human-summary templates.
- `playbooks/`: bounded operational procedures.
- `reports/`: ignored convenience output; not the canonical Evidence Store.

Business modules own the meaning of an operation and its Oracle. Core owns
execution mechanics and must return `BUSINESS_INJECTION_REQUIRED` or
`UNPROVEN` when those semantics are absent.

## Execution Flow

```text
selection
  -> scope and dependency closure
  -> read-only E2E implementation preflight
  -> execution-input qualification
  -> environment and runtime-cell provisioning
  -> bounded Gate operation
  -> assertions and immutable artifacts
  -> cleanup and required finalizers
  -> sealed EvidenceReport
  -> formal proof reading and report projection
```

The Runner is the execution authority. Execution Plans are optional inputs:
use one when a reviewed task supplies an explicit scope, or select Gates,
completion scope, or full scope directly.

## Setup

Use the repository Acceptance environment when present:

```bash
export PATH="$PWD/.local/acceptance/python-venv/bin:$PATH"
```

Do not install dependencies implicitly during a Gate. Input owners qualify the
actual selected tools and fail closed when required equipment is absent or has
drifted.

## Select Scope

Plan the current diff:

```bash
python3 tooling/scripts/acceptance-plan.py \
  --root tooling/acceptance \
  --range HEAD
```

Select explicit Gates:

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate acceptance-plan-self \
  --gate acceptance-infra-validation
```

Run completion or explicit full scope:

```bash
python3 tooling/scripts/acceptance-run.py --completion
python3 tooling/scripts/acceptance-run.py --full
```

Consume a reviewed plan when one exists:

```bash
python3 tooling/scripts/acceptance-run.py --plan <plan.json>
```

Use `--dry-run` before an expensive or remote scope to inspect the resolved
closure. A path match alone does not authorize resources outside the selected
scope.

For an explicit E2E Gate, humans and Agents use the same entry:

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate chat-lifecycle-onboarding-e2e \
  --runtime-cell desktop-macos-native --dry-run
python3 tooling/scripts/acceptance-run.py \
  --gate chat-lifecycle-onboarding-e2e \
  --runtime-cell desktop-macos-native \
  --execution-policy development --work-item onboarding-check
```

Omit the development options for formal Acceptance. Preview allocates no
Evidence Store and starts no product resources. The runner reads declared
public Python symbols without importing business modules, then returns
`REUSE_IMPLEMENTATION`, `ENHANCE_REQUIRED`, and `QUALIFY_AT_OWNER`.
Repair a gap at the referenced original owner and repeat the same selection.
Only selected Gates and their explicit `dependsOn` closure execute.

No IDE is required. Independent Python Gate entries recheck the same contract;
entry code calls `preflight_gate_entry` before resource preparation outside
`AcceptanceGate.run`. Source-only Gates have no inferred E2E classification.
The preparation artifact is supporting information with `UNPROVEN` proof.
See [the E2E contract](../../docs/architecture/engineering/acceptance/e2e-execution-hook.md).

## Execution Modes

- Direct Gate mode runs the named Gates plus declared prerequisites.
- Completion mode resolves the current completion contract.
- Full mode is explicit and must not be inferred from an ordinary change.
- Tier filters select registered cost classes without changing proof meaning.
- Runtime-cell selection binds a platform-specific product claim.
- Resume requires the original durable session reference and revalidates source,
  input closure, artifacts, equipment, and cleanup eligibility.

Every operation has a timeout. Lifecycle budgets reserve time for cleanup and
publication. On the first over-budget Gate, downstream dispatch stops; the
failure is diagnosed at its owning layer before a new candidate is frozen.
Timeouts must not be enlarged merely to manufacture a pass.

## Reports And Evidence

Generate the report for the latest or selected sealed run:

```bash
python3 tooling/scripts/acceptance-report.py
python3 tooling/scripts/acceptance-report.py --run <run-id>
```

The machine contract is `core/evidence.py::EvidenceReport`. The canonical
runtime store defaults to `~/.peers-touch/dev/acceptance` and can be isolated
with `PT_ACCEPTANCE_ARTIFACT_ROOT`.

For a review note, start from
[`templates/gate-execution-summary.md`](templates/gate-execution-summary.md).
That file is a human projection only. It defaults to `UNPROVEN`, cites immutable
run and artifact references, and must never be edited to manufacture `PROVEN`.

Formal proof is read through `core/proof.py`. It validates original inventory,
source identity, execution inputs, required assertions, scans, terminal cleanup,
finalizer authority, and evidence freshness. Labels and copied summaries carry
no proof authority.

## Add Or Change A Product Gate

1. Define or update the Capability and Feature contract.
2. Declare the exact user effect, operation, Oracle, negative constraints, and
   required evidence surface.
3. Register impact mapping separately from business semantics.
4. Add the Gate command, dependencies, input owner, timeout, tier, environment,
   runtime cells, artifacts, and finalizer requirement to `gates.yaml`.
5. Reuse an existing Driver, Provisioner, Fixture, and service binding.
6. Emit structured assertions and immutable artifact references.
7. Prove failure, timeout, cleanup, and stale-evidence rejection paths.
8. Update domain coverage and run structural validation.

Do not put product assertions in Core or Provisioners. Do not infer service
topology from client order or raw URLs. Use typed service IDs from the runtime
manifest. Do not let one platform cell prove another.

## Add Or Change Framework Infrastructure

Keep Core domain-neutral. A framework change must preserve:

- explicit closed scope and dependency ordering;
- current-source execution identity and owner-observed inputs;
- finite lock wait and hold diagnostics;
- bounded processes, cleanup, and publication reserve;
- immutable evidence and atomic latest pointers;
- no secrets or raw handles in manifests, arguments, environment, or reports;
- rejection of stale, partial, fabricated, or mismatched proof;
- `UNPROVEN` product scope when business providers are absent.

Validate the infrastructure slice:

```bash
python3 tooling/scripts/acceptance-docs-test.py
python3 tooling/scripts/acceptance-validate-test.py
python3 tooling/scripts/acceptance-validate.py --infra
python3 tooling/scripts/acceptance-report-test.py
```

The registered structural Gate is:

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate acceptance-infra-validation
```

## Diagnose A Failure

Classify the first failed owner before changing code:

- scope or registry;
- input qualification or source identity;
- environment, equipment, lease, or provisioning;
- Driver, Fixture, operation, or Oracle;
- product behavior;
- evidence, cleanup, finalizer, or publication;
- framework contract or toolchain overhead.

Preserve raw evidence and immutable references. Do not convert an infrastructure
failure into a product failure, and do not inherit prior `PASS` after source or
contract drift. Unexecuted scope remains `UNPROVEN`.

## Required Knowledge

Read path-matched entries in `docs/knowledge/` before editing. Common entries:

- `invariants/acceptance-scope-is-runner-owned.md`
- `invariants/acceptance-suite-runtime-reuse.md`
- `invariants/acceptance-fixed-scope-continuation.md`
- `pitfalls/acceptance-core-transport-import-cycle.md`
- `pitfalls/acceptance-mutable-artifact-rewrite.md`
- `pitfalls/acceptance-active-docs-must-not-promote-drafts.md`

## Nonclaims

An Infra validation pass does not prove a product domain. A domain aggregate
does not prove undeclared platforms or topologies. A historical report does not
prove current source. Missing immutable references, required observations,
cleanup, or authority leaves the affected scope `UNPROVEN`.
