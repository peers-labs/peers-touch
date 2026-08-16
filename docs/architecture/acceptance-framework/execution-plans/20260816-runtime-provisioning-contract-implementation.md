# Runtime Provisioning Contract Implementation Plan

> **Status**: active — EXECUTE (WS8 blocked by product identity lifecycle)
> **Version**: v1.0
> **Created**: 2026-08-16 | **Updated**: 2026-08-17
> **Owner**: Architecture Team
> **Branch**: design/acceptance-runtime-provisioning-contract
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-07, D-08, D-09, D-10

---

## Context Anchor

| Field | Current value |
|---|---|
| Main task | Complete the Runtime Provisioning Contract from EXECUTE through truthful Native proof, independent audit, PR review, and merge. |
| Plan source | `docs/architecture/acceptance-framework/execution-plans/20260816-runtime-provisioning-contract-implementation.md` |
| Tracking source | This plan's workstream table, acceptance scenarios, and Final Readiness Gate |
| Worktree | `/Users/bytedance/Documents/Projects/peers-touch/peers-oss` |
| Branch | `design/acceptance-runtime-provisioning-contract` |
| Stage | `EXECUTE` |
| Current workstream | `WS8: Chat Native Two-Client Validation` |
| Current step | Hold Draft PR #91 with explicit product, lease, Native Gate, and AS-04 evidence blockers. |
| Progress | WS1, WS5, and WS7 DONE; WS2, WS3, WS4, and WS6 PARTIAL; WS8 BLOCKED. AS-03 and AS-05 PASSED; AS-01 and AS-02 PARTIAL; AS-04 BLOCKED/UNPROVEN; Direct Chat DELIVERED UNPROVEN. |
| Last completed | Commits `a0ff6368a` and `ce564cb95` made Quality/Review fail closed on evidence gaps and isolated both non-empty and empty explicit ranges. Gap, Quality, submit-pipeline, and review-skill audits now reject readiness honestly. |
| Current action | Update the Draft PR and hand off exact closure requirements; no framework-side P0/P1 fix remains that can legitimately bypass the product or shared-environment blockers. |
| Next action | Product/identity owners resolve the post-login account transition and environment owners provide an enforceable Profile Three lease plus a discriminating credential; then rerun all four Native Gates and audits. |
| Blockers | `PRODUCT_AMENDMENT_REQUIRED`: source-matched run `412bb356ae476869` returns Bob to visible `Choose Account` after password login and logs a numeric-actor/canonical-PTID mismatch. `ENVIRONMENT_BLOCKED`: Profile Three has no enforceable shared provisioning lease; run `6fc14b7010c35190` was overwritten mid-Gate by Station commit `4383dfc1`. |
| Decisions required | Product/identity owners must define and fix the post-login account-gate transition in the governing Desktop identity lifecycle plan. The Runtime Provisioning plan must not bypass it with text selectors or Store injection. |
| Evidence | `PASSED`: local static/runtime Gates, four-domain structural validation, coverage generation, final-source guard tests, Fixture/TauriDriver startup, failure traceability, cleanup, six Quality/Review regressions, and review skill freshness. `FAILED/UNPROVEN`: v9 stops at source-matched `bob:shell.ready`; v10 is invalid because Station drifted. `BLOCKED/UNPROVEN`: Gap Detector lists four Native Gates; Quality and review-submit return nonzero; AS-04 exact-value scan is non-discriminating. |
| Last updated | 2026-08-17 03:17 CST |

---

## 1. Background & Goals

This plan implements the accepted Runtime Provisioning architecture for the Acceptance Framework, addressing the root causes of:
- Non-reproducible native acceptance paths requiring manual environment assembly
- Silent pass failures where missing environment variables lead to connection refused errors instead of structured BLOCKED states
- Self-certifying gates that generate their own attestations, actor identities, or hardcode credentials
- Incorrect gate selection for receiver-visible state changes (e.g., DELIVERED receipts only running API-level gates instead of native two-client journeys)
- No independent guardrail to detect Acceptance gaps at completion, commit, or PR time.

**Outcome**: Any agent (new or existing) has a single, discoverable, reproducible path to run native two-client acceptance and produce verifiable product evidence without hardcoding, mocking, or silent pass.

---

## 2. Scope & Non-Scope

