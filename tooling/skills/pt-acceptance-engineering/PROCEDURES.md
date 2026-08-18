# Acceptance Engineering Procedures

This manual defines how to execute each Acceptance lifecycle step. Read it in
full before acting. Repository sources and the selected Gate Catalog entry are
authoritative when an example command differs from current code.

## Common Failure Rule

On a named failure state:

1. Stop the current step.
2. Record the failure state, failed check, source path, and evidence.
3. Classify it as product, architecture, plan, implementation, environment, or
   evidence failure.
4. Dispatch to the owning project skill or report `BLOCKED`.
5. Do not weaken assertions, switch runtime cells, add mocks, or skip cleanup.

## Step 1. Identify Scope And Ownership

### Inputs

- User request.
- Current git branch, worktree, and changed paths.
- Acceptance architecture and onboarding sources.
- Target product, architecture, platform, and operational knowledge sources.
- Existing Domain, Capability, Feature, Gate, and report files.

### Procedure

1. Classify the request as `ADD`, `COMPLETE`, `UPGRADE`, or `AUDIT`.
2. Identify the smallest valid Acceptance unit:
   existing Feature, new Feature, new Capability, or new Domain.
3. Locate the product truth source and its owning runtime.
4. Identify the receiver or operator and the visible surface being asserted.
5. Enumerate claimed platforms and runtime cells.
6. Locate existing contract IDs, Registry rules, Gate definitions, Gate
   implementations, Fixtures, Harnesses, Drivers, and latest evidence.
7. Separate facts found in source from inferred gaps.
8. **Classify ownership of every touched file** using the Responsibility
   Ownership Rule below. Emit the classification artifact before proceeding.

### Responsibility Ownership Rule

Ownership is determined by **what the code decides**, not where it lives or how
many lines it has.

| Signal | Does NOT determine ownership |
|--------|------------------------------|
| File path under `tooling/acceptance/` | Business Gate implementations live here too |
| Large line count or shared by multiple Gates | Domain-local composition, not Infra |
| Reused lifecycle (login, launch, cleanup) | Shared runner within one Domain is still business |
| Called "runner" or "harness" | Only generic abstractions are Infra |

A file is **Acceptance Infra** only if it:

- Defines a generic contract, schema, or extension point consumed by multiple
  independent Domains without modification.
- Implements planner, validator, runner dispatch, Evidence Store, or report
  semantics that are Domain-neutral.
- Would break ALL Domains if removed, not just one.

A file is **business injection** if it:

- Contains product-specific journeys, assertions, or scenarios.
- Maps actors/roles/credentials to a specific Domain.
- Implements Gate logic that only one Domain exercises.
- Would break only one Domain if removed.

**Canonical misclassification example**: `native_visible_runner.py` under
`tooling/acceptance/gates/chat/` is ~1200 lines shared by 4+ Chat journeys.
It is NOT Infra because it contains Chat-specific actor allocation, Chat
journey dispatch, Chat provisioner consumption, and Chat report naming. It
is Domain-local shared infrastructure owned by the Chat business module.

If classification is ambiguous, emit `ACCEPTANCE_OWNERSHIP_MISCLASSIFIED` and
stop. Do not proceed with implementation under the wrong ownership.

### Commands

Run from the repository root:

```bash
git status --short
git branch --show-current
rg -n "<module|capability|feature-id>" \
  docs tooling/acceptance apps model packages
rg -n "<owned-path|gate-id>" \
  tooling/acceptance/registry.yaml tooling/acceptance/gates.yaml
```

List current Acceptance assets:

```bash
rg --files tooling/acceptance/domains \
  tooling/acceptance/capabilities \
  tooling/acceptance/features \
  tooling/acceptance/gates
python3 tooling/scripts/acceptance-artifact.py root
```

### Artifacts

Produce an `Acceptance Scope Inventory` in the work report or execution plan:

| Field | Required value |
|-------|----------------|
| Mode | ADD / COMPLETE / UPGRADE / AUDIT |
| Domain | Existing ID or proposed ID |
| Capability IDs | Existing or missing |
| Feature IDs | Existing or missing |
| Truth owner | Station / Desktop Rust / runtime / other source-backed owner |
| Receiver and surface | Exact user/operator-visible target |
| Runtime cells | Desktop native / browser diagnostic / Station / mobile / testnet |
| Existing Gates | IDs and environments |
| Latest evidence | Paths and timestamps |

Emit `ACCEPTANCE_REQUEST_CLASSIFIED` and `ACCEPTANCE_SCOPE_INVENTORIED`.

### Failure States

- `ACCEPTANCE_SCOPE_AMBIGUOUS`: target module or requested claim is unclear.
- `ACCEPTANCE_TRUTH_OWNER_UNDEFINED`: no authoritative state owner is defined.
- `ACCEPTANCE_RECEIVER_UNDEFINED`: no receiver-visible or operator-visible
  assertion exists.
- `ACCEPTANCE_SOURCE_CONFLICT`: product, architecture, code, and Acceptance
  contracts disagree.
- `ACCEPTANCE_EXISTING_WORK_UNRESOLVED`: active plan or branch ownership is
  unknown.
- `ACCEPTANCE_OWNERSHIP_MISCLASSIFIED`: a file or request was classified under
  the wrong responsibility plane (e.g. business injection labeled as Infra, or
  Infra labeled as business). Stop and reclassify before proceeding.

### Exit Criteria

- Mode and smallest valid Acceptance unit are explicit.
- Truth owner, receiver, surface, and runtime cells are source-backed.
- Existing assets and evidence have been inventoried.
- Every touched file has an explicit ownership classification (Infra or Business).
- Every uncertainty is either resolved or represented by a named failure state.

## Step 2. Build The Coverage Gap Matrix

### Inputs

- Acceptance Scope Inventory.
- Product journeys and acceptance matrix.
- Domain, Capability, and Feature contracts.
- Registry and Gate Catalog.
- Latest plan, run, domain validation, and Gate-specific reports.

### Procedure

1. Create one row per receiver assertion and required runtime/platform cell.
2. Trace each row through truth source, surface, Feature, Capability, Registry,
   Gate, and latest evidence.
3. Verify evidence identity, timestamp, runtime cell, source artifact, and
   receiver assertion.
4. Classify each row:
   - `PROVEN`
   - `STRUCTURAL_ONLY`
   - `PARTIAL`
   - `UNPROVEN`
   - `STALE`
   - `BLOCKED`
5. Name the smallest missing closure and the project stage that owns it.

### Commands

```bash
make acceptance-coverage-report
make acceptance-validate DOMAIN=<domain>
```

When reports exist:

```bash
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate acceptance-plan --role plan
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate acceptance-run --role run
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate <validation-gate-id> --role validation
```

Do not run `--require-proven` yet merely to discover structure. Proof judgment
belongs to Step 8 after required Gates execute.

### Artifacts

Produce the Coverage Gap Matrix:

| Journey/assertion | Runtime cell | Truth source | Surface/receiver | Contract trace | Gate | Latest evidence | State | Missing closure | Required stage |
|-------------------|--------------|--------------|------------------|----------------|------|-----------------|-------|-----------------|----------------|

Emit `ACCEPTANCE_GAP_MATRIX_READY`.

### Failure States

- `ACCEPTANCE_CONTRACT_TRACE_BROKEN`: Feature, Capability, Domain, Registry, or
  Gate link is missing.
- `ACCEPTANCE_EVIDENCE_IDENTITY_MISSING`: evidence does not identify actor,
  runtime, build, or source.
- `ACCEPTANCE_EVIDENCE_STALE`: evidence predates the relevant source/runtime.
- `ACCEPTANCE_RUNTIME_CELL_MISSING`: a claimed platform/runtime has no Gate.
- `ACCEPTANCE_OVERCLAIM_DETECTED`: claimed scope is stronger than evidence.

### Exit Criteria

- Every required assertion and runtime cell has exactly one proof state.
- Every non-proven row names a missing closure and owning stage.
- No structural or smoke evidence is labeled as receiver proof.

