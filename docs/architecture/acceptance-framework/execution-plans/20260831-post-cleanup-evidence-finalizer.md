# Post-Cleanup Evidence Finalizer — Acceptance Infra Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-31 | **Updated**: 2026-08-31
> **Owner**: Acceptance Infrastructure
> **Branch**: `merge-desktop-prototype`
> **Parent Design**: [../design.md](../design.md)
> **Approved Decision**: D-19
> **Approval**: approved for execution on 2026-08-31

---

## 1. Goal And Claims

Implement the accepted D-19 `PostCleanupEvidenceFinalizer` as a domain-neutral
Acceptance Infra capability:

- a Gate can declare a required detached finalizer through a protected mapping
  while the Catalog supplies matching execution configuration;
- cleanup-produced artifacts are sealed into one immutable snapshot only after
  Gate exit, launch-context quiesce, Runtime Cell cleanup, Provisioner cleanup,
  launch-context close, and Infra log/artifact persistence;
- a supervised, bounded, read-only finalizer consumes the sealed snapshot and
  returns one typed outcome;
- Evidence Store is the only merge/publication authority and monotonically
  combines the primary Gate result with the finalizer outcome;
- claim admission, durability qualification, controller trust, activation,
  retry, crash recovery, and authority rotation remain fail-closed;
- canonical aggregate and per-cell results have one pure owner.

This plan proves the framework with synthetic fixtures. It does not claim
Mobile OAuth product proof, modify Mobile business injection, activate a
production Gate, or start E2-6.

## 2. Accepted Architecture Baseline

- `docs/architecture/acceptance-framework/README.md`
- `docs/architecture/acceptance-framework/design.md` §3.12 and §10
- `docs/architecture/acceptance-framework/decisions.md` D-11, D-12, D-18,
  accepted D-19
- `docs/architecture/acceptance-framework/data-model.md` §20
- `docs/architecture/acceptance-framework/integration.md` D-19 accepted target
  compatibility boundary
- `docs/architecture/acceptance-framework/module-layout.md`
- `docs/architecture/mobile/execution-plans/20260829-mobile-native-oauth-proof.md`
  D-19 handoff and E2-5 blocker

Accepted open consequence:

- If `activation-pending.json` is durable and the original kernel principal is
  permanently lost, v1 remains permanently fail-closed. No substitute
  principal, abort, supersede, rebase, or rollback path is authorized.

## 3. Scope And Responsibility Firewall

### 3.1 Acceptance Infra Scope

- Pure result/finalization contracts and canonical digest helpers.
- Generic finalizer registry and protected requirement/config validation.
- Evidence Store source capture, run requirement, artifact seal, immutable
  snapshot, invocation/finalization record, monotonic merge, authoritative
  resolution, retention, abort, and authority state.
- Native hard-deadline supervisor, isolated worker, bounded coordinator, typed
  process/wait evidence, and deterministic cleanup.
- Proof-admission inventory, epoch/job/quiescence, idempotent sink, interlock,
  activation, durability profiles, external controller journal, trust
  admission, rotation, and revocation.
- Planner, validator, runner, reporter, coverage, and gap-detector integration.
- Synthetic framework fixtures, adversarial tests, capability registration,
  documentation, and quality evidence.

### 3.2 Business Injection Scope

The following are excluded and handed to the later Mobile E2-5 amendment:

- `mobile.native.oauth-final-roles` and every concrete finalizer ID.
- Mobile Artifact Roles, relations, discriminators, payload schema, and
  validator behavior.
- Mobile protected mapping/baseline and generated registration instance.
- Device/provider/Station Fixture handlers, leases, credentials, actors, and
  product assertions.
- Production interlock installation, generation activation, and physical
  16-cell proof.

Missing business content returns:

```text
BUSINESS_INJECTION_REQUIRED
- owner domain
- missing contract slot
- expected schema/interface
- affected Domain
- impact on that Domain
- impact on Acceptance Infra: non-blocking
```

### 3.3 Non-Scope

- Compatibility readers, dual writes, re-export shims, fallback finalizers, or
  legacy-authority recovery.