### In Scope
- Core Provisioning Contract data model and runtime manifest generation
- Independent Environment Provisioner execution boundary before gate execution
- Station Attestation production and validation flow
- Canonical Actor Fixture framework for PTID/account/initial state management
- Credential reference system with strict secret redaction
- Registry behavior rules for receiver-visible state gate selection
- `pt-acceptance-gap-detector` cross-stage read-only guard skill
- Chat Native two-client environment end-to-end validation

### Non-Scope
- Fixing Direct Chat DELIVERED receipt product logic itself (this remains a product bug to be fixed separately after framework lands)
- Changing existing Gate product assertions or journey semantics; runtime Driver
  consumers must still migrate to the accepted single TauriDriver entry when a
  stale pre-Core-Runtime transport is discovered
- CI/CD platform integration (local developer environment only in this phase)
- Remote testnet provisioning (home-station local environment only)

---

## 3. Traceability Matrix

| Plan Workstream | Architecture Decision | Required Evidence |
|-----------------|----------------------|-------------------|
| WS1: Core Provisioning Model | D-07 | Contract schema validation, manifest immutability tests |
| WS2: Environment Provisioner Runtime | D-07 | BLOCKED/UNPROVEN structured output for missing resources, cleanup audit |
| WS3: Attestation & Actor Fixture Owners | D-08 | Attestation matches live Station, actor manifest has canonical PTIDs, no hardcoded identities |
| WS4: Credential Reference System | D-08 | Only credential references appear in manifests/logs/evidence, secret values are redacted |
| WS5: Registry Behavior Rules | D-09 | Messaging receipt changes automatically select `chat-native-two-client-e2e`, no over-selection of expensive gates |
| WS6: Acceptance Runner Integration | D-07 | Provisioning runs before gate, missing provisioning blocks gate execution, manifest attached to evidence |
| WS7: Gap Detector Skill | D-10 | Gap detector fails closed on missing evidence, outputs structured gaps, does not modify code |
| WS8: Chat Native Validation | D-07/D-08/D-09 | End-to-end two-client provisioning path is discoverable and reproducible by a new agent |

---

## 4. Workstreams & Dependency Order

### Dependency DAG
```
WS1 (Core Model) → WS2 (Provisioner Runtime) → WS6 (Runner Integration) → WS8 (Chat Validation)
     ↓                     ↓
WS4 (Credentials)     WS3 (Attestation/Actors)
     ↓                     ↓
WS5 (Registry Rules) ───────┘
     ↓
WS7 (Gap Detector)
```

Workstreams that may run in parallel after WS1: WS3, WS4, WS5.

---

### Phase 1: Core Data Model & Contracts (WS1)
**Goal**: Implement the canonical Provisioning Contract and Runtime Manifest data models with validation.
**Depends on**: Nothing (starts first)
**Files to create/modify**:
- Create: `tooling/acceptance/core/provisioning.py` - Contract, Manifest, Attestation, ActorManifest, CredentialRef, GapArtifact dataclasses
- Modify: `tooling/acceptance/core/evidence.py` - Add manifest attachment to EvidenceReport
- Create: `tooling/acceptance/environments/` - Environment contract YAML directory
- Create: `tooling/acceptance/environments/home-station.yaml` - Contract for native chat environment
- Modify: `tooling/acceptance/core/errors.py` - Add ProvisioningError, BlockedError hierarchy
**Deliverables**:
- Pydantic or dataclass-based schema validation for all provisioning artifacts
- Immutable manifest once created
- Manifest identity binding to runId, commit, worktree, profile
- Strict state machine for provisioning lifecycle: DISCOVERED → PREFLIGHTED → PROVISIONED → FIXTURE_READY → GATE_RUNNING → EVIDENCE_JUDGED → CLEANING → CLEANED, with BLOCKED / GATE_FAILED / CLEANUP_FAILED terminal failure states
**Acceptance Criteria**:
- [x] `python3 -m unittest tooling.acceptance.tests.test_provisioning_model` passes
- [x] Invalid contracts fail validation at parse time, not runtime
- [x] Manifests cannot be modified after write
- [x] Secret fields are automatically redacted on serialization

---

