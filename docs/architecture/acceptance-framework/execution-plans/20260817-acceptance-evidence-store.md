# Acceptance Evidence Store — Execution Plan

> **Status**: approved
> **Version**: v1.0
> **Created**: 2026-08-17 | **Updated**: 2026-08-17
> **Owner**: Acceptance Core Evidence Store
> **Branch**: `design/acceptance-runtime-provisioning-contract`
> **Decision**: D-11

## Context Anchor

| Field | Current value |
|---|---|
| Main task | Move Acceptance runtime evidence out of the repository source tree |
| Plan source | `docs/architecture/acceptance-framework/execution-plans/20260817-acceptance-evidence-store.md` |
| Tracking source | This plan §10 Acceptance Scenarios and §13 Status |
| Worktree | `<repo-root>` |
| Branch | `design/acceptance-runtime-provisioning-contract` |
| Stage | `EXECUTE` |
| Current workstream | `ES-W4: Standalone And Domain Writer Cutover` |
| Current step | Migrate remaining standalone writers and cross-Gate readers to logical artifact roles |
| Progress | 7/8 workstreams evidence-complete; ES-W8 delivery remains blocked; Chat G15 remains out of scope and `FAILED/UNPROVEN` |
| Last completed | ES-W7 failure/isolation matrix; 28/28 Evidence Store tests and zero source-tree fallback |
| Current action | Commit the Acceptance-only migration and update Draft PR #91 with exact evidence/non-claims |
| Next action | Re-run quality/review on the committed range and resolve or waive the four product-owned Chat Native Gate gaps |
| Blockers | AS-ES-09 is `BLOCKED/UNPROVEN` by Station/source commit mismatch; Gap Detector also requires four Chat Native product Gates that this Acceptance-only change does not claim |
| Decisions required | Product/owner waiver or future product-owned proof is required before the Gap Detector can permit ready-to-merge |
| Evidence | `test_evidence_store.py`: PASS 28/28; Core/Provisioning: PASS 115/115; Desktop scripts: PASS 177/177; CI bundle: PASS 3/3; skill-check: PASS; external plan/validate/coverage/report chain: PASS; representative env Gate: `BLOCKED/UNPROVEN`; Chat G15: `FAILED/UNPROVEN` |
| Last updated | 2026-08-17 14:25 CST |

---

## 1. Goal And Claim

Move every runtime-generated Acceptance artifact outside the repository and make
one canonical Evidence Store responsible for root resolution, run isolation,
typed references, durable writes, atomic latest pointers, readers, retention,
and cleanup.

The plan claims only Acceptance infrastructure behavior. It does not claim that
the failed G15 Chat journey passed. G15 remains `FAILED/UNPROVEN` until its
product assertion passes in a future product-owned change.

## 2. Architecture Sources

- `docs/architecture/acceptance-framework/README.md`
- `docs/architecture/acceptance-framework/design.md` §3.9, §4.10, §7
- `docs/architecture/acceptance-framework/decisions.md` D-11
- `docs/architecture/acceptance-framework/data-model.md` §9-§14
- `docs/architecture/acceptance-framework/integration.md` §1.4
- `docs/architecture/acceptance-framework/module-layout.md`

Accepted invariants:

- Runtime writers never write under the repo root, `tooling/`, `docs/`, or
  `.git/`.
- No dual-write, symlink compatibility, fallback, or legacy resolver.
- Run manifests are immutable and primary; `latest.json` is only an atomic
  pointer.
- Permission, disk, root, traversal, symlink, conflict, and interrupted-write
  failures are typed and fail closed.
- Cleanup never deletes an active run or current latest target.
- Product proof semantics and redaction do not change.

## 3. Scope

In scope:

- Canonical artifact-root resolver and platform defaults.
- Workspace, Gate, and run identity.
- Run allocation, active locking, atomic writes, manifest finalization, latest
  publication, readers, and cleanup.
- AcceptanceGate, EvidenceReport, Provisioner, Fixture, Attestation, plan/run,
  validators, coverage, quality, report tools, standalone Gate/report
  generators, Make targets, skills, CI, and docs.