- Gate-side resource reacquisition or cleanup ownership transfer.
- Secrets, raw handles, literal hosts, credentials, private keys, or endpoint
  paths in durable contracts.
- Non-POSIX hard-timeout backend.
- Dependency, protocol, package, document, or schema version bumps.
- E2-6 builds, devices, accounts, providers, services, or live OAuth runs.

## 4. Repository-Backed Current-State Inventory

| Area | Current source | Verified gap / target |
|---|---|---|
| Result algebra | `core/runtime_cell.py::CellResult`, `aggregate_matrix` | Move canonical tuple/cell/matrix algebra to new pure `core/result_contracts.py`; delete duplicate ownership |
| Run lifecycle | `core/evidence_store.py::RunHandle.finalize`, `publish_latest` | No requirement, seal, immutable snapshot, finalizer record, monotonic merge, or authoritative generation reader |
| Runner lifecycle | `acceptance-run.py` cleanup block and `finalize_gate_result` | Cleanup is ordered, but result finalizes/publishes directly after cleanup |
| D-18 launch | `core/launch_context.py` | Reuse lifecycle and process-group evidence; no finalizer ownership |
| Planner/validator | `acceptance-plan.py`, `acceptance-validate.py` | No generic required-finalizer/config consistency contract |
| Reporting | coverage/report/gap scripts | Read legacy latest/manifest status; no authoritative-resolution consumer |
| Finalizer runtime | absent | Add pure contracts, registry, coordinator, worker, and native supervisor |
| Claim admission | absent | Add epoch/job/quiescence, source closure, idempotent emission, interlock |
| Authority CLI | absent | Add isolated owner-confirmed interlock/activation/abort/trust commands |
| Durability/controller | absent | Add closed durability profiles, controller trust/store/journal, boot/pidfd evidence |
| Business finalizers | absent | Infra creates extension mechanism and synthetic fixture only |

The inventory is source-backed. Architecture-only target files must not be
reported as implemented until their workstream lands.

## 5. Requirement Traceability

| Plan requirement | Architecture source | Decision/invariant | Required evidence |
|---|---|---|---|
| Cleanup-before-finalization ordering | design §3.12; data-model §20.1 | D-07, D-18, D-19 | ordered lifecycle tests on every exit |
| One canonical result algebra | integration D-19 boundary | D-13, D-19 | source-closure scan and tuple mutation tests |
| Immutable snapshot and bounded child | design §3.12 | D-11, D-19 | digest/ref mutation and real-process timeout tests |
| Evidence Store merge authority | data-model §20.4 | D-11, D-19 | complete merge truth-table tests |
| Claim-admission interlock | design §3.12 | D-19 | epoch/quiescence/adversarial reader tests |
| Durable authority transitions | data-model §20.3 | D-19 | crash-boundary and lost-ACK fixtures |
| No business injection in Infra | design §4.11 | D-12 | boundary scan and synthetic-only self-proof |
| Principal-loss fail-closed | decisions D-19 | accepted consequence | exact pending/principal-loss rejection test |

## 6. Dependency DAG

```text
D19-W1 Pure contracts/result algebra ─┬─> D19-W3 Evidence Store lifecycle
D19-W2 Generic registration/schema ──┘
          │                              │
          ├────────> D19-W4 Supervisor/worker runtime
          │                              │
          └────────> D19-W5-SRC Durability/controller trust source
                                         │
D19-W3 + W4 + W5-SRC ───────────────> D19-W6-A Qualification CLI subset
                                         │
D19-W6-A ────────────────────────────> D19-W5-Q1 External qualification
                                         │
D19-W5-Q1 ───────────────────────────> D19-W6-B Final proof-admission/authority source
                                         │
D19-W6-B ────────────────────────────> D19-W5-Q2 Final-source requalification
                                         │
D19-W5-Q2 + W6-B ───────────────────> D19-W6 complete
                                         │
D19-W1..W6 ─────────────────────────> D19-W7 Runner/tooling atomic cutover
                                         │
D19-W7 ─────────────────────────────> D19-W8 Synthetic self-validation and source closure
                                         │
D19-W8 ─────────────────────────────> Plan completion audit
```

