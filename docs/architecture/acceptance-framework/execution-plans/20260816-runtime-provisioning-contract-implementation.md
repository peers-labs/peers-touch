# Runtime Provisioning Contract Implementation Plan

> **Status**: complete — current-source WS2/WS3 maintenance verified
> **Version**: v1.0
> **Created**: 2026-08-16 | **Updated**: 2026-09-09
> **Owner**: Architecture Team
> **Branch**: design/acceptance-runtime-provisioning-contract
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-07, D-08, D-09, D-10

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
- Desktop post-login identity prerequisite required by Native Chat proof
- Cross-worktree deployment/provisioning lease for the shared Profile Three Station
- High-entropy leak-canary CredentialRef for discriminating AS-04 value scans

### Non-Scope
- Fixing Direct Chat DELIVERED receipt product logic itself (this remains a product bug to be fixed separately after framework lands)
- Changing existing Gate product assertions or journey semantics; runtime Driver
  consumers must still migrate to the accepted single TauriDriver entry when a
  stale pre-Core-Runtime transport is discovered
- CI/CD platform integration (local developer environment only in this phase)
- Remote testnet provisioning (home-station local environment only)
- Vercel deployment status, because the private-repository Hobby-plan failure is an external non-product limitation explicitly excluded by the user

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
| WS8-A: Identity Prerequisite | Desktop Identity Lifecycle / D-08 | Password login reaches PIN/shell through canonical PTID validation without numeric-ID boundary fallback |
| WS8-B: Shared Profile Lease | D-07 | Deploy and Provisioner contend on one crash-safe Profile Three lease; concurrent work is structured BLOCKED |
| WS8-C: Leak Canary | D-08/D-10 | High-entropy canary traverses CredentialRef/runtime redaction and has zero raw-value artifact matches |
| WS8: Chat Native Validation | D-07/D-08/D-09 | End-to-end two-client provisioning path is discoverable and reproducible by a new agent |

---

## 4. Workstreams & Dependency Order

### Dependency DAG
```
WS1 (Core Model) → WS2 (Provisioner Runtime) → WS6 (Runner Integration)
     ↓                     ↓
WS4 (Credentials)     WS3 (Attestation/Actors)
     ↓                     ↓
WS5 (Registry Rules) ───────┘
     ↓
WS7 (Gap Detector)

WS8-A (Identity) ─┐
WS8-B (Lease) ────┼→ WS8 (Chat Validation)
WS8-C (Canary) ───┘
```

Workstreams that may run in parallel after WS1: WS3, WS4, WS5.

### Approved Blocker Closure Amendment (WS8-A / WS8-B / WS8-C)

**User decision (2026-08-17)**: Ignore the external Vercel plan limitation and
continue resolving every other blocker.

#### WS8-A: Desktop Identity Prerequisite
- Remote profile identity MUST be compared with the canonical PTID bound to the
  originating Tauri window.
- Local profile writes MUST target the local account ID from that same active
  window session.
- Numeric Station storage IDs MUST NOT be accepted as cross-boundary identity
  substitutes.
- Required evidence:
  `cargo test` for profile/session ownership, Desktop identity lifecycle tests,
  Desktop check, and a source-matched Native login reaching PIN/shell.

#### WS8-B: Shared Profile Lease
- Deploy and Environment Provisioner MUST acquire the same OS-backed lease key
  for `station-three`.
- A competing deploy or Gate MUST return structured BLOCKED before changing the
  Station.
- The lease MUST release automatically on process exit and explicitly during
  cleanup.
- Required evidence: contention tests, crash/release test, and a live Native run
  whose final Station commit remains source-matched.

#### WS8-C: High-Entropy Leak Canary
- Provisioning MUST resolve a per-run high-entropy canary through CredentialRef.
- The canary value MUST never be serialized; reports retain only its reference.
- Final evidence scan MUST search every current-run report/evidence artifact for
  the exact canary and return zero matches.
- Product login password remains separately covered by structured redaction and
  reference-only checks.

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
- **Status**: PASSED — an isolated canonical profile pointed at an unreachable Station; the runner returned exit 2 with manifest state `BLOCKED`, resource `station:http://127.0.0.1:9`, and no Gate evidence artifact.

### AS-02: New agent can discover and run two-client path
- **Precondition**: Fresh agent with no prior Acceptance framework knowledge, repo cloned, dependencies installed
- **Action**: Agent reads `tooling/acceptance/README.md`, follows provisioning steps, runs the gate
- **Expected**: Agent can complete provisioning without asking for tribal knowledge; if credentials are missing, agent gets exact env var name to set
- **Failure variant**: Profile content mismatches name → BLOCKED with identity mismatch error
- **Evidence**: Agent execution transcript shows no manual PTID/URL copying, all inputs come from framework
- **Status**: PASSED — a clean agent runtime followed the documented profile, Provisioner, Fixture, Actor Manifest, and TauriDriver path without manually copying PTIDs or Station URLs. It reached the receiver-visible product receipt assertion; the later product failure remains separate.

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
- **Status**: PASSED — the live Native run generated and resolved one high-entropy leak canary through CredentialRef; `secretScan.status=passed`, `scannedHighEntropyValues=1`, and `redactedArtifacts=[]`. The one-character demo password is not used as the discriminating canary.