- Logical ArtifactRef migration.
- Tracked report classification and old owner deletion.
- Local, failure, concurrency, read-only-repository, and one
  environment-backed representative Gate.

Non-scope:

- Chat DELIVERED product implementation.
- Changing Gate IDs, product assertions, proof thresholds, or runtime tiers.
- Moving reviewed long-lived source evidence out of
  `tooling/acceptance/evidence/`.
- A remote/shared artifact service, upload API, or cross-machine synchronization.
- Automatic default retention deletion.

## 4. Current-State Inventory

Repository scan on 2026-08-17 found 96 unique files and 366 references to
source-tree report paths or legacy path constants.

| Class | File count | Current assets |
|---|---:|---|
| Core | 6 | `_paths.py`, evidence, gate, attestation, provisioner, exports |
| Contracts | 7 | Domain profiles, capability truth sources, feature source paths |
| Gates/Fixtures/Tests | 9 | Native runner/validator, actor Fixture, runtime tests |
| Scripts | 47 | plan/run/validate/report/coverage/quality plus performance and domain report generators |
| Make/Skills | 5 | acceptance.mk, submit pipeline, Acceptance/Gap/Quality/PR skills |
| Docs | 18 | Acceptance, Quality, Messaging, Performance, Federation historical contracts |
| CI/Templates | 2 | review workflow and PR template |

Tracked runtime reports:

- `tooling/acceptance/reports/chat-mls-three-station-convergence.json`
- `tooling/acceptance/reports/d13-c5-atomic-mls-fault-matrix.json`
- `tooling/acceptance/reports/testnet-p5-federation-e2e.json`

They are historical runtime outputs, not deterministic test fixtures. Delete
them from the runtime owner and retain only their historical claims in existing
reviewed architecture/context documents. They must not be imported as current
product proof.

Intentional fixtures:

- Existing tests use temporary directories and inline payloads.
- Any reusable deterministic artifact fixture created by this migration belongs
  under `tooling/acceptance/tests/fixtures/`.

## 5. Traceability

| Requirement | Architecture | Workstream | Evidence |
|---|---|---|---|
| Platform root/default/override | D-11, data model §9 | ES-W1 | resolver unit matrix |
| Workspace/Gate/run isolation | design §3.9 | ES-W1 | identity and concurrency tests |
| Atomic artifacts/manifest/latest | data model §11-§13 | ES-W1 | interruption tests |
| Typed fail-closed errors | data model §14 | ES-W1/ES-W5 | permission/disk/path tests |
| Core runtime migration | integration §1.4 | ES-W2 | core/provisioning tests |
| Reader/validator/report migration | integration §1.4 | ES-W3 | report/coverage/quality tests |
| Standalone writer migration | integration §1.4 | ES-W4 | inventory and focused tests |
| Contracts/Make/skills/CI migration | integration §1.4 | ES-W5 | structural validation |
| Old owner hard deletion | D-11 | ES-W6 | zero-write/reference scan |
| Read-only repo and env Gate | design §7 | ES-W7 | runtime evidence |

## 6. Dependency Graph

```text
ES-W1 Evidence Store substrate
   ├──> ES-W2 Core runtime writers
   ├──> ES-W3 Readers/validators/reports
   ├──> ES-W4 Standalone/domain writers
   └──> ES-W5 Contracts/Make/skills/CI
            │
ES-W2 ──────┤
ES-W3 ──────┤
ES-W4 ──────┼──> C1 atomic ownership cutover + ES-W6 old owner deletion
ES-W5 ──────┘
                              │
                              ├──> ES-W7 failure/concurrency/read-only gates
                              └──> ES-W8 representative env Gate + final audit
```

ES-W2 through ES-W5 may be edited in parallel after ES-W1 API is stable. None
may be marked done or delivered independently. C1 is the only ownership
cutover.

## 7. Workstreams

### ES-W1: Canonical Evidence Store

Responsibility:

- Implement `core/evidence_store.py`.
- Keep repository/config paths in `_paths.py`; remove runtime artifact paths
  only at C1.
- Add typed errors and exports.

Deliverables:

- Platform default/override resolver.
- Canonical workspace ID, Gate slug, collision-resistant run ID.
- ArtifactRef validation and content hashes.
- RunHandle with active lock and owner-only permissions.
- Atomic streaming writes, immutable paths, manifest finalize.
- Gate publish lock and monotonic atomic latest.
- Reader and explicit cleanup.

Failure behavior:

- Every D-11 typed error maps without repo fallback.
- Cancellation leaves latest unchanged and an inactive incomplete run.

Tests:

- macOS/Linux/Windows defaults and missing platform prerequisites.
- Override, CI-required override, repo-root rejection, malformed root.
- Traversal, absolute child, backslash, drive prefix, symlink escape.
- Same-path idempotency/conflict, run collision, manifest/hash validation.
- Interrupted write/latest and active cleanup protection.

Definition of done:

- Unit tests pass with temporary roots.
- Substrate is not yet a second active runtime owner.

### ES-W2: Core Runtime Writer Cutover

Responsibility:

- Migrate AcceptanceGate, EvidenceReport, Provisioner, Attestation, Fixture,
  environment provisioners, acceptance-run logs/manifests/run reports, and
  Native runners.

Deliverables:

- One orchestrator RunHandle per Gate execution.
- Child artifacts use run-relative roles and ArtifactRefs.
- Artifact-root creation failure is emitted to stderr and returns non-zero;
  no report fallback is attempted.
- Secret redaction occurs before durable write.

Tests:

- Existing core/provisioning/owner/runner tests use explicit temporary roots.
- Product Gate failure and evidence-write failure remain distinct.

Deletion obligation:

- No Core runtime import of legacy REPORTS_DIR/EVIDENCE_DIR/MANIFESTS_DIR after
  C1.

### ES-W3: Reader, Validator, Coverage, Report, And Quality Cutover

Responsibility:

- Migrate plan, run, validate, capability report, coverage report, Acceptance
  report, Gap Detector, quality evidence, and submit pipeline readers/writers.

Deliverables:

- Defaults resolve logical latest/run identities through EvidenceReader.
- Explicit CLI paths remain only for temporary/test fixtures.
- Domain validation and coverage consume logical report Gate IDs.
- Quality/review output prints resolved artifact references, not stale repo
  paths.

Tests:

- Existing script suites pass with isolated artifact roots.
- Malformed/missing latest is explicit `UNPROVEN` or typed evidence failure.
- Coverage and quality consume a new-store run.

### ES-W4: Standalone And Domain Writer Cutover

Responsibility:

- Migrate every remaining script/Gate that defaults to
  `tooling/acceptance/reports`, including Desktop performance/telemetry,
  Federation, Messaging baseline, Agent parity, and shell writers.

Deliverables:

- Shared small CLI helper maps logical output role to current RunHandle.
- No script defines its own root/default resolver.
- Tests that need physical paths inject temp paths explicitly.

Inventory gate:

```bash
rg -n 'tooling/acceptance/reports|REPORTS_DIR|EVIDENCE_DIR|MANIFESTS_DIR' \
  tooling --glob '!tooling/acceptance/tests/fixtures/**'
```

Only historical documentation strings or explicit migration rejection tests
may remain. Runtime write callsites must be zero.

### ES-W5: Contracts, Make, CI, Skills, And Operational Docs

Responsibility:

- Replace Domain profile `report` fields and Capability report truth sources
  with logical Gate/report identities.
- Update `tooling/acceptance/README.md`, Make targets, PR template, review
  workflow, quality docs, and operational skills.
- Update `pt-acceptance-engineering` and `pt-dev-runtime-handoff`.

Deliverables:

- `PT_ACCEPTANCE_ARTIFACT_ROOT` documented as optional locally and mandatory in
  CI.