Parallelism:

- W1 and W2 may run in parallel with non-overlapping ownership.
- W4 and W5-SRC may run in parallel after their W1/W2 contract prerequisites.
- W3 owns all Evidence Store mutations; W6 consumes only public APIs.
- W6-A contains only the qualification-capable authority CLI subset needed to
  execute W5-Q1; it does not close W6.
- W6-B lands the remaining proof-admission and authority source. W5-Q2 must
  rerun both Linux and Darwin qualification against the exact W6-B commit
  before W6 can close. W5-Q1 cannot substitute for W5-Q2.
- W7 is the sole integrator for `acceptance-run.py`.

## 7. Execution Workstreams

### D19-W1: Pure Result And Finalization Contracts

Deliver:

- Add `tooling/acceptance/core/result_contracts.py` as the only owner of
  `CanonicalResultTuple`, `PlatformCellResult`, `PlatformMatrixResult`, and
  deterministic fold semantics.
- Add `tooling/acceptance/core/finalization_contracts.py` for closed D-19
  schemas, typed errors, digest domains, ArtifactRef projections, maintenance
  requests/results, and merge truth table.
- Migrate aggregate and every nested Runtime Cell result atomically.
- Keep both modules pure: no filesystem, Evidence Store, business contract, or
  runtime dependency.

Targets:

- Add the two Core modules and focused tests.
- Modify `core/runtime_cell.py`, `core/__init__.py`, and direct consumers.

Deletion obligations:

- Delete `CellResult`/matrix ownership from `runtime_cell.py`.
- No compatibility re-export or second status tuple remains.

Gate:

```bash
python3 -m unittest tooling.acceptance.tests.test_result_contracts
python3 -m unittest tooling.acceptance.tests.test_runtime_cell
rg -n "class CellResult|def aggregate_matrix" tooling/acceptance/core
```

### D19-W2: Generic Registration And Protected Requirement Contract

Deliver:

- Add domain-neutral finalizer registration schema/resolver under
  `tooling/acceptance/finalizers/`.
- Add generic protected requirement/baseline schemas and deterministic source
  capture rules without concrete Mobile instances.
- Extend Capability/Catalog validation so required mapping and execution config
  match exactly by Gate/finalizer identity.
- Reject dynamic argv, optional required finalizers, unknown IDs, path escape,
  stale source, conflicting registration, or component digest mismatch.

Targets:

- Add `finalizers/registry.py` and synthetic fixture registration.
- Modify planner/validator schemas and tests.

Business handoff:

- Concrete Mobile mapping, registry instance, protected baseline, schema, and
  validator remain `BUSINESS_INJECTION_REQUIRED`.

Gate:

```bash
python3 tooling/scripts/acceptance-plan-test.py
python3 tooling/scripts/acceptance-validate-test.py
python3 tooling/scripts/acceptance-infra-boundary-test.py
```

### D19-W3: Evidence Store Finalization And Authoritative Reader

Deliver:

- Add immutable preflight source capture, requirement record, seal marker,
  read-only snapshot materialization, invocation reservation, finalization
  record, monotonic merge, and authoritative latest resolution.
- Add fixed finalizer-enforcement, claim-admission, durability, trust,
  authority-runtime, abort, and generation namespaces.
- Implement atomic no-replace/replace boundaries, directory durability,
  lost-ACK equal-byte retry, typed refs, quotas, cleanup protection, and
  retention rules.
- Add maintenance APIs for interlock, activation, abort, tombstone, and bounded
  deletion while keeping Evidence Store the sole mutation owner.
- Preserve legacy behavior only before interlock. After interlock/pending,
  authoritative readers fail closed and never fall back.

Targets:

- Modify `core/evidence_store.py`.
- Add focused store/reader/maintenance tests.

Gate:

```bash
python3 -m unittest tooling.acceptance.tests.test_evidence_store
python3 -m unittest tooling.acceptance.tests.test_evidence_finalization_store
```