### AS-05: Gap detector catches unproven completion claim
- **Precondition**: Direct DELIVERED receipt bug exists, no native two-client evidence exists
- **Action**: Agent claims task complete, runs `pt-acceptance-gap-detector` before commit
- **Expected**: Detector reports GAP: chat-native-two-client-e2e evidence missing for receiver-visible state change, task cannot be marked complete
- **Failure variant**: Evidence exists but is stale (from older commit) → detector reports stale evidence gap
- **Evidence**: Gap report artifact lists specific missing gate and required closure path
- **Status**: PASSED — detector retains missing/failed Native evidence as `UNPROVEN`. A new regression also rejects a focused run's stale empty plan when auditing a non-empty review range, closing a discovered completion-path Silent Pass.

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
6. Product code changes are limited to the accepted Desktop identity prerequisite and pass its dedicated tests and Native proof
7. All existing acceptance gates continue to pass as before (no regression)

Once this gate passes, the framework is ready to be used to validate actual product fixes (like the DELIVERED receipt bug) in subsequent workstreams.

---

## 9. Implementation Status

| Workstream | Status | Completion Date | Commit | Notes |
|------------|--------|-----------------|--------|-------|
| WS1: Core Data Model | DONE | 2026-08-16 | `9d05335e1` | Immutable contract/manifest models and schema tests pass. |
| WS2: Provisioner Runtime | DONE | 2026-09-09 | current checkpoint | Local Desktop Gateway declares its Fixture/credential contract; generated coverage-report changes are excluded from workspace source identity; aggregate reports retain exact source identity. Product cleanup proof remains separately unproven. |
| WS3: Attestation & Actors | DONE | 2026-09-09 | current checkpoint | Proto identity uses only tracked contract artifacts; remote attestation delegates to strict `SshTransport` and rejects missing/invalid known-hosts configuration before network access. |
| WS4: Credential Redaction | DONE | 2026-08-17 | `9d05335e1`, `f9bcead42`, `602c730eb`, `d4f082492` | Actor login credential ownership is explicit, runtime canary resolution is live-proven, and the exact high-entropy scan found zero leaked artifacts. |
| WS5: Registry Behavior Rules | DONE | 2026-08-16 | `9d05335e1` | Receipt owner selects two-client Gate; unrelated messaging and proto paths do not over-select it. |
| WS6: Runner Integration | PARTIAL | — | `9d05335e1`, `f9bcead42`, `8f88bb038`, `b274e68c1`, `034bd725b`, `7b6938982`, `ba1d799ba`, `d4f082492`, `0e5915aa4`, `907c0fe94` | Provision-before-run, manifest-only input, TauriDriver, cleanup, failed-result traceability, and final live commit guard are live-proven. A successful complete product Gate remains unproven. |
| WS7: Gap Detector Skill | DONE | 2026-08-17 | `9d05335e1`, `a0ff6368a`, `ce564cb95`, `23b7391be`, `2f553b3a8` | Detector and submit wiring fail closed, including stale-plan identity rejection after focused Gate runs. |
| WS8-A: Identity Prerequisite | DONE | 2026-08-17 | `602c730eb`, `907c0fe94` | Strict PTID validation and window-bound account writes pass Rust/Desktop/static tests; both Native actors reached shell/device/bundle readiness. |
| WS8-B: Shared Profile Lease | DONE | 2026-08-17 | `602c730eb`, `298f656b1`, `907c0fe94` | Local contention, SSH-held remote Git exclusion, process-exit release, 237-second Gate source stability, and cleanup all pass. |
| WS8-C: Leak Canary | DONE | 2026-08-17 | `602c730eb`, `d4f082492`, `907c0fe94` | Live current-run scan covered one high-entropy generated CredentialRef and found zero leaked artifacts. |
| WS8: Chat Native Validation | FAILED / UNPROVEN | — | `907c0fe94` | Both actors reached shell/device/bundle readiness; Alice submitted and Bob visibly received/decrypted. Alice never projected `DELIVERED` within 120 seconds. Dependent Native Gates remain unrun and Direct Chat DELIVERED is unproven. |

### 9.1 Current-Source Maintenance Closure — 2026-09-09

Checkpoint `c0d169b6f3bb035de66fb31c566b982a0ae95f6b` reproduced four
generic WS2/WS3 failures before any Station access:

- `local-desktop-gateway` no longer satisfies its declared Fixture contract;
- `source_proto_digest` includes non-git-tracked generated artifacts;
- remote source attestation invokes SSH with `StrictHostKeyChecking=no` and
  does not fail closed on an invalid known-hosts contract;
- `source_workspace_digest` treats the generated coverage report as source
  drift.

This maintenance slice repairs only the generic contracts and synthetic tests.
It does not modify a business Gate, provision a remote environment, or establish
Agent product evidence.

Aggregate verification exposed two additional generic lifecycle defects:
`reports/run.json` omitted the aggregate source identity, and validation rejected
stale historical evidence before considering the current source-bound aggregate.
The runner now persists the exact aggregate source, while the validator admits a
current source-matched result envelope and still rejects stale latest evidence
when no current envelope exists.

Closure evidence passes five focused provisioning/attestation regressions, the
149-test combined provisioning/launch-context suite, the complete runner and
validator suites, `acceptance-runtime-provisioning-self`, and
`acceptance-infra-validation` on one clean current-source checkpoint. No remote
Station access or product Gate execution occurred.