- Stable Make target names remain unchanged.
- Commands to locate latest artifacts use a canonical CLI/API.
- Operational procedures scan the resolved artifact root for secrets.
- Historical architecture plans remain historical; active procedures no longer
  instruct source-tree writes.

Tests:

- Acceptance self-plan and structural validation.
- CI workflow points artifact collection at its override root.

### ES-W6: Atomic Ownership Cutover And Old Owner Deletion

C1 cutover condition:

- ES-W2 through ES-W5 consumer inventory is complete.
- All focused tests pass against the new store.
- One tree-wide scan confirms no runtime writer remains.

Atomic actions:

- Activate Evidence Store defaults for every production entrypoint.
- Delete legacy runtime path constants.
- Delete `tooling/acceptance/reports/.gitignore` and the reports runtime owner.
- Delete the three tracked historical runtime report files.
- Do not create symlink, compatibility wrapper, dual-write, or fallback.

Rollback:

- Git revert/deployment rollback only.

Gate:

- Repository tree contains no `tooling/acceptance/reports` directory.
- Runtime execution creates no source-tree files.

### ES-W7: Failure, Isolation, And Lifecycle Verification

Required scenarios:

- Two concurrent Gates have distinct run directories and no overwrite.
- Newer completion remains latest when an older run publishes later.
- Read-only repository with writable artifact root emits and validates.
- Unwritable root fails typed and creates no repo artifact.
- Disk-full/quota simulation fails typed.
- Interrupted artifact/manifest/latest preserves previous durable pointer.
- Traversal and symlink escape reject.
- Active run survives cleanup; closed non-latest run is eligible only under an
  explicit policy.
- Secret canary has zero raw matches.

### ES-W8: End-To-End And Delivery

Commands:

```bash
make acceptance-plan-self
make acceptance-validate
make acceptance-coverage-report
python3 tooling/scripts/acceptance-run-test.py
python3 tooling/scripts/acceptance-plan-test.py
python3 tooling/scripts/acceptance-gap-detect-test.py
python3 tooling/scripts/quality-evidence-test.py
make acceptance-run-ci
make acceptance-run-local-evidence
```

Environment-backed representative Gate:

- Rerun one declared environment Gate with the exact source and override root.
- Evidence emission/validation must pass independently of its product result.
- If G15 is selected, its Chat assertion may remain `FAILED/UNPROVEN`; the
  Evidence Store claim passes only if the failed product result is durably
  emitted, validated, and source-bound outside the repo.

Final delivery:

- Run Gap Detector, Quality Evidence, Completion Auditor, and agent-led review.
- Commit with Peers-Touch Conventional Commit rules.
- Update PR #91 with exact tests and non-claims.
- Stop ready-to-merge; do not merge.

## 8. End-To-End Lifecycle Mapping

| Lifecycle step | Owner | Workstream |
|---|---|---|
| Resolve platform root/workspace | ArtifactRootResolver | W1 |
| Allocate Gate run and active lock | RunAllocator | W1 |
| Provision runtime and write manifests | Provisioner/RunHandle | W2 |
| Run Gate and stream evidence | AcceptanceGate/EvidenceWriter | W2/W4 |
| Redact/hash/finalize manifest | EvidenceWriter | W1/W2 |
| Publish latest | EvidenceWriter | W1 |
| Validate/report/quality read | EvidenceReader | W3 |
| CI collect and human inspect | Make/CI/skills | W5 |
| Cancel/restart/interrupted write | RunHandle | W1/W7 |
| Explicit cleanup | EvidenceCleanup | W1/W7 |

No lifecycle transition is unmapped.

## 9. Atomic Cutover Matrix

| Concern | New owner | Consumers | Old path deleted at C1 | Zero-reference proof |
|---|---|---|---|---|
| Root resolution | Evidence Store | all runtime tools | `_paths.py` report constants | symbol scan |
| Gate reports/evidence | RunHandle | Gates/validators | repo reports/evidence runtime path | writer scan |
| Provisioning manifests | RunHandle | Provisioner/Gates | repo manifests dir | symbol/path scan |
| latest plan/run/report | atomic pointers | report/quality/review | singleton repo files | reader scan |
| Domain validation reports | logical Gate identity | coverage | Domain physical report field | schema scan |
| CI artifacts | override root | workflow/reviewer | source-tree collection | workflow check |
| Historical runtime reports | reviewed docs only | none as proof | 3 tracked JSON files | git ls-files |