### D19-W4: Isolated Supervisor, Worker, And Coordinator

Deliver:

- Add `finalization_supervisor.c`, isolated `finalizer_worker.py`, and
  `evidence_finalization.py`.
- Implement source/runtime capture, fixed worker kinds, wire framing, descriptor
  ownership, bounded files/bytes/time, default-signal verification, hard
  timeout, process-group termination, consuming waits, and supervisor close.
- Materialize the snapshot after all cleanup/Infra writes and invoke exactly one
  detached read-only finalizer before Evidence Store finalization.
- Convert every failure to a typed fail-closed result without swallowing cleanup
  failures or exposing secrets.

Gate:

```bash
python3 -m unittest tooling.acceptance.tests.test_finalization_supervisor
python3 -m unittest tooling.acceptance.tests.test_evidence_finalization
```

Required real-process cases:

- success, nonzero, malformed output, timeout, cancellation, runner EOF,
  default signal disposition/mask restoration verification, signal-mask
  mutation rejection, descendant attempt, descriptor leak, and close failure.

### D19-W5: Durability And External Power-Controller Trust

#### D19-W5-SRC: Source Closure

Deliver:

- Add `power_controller.py` with OS-closed host/store identities, qualified
  durability profiles, runtime epoch/lease, command journal, one-shot dispatch,
  rotation/revocation, and in-process actuator ownership.
- Add P-256 qualification-only witness and structurally disjoint Ed25519
  production controller contracts.
- Add expectation-before-mutation, boot observations, physical/VM
  interruption, signed recovery authority, pidfd capability, and Darwin
  full-sync evidence.
- Add predecessor-keyed trust transition reservations and immutable generation
  history.
- Add `trust_admission.py` read-only mediator and command-bound,
  non-serializable `TrustDispatchLease`.

Targets:

- Add Core modules and synthetic controller/durability fixtures.
- Do not accept private keys through repo files, env, network, or Evidence
  Store.

Gate:

```bash
python3 -m unittest tooling.acceptance.tests.test_power_controller
python3 -m unittest tooling.acceptance.tests.test_durability_profiles
python3 -m unittest tooling.acceptance.tests.test_trust_admission
```

Mandatory external evidence:

- Independently powered controller and interrupted target environments.
- Linux file/directory durability cell and Darwin APFS full-sync/anchor cell.
- Real physical power cut or external VM hard-off at every declared boundary.
- Stable controller volume, lock backend, boot observation, signed witness
  recovery, trust generation, and command journal evidence.
- Owner-authorized public-key input and local TTY confirmation; private keys
  never enter repository, environment, network, or Evidence Store paths.

If any prerequisite is unavailable, W5 and final Infra readiness remain
`BLOCKED/UNPROVEN`. A simulated interruption, process kill, graceful shutdown,
mock controller, or reused target/controller environment cannot substitute.

#### D19-W5-Q1 / D19-W5-Q2: Qualification Sequence

- `W5-Q1` runs after `W6-A` and binds its Linux/Darwin evidence to the exact
  qualification-CLI source commit.
- `W5-Q2` runs after `W6-B` and repeats the complete mandatory Linux/Darwin
  qualification against the exact final W6 source commit.
- Any W6-B or later review fix that changes source, runtime, contract closure,
  controller identity, trust generation, or durability profile invalidates the
  affected evidence and requires W5-Q2 again.
- W5 closes only when W5-SRC and W5-Q2 pass.

### D19-W6: Proof Admission And Authority Commands

#### D19-W6-A: Qualification CLI Subset

Deliver only the isolated authority-CLI commands and source loading required
for controller bootstrap, candidate/run-bound qualification-witness
authorization, qualification, and promotion. Commit and review this subset
before W5-Q1. It does not authorize W6 completion.

#### D19-W6-B: Final Source Closure

Deliver:

- Add `proof_admission.py` with source inventory/classification, restricted
  emitter runtime, epoch/job/completion, Linux PID namespace and Darwin reboot
  fencing, immutable emission intent/ack, idempotent sink, pause, and
  quiescence.