## Step 3. Dispatch The Correct Project Stage

### Inputs

- Coverage Gap Matrix.
- Active product, architecture, and execution-plan status.
- Current `active_work` registry entry when present.

### Procedure

1. Group gaps by owning decision layer.
2. Dispatch using this order:
   - Missing job, journey, visible state, recovery, or receiver assertion:
     `pt-product-design-methodology`.
   - Missing ownership, trust boundary, Driver/Fixture/Harness contract,
     evidence schema, environment lifecycle, retry, teardown, or failure
     semantics: `pt-architecture-design-methodology`.
   - Accepted contracts but missing dependency order or execution closure:
     `pt-architecture-execution-methodology`, then `pt-plan-and-document`.
   - Approved plan with exact task ID: `pt-execution-plan-guardian`.
   - Completed code requiring review evidence: `pt-quality-check`, then
     `pt-completion-auditor`.
3. `UPGRADE` enters DESIGN unless accepted architecture and an approved plan
   already name the exact framework change.
4. Stop after dispatch. Do not perform work owned by another stage skill while
   pretending this skill authorized it.

### Commands

No implementation command is valid in this step.

Read stage sources and report the selected skill:

```bash
rg -n "<capability|journey|decision|workstream-id>" \
  docs/architecture docs/client docs/station tooling/skills
```

### Artifacts

Produce:

```text
Stage Decision
- mode
- gap rows being dispatched
- selected stage
- selected skill
- source paths
- blocker or amendment state
```

Emit `ACCEPTANCE_STAGE_DISPATCHED`.

### Failure States

- `PRODUCT_AMENDMENT_REQUIRED`
- `DESIGN_AMENDMENT_REQUIRED`
- `EXECUTION_BLOCKED_BY_PRODUCT`
- `EXECUTION_BLOCKED_BY_DESIGN`
- `EXECUTION_BLOCKED_BY_PLAN`
- `PLAN_AMENDMENT_REQUIRED`

Use the exact semantics defined by the corresponding stage skill.

### Exit Criteria

- Every gap is owned by one stage or explicitly deferred.
- The selected stage has its required upstream sources.
- No code or contract edit starts before the stage preconditions pass.

## Step 4. Connect Or Update Acceptance Contracts

### Inputs

- Accepted product and architecture sources.
- Approved execution plan/task for non-trivial changes.
- Coverage Gap Matrix rows assigned to PLAN or EXECUTE.
- Templates under `tooling/acceptance/templates/`.

### Procedure

Update only the layers required by the gap, in dependency order:

1. Feature contract:
   truth sources, surfaces, acceptance assertions, negative constraints, and
   required Gate IDs.
2. Capability contract:
   Feature membership, required Gates, synthetic paths, `proven_by`,
   `proven_scope`, and `unproven_scope`.
3. Domain profile:
   Capability membership and validation report.
4. Domain index:
   only for a new Domain or reviewed status/coverage transition.
5. Registry:
   owned path patterns to impacted Feature and required Gate IDs.
6. Gate Catalog:
   stable command, timeout, environment, tier, and description.
7. Implementation:
   Gate, Fixture, Harness, and Driver only after contracts are connected.

Use the smallest valid unit. Do not add a Domain for a single component.

### Commands

Validate a proposed or changed path mapping directly:

```bash
python3 tooling/scripts/acceptance-plan.py \
  --changed-file <owned-path> \
  --output /tmp/acceptance-contract-plan.json
sed -n '1,260p' /tmp/acceptance-contract-plan.json
```

Validate the Domain graph:

```bash
make acceptance-validate DOMAIN=<domain>
```

### Artifacts

- Updated Feature, Capability, Domain, Registry, and Gate Catalog files as
  required.
- Contract trace:

```text
owned path
  -> Registry rule
  -> Feature
  -> Capability
  -> Domain
  -> Gate definition
  -> expected evidence
```

Emit `ACCEPTANCE_CONTRACTS_CONNECTED`.

### Failure States