## 10. Acceptance Scenarios

### AS-ES-01: Platform defaults and override
- **Precondition**: Temporary homes for macOS/Linux/Windows simulations.
- **Action**: Resolve artifact root with no override, then with an override.
- **Expected**: Exact D-11 paths; override wins; workspace ID is stable.
- **Failure variant**: Missing Windows LOCALAPPDATA or CI override returns typed error.
- **Evidence**: Resolver unit matrix.
- **Status**: pass (`test_evidence_store`: platform default/override matrix)

### AS-ES-02: Concurrent isolated runs
- **Precondition**: One workspace and Gate, two concurrent processes.
- **Action**: Both write/finalize different evidence.
- **Expected**: Distinct run IDs, no overwrite, valid manifests, deterministic latest.
- **Failure variant**: Older completion publishes after newer and cannot regress latest.
- **Evidence**: Concurrency integration report.
- **Status**: pass (`test_evidence_store`: two spawned processes, distinct immutable runs, valid latest)

### AS-ES-03: Read-only repository
- **Precondition**: Repository files are read-only; external root is writable.
- **Action**: Run a cheap Acceptance Gate and validator.
- **Expected**: Evidence emits and validates outside repo; tree remains unchanged.
- **Failure variant**: Any repo write fails the scenario.
- **Evidence**: before/after tree scan and run manifest.
- **Status**: pass (`test_evidence_store`: read-only worktree emits external report and leaves worktree empty)

### AS-ES-04: Unwritable or full artifact root
- **Precondition**: Override root denies writes or writer injects ENOSPC.
- **Action**: Run a Gate.
- **Expected**: Typed evidence error, non-zero result, no fallback.
- **Failure variant**: Repo artifact appears or Gate reports PASS.
- **Evidence**: error classification and zero-write scan.
- **Status**: pass (`test_evidence_store`: protected-root permission failure, injected ENOSPC, quota, zero fallback)

### AS-ES-05: Path and symlink attack
- **Precondition**: Traversal, absolute, drive-prefix, and symlink test inputs.
- **Action**: Resolve/write each candidate.
- **Expected**: Every escape is rejected before write.
- **Failure variant**: Any file appears outside the run directory.
- **Evidence**: security unit report.
- **Status**: pass (`test_evidence_store`: traversal and symlink rejection)

### AS-ES-06: Interrupted publication
- **Precondition**: One valid latest pointer.
- **Action**: Interrupt artifact, manifest, and latest writes at each boundary.
- **Expected**: Old latest remains valid; incomplete run is not primary evidence.
- **Failure variant**: Latest points to missing/partial manifest.
- **Evidence**: fault-injection test report.
- **Status**: pass (`test_evidence_store`: interrupted latest preserves prior pointer)

### AS-ES-07: Cleanup active-run safety
- **Precondition**: One locked active run, one closed old run, one latest target.
- **Action**: Execute explicit retention cleanup.
- **Expected**: Active/latest remain; only eligible old run is deleted.
- **Failure variant**: Lock failure causes skip, never forced deletion.
- **Evidence**: cleanup integration report.
- **Status**: pass (`test_evidence_store`: active/latest cleanup protection)

### AS-ES-08: Reader/report chain
- **Precondition**: New-store plan and Gate run.
- **Action**: Run validator, capability report, coverage, quality, and Acceptance report.
- **Expected**: All consume ArtifactRefs/latest and preserve proof state.
- **Failure variant**: Missing/malformed latest stays explicit unproven/error.
- **Evidence**: generated reports and script tests.
- **Status**: pass (external-root plan -> CI run -> validate -> coverage -> report chain)