- Add `authority_cli_bootstrap.py` with isolated source loading, clean-HEAD,
  accepted D-19 document, kernel principal, controlling TTY, challenge, impact
  inventory, interlock/activation/abort/trust commands, and complete typed
  maintenance results.
- Persist authority runtime before any authority mutation.
- Preserve accepted principal-loss behavior: pending stays permanently
  fail-closed when the original principal is unavailable.

Dependencies: W3, W4, W5.

Dependency refinement:

- W6-A depends on W3, W4, and W5-SRC.
- W6-B depends on W5-Q1.
- W6 completion depends on W6-B and W5-Q2.

Gate:

```bash
python3 -m unittest tooling.acceptance.tests.test_proof_admission
python3 -m unittest tooling.acceptance.tests.test_authority_cli_bootstrap
```

### D19-W7: Runner And Tooling Atomic Cutover

Deliver:

- Integrate the exact lifecycle:

```text
Gate exits
-> launch-context quiesce
-> Runtime Cell cleanup
-> Provisioner cleanup
-> launch-context close
-> cleanup/log/Infra artifacts
-> secret audit
-> seal
-> finalizer invocation
-> supervisor close
-> Evidence Store monotonic merge/finalize/publish
```

- Extend plan/validate/run/report/coverage/gap tools to consume
  `AuthoritativeLatestResolution`.
- Migrate Runtime Cell aggregate/nested projections to W1 contracts.
- Preserve Gates without a required finalizer.
- For a finalizer-required Gate, delete the old direct-finalize path in the same
  cutover. No dual read/write or compatibility mode survives.

Sole integration owner:

- `tooling/scripts/acceptance-run.py`

Gate:

```bash
python3 tooling/scripts/acceptance-run-test.py
python3 tooling/scripts/acceptance-plan-test.py
python3 tooling/scripts/acceptance-validate-test.py
python3 tooling/scripts/acceptance-gap-detect-test.py
python3 tooling/scripts/acceptance-coverage-report-test.py
```

### D19-W8: Synthetic Self-Validation, Docs, And Source Closure

Deliver:

- Register only domain-neutral synthetic capability/Gate/environment fixtures.
- Cover every architecture quality gate in `design.md` §10.1, including
  mutation, crash, lost-ACK, ordering, isolation, durability, trust, timeout,
  cancellation, overload, and principal-loss behavior.
- Add source-closure checks proving no duplicate result algebra, finalizer
  mapping, Evidence Store resolver, authority reader, or business injection.
- Update Acceptance docs, README, Make targets, review routing, and operational
  knowledge exposed by implementation.
- Emit business gaps separately without modifying Mobile files.

Final deterministic gate:

```bash
python3 tooling/scripts/acceptance-infra-boundary-test.py
python3 tooling/scripts/quality-evidence-test.py
python3 tooling/scripts/acceptance-validate-test.py
tooling/scripts/review/skill-check.sh
make acceptance-infra-validate
make acceptance-plan-self
git diff --check -- \
  AGENTS.md \
  docs/architecture/acceptance-framework \
  docs/knowledge \
  tooling/acceptance \
  tooling/scripts \
  tooling/skills
```

## 8. Atomic Cutover And Deletion Matrix

| Replaced concern | New owner | Cutover condition | Required deletion/search |
|---|---|---|---|
| Runtime Cell result algebra | `core/result_contracts.py` | All consumers compile/tests pass in one change | No tuple/fold definition outside owner |
| Required finalizer contract | protected mapping + generated registry | validator exact-match gate passes | No caller-supplied dynamic registration |
| Direct post-cleanup finalize | D-19 runner lifecycle | finalizer-required synthetic Gate passes every exit path | No direct finalize before finalization record |
| Raw manifest/latest claims | authoritative resolution reader | interlock and reader tests pass | No project-owned claim consumer reads raw latest/manifest |
| In-process business validator | detached finalizer runtime | supervised process gates pass | No business validator import in Core/runner |
| Unqualified authority writes | isolated authority CLI + maintenance APIs | authority/durability gates pass | No private mutation call outside Evidence Store |
| Mutable trust selection | reservation/generation/CAS current | crash/rotation/revocation gates pass | No sibling/rollback/scan-based recovery |