- `ACCEPTANCE_FEATURE_ASSERTION_MISSING`
- `ACCEPTANCE_CAPABILITY_PROOF_INCOMPLETE`
- `ACCEPTANCE_DOMAIN_OVERMODELED`
- `ACCEPTANCE_REGISTRY_UNMAPPED`
- `ACCEPTANCE_REGISTRY_OVERBROAD`
- `ACCEPTANCE_GATE_DEFINITION_MISSING`
- `ACCEPTANCE_GATE_ENVIRONMENT_INVALID`
- `ACCEPTANCE_UNPROVEN_SCOPE_HIDDEN`

### Exit Criteria

- The full contract trace resolves without missing IDs.
- Synthetic paths select all Capability-required Gates.
- Structural Domain validation passes.
- Unproven scope remains explicit.

## Step 5. Define The Runtime Scenario And Resource Manifest

### Inputs

- Feature assertions and Capability proof requirements.
- Selected Gate definitions.
- Product actor/journey model.
- Architecture runtime ownership and trust boundaries.
- Profile and environment documentation.

### Procedure

1. Define actors, devices, accounts, Stations, Relays, and receiver.
2. Select the exact runtime cell for every assertion.
3. Define production actions exposed through Harness or API.
4. Define Fixture setup, reset authorization, initial-state checks, and
   teardown.
5. Define profile, service topology, ports, storage roots, credentials, and
   datasets.
6. Define timeouts, cancellation, restart, offline, and cleanup behavior.
7. Define evidence files, required identity fields, and redaction.
8. Record all of this as the Runtime Resource Manifest in the execution plan or
   Gate preflight report.

### Commands

Inspect the Gate requirements and available profiles:

```bash
sed -n '1,320p' tooling/acceptance/gates.yaml
make profiles
make config
```

Inspect runtime and fixture implementations:

```bash
rg -n "<gate-id|fixture|harness-namespace>" \
  tooling/acceptance apps/desktop/src/acceptance
```

### Artifacts

Runtime Resource Manifest:

```yaml
gate_id: <gate-id>
environment: <local|fedp5|home-station|local-desktop-gateway|native-tauri-embedded-webdriver>
tier: <tier>
profile:
  name: <profile>
  slot: <slot>
services:
  station:
    mode: <local|remote|none>
    url: <url>
    expected_commit: <commit-or-not-applicable>
    health_check: <command-or-url>
  relay:
    required: <true|false>
clients:
  - actor: <actor>
    runtime: <tauri|chrome|station-api|mobile>
    webdriver_port: <port-or-dynamic>
    gateway_port: <port-or-dynamic>
    profile: <isolated-client-profile>
    storage_root: <isolated-path>
credentials:
  - variable: <environment-variable>
    source: <approved-secret-or-test-fixture>
    redact: true
fixture:
  setup: <command-or-function>
  reset_authorization: <variable-or-not-required>
  initial_assertion: <expected-state>
  teardown: <command-or-function>
evidence:
  - <report/screenshot/dom/log/runtime-identity>
cleanup:
  - <process/port/storage/session-check>
```

Do not commit concrete secrets or transient local paths.

### Failure States

- `ACCEPTANCE_RUNTIME_SCENARIO_UNDEFINED`
- `ACCEPTANCE_ACTOR_ISOLATION_UNDEFINED`
- `ACCEPTANCE_PROFILE_UNDEFINED`
- `ACCEPTANCE_CREDENTIAL_SOURCE_UNDEFINED`
- `ACCEPTANCE_FIXTURE_RESET_UNAUTHORIZED`
- `ACCEPTANCE_CLEANUP_POLICY_UNDEFINED`
- `ACCEPTANCE_EVIDENCE_CONTRACT_INCOMPLETE`

### Exit Criteria

- Every Gate resource has an owner, source, acquisition method, and cleanup.
- Every actor has isolated runtime identity and storage where required.
- Fixture reset authorization and target verification are explicit.
- Evidence can identify the source build, runtime, actor, and receiver.

## Step 6. Plan Gates From The Actual Change Surface

### Inputs

- Git diff range or explicit changed-file list.
- Connected Acceptance contracts.
- Gate Catalog.
- Runtime Resource Manifest.