### Phase 2: Environment Provisioner Runtime (WS2)
**Goal**: Implement standalone provisioner that executes before gate runs, resolves all resources, and outputs an immutable source-bound manifest.
**Depends on**: WS1
**Files to create/modify**:
- Create: `tooling/acceptance/core/provisioner.py` - Provisioner base class and execution engine
- Create: `tooling/acceptance/provisioners/` - Provisioner implementation directory
- Create: `tooling/acceptance/provisioners/home_station.py` - Home station local environment provisioner
- Modify: `tooling/scripts/acceptance-run.py` - Inject the Runtime Manifest path into the Gate process
**Deliverables**:
- Profile resolution and identity validation (fails closed if profile name does not match content)
- Service lifecycle management (Station start/stop, health checks)
- Isolated client process/port/storage management
- Structured cleanup audit (process kill, port release, storage cleanup verification)
- BLOCKED state output for any missing dependency (service not running, credentials missing, profile invalid)
**Acceptance Criteria**:
- [x] Provisioner fails closed with BLOCKED and structured reason when Station is not running
- [x] Provisioner fails closed with BLOCKED when profile `three.env` content mismatches identity
- [ ] All processes started by provisioner are cleaned up on failure or completion
- [x] No port leaks after failed provisioning/native runs (verified via port scan before/after)

---

### Phase 3: Attestation & Actor Fixture Owners (WS3)
**Goal**: Implement single ownership for Station attestation production and canonical actor/PTID fixtures.
**Depends on**: WS1
**Files to create/modify**:
- Create: `tooling/acceptance/core/attestation.py` - Station attestation generation and validation
- Modify: `tooling/scripts/station-*.sh` or add provisioner action to produce attestation on Station startup
- Create: `tooling/acceptance/fixtures/chat_native_actors.py` - Chat native actor fixture (Alice/Bob PTIDs, account reset)
- Modify: `tooling/acceptance/fixtures/chat_native_reset.py` - Refactor to produce actor manifest instead of side effects only
**Deliverables**:
- Attestation includes: Station commit hash, workspaceDigest (must be `clean` for valid runs), protoDigest, live URL
- Attestation validation: runner verifies attestation matches live Station metadata before proceeding
- Actor fixture produces canonical PTIDs per profile, accounts exist, initial conversation state is reset
- Destructive fixture reset requires explicit authorization flag
**Acceptance Criteria**:
- [x] Runner rejects mismatched attestation (wrong commit, dirty workspace, wrong proto digest)
- [x] Actor manifest contains valid, reachable PTIDs for Alice and Bob
- [x] No hardcoded PTIDs or account credentials in gate code or runner logic
- [x] Reset without authorization flag fails closed

---

### Phase 4: Credential Reference & Redaction (WS4)
**Goal**: Ensure no secret values appear in manifests, logs, or evidence; only references are stored.
**Depends on**: WS1
**Files to create/modify**:
- Modify: `tooling/acceptance/core/redaction.py` - Add credential reference handling, expand secret pattern detection
- Modify: `tooling/acceptance/core/evidence.py` - Ensure all evidence files go through redaction
- Modify: `tooling/local/dev/profiles/*.env` - Document credential reference pattern
**Deliverables**:
- Credentials are resolved at provisioning time from approved sources (env vars, profile env files, secret stores)
- Only `source_ref` identifiers are stored in manifests and reports
- All text evidence (logs, json, html, md) is scanned for secrets before write
- Redaction is deterministic and auditable
**Acceptance Criteria**:
- [ ] Passwords/tokens/keys do not appear in any report under `tooling/acceptance/reports/`
- [ ] Passwords/tokens/keys do not appear in any evidence under `tooling/acceptance/evidence/`
- [x] Credential resolution fails closed when referenced secret does not exist
- [ ] Existing secret scan in commit hooks still passes

---

### Phase 5: Registry Behavior Rules (WS5)
**Goal**: Implement narrow behavior-based gate selection for receiver-visible state changes, per D-09.
**Depends on**: WS1, WS3, WS4
**Files to create/modify**:
- Modify: `tooling/acceptance/registry.yaml` - Add behavior rules for receiver-visible state
- Create: `tooling/acceptance/behavior-rules/` - Behavior rule definitions directory
- Create: `tooling/acceptance/behavior-rules/chat-receipts.yaml` - Rules for receipt/delivery state changes
- Modify: `tooling/scripts/acceptance-plan.py` - Extend planner to evaluate behavior rules in addition to path rules
**Deliverables**:
- Path-based rules remain for cheap structural checks
- Behavior rules trigger narrower, more expensive gates when user-visible state changes are touched
- Receipt, badge, projection changes automatically select the appropriate native multi-actor gate
- No over-selection: unrelated messaging changes do not trigger expensive native E2E runs
**Acceptance Criteria**:
- [x] Changes to `apps/desktop/src-tauri/src/messaging/**` receipt processing select `chat-native-two-client-e2e`
- [x] Proto-only changes do not select native E2E gates
- [x] Gateway-only HTTP handler changes do not select native E2E gates (only gateway E2E)
- [x] Planner produces correct gate selection for receipt path modifications