Rollback is source/deployment rollback before operational activation. After an
activation pending record is durable, rollback/rebase is forbidden by accepted
D-19.

## 9. End-To-End Lifecycle Coverage

| Lifecycle step | Owner workstream | Evidence |
|---|---|---|
| Plan and validate injection | W2, W7 | invalid/mismatch matrix |
| Allocate run and freeze source | W3 | requirement/source-capture tests |
| Execute Gate and cleanup | existing D-18 + W7 | ordered exit-path tests |
| Seal and materialize snapshot | W3, W4 | immutable ref/digest mutations |
| Invoke bounded finalizer | W4 | real-process lifecycle evidence |
| Merge and publish | W3, W7 | truth-table and authoritative reader tests |
| Restart/retry | W3, W5, W6 | crash/lost-ACK fixtures |
| Rotate/revoke trust | W5 | reservation/generation/CAS tests |
| Abort sealed run | W3, W6 | authorization/tombstone/delete chain |
| Business injection | later Mobile E2-5 | `BUSINESS_INJECTION_REQUIRED` |

No lifecycle step is assigned to a business module inside this plan.

## 10. Acceptance Scenarios

### AS-D19-01: Cleanup-produced evidence closes a synthetic run

- **Precondition**: Synthetic Gate declares one protected finalizer and produces
  one cleanup artifact.
- **Action**: Acceptance operator runs the Gate.
- **Expected**: Cleanup completes, snapshot seals, detached finalizer returns a
  typed outcome, and authoritative latest reports the monotonic merged tuple.
- **Failure variant**: Missing cleanup artifact remains `PARTIAL/UNPROVEN`.
- **Evidence**: run manifest, finalization record, authoritative resolution.
- **Status**: pending

### AS-D19-02: Invalid or missing injection fails before allocation

- **Precondition**: Requirement/config/registry identity is missing, stale, or
  conflicting.
- **Action**: Operator plans or starts the synthetic Gate.
- **Expected**: Typed rejection; no run, credential, or resource allocation.
- **Failure variant**: Concrete business content is reported as
  `BUSINESS_INJECTION_REQUIRED`, not repaired by Infra.
- **Evidence**: planner/validator output and absent run directory.
- **Status**: pending

### AS-D19-03: Finalizer timeout, crash, and cancellation are bounded

- **Precondition**: Synthetic finalizers hang, exit nonzero, emit malformed
  output, ignore TERM, or lose the parent channel.
- **Action**: Operator runs each fixture.
- **Expected**: Worker group is killed/reaped, supervisor closes, run remains
  fail-closed, and no descendant or lock survives.
- **Failure variant**: Reap/close uncertainty blocks publication.
- **Evidence**: typed wait evidence and process-lifecycle report.
- **Status**: pending

### AS-D19-04: Network and direct-output bypass are impossible

- **Precondition**: Synthetic finalizer attempts network, raw stdout/file sink,
  dynamic import, native extension, or child process.
- **Action**: Operator runs source/runtime admission.
- **Expected**: Admission rejects before authoritative emission.
- **Failure variant**: Unsupported parser/runtime remains `UNPROVEN`.
- **Evidence**: source graph, restricted-runtime rejection, no sink receipt.
- **Status**: pending

### AS-D19-05: Crash recovery preserves one immutable transition

- **Precondition**: Crash fixture interrupts expectation, intent, manifest,
  trust generation, current pointer, or emission acknowledgement boundaries.
- **Action**: Operator restarts the same frozen operation.
- **Expected**: Equal-byte retry completes once or fails closed; no sibling,
  rollback, replay, or second side effect.
- **Failure variant**: Conflicting bytes are permanently rejected.
- **Evidence**: typed before/interruption/after/recovery chain.
- **Status**: pending

### AS-D19-06: Revocation fences a live irreversible dispatch