### Procedure

1. Generate the Acceptance plan from the actual diff.
2. Compare changed paths with expected Registry ownership.
3. Compare impacted Features with the Feature contracts changed or relied on.
4. Compare selected Gates with Capability-required Gates.
5. Check environment and tier against the Resource Manifest.
6. Detect unrelated Gate selection caused by broad path patterns.
7. Stop if an owned path produces an empty plan.

### Commands

```bash
make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate acceptance-plan --role plan
```

For an uncommitted or synthetic path check:

```bash
python3 tooling/scripts/acceptance-plan.py \
  --changed-file <repo-relative-path> \
  --output /tmp/acceptance-path-plan.json
sed -n '1,260p' /tmp/acceptance-path-plan.json
```

### Artifacts

- `acceptance-plan` Gate role `plan` in the external Evidence Store.
- Plan review note containing:
  changed paths, matched rules, impacted Features, selected Gates, tiers,
  environments, and mismatches.

Emit `ACCEPTANCE_PLAN_SELECTED`.

### Failure States

- `ACCEPTANCE_OWNED_PATH_UNMAPPED`
- `ACCEPTANCE_REQUIRED_GATE_MISSING`
- `ACCEPTANCE_UNRELATED_GATE_SELECTED`
- `ACCEPTANCE_PLAN_ENVIRONMENT_MISMATCH`
- `ACCEPTANCE_PLAN_EMPTY`

### Exit Criteria

- All owned changed paths match intended Registry rules.
- All required Gates are selected once.
- Every selected environment has a complete Resource Manifest.
- No unrelated Gate is selected.

## Step 7. Provision Runtime, Fixture, Harness, Credentials, And Isolation

### Inputs

- Selected Gates from Step 6.
- Runtime Resource Manifest from Step 5.
- Active worktree and branch.
- Profile definitions and deployment environments.
- Approved credentials and destructive-reset authorization.

### Procedure

#### 7.1 Resolve Environment And Tier

Read each selected Gate's `environment`, `tier`, and timeout.

| Environment | Provision action |
|-------------|------------------|
| `local` | Verify required toolchains/dependencies; do not start unrelated services |
| `native-tauri-embedded-webdriver` | Activate profile, ready Station, build Acceptance binary, run Driver smoke, allocate isolated clients |
| `local-desktop-gateway` | Activate profile, ready Station, start Desktop through `make desktop`, verify Gateway |
| `home-station` | Activate the approved remote/local Station profile, ready and fingerprint Station, verify reset target |
| `fedp5` | Use the existing Federation testnet Make/Gate workflow; verify all declared nodes before the proof Gate |

`ci-structure` and `ci-cheap` must use `local`. Non-local environments must use
`env-evidence`, `nightly`, or `release`.

#### 7.2 Activate An Isolated Worktree Profile

```bash
make profiles
make profile <name>
make config
```

If no appropriate profile exists:

```bash
make profile-init PROFILE=<name> SLOT=<unused-slot>
make profile PROFILE=<name>
make config
```

Verify configured Station URL, mode, slot, and Desktop ports. Do not edit a
shared active profile to fit one Gate when a dedicated profile is required.

#### 7.3 Ready And Fingerprint Services

When Station code, Proto, Schema, or deployment inputs changed:

```bash
make station
make station-check
make station-status
```

When consuming an unchanged Station:

```bash
make station-check
make station-status
```

For remote mode, verify the deployed commit. Uncommitted local changes are not
present in the remote Station and cannot be claimed as tested.

If Relay is required:

```bash
make relay
make relay-check
make relay-status
```

#### 7.4 Build And Preflight Native Tauri

For `native-tauri-embedded-webdriver`:

```bash
python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build
make acceptance-driver-smoke
```

The smoke must verify native URL, root DOM, global Tauri API, process exit, and
port release. It does not prove product behavior.

#### 7.5 Allocate Actor Isolation

For every actor, record:

- WebDriver port or allocation method.
- Gateway port or allocation method.
- Client profile.
- Storage root.
- Account and device identity.