---

### Phase 6: Acceptance Runner Integration (WS6)
**Goal**: Integrate provisioning flow into the main acceptance runner, blocking gate execution when provisioning fails.
**Depends on**: WS2, WS3, WS4, WS5
**Files to create/modify**:
- Modify: `tooling/scripts/acceptance-run.py` - Add provisioning phase before gate execution
- Modify: `tooling/acceptance/gates/chat/native_visible_runner.py` - Consume manifest instead of raw env vars
- Modify: `tooling/acceptance/gates.yaml` - Add environment metadata and provisioner references
- Modify: `tooling/acceptance/README.md` - Document new provisioning flow
**Deliverables**:
- Runner executes provisioner for the gate's declared environment before running the gate command
- BLOCKED provisioning state produces structured BLOCKED gate result, not FAIL
- Runtime manifest is attached to all env-evidence gate reports
- Error messages clearly distinguish provisioning failures from product test failures
**Acceptance Criteria**:
- [ ] Running `chat-native-two-client-e2e` without Station started produces BLOCKED result with clear reason, not connection refused traceback
- [x] Running with valid provisioning produces manifest attached to evidence report
- [x] Existing local/ci-cheap gates continue to work without provisioning overhead
- [x] Manual gate execution path remains available for advanced users

---

### Phase 7: Gap Detector Skill (WS7)
**Goal**: Implement and register the `pt-acceptance-gap-detector` cross-stage read-only guard, per D-10.
**Depends on**: WS6
**Files to create/modify**:
- Create: `tooling/skills/pt-acceptance-gap-detector/SKILL.md` - Skill definition and checklists
- Create: `tooling/skills/pt-acceptance-gap-detector/PROCEDURES.md` - Detection procedures for 25 bypass patterns
- Modify: `AGENTS.md` - Register skill in §13.1 skills table
- Create: `tooling/scripts/acceptance-gap-detect.py` - Automated gap detection script
**Deliverables**:
- Four-layer mandatory checklist: Product Promise, Gate Coverage, Evidence Integrity, Failure Honesty
- Detection logic for 25 common silent-pass patterns (mock APIs, single-actor tests, stale evidence, hardcoded values, etc.)
- Skill outputs structured gap report with proof state, responsible stage, and minimal closure path
- Skill is read-only: it does not modify code, fix gaps, or approve continuation
- Skill calls `pt-acceptance-engineering` when real gaps are found
**Acceptance Criteria**:
- [x] Running detector on current unproven DELIVERED receipt state correctly reports gap
- [x] Detector does not modify any files when run
- [x] Detector fails closed when a task is marked complete without required evidence
- [x] Skill is discoverable in AGENTS.md; IDE runtime sync consumes the canonical `tooling/skills/` source

---

### Phase 8: Chat Native Two-Client Validation (WS8)
**Goal**: Verify the full end-to-end path works for the native two-client chat journey.
**Depends on**: WS1-WS7 complete
**Files to create/modify**:
- Modify: `tooling/acceptance/playbooks/chat-native-visible-clients.md` - Update with new provisioning steps
- Modify: `tooling/skills/pt-dev-runtime-handoff/SKILL.md` - Update examples to include attestation/PTID manifest references
**Deliverables**:
- New agent following documented steps can provision environment and run two-client E2E without manual tribal knowledge
- All required inputs are produced by the framework, no manual copying of PTIDs, URLs, or credentials
- Evidence report contains full manifest, attestation, actor runtime data, and clear pass/fail state
- Native clients consume the single `tooling.acceptance.drivers.tauri.TauriDriver`
  entry with one provisioned WebDriver port per client; the deleted
  `PT_PLAYWRIGHT_SOCKET` transport is not retained as a fallback
**Acceptance Criteria**:
- [ ] Fresh agent can follow documented steps to run `chat-native-two-client-e2e` without asking for missing information
- [ ] Successful run produces verifiable evidence with all manifest fields populated
- [ ] Missing credential produces BLOCKED result with specific remediation instruction, not generic failure
- [ ] DELIVERED receipt state remains UNPROVEN until product bug is fixed (framework correctly reports state, does not fake pass)

---