- **Precondition**: A command reaches `EXECUTION_STARTED`.
- **Action**: Revocation races `EXECUTE_POWER_ACTION`.
- **Expected**: Shared/exclusive trust admission serializes the operations;
  dispatch either completes under the exact ACTIVE generation or observes
  REVOKED and does not invoke the actuator.
- **Failure variant**: Lease/request/head mismatch rejects dispatch.
- **Evidence**: command-bound `TrustDispatchLease`, journal, current generation.
- **Status**: pending

### AS-D19-07: Original principal is permanently unavailable

- **Precondition**: Activation pending is durable and the authorizing principal
  is removed.
- **Action**: Another principal attempts recovery, abort, or supersession.
- **Expected**: Every attempt fails; readers and new runs remain fail-closed.
- **Failure variant**: None; permanent unavailability is the accepted v1
  consequence.
- **Evidence**: authority result and unchanged frozen pending bytes.
- **Status**: pending

### AS-D19-08: Product injection is absent

- **Precondition**: Generic Infra is complete; Mobile finalizer/mapping is not
  installed.
- **Action**: Infra readiness gate runs.
- **Expected**: Infra self-validation passes; Mobile reports
  `BUSINESS_INJECTION_REQUIRED` and remains blocked.
- **Failure variant**: Infra must not manufacture Mobile roles or mark product
  proof complete.
- **Evidence**: separated Infra readiness and business gap report.
- **Status**: pending

## 11. Implementation Status

| Workstream | Status | Evidence |
|---|---|---|
| D19-W1 Pure contracts/result algebra | in progress | canonical result algebra, requirement/config/registry/baseline foundations, and the first C3c durability slice pass; remaining §20 closed schemas are pending |
| D19-W2 Generic registration/schema | complete | registry, protected baseline, planner, validator, boundary, and coverage focused tests pass |
| D19-W3 Evidence Store lifecycle | pending | not run |
| D19-W4 Supervisor/worker runtime | pending | not run |
| D19-W5 Durability/controller trust | pending | W5-SRC and both external qualification epochs remain unproven |
| D19-W6 Proof admission/authority | pending | W6-A qualification CLI subset and W6-B final source are not run |
| D19-W7 Runner/tooling cutover | pending | not run |
| D19-W8 Synthetic self-validation | pending | not run |

Current W1 sub-closures:

- `W1-A` complete: canonical six-tuple algebra, platform cell/matrix contracts,
  deterministic fold, digest, closed decoders, Runtime Cell ownership cutover,
  and direct consumer migration.
- `W1-B` complete: pure finalizer ID/path/hash/JCS helpers plus requirement,
  execution config, registry entry, and protected baseline contracts.
- `W1-C1` complete: ArtifactRef projection, canonical opaque JSON, sealed
  snapshot, primary result/source trace, child/Core outcomes, finalization
  record branches, closed failure enums, and monotonic merge.
- `W1-C2` complete: executable/runtime identity plus context,
  invocation/input/seal/preflight contracts.
- `W1-C3a` complete: latest/authoritative resolution, enforcement selectors,
  abort preflight, and dependency-free authority contract prefix.
- `W1-C3b` complete: proof-admission source/runtime/epoch/job/quiescence and
  idempotent emission closed contracts.
- `W1-C3c` partial: stable-volume/sync-anchor identities, qualified/live
  environment observations, artifact refs, crash cases, and the closed crash
  fixture manifest, Darwin/Linux qualification/profile boot observations,
  observation-to-qualified-environment equality validator, and durable
  execution-start records pass. Preflight supervisor-build, stdlib-module,
  loaded-runtime-image, and captured-runtime-file identities required by the
  probe runtime also pass. The accepted artifact-ref wire shape and durability
  digest separators are covered by negative and fixed-domain tests; independent
  boot-contract re-audit returned PASS. Typed stored-byte/schema resolution,
  preflight platform/runtime measurement, expectation records, probe runtime,
  power-controller, trust, receipt, journal, and dispatch contracts remain
  pending.
- `W1-C3d` pending: remaining enforcement/activation/authority/abort and
  maintenance request/result unions after C3b/C3c types exist.