Before launch, verify fixed ports are free:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN
```

An expected "no listener" result is success. Dynamic allocation must be
recorded in the Gate report.

#### 7.6 Inject Credentials Safely

- Read credentials only from approved environment variables, profile sources,
  or test fixtures.
- Check presence without printing values.
- Never place passwords, tokens, PINs, keys, or private actor data in commands,
  reports, screenshots, DOM evidence, or logs.
- Redact before evidence is persisted.

Example presence check:

```bash
test -n "${CHAT_ACCEPTANCE_PASSWORD:-}" \
  || { echo "required credential is missing" >&2; exit 1; }
```

#### 7.7 Prepare Fixture And Harness

For destructive reset, require both:

1. Explicit authorization such as `CHAT_ACCEPTANCE_RESET=1`.
2. Verification that the target is the approved disposable environment.

Run Fixture setup/reset, then assert the expected initial state. Start clients
and wait for the namespaced production Harness to become available. A missing
Harness is a preflight failure, not permission to call Stores directly.

#### 7.8 Record Preflight

Record:

- Active profile and slot.
- Station/Relay URLs, health, and runtime commit.
- Client ports, profiles, and storage roots.
- Credential variable names only.
- Fixture setup/reset status.
- Harness namespaces.
- Cleanup policy.

Emit:

- `ACCEPTANCE_RUNTIME_PREFLIGHTED`
- `ACCEPTANCE_FIXTURE_READY`
- `ACCEPTANCE_HARNESS_READY`

### Commands

Use only the commands selected by the environment procedure above. Before
starting the proof Gate, run:

```bash
make status
```

For native Tauri, the minimum sequence is:

```bash
make profiles
make profile <name>
make config
make station
make station-check
python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build
make acceptance-driver-smoke
make status
```

### Artifacts

- Completed Runtime Resource Manifest.
- Runtime preflight section in the Gate or runner report.
- Service health and runtime commit evidence.
- Per-actor isolation metadata.
- Fixture and Harness readiness evidence.

### Failure States

- `ACCEPTANCE_PROFILE_MISSING`
- `ACCEPTANCE_PROFILE_CONFIG_MISMATCH`
- `ACCEPTANCE_PORT_CONFLICT`
- `ACCEPTANCE_STATION_UNHEALTHY`
- `ACCEPTANCE_RELAY_UNHEALTHY`
- `ACCEPTANCE_RUNTIME_COMMIT_MISMATCH`
- `ACCEPTANCE_NATIVE_BUILD_FAILED`
- `ACCEPTANCE_DRIVER_SMOKE_FAILED`
- `ACCEPTANCE_CREDENTIAL_MISSING`
- `ACCEPTANCE_FIXTURE_RESET_UNAUTHORIZED`
- `ACCEPTANCE_FIXTURE_SETUP_FAILED`
- `ACCEPTANCE_HARNESS_UNAVAILABLE`
- `ACCEPTANCE_ACTOR_ISOLATION_FAILED`

### Exit Criteria

- Every selected Gate environment is ready and fingerprinted.
- Every required credential is present without value disclosure.
- Fixture initial state and Harness readiness are proven.
- Actor ports, profiles, devices, and storage are isolated.
- Cleanup actions are registered before the proof Gate starts.

## Step 8. Execute Gates And Judge Structure Separately From Proof

### Inputs

- Selected plan.
- Successful Step 7 preflight.
- Connected contracts.
- Evidence contract.

### Procedure

1. Run cheap/local tiers first.
2. Diagnose failures before running dependent environment Gates.
3. Run environment-backed Gates only after their exact runtime preflight.
4. Use explicit Gate IDs for focused diagnosis only.
5. Run the planned Gate bundle for final proof.
6. Record the first failed step, exit code, duration, log, and source evidence.
7. Run structural validation.
8. Run proof validation with `--require-proven`.
9. Classify each Capability as Proven, Partial, Unproven, or Blocked.

### Commands

```bash
make acceptance-run-ci
make acceptance-run-local-evidence
make acceptance-run-env-evidence
make acceptance-run
```

Run only tiers present in the selected plan and whose environments are ready.

Structural judgment:

```bash
make acceptance-validate DOMAIN=<domain>
```

Proof judgment:

```bash
python3 tooling/scripts/acceptance-validate.py \
  --domain <domain> \
  --require-proven