## 5. Atomic Cutover Matrix

| Concern | Old Path | New Source of Truth | Cutover Condition | Old Path Deletion |
|---------|----------|---------------------|-------------------|-------------------|
| Environment input | Raw env vars read directly by gates | Runtime Manifest produced by Provisioner | All env-evidence gates consume manifest | Remove direct env var reads from native runners |
| PTID/Accounts | Hardcoded or manually copied | Actor Manifest from chat_native_actors fixture | All native chat gates consume actor manifest | Remove hardcoded PTID defaults from runners |
| Attestation | Not validated / optional | Attestation artifact validated against live Station | Runner enforces attestation check before gate start | Remove bypass flags for attestation validation |
| Gate selection | Path-based rules only | Path + behavior rules | Behavior rules deployed and tested | No old path deletion needed (rules are additive) |
| Completion check | Agent self-attestation | Gap Detector mandatory check before commit/PR | Gap detector integrated into quality workflow | No old path deletion needed |

Rollback: All changes are feature-flagged per environment type; local gates retain old behavior until provisioning is validated. Rollback via git revert of the feature branch.

---

## 6. Acceptance Scenarios

### AS-01: Missing Station produces BLOCKED, not FAIL
- **Precondition**: No Station running on port 3000/3030, profile `three` is active
- **Action**: Agent runs `chat-native-two-client-e2e` via `make acceptance chat-native-two-client-e2e`
- **Expected**: Result state is BLOCKED, reason states "Station not reachable at <url>, run `make station` first", no Python traceback, no gate logic executes
- **Failure variant**: Wrong Station running on port (different commit) → BLOCKED with attestation mismatch reason
- **Evidence**: `tooling/acceptance/reports/chat-native-two-client-e2e.json` has `status: BLOCKED`, structured `blockedReason` field
- **Status**: PARTIAL — real Gateway absence and dirty Station attestation produce structured BLOCKED/UNPROVEN with exit code 2; exact no-Station runtime remains unrun.

### AS-02: New agent can discover and run two-client path
- **Precondition**: Fresh agent with no prior Acceptance framework knowledge, repo cloned, dependencies installed
- **Action**: Agent reads `tooling/acceptance/README.md`, follows provisioning steps, runs the gate
- **Expected**: Agent can complete provisioning without asking for tribal knowledge; if credentials are missing, agent gets exact env var name to set
- **Failure variant**: Profile content mismatches name → BLOCKED with identity mismatch error
- **Evidence**: Agent execution transcript shows no manual PTID/URL copying, all inputs come from framework
- **Status**: PARTIAL — the documented path now reaches source-matched dual Native WebDriver execution without manual PTID/URL copying, but stops at a product identity-lifecycle failure rather than completing the journey.

### AS-03: Receipt code changes select correct gate
- **Precondition**: Developer modifies receipt delivery logic in `apps/desktop/src-tauri/src/messaging/direct.rs`
- **Action**: Developer runs `make acceptance-plan` for the diff
- **Expected**: Plan includes `chat-native-two-client-e2e` as a required gate, not just `chat-desktop-gateway-e2e`
- **Failure variant**: Proto-only change → only contract/unit gates selected, no expensive native E2E
- **Evidence**: `latest-plan.json` shows the native two-client gate in selected_gates list
- **Status**: PASSED — direct receipt owner selects `chat-native-two-client-e2e`; unrelated messaging and proto-only paths do not.

### AS-04: No secrets leak into evidence
- **Precondition**: CHAT_NATIVE_DEMO_PASSWORD is set in environment, gate runs (even if fails)
- **Action**: After run, grep all files in `tooling/acceptance/reports/` and `tooling/acceptance/evidence/` for the password value
- **Expected**: Zero matches; only credential reference `env:CHAT_NATIVE_DEMO_PASSWORD` appears
- **Failure variant**: Log line prints password → redactor catches it and replaces with [REDACTED]
- **Evidence**: grep returns exit code 1 (no matches)
- **Status**: BLOCKED/UNPROVEN — a credential-backed live Gate and structured scan ran with zero unredacted current-run secret fields, but the approved preset credential is one character, so an exact raw-value grep is non-discriminating and cannot prove zero matches.