Current evidence:

```text
96 result/finalization/runtime/registry tests PASS
15 acceptance-plan tests PASS
14 acceptance-validate tests PASS
15 acceptance-coverage-report tests PASS
8 acceptance-infra-boundary tests PASS
py_compile PASS
owned-file git diff --check PASS
legacy CellProofState/CellResult/aggregate_matrix ownership scan PASS
```

Unified native Goal G0 status:

- `G0-MOBILE-BASELINE` commit `588e8414125b05b28fb5fc734b3fc30d8f6773e1`
  failed its independent commit-review gate with three P1 findings. The source
  remediation was implemented and locally verified. Its r4 replacement freeze
  review found five additional P1 defects in freeze authority, evidence-run
  binding, parent-only Harness routing, nested response validation, and
  process-group extinction proof. Those source defects are being remediated;
  an authoritative r5 pack, source epoch, commit, and two fresh commit reviews
  remain pending.
- `G0 inventory` complete: 62 tracked modifications and 21 untracked paths
  were classified as prior governance, D-18 generic launch context,
  Mobile/D-18 business injection, D-19, mixed, generated evidence, or unrelated.
- The D-19-only checkpoint contains 11 whole-file paths; 15 shared files require
  hunk-level separation before any checkpoint commit.
- The W5/W6 dependency refinement in §6 and §7 passed independent pre-commit
  review with `0 P0 / 0 P1`.
- Mobile status copies now consistently record accepted D-19 architecture and
  plan, active Infra execution, blocked E2-5, and
  `E2-6 = UNPROVEN / NOT STARTED`.
- Commit/index mutation remains pending explicit Owner authorization.

## 12. Risks, Non-Claims, And Escalation

- The accepted design is intentionally large; workstreams must land in DAG
  order and may not weaken contracts to reduce implementation scope.
- Any required dual path, compatibility period, mutable finalized run, second
  authority, Gate-side reacquisition, or business-specific Core branch returns
  `DESIGN_AMENDMENT_REQUIRED`.
- Absence of external controller hardware/VM, Darwin/Linux qualification, or
  Mobile injection does not block early framework code review. External
  controller and Darwin/Linux qualification do block W5 and plan completion;
  absent Mobile injection remains a separate non-blocking business gap.
- Mobile macOS/Windows product proof and E2-6 remain out of scope; Darwin/Linux
  Infra durability qualification remains in scope.
- No implementation work begins until this plan passes independent review and
  receives Owner approval.

## 13. Final Readiness Gate

Return `PLAN_READY_FOR_EXECUTION` only after an independent reviewer confirms:

- every workstream traces to accepted D-19;
- dependencies and sole integration owners are coherent;
- Infra/business scope is separated;
- every replacement has an atomic deletion closure;
- every workstream has deterministic tests and evidence;
- the eight acceptance scenarios cover success, invalid input, timeout,
  cancellation, bypass, restart, revocation, and missing business injection;
- no plan item redesigns or weakens D-19.

Plan completion later requires W1–W8 gates passing, source closure clean, all
synthetic scenarios evidenced, no unresolved Infra P0/P1, and business gaps
reported separately. W5 additionally requires real external Linux/Darwin
durability evidence with no simulation. It does not claim Mobile E2-5 or E2-6
completion.

## 14. Independent Plan Review

The independent plan review on 2026-08-31 returned `PASS` with `0 P0 / 0 P1`
and three P2 documentation improvements. This revision incorporates all three:

- W4 separates successful default signal disposition/mask restoration from
  signal-mask mutation rejection.
- W7 places secret audit after cleanup/log/Infra artifact persistence and before
  seal.
- W8 includes `docs/knowledge/` in the final diff check when implementation
  adds or updates operational knowledge.

The review's final sentence incorrectly named already-complete
`W2-E2-FREEZE / E2-0A` as the execution target. The valid dependency-ready
frontier is D19-W1 and D19-W2 in parallel. Reviewer PASS does not replace Owner
execution approval. The Owner approved execution on 2026-08-31.