### AS-ES-09: Representative environment Gate
- **Precondition**: Exact-source environment and CI-style override root.
- **Action**: Run one env-evidence Gate.
- **Expected**: Runtime/manifest/report/log chain is external and source-bound.
- **Failure variant**: Product failure remains product failure, while evidence emission is judged separately.
- **Evidence**: run manifest plus validator output.
- **Status**: blocked/unproven (external manifest/attestation/log/run durable; Station/source commit mismatch blocked product Gate execution)

### AS-ES-10: Old owner deletion
- **Precondition**: C1 complete.
- **Action**: Run tree and tracked-file scans, then all core/local Gates.
- **Expected**: Zero runtime writes/references to reports owner; no reports directory recreated.
- **Failure variant**: Any writer or fallback path blocks readiness.
- **Evidence**: zero-reference report and git status.
- **Status**: pass (production zero-reference scan; reports directory deleted and not recreated)

## 11. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Broad writer inventory misses a default | source-tree regression | executable tree/write scan plus read-only repo Gate |
| latest pointer races | stale evidence selected | gate lock and monotonic completion comparison |
| Windows permission/locking divergence | platform failure | isolated resolver/lock backend tests |
| Large artifacts exhaust memory/disk | process failure | chunked streaming, budget, typed quota/no-space errors |
| Tests accidentally consume developer artifacts | nondeterminism | mandatory temp override in tests |
| Old reports reused as proof | false readiness | delete tracked runtime JSON and preserve non-claim |
| Cleanup races a Gate | evidence loss | OS active lock and latest protection |
| CI forgets override | home-directory leakage | CI environment requires explicit override |

## 12. Final Readiness Gate

Ready-to-merge requires:

1. All ES-W1 through ES-W8 deliverables complete.
2. AS-ES-01 through AS-ES-10 have evidence and binary status.
3. Tree scan proves zero runtime source-tree writers and no reports owner.
4. All selected deterministic Acceptance Gates pass.
5. One environment-backed Gate proves external evidence emission; product proof
   is reported separately.
6. Secret scan has zero raw secret/canary matches.
7. Quality, Completion, and agent-led review have no Acceptance Core P0/P1.
8. PR body names Chat G15 as `FAILED/UNPROVEN`, never PASS.
9. PR is ready-to-merge but remains unmerged per user instruction.

## 13. Status

| Workstream | Status | Evidence |
|---|---|---|
| ES-W1 Canonical Store | done | `python3 -m unittest ...test_evidence_store` 28/28; process concurrency/read-only/failure matrix PASS |
| ES-W2 Core Writers | done | Core/provisioning/native writer migration; Core/Provisioning 115/115 PASS |
| ES-W3 Readers/Reports | done | Plan/run/validate/coverage/report external-root chain PASS |
| ES-W4 Standalone Writers | done | Production legacy writer scan zero; Desktop scripts 177/177 PASS |
| ES-W5 Contracts/Operations | done | Make/CI/skills/docs migrated; workflow/catalog parse and skill-check PASS |
| ES-W6 Atomic Cutover/Delete | done | Legacy constants and reports owner deleted; no recreation after tests |
| ES-W7 Failure/Isolation | done | AS-ES-02/03/04/05/06/07 PASS; redaction canary and zero fallback covered |
| ES-W8 End-to-End/Delivery | blocked | Local chain PASS; representative env Gate and four Chat Native product Gates remain UNPROVEN; commit/PR update pending |

## 14. Review Prompt

Review this plan against:

- `docs/architecture/acceptance-framework/design.md`
- `docs/architecture/acceptance-framework/decisions.md` D-11
- `docs/architecture/acceptance-framework/data-model.md`
- `docs/architecture/acceptance-framework/integration.md`
- `docs/architecture/acceptance-framework/module-layout.md`

Judge dependency order, scope, atomic C1 cutover, failure semantics, platform
coverage, writer/reader inventory, deletion proof, scenario completeness, and
whether any step introduces dual-write, fallback, compatibility shim, or a
product claim.