### AS-05: Gap detector catches unproven completion claim
- **Precondition**: Direct DELIVERED receipt bug exists, no native two-client evidence exists
- **Action**: Agent claims task complete, runs `pt-acceptance-gap-detector` before commit
- **Expected**: Detector reports GAP: chat-native-two-client-e2e evidence missing for receiver-visible state change, task cannot be marked complete
- **Failure variant**: Evidence exists but is stale (from older commit) → detector reports stale evidence gap
- **Evidence**: Gap report artifact lists specific missing gate and required closure path
- **Status**: PASSED — detector reports `GATE_BLOCKED_BY_ENVIRONMENT` and retains Direct DELIVERED as `UNPROVEN`.

---

## 7. Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Provisioning adds overhead to existing cheap gates | Slow CI/local feedback | Medium | Provisioning only runs for `env-evidence` tier gates; `ci-cheap`/`ci-structure` tiers skip provisioning entirely |
| Profile validation breaks existing developer setups | Developer workflow disruption | Medium | Add profile repair instructions in BLOCKED messages; do not delete existing profiles, just validate identity |
| Behavior rules over-select expensive gates | Long CI times | Medium | Start with narrow rules only for receipt/delivery paths; measure selection rate before expanding |
| Attestation strictness blocks legitimate dirty-workspace testing | Developer friction | Medium | Allow explicit `--dirty-workspace` override flag for local development (marked as unofficial, not valid for proof claims) |
| Gap detector false positives block legitimate work | Frustration, workarounds | Medium | Start with detector as advisory in first release; iterate on rule specificity; allow explicit gap acknowledgement with justification |

---

## 8. Final Readiness Gate

The plan is complete and ready for production use only when:
1. All workstreams WS1-WS7 are implemented and code-reviewed
2. Unit tests for core provisioning model pass
3. AS-01 through AS-04 all pass in local environment
4. AS-05 correctly reports the existing DELIVERED receipt gap
5. A fresh agent (no context) can successfully execute AS-02 without human intervention beyond setting the documented credential env var
6. No product code in `apps/` is modified (framework-only change)
7. All existing acceptance gates continue to pass as before (no regression)

Once this gate passes, the framework is ready to be used to validate actual product fixes (like the DELIVERED receipt bug) in subsequent workstreams.

---

## 9. Implementation Status

| Workstream | Status | Completion Date | Commit | Notes |
|------------|--------|-----------------|--------|-------|
| WS1: Core Data Model | DONE | 2026-08-16 | `9d05335e1` | Immutable contract/manifest models and schema tests pass. |
| WS2: Provisioner Runtime | PARTIAL | — | `9d05335e1`, `b274e68c1`, `034bd725b` | Profile/service preflight, structured BLOCKED, per-client WebDriver allocation, and failed-run cleanup are proven. The design-required shared Profile lease and cleanup after a successful complete Gate remain unproven. |
| WS3: Attestation & Actors | PARTIAL | — | `9d05335e1`, `d0af86743`, `1fc55890f` | Live attestation, reset, canonical Alice/Bob PTIDs, and authenticated login/logout are proven. The latest run correctly blocked when a concurrent deployment replaced the Station commit. |
| WS4: Credential Redaction | PARTIAL | — | `9d05335e1`, `f9bcead42` | CredentialRef and structured/key-aware redaction tests pass; live artifacts contain references/redaction only, but exact-value AS-04 is UNPROVEN because the preset value is one character. |
| WS5: Registry Behavior Rules | DONE | 2026-08-16 | `9d05335e1` | Receipt owner selects two-client Gate; unrelated messaging and proto paths do not over-select it. |
| WS6: Runner Integration | PARTIAL | — | `9d05335e1`, `f9bcead42`, `8f88bb038`, `b274e68c1`, `034bd725b`, `7b6938982`, `ba1d799ba` | Provision-before-run, manifest-only input, TauriDriver, cleanup, failed-result traceability, and final live commit guard are implemented; final guard live evidence and a successful complete product Gate remain unproven. |
| WS7: Gap Detector Skill | DONE | 2026-08-17 | `9d05335e1`, `a0ff6368a`, `ce564cb95` | Detector and submit wiring fail closed. Quality/Review range isolation and gap-aware readiness regressions close the discovered completion-path silent pass. |
| WS8: Chat Native Validation | BLOCKED | — | `8f88bb038`, `b274e68c1`, `570dfd514`, `f826199bf`, `034bd725b` | Source-matched dual Native execution reaches Bob password login and then fails at `shell.ready`: the product returns to `Choose Account` with a numeric-actor/canonical-PTID profile-sync mismatch. Product amendment is out of scope; Direct Chat remains UNPROVEN. |