```

### Artifacts

- `acceptance-run` Gate role `run` in the external Evidence Store.
- Each executed Gate's role `log` in its immutable external run.
- Gate-specific reports and source evidence.
- Domain validation report.

Emit:

- `ACCEPTANCE_GATE_FINISHED`
- `ACCEPTANCE_EVIDENCE_EMITTED`
- `ACCEPTANCE_PROOF_JUDGED`

### Failure States

- `ACCEPTANCE_GATE_FAILED`
- `ACCEPTANCE_GATE_TIMEOUT`
- `ACCEPTANCE_GATE_BLOCKED_BY_ENVIRONMENT`
- `ACCEPTANCE_EVIDENCE_MISSING`
- `ACCEPTANCE_EVIDENCE_REDACTION_FAILED`
- `ACCEPTANCE_STRUCTURAL_VALIDATION_FAILED`
- `ACCEPTANCE_PROOF_VALIDATION_FAILED`
- `ACCEPTANCE_FIRST_FAILED_STEP_UNKNOWN`

### Exit Criteria

- Every selected Gate is passed, failed, or blocked with a reason.
- Every passed proof Gate has source-bound evidence.
- Structure and proof statuses are reported separately.
- No unrun Gate is labeled passed.

## Step 9. Report, Release Resources, And Update Coverage

### Inputs

- Runtime Resource Manifest.
- Latest plan and run.
- Gate and Domain reports.
- Cleanup policy.
- Coverage Gap Matrix.

### Procedure

1. Stop Driver sessions and client processes in reverse acquisition order.
2. Release ports and temporary storage.
3. Tear down or restore Fixtures according to policy.
4. Verify no process, port, storage, or credential residue remains.
5. Generate Acceptance and coverage reports.
6. Update the Coverage Gap Matrix with final proof states.
7. Record remaining unproven and blocked scope.
8. Propose an invariant, pitfall, playbook, Fixture, or Gate update when the
   run exposed reusable operational knowledge. Do not auto-create knowledge.

### Commands

Use Gate/Driver teardown first, then verify:

```bash
make status
lsof -nP -iTCP:<allocated-port> -sTCP:LISTEN
```

An expected "no listener" result verifies port release.

Generate reports:

```bash
make acceptance-report
make acceptance-coverage-report
```

For review-bound work:

```bash
make quality-evidence REVIEW_RANGE=<base>...<head>
```

Scan generated evidence and logs for secret-bearing field names and inspect any
match before delivery:

```bash
artifact_root="$(
  python3 tooling/scripts/acceptance-artifact.py root
)"
rg -n -i 'password|secret|private_key|api_key|authorization|bearer|token' \
  "$artifact_root"
```

### Artifacts

- Latest Acceptance report.
- Updated project coverage report.
- Final Coverage Gap Matrix.
- Cleanup audit.
- Explicit proven, partial, unproven, and blocked scope.
- Review evidence when applicable.

Emit:

- `ACCEPTANCE_RESOURCES_RELEASED`
- `ACCEPTANCE_COVERAGE_UPDATED`

### Failure States

- `ACCEPTANCE_PROCESS_LEAK`
- `ACCEPTANCE_PORT_LEAK`
- `ACCEPTANCE_STORAGE_LEAK`
- `ACCEPTANCE_SESSION_LEAK`
- `ACCEPTANCE_SECRET_LEAK`
- `ACCEPTANCE_REPORT_INCOMPLETE`
- `ACCEPTANCE_COVERAGE_STALE`

Cleanup failure does not invalidate already observed product behavior, but it
blocks readiness and must remain a failed Acceptance engineering result.

### Exit Criteria

- Resources are released and verified.
- Reports identify exact runtime cells and source evidence.
- Proven and unproven scope match the final Gap Matrix.
- Review handoff contains no unsupported readiness claim.
