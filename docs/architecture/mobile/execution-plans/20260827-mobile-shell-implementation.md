# Mobile Shell — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-09-02
> **Owner**: Mobile Architecture Team

---

## 1. Objective

Deliver the accepted Mobile Shell product contract through the Tauri v2 Mobile
mainline without introducing a second identity, runtime, sync, command, or
business-state authority.

The completed system must:

- enter a challenge-verified Station through the Station-owned Access Gate;
- activate only a PTID-bearing session after final access grant;
- render Chat, Moments, Contacts, and Me from runtime-owned projections;
- preserve drafts and uncertain commands across interruption and restart;
- switch Station, actor, background state, and revoked sessions without leaking
  prior-generation data;
- pass every `MS-PA01..MS-PA27` assertion through `MS-AG01..MS-AG11`.

Owner acceptance of PRODUCT, Prototype, architecture, `MS-D01..MS-D11`,
Frontend Runtime `D-17`, and Social Runtime `D-08` was recorded on 2026-08-27.

## 2. Accepted Sources

Product:

- `docs/architecture/mobile/product-definition.md`
- `docs/architecture/mobile/experience-contract.md`
- `docs/architecture/mobile/product-state-model.md`
- `docs/architecture/mobile/product-feasibility.md`
- `docs/architecture/mobile/acceptance-matrix.md`
- `docs/architecture/mobile/prototype/README.md`

Architecture:

- `docs/architecture/mobile/design.md`
- `docs/architecture/mobile/decisions.md`
- `docs/architecture/mobile/data-model.md`
- `docs/architecture/mobile/integration.md`
- `docs/architecture/mobile/module-layout.md`
- `docs/architecture/identity/unified-actor-system.md`
- `docs/architecture/frontend-runtime/`
- `docs/architecture/social-runtime/`
- `docs/architecture/access-gates/station-access-gate-architecture.md`
- `docs/architecture/service-coordination.md`
- `docs/client/mobile/`
- `docs/client/common/ui-identity/frontend-component-tree-registry.md`

## 3. Scope And Non-Scope

### In Scope

- `MS-C01..MS-C10` required capability closure.
- `MS-C14` explicit device-local message flag.
- `MS-P01..MS-P08` contract closure without an unauthorized version bump.
- Repository-wide `ActorRef` PTID hard cut across Model, Station, Desktop
  Rust/TypeScript, Mobile Web/Rust, and all generated consumers.
- Mobile lifecycle, navigation, runtime registry, projection, native-port, and
  persistence cutovers.
- Required Station and Model changes for identity, handshake, OAuth, settings,
  command outcomes, and product readback.
- iOS and Android native runtime evidence.
- Atomic removal of replaced lifecycle, route, DTO, stream, outbox, and
  component-local persistence paths.
- Acceptance automation and evidence for `MS-PA01..MS-PA27`.

### Non-Scope

- Enabling WeChat OAuth, voice/video calls, or Chat Docs (`MS-C11..MS-C13`).
- Making local message flags cross-device.
- Station Dashboard administration.
- Replacing accepted Frontend Runtime, Social Runtime, Access Gate, or
  federation architecture.
- Bumping a protocol, schema, dependency, package, framework, or document
  version without separate Owner approval.
- Treating browser Prototype evidence as native production acceptance.

## 4. Architecture Traceability

| Plan requirement | Product IDs | Architecture source | Decision / invariant | Required evidence |
|---|---|---|---|---|
| Verified Station scope | MS-C01, MS-J01, MS-J06, MS-PA01, MS-PA16, MS-PA25 | `data-model.md` MS-P07 | MS-D10 | MS-AG01, MS-AG02 |
| Repository-wide PTID-only ActorRef hard cut | MS-C02, MS-J01, MS-J02, MS-PA02, MS-PA04, MS-PA05 | `identity/unified-actor-system.md` plus `data-model.md` MS-P01 | MS-D06; Proto-first; Station-internal numeric identity only | Model generation; Station tests; Desktop check/tests; Mobile check; identity zero-reference Gate; MS-AG01, MS-AG02, MS-AG05 |
| OAuth through Access Gate | MS-C03, MS-J01, MS-PA03, MS-PA25 | `data-model.md` MS-P02, MS-P03 | MS-D05 | MS-AG03 |
| Lifecycle/runtime graph | MS-C04, MS-C10, MS-J02, MS-J06, MS-J07 | `design.md` §§5–6 | MS-D01, MS-D02, MS-D09 | MS-AG02, MS-AG05 |
| Descriptor navigation | MS-C04, MS-J03..MS-J06 | `module-layout.md` | MS-D03, MS-D04 | MS-AG07, MS-AG08, MS-AG11 |
| Generated domain gateways | MS-C05..MS-C09 | `data-model.md` §§2–3, §6 | MS-D07 | MS-AG01, MS-AG06 |
| Durable command convergence | MS-C05, MS-C06, MS-C08..MS-C10, MS-J07 | `data-model.md` MS-P04, MS-P06 | MS-D08; Frontend D-17; Social D-08 | MS-AG04, MS-AG09, MS-AG10 |
| Durable local drafts | MS-C05, MS-C08, MS-PA23 | `data-model.md` MS-P08 | single Rust persistence owner | MS-AG05, MS-AG10 |
| Complete settings | MS-C09, MS-PA12, MS-PA21 | `data-model.md` MS-P05 | Station/account vs device ownership | MS-AG06, MS-AG10 |
| Honest deferred/degraded UX | MS-C11..MS-C14, MS-PA22, MS-PA27 | Product contract + confirmed Prototype | UI Identity | MS-AG08, MS-AG11 |

## 5. Current-State Inventory

| Concern | Current asset | Current state | Target disposition |
|---|---|---|---|
| Top-level lifecycle | `apps/mobile/src/App.tsx` | Component effects coordinate Station, session, gates, and Shell | Replace with `MobileLifecycleKernel`; App renders projection |
| Shell navigation | `apps/mobile/src/components/MobileShell.tsx` | Tab switch plus store-owned detail identity | Introduce descriptor host; remove route ownership from stores |
| Runtime registry | `apps/mobile/src/runtimes/runtimeRegistry.ts` | Descriptive status records only | Replace with executable descriptors and validated DAG |
| Friend/social runtime | `apps/mobile/src/features/social/` | Real projection, SSE, presence, typing, reconcile | Adapt under shared Social supervisor and generated gateways |
| Group runtime | `apps/mobile/src/features/group/` | Separate projection/E2EE runtime | Keep domain owner; consume shared event ingress |
| Chat surface | `apps/mobile/src/pages/ChatPage.tsx` | Large coupled list/thread/composer/settings component | Split by accepted page/detail/overlay boundaries |
| Moments | `apps/mobile/src/pages/MomentsPage.tsx` | Publish/upload path without complete feed runtime | Add Station-backed feed/detail/comment/reaction projection |
| Settings | `apps/mobile/src/pages/SettingsPage.tsx` | Minimal session/Station/block surface | Add Me shell and selected-only account/device details |
| Identity | `authSession.ts`, auth/OAuth Proto | Legacy numeric/alias fields still accepted | PTID-only target; fail closed when PTID is absent |
| Global ActorRef consumers | `model/domain/actor/actor.proto` plus 27 non-generated consumers across Desktop, Station, and Model | `ActorRef.actor_id` remains live; Desktop session/identity paths still consume numeric identity | One repository-wide PTID cutover closure; no Mobile-only hard cut |
| Station registry | `features/station/`, `commands/station.rs` | URL reachability and label | Pin signed `station_peer_id`; URL remains hint |
| OAuth | native deep-link event + bridge Proto | No bound attempt/PKCE/consume lifecycle | Add Station attempt and `authRuntime` closure |
| Native secure storage | `src-tauri/platform/secure_storage/` | iOS implementation; other targets unsupported | Complete Android and deterministic failure behavior |
| Durable commands | messaging-core outbox types; no Mobile cross-domain ledger | No single Mobile reliability owner | Add encrypted Rust ledger behind `commandRuntime` |
| Drafts | Chat/Moments component state | Lost across process restart | Add encrypted Rust draft store |
| Acceptance | `tooling/acceptance/domains/index.yaml` | `mobile` is `planned/not_onboarded`; profile and capabilities are empty | Add the complete Mobile business Domain injection chain |

## 6. Dependency DAG

```text
W-1 Latest-master and worktree isolation preflight
  |
  v
W0 Mobile Acceptance Domain onboarding and baseline
  |
  v
W1 Unified ActorRef identity and Station trust
  |
  +--> W2 Access Gate and OAuth
  +--> W3 Lifecycle, runtime graph, and navigation
  +--> W4 InteractionAdmission, command ledger, and draft store

W3 + W4 --> W5 Generated gateway and Social projection convergence

W2 + W5 --> W6A Chat, Contacts, and Group product closure
W2 + W5 --> W6B Moments product closure
W2 + W5 --> W6C Profile and Settings product closure
W3 + W4 + W5 --> W6D Recovery and degraded-state closure

W2 + W3 + W4 + W5 --> W7 Native lifecycle and platform closure

W6A + W6B + W6C + W6D + W7 --> W8 Atomic old-path deletion
W0..W8 --> W9 Native Acceptance and readiness audit
```

Parallelization:

- No implementation work starts before W-1 and W0 pass.
- W2, W3, and W4 may proceed in parallel after W1 contracts are generated.
- Station domain implementations inside W2/W4 may proceed in parallel with
  Mobile kernel work in W3 after their Proto contracts stabilize.
- W6A, W6B, and W6C may run in parallel after W5 establishes one
  gateway/event/admission pattern.
- W6D may build its UI projections in parallel but cannot close before W3, W4,
  and W5 expose lifecycle, durable-state, and reconcile inputs.
- iOS and Android adapters in W7 may run in parallel against the same Rust port
  and Fixture contract; W7 cannot close before W5 proves shared event ingress.

## 7. Workstreams

### W-1: Latest-Master And Worktree Isolation Preflight

Responsibility:

- Establish a clean, reviewable implementation base before any W0-W9 change.

Deliverables:

- Create or select a dedicated Mobile Shell implementation worktree and branch
  whose merge-base is current `origin/master`.
- Port only reviewed Mobile and cross-architecture
  PRODUCT/DESIGN/Prototype/plan changes.
- Inventory and preserve unrelated dirty changes outside the implementation
  worktree.
- Record source commit, branch, changed-path allowlist, and clean baseline.

Gate:

```bash
git fetch origin master
test "$(git merge-base HEAD origin/master)" = "$(git rev-parse origin/master)"
git status --short
git diff --name-only origin/master...HEAD
```

Definition of done:

- The merge-base equals current `origin/master`.
- Every dirty or committed path belongs to the reviewed Mobile Shell scope.
- No implementation command has run in the mixed `merge-desktop-prototype`
  worktree.

Evidence:

- `tmp/evidence/mobile-shell/<run-id>/W-1/source-baseline.md`

Non-claim:

- A clean branch proves source identity only, not product behavior.

### W0: Mobile Acceptance Domain Onboarding And Baseline

Responsibility:

- Connect the accepted Mobile assertions to the existing `mobile` Acceptance
  Domain before any product claim.

Acceptance classification:

| Field | Value |
|---|---|
| Mode | ADD |
| Domain | existing `mobile` entry, currently `planned/not_onboarded` |
| Truth owners | Station business domains, Mobile Rust/runtime owners, native platform adapters |
| Receivers | iOS and Android Mobile users |
| Runtime cells | local static, iOS simulator/device, Android emulator/device, two-Station/two-actor environment |
| Existing proof | Prototype L1/L2/L3 design evidence only; production proof UNPROVEN |

Stable Acceptance IDs:

| Capability ID | Feature ID | Product assertions | Required Gate IDs |
|---|---|---|---|
| `mobile-station-access` | `mobile-station-trust` | MS-PA01, MS-PA16, MS-PA25 | `mobile-contract-static`, `mobile-identity-contract`, `mobile-native-access-e2e` |
| `mobile-station-access` | `mobile-access-gate-oauth` | MS-PA02, MS-PA03, MS-PA17, MS-PA25 | `mobile-contract-static`, `mobile-native-access-e2e` |
| `mobile-runtime-lifecycle` | `mobile-session-lifecycle` | MS-PA04, MS-PA05, MS-PA13, MS-PA14 | `mobile-contract-static`, `mobile-native-lifecycle-e2e` |
| `mobile-command-recovery` | `mobile-command-draft-recovery` | MS-PA07, MS-PA08, MS-PA23, MS-PA26 | `mobile-contract-static`, `mobile-native-recovery-e2e` |
| `mobile-command-recovery` | `mobile-recovery-degraded-states` | MS-PA14, MS-PA22, MS-PA23, MS-PA25, MS-PA26, MS-PA27 | `mobile-native-recovery-e2e`, `mobile-native-recovery-ui-e2e` |
| `mobile-social-product` | `mobile-chat-contacts-groups` | MS-PA06, MS-PA09, MS-PA10, MS-PA18, MS-PA19 | `mobile-native-social-convergence-e2e`, `mobile-native-chat-contacts-e2e` |
| `mobile-social-product` | `mobile-moments-participation` | MS-PA11, MS-PA20, MS-PA23 | `mobile-native-social-convergence-e2e`, `mobile-native-moments-e2e` |
| `mobile-social-product` | `mobile-profile-settings` | MS-PA12, MS-PA13, MS-PA21, MS-PA24 | `mobile-native-social-convergence-e2e`, `mobile-native-settings-e2e` |
| `mobile-native-quality` | `mobile-native-accessibility-performance` | MS-PA15, MS-PA24, MS-PA25, MS-PA27 | `mobile-native-platform-e2e`, `mobile-hard-cut-static` |

No implementation step may rename or merge these IDs. Any ID change is a plan
amendment because Registry, Capability, Feature, Gate, and evidence references
must remain stable.

Runtime Resource Manifest:

```yaml
environment_id: mobile-native
tier: env-evidence
profile:
  name: mobile-shell-acceptance
  slot: 7
  required: true
  identity_match: true
services:
  station-primary:
    kind: station
    mode: remote
    deploy_environment: station-two
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
  station-secondary:
    kind: station
    mode: remote
    deploy_environment: station-three
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
  relay:
    kind: relay
    required: true
    deploy_environment: relay-1
    health_action: relay-check
    status_action: relay-status
clients:
  - id: alice-ios
    actor: alice
    runtime: tauri-ios
    destination_ref: env:PT_MOBILE_IOS_DESTINATION
    profile: mobile-shell-alice-ios
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/alice-ios
  - id: bob-ios
    actor: bob
    runtime: tauri-ios
    destination_ref: env:PT_MOBILE_IOS_DESTINATION
    profile: mobile-shell-bob-ios
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/bob-ios
  - id: alice-android
    actor: alice
    runtime: tauri-android
    destination_ref: env:PT_MOBILE_ANDROID_PHYSICAL_DESTINATION
    profile: mobile-shell-alice-android
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/alice-android
  - id: bob-android
    actor: bob
    runtime: tauri-android
    destination_ref: env:PT_MOBILE_ANDROID_PHYSICAL_DESTINATION
    profile: mobile-shell-bob-android
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/bob-android
credentials:
  - source: committed disposable actor fixture
    path: apps/station/app/conf/actor.yml
    redact: true
  - variable: MOBILE_ACCEPTANCE_GITHUB_ACCOUNT
    source: approved secret
    redact: true
  - variable: MOBILE_ACCEPTANCE_GOOGLE_ACCOUNT
    source: approved secret
    redact: true
fixture:
  id: mobile-native-actors
  setup: python3 -m tooling.acceptance.fixtures.mobile_native_reset --prepare
  reset_authorization: env:MOBILE_ACCEPTANCE_RESET
  target_assertion: station-two and station-three are approved disposable targets
  initial_assertion: alice and bob have isolated PTID/device identities on both Stations
  teardown: python3 -m tooling.acceptance.fixtures.mobile_native_reset --cleanup
harness:
  namespace: __PEERS_MOBILE_ACCEPTANCE__
  policy: production actions only; direct Store mutation forbidden
evidence:
  - source commit and workspace digest
  - Station/Relay deployment attestations and peer IDs
  - per-client runtime, actor PTID, device ID, profile, ports, and storage identity
  - screenshots, AX trees, DOM/state projections, typed readbacks, redacted logs
cleanup:
  - close clients and native driver sessions in reverse acquisition order
  - release dynamic ports
  - remove per-run storage
  - revoke fixture sessions and restore/reset fixture data
  - release profile and deployment leases
```

Resource rules:

- The block above is the Environment Provisioning requirement. The immutable
  runtime output is the canonical `RuntimeManifest.services` map defined by
  Acceptance Framework D-13; each required role carries source-bound live
  attestation fields.
- `PT_MOBILE_IOS_DESTINATION` and
  `PT_MOBILE_ANDROID_PHYSICAL_DESTINATION` are required; actual devices are
  resolved from four fenced physical-device leases, and no simulator/emulator
  fallback may be chosen silently.
- Dynamic ports are allocated by binding port zero, then persisted in the run
  manifest before process launch.
- OAuth account variables are presence-checked and never printed or persisted.
- A missing Android generated project, destination, credential, Station
  attestation, or cleanup handler is `BLOCKED`, not permission to downgrade to
  browser or iOS-only evidence.

Deliverables:

- Add `check:mobile-shell-contracts`.
- Add `tooling/acceptance/domains/mobile.yaml`.
- Add `tooling/acceptance/capabilities/mobile.yaml`.
- Add the nine named Mobile Feature contracts from the stable-ID table.
- Add precise Mobile owned-path rules to `tooling/acceptance/registry.yaml`.
- Register stable local and environment Gate IDs in
  `tooling/acceptance/gates.yaml`.
- Add `tooling/acceptance/environments/mobile-native.yaml`,
  `tooling/acceptance/provisioners/mobile_native.py`,
  `tooling/acceptance/fixtures/mobile_native_reset.py`, the namespaced
  production Harness, and the exact cleanup policy above. These are business
  injection, not Acceptance Infra.
- Register `tooling/acceptance/plans/mobile-shell.json` covering
  `MS-PA01..MS-PA27`.
- Add deterministic fixtures for two actors, two devices, two Stations,
  disconnect points, revocation, overflow, and long content.
- Register the baseline interaction/resource evidence schema in W0. Capture
  pinned iOS/Android measurements in W9 after W7 provides both native runtime
  cells; W0 must not fabricate an early native baseline.

Gate:

```bash
pnpm mobile:check
pnpm --dir apps/mobile run check:mobile-shell-contracts
./tooling/scripts/proto-gen-mobile.sh
make acceptance-validate DOMAIN=mobile
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=origin/master...HEAD
python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static
```

Definition of done:

- The contract checker fails on identity aliases, manual domain DTO leakage,
  invalid runtime graphs, URL-keyed security state, duplicate command
  persistence, and retired adapters.
- Every owned Mobile path resolves through Registry -> Feature -> Capability ->
  Domain -> Gate without unrelated Gate selection.
- The runtime resource manifest names profiles, services, actor/device
  isolation, credential variable names, reset authorization, evidence identity,
  and reverse-order cleanup.
- Every acceptance row has a planned runtime cell and evidence path.

Evidence:

- Acceptance plan/run/validation roles in the external Evidence Store.
- `tmp/evidence/mobile-shell/<run-id>/W0/coverage-gap-matrix.md`.

Acceptance checkpoints:

- `ACCEPTANCE_REQUEST_CLASSIFIED`
- `ACCEPTANCE_SCOPE_INVENTORIED`
- `ACCEPTANCE_GAP_MATRIX_READY`
- `ACCEPTANCE_STAGE_DISPATCHED`
- `ACCEPTANCE_CONTRACTS_CONNECTED`
- `ACCEPTANCE_PLAN_SELECTED`

Non-claim:

- Structural onboarding and baseline collection do not prove native journeys.

### W1: Unified ActorRef Identity And Station Trust

Responsibility:

- Establish the only legal actor and Station scopes before credentials or
  durable local state can bind.

Deliverables:

- Implement the accepted repository-wide `ActorRef` PTID-only hard cut before
  relying on MS-P01 in Mobile.
- Implement MS-P07 challenge-signed Station handshake.
- Pin `station_peer_id` in the local registry after explicit first add.
- Partition session/cache/cursor/command/draft keys by Station peer ID and PTID.
- Reject missing PTID, signature failure, capability incompatibility, redirect
  identity change, and pinned-ID mismatch with typed errors.

Target areas:

- `model/domain/actor/`, `model/domain/auth/`, and every generated target.
- All non-generated `ActorRef` and numeric session consumers in Desktop Rust,
  Desktop TypeScript, Station Go, Mobile Web, and Mobile Rust.
- Station core/federation identity, JWT subject production/validation, Access
  Gate attempts, OAuth responses, and session persistence.
- `apps/mobile/src/features/station/`, `features/auth/`, storage projections.
- `apps/mobile/src-tauri/src/commands/station.rs`.

Deletion obligation:

- Reserve former `ActorRef.actor_id` field 1 and remove numeric identity from
  every API, event, JWT, Tauri command, generated adapter, client store, and
  session filename.
- Remove URL-only identity scope and `__default__` identity fallback.
- Complete the consumer inventory and tree-wide zero-reference scan before the
  cutover is marked done.

Gate:

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh
(cd apps/station && go test ./...)
(cd apps/desktop && pnpm run check && pnpm run test)
pnpm mobile:check
python3 tooling/scripts/acceptance-run.py --gate mobile-identity-contract
```

- MS-AG01 and MS-AG02, including ten Station/actor switches and peer mismatch.

Evidence:

- `tmp/evidence/mobile-shell/<run-id>/W1/`.

Definition of done:

- All generated and handwritten consumers compile against PTID-only `ActorRef`.
- Numeric identity appears only in explicitly listed Station repository
  persistence adapters.
- Desktop, Mobile, and Station identity tests pass in the same source revision.

### W2: Access Gate And OAuth

Responsibility:

- Complete credentials as one gate action without creating a pre-authorized
  business session.

Deliverables:

- Implement MS-P02 OAuth attempt and MS-P03 complete/status/cancel contracts.
- Bind provider, Station peer ID, access attempt, gate, redirect, PKCE
  challenge, nonce hash, state, expiry, and one-time consumption.
- Add station-scoped `authRuntime`.
- Keep session candidates secure and inactive until final `access_granted`.
- Add GitHub/Google native browser and deep-link handling on iOS and Android.

Target areas:

- `model/domain/oauth/`, `model/domain/access_gate/`, `model/domain/auth/`.
- `apps/station/app/subserver/oauth/` and access-gate integration.
- `apps/mobile/src/features/auth/`, `apps/mobile/src/runtimes/`.
- `apps/mobile/src-tauri/src/runtime/oauth/` and native adapters.

Failure closure:

- Cancel, expiry, replay, duplicate consume, provider mismatch, Station
  mismatch, stale generation, and later-gate denial all fail closed.

Accepted amendment execution order:

1. **W2-A Security stop-the-line**
   - remove Authorization header values from logs;
   - derive legacy authorization actor identity from authenticated consent;
   - atomically consume legacy authorization codes.
2. **W2-B Model and Station finalizer**
   - add first-class `auth.oauth` gate semantics;
   - bind device ID, lifecycle generation, attempt-secret hash, and credential
     delivery public key;
   - atomically finalize granted Access Attempt, candidate, candidate-keyed
     session, and encrypted credential envelope;
   - make status idempotently return the same envelope until acknowledgement.
3. **W2-C Rust-owned OAuth**
   - **W2-C1** generate Rust OAuth/Auth/AccessGate bindings and implement
     Station-compatible credential-envelope decryption with cross-language test
     vectors;
   - **W2-C2** move callback parsing and Station
     start/complete/status/cancel/ack transport into Mobile Rust;
   - **W2-C2** persist the active attempt index, attempt secret, and delivery
     private key in secure storage for cold-start recovery;
   - **W2-C2** expose only public projection state to Mobile Web and delete the
     old Web transport/secret-return path.
4. **W2-D Native adapters**
   - integrate approved `tauri-plugin-deep-link = 2.4.9` and
     `tauri-plugin-opener = 2.5.4`;
   - register iOS and Android callback schemes and cover warm/cold launch;
   - delete ad hoc iOS browser FFI and Android unsupported fallbacks.
5. **W2-E Native Acceptance**
   - **W2-E1 Simulator evidence** declares a separate `mobile-simulator`
     environment that owns iOS Simulator and Android emulator discovery, boot,
     Acceptance build deployment, Appium sessions, deterministic callback
     routing, source-bound evidence, and cleanup;
   - W2-E1 pins and verifies Appium `2.19.0`, XCUITest `9.10.5`, and
     UiAutomator2 `4.2.9` before session creation; Android WebView automation
     additionally requires an exact browser-major Chromedriver artifact with
     declared source, host/ABI compatibility, SHA-256, and external cache;
   - W2-E1 is supplemental evidence only and MUST NOT satisfy the
     physical-device MS-AG03 cell;
   - **W2-E2 Physical proof** keeps the existing `mobile-native` environment
     restricted to physical devices and approved provider credentials;
   - implement the acceptance-only typed registry and Appium XCUITest /
     UiAutomator2 drivers;
   - prove deterministic simulator/emulator failure paths;
   - prove real GitHub/Google completion on physical iOS and Android devices;
   - emit source-bound Station, DOM/AX, screenshot, lifecycle, and cleanup
     evidence.

Dependency order:

```text
W2-A -> W2-B -> W2-C --+
                 \      +-> W2-E
                  -> W2-D --+
```

W2-B contract generation may run in parallel with W2-A implementation after
field numbers are allocated. W2-C and W2-D may proceed in parallel after W2-B.
Native environment provisioning may run in parallel with W2-B/W2-C/W2-D, but
no native proof starts before both W2-C and W2-D and the credential/account
preflight pass.

Execution status:

- W2-A through W2-D: done for their planned implementation scope.
- W2-E1 Simulator evidence: done. The canonical external Evidence Store
  `latest` run passed both iPhone 15 Pro / iOS 17.4 and
  `peers_touch_applet_l3_e2e` runtime cells, including warm/cold invalid
  callback routing, WebView restart, fail-closed projections,
  DOM/AX/screenshots, runtime identity, and cleanup.
- W2-E2 source closure: `D-19_INFRA_LANDED / E2-5_SOURCE_COMPLETE`. The accepted
  architecture at `docs/architecture/mobile/native-oauth-proof/` defines the trusted
  negative-Fixture authority, authoritative Station proof, four-client
  provider-browser lease lifecycle, and physical-app build provenance.
  The Owner accepted MOP-D01..MOP-D04 on 2026-08-29. The focused execution plan
  is `docs/architecture/mobile/execution-plans/20260829-mobile-native-oauth-proof.md`;
  the base plan and accepted pre-D-19 amendments independently returned
  `0 P0 / 0 P1`. D-19 Infra landed via PR #105. E2-0 through E2-5 source-side
  closure are complete (finalizer module, registry, baseline, capability YAML,
  gate catalog update, and 11 adversarial tests all committed to master).
- W2-E2 Physical proof: `UNPROVEN / NOT STARTED`; approved provider accounts,
  two physical iOS devices, two physical Android devices are prerequisites.
  D-19 Infra and E2-5 source closure are no longer blockers.
  All 16 scenarios are source-executable, but no physical run is claimed.
  MS-AG03 remains `UNPROVEN`.

Gate:

- MS-AG03 plus MS-PA03, MS-PA17, and MS-PA25.

### W3: Lifecycle, Runtime Graph, And Navigation

Responsibility:

- Make lifecycle and surface lifetime executable, observable, and generation
  fenced.

Deliverables:

- Add `MobileLifecycleKernel` and top-level reducer.
- Replace static registry entries with `MobileRuntimeDescriptor` implementations.
- Validate `dependsOn` cycles and apply topological bootstrap/reverse teardown.
- Add descriptor-owned primary/detail/overlay navigation.
- Externalize scroll and focus restoration from page lifetime and define the
  draft restoration projection port consumed from W4.
- Implement bounded suspend/resume/reconcile and aggregate teardown results.

Target areas:

- `apps/mobile/src/app/lifecycle/`, `app/navigation/`, `runtimes/`.
- `App.tsx`, `components/MobileShell.tsx`.
- UI component-tree registry evidence.

Deletion obligation:

- Remove component-owned launch transitions.
- Remove `activeSessionUlid`/`activeGroupUlid` as route owners.
- Remove page-owned streams, polling, and mount-time truth fetches.

Gate:

- MS-AG02, MS-AG05, MS-AG07, MS-AG08, and MS-AG11.

### W4: InteractionAdmission, Command Ledger, And Draft Store

Responsibility:

- Provide one restart-safe Mobile reliability path for all admitted writes and
  one independent encrypted draft persistence path.

Deliverables:

- Implement MS-P04 command result/readback and MS-P06 typed command envelope.
- Add `commandRuntime` as the Mobile `InteractionAdmission` adapter.
- Add encrypted transactional Rust ledger with per-key ordering, four-key
  fairness, capacity limits, crash recovery, and schema migration.
- Add MS-P08 encrypted Chat/Moments draft store.
- Connect W3's draft restoration port to the Rust draft store and prove
  unmount/background/restart restoration.
- Project ledger state into domain-visible pending/failed/unknown state.

Target areas:

- Model/Station command result contracts.
- `apps/mobile/src/runtimes/commandRuntime.ts`.
- `apps/mobile/src-tauri/src/runtime/command_ledger/`.
- `apps/mobile/src-tauri/src/runtime/draft_store/`.

Deletion obligation:

- Remove any Mobile durable Social outbox, native Room/SwiftData queue, and
  component-local persistence claim.
- Keep `ChatOutboxItem` projection-only.

Gate:

- MS-AG04, MS-AG09, and MS-AG10.

### W5: Generated Gateway And Social Projection Convergence

Responsibility:

- Converge business domains on generated Proto, one shared event ingress, and
  runtime-owned projection freshness.

Deliverables:

- Quarantine temporary JSON compatibility inside domain API gateways.
- Route Social/group/Moments/notification/profile events through one shared
  typed ingress with control/data capacity and cursor repair.
- Keep `groupRuntime` as a subordinate projection descriptor.
- Add per-domain command outcome/readback adapters.
- Complete MS-P05 account preference contracts.

Target areas:

- `apps/mobile/src/features/social/`, `features/group/`, new runtime-owned
  Moments/profile/settings projections.
- `apps/mobile/src/services/api/`.
- Station social/conversation/notification/actor domains.

Failure closure:

- Data overflow marks affected projections stale and reconciles.
- Control-event loss closes write admission and revalidates the session.
- Module failure renders unavailable state, never fabricated empty data.

Deletion obligation:

- Remove retired JSON/manual DTO paths after each domain reaches parity.
- Remove duplicate long-lived Station event streams.

Gate:

- MS-AG01, MS-AG06, MS-AG09, and MS-AG10.

### W6A: Chat, Contacts, And Group Product Closure

Responsibility:

- Complete Chat, Contacts, and Group receiver journeys on the shared Social
  projection and InteractionAdmission contracts.

Deliverables:

- Chat: list, detail, attachment, typing, search, message actions, conversation
  settings, group administration, visible uncertain outcomes.
- Contacts/groups: requests, federated resolve, profile, duplicate/no-result/
  unavailable/role-denied states.

Rules:

- Pages render narrow selectors and dispatch typed commands only.
- All visible text uses `packages/locales/`.
- Conversation/message/contact/member lists are virtualized or bounded and
  preserve anchors.

Gate:

- MS-PA06..MS-PA10, MS-PA18, and MS-PA19 through AS-05..AS-07.

Target areas:

- `apps/mobile/src/pages/ChatPage.tsx`,
  `apps/mobile/src/pages/ContactsPage.tsx`.
- `apps/mobile/src/features/social/`, `apps/mobile/src/features/group/`.
- Station conversation, messaging, social relationship, and group handlers.

### W6B: Moments Product Closure

Responsibility:

- Complete Station-backed Moments participation without page-owned freshness.

Deliverables:

- Feed/detail pagination, audience, publish, reaction, comment, reply, draft
  recovery, rollback, and policy/empty/unavailable states.
- Runtime-owned projection with generated Social Proto gateways.
- Virtualized or bounded feed with stable anchors.

Target areas:

- `apps/mobile/src/pages/MomentsPage.tsx`.
- Mobile Moments runtime/projection/gateway modules.
- Station Social post/comment/reaction handlers and tests.

Gate:

- MS-PA11, MS-PA20, and MS-PA23 through AS-08.

### W6C: Profile And Settings Product Closure

Responsibility:

- Complete account and device settings with explicit persistence ownership.

Deliverables:

- Profile, account preferences, device preferences, notifications, privacy,
  storage, blocked users, language, permissions, Station change, and logout.
- Dirty/save/discard/conflict behavior and selected-only settings detail mount.
- Station readback for shared preferences and typed local readback for device
  preferences.

Target areas:

- `apps/mobile/src/pages/SettingsPage.tsx`.
- Mobile profile/settings runtime, projection, and gateway modules.
- Station actor/preferences and notification preference handlers.

Gate:

- MS-PA12, MS-PA13, MS-PA21, and MS-PA24 through AS-09 and AS-10.

### W6D: Recovery And Degraded-State Closure

Responsibility:

- Project lifecycle, trust, ledger, draft, and capability failures into the
  confirmed recovery surfaces.

Deliverables:

- Draft restore, unknown outcome, capacity/read-only, revocation, Station
  identity mismatch, event-overflow reconcile, deferred capability, and
  device-local flag states.
- No recovery surface creates a second retry, persistence, or lifecycle owner.

Target areas:

- Mobile recovery projection and overlay descriptors.
- Confirmed Prototype-to-production replica mapping.
- `packages/locales/` Mobile recovery keys.

Gate:

- MS-PA14..MS-PA17 and MS-PA22..MS-PA27 through AS-04, AS-06, and AS-10..AS-15.

### W7: Native Lifecycle And Platform Closure

Responsibility:

- Make the accepted Web/Rust/native ports real on both supported platforms.

Deliverables:

- Complete Android secure storage parity with iOS.
- Complete deep-link, push/wakeup, network, permission, background/resume, and
  media ports.
- Propagate lifecycle generation through native events and reject stale events.
- Ensure WorkManager/BGTaskScheduler emits wakeups only; Rust/runtime owners
  perform reconciliation and command convergence.
- Add platform-specific accessibility and permission evidence.

Dependencies:

- W2, W3, W4, and W5 must expose stable auth, lifecycle, reliability, and
  shared-event ports before W7 may close.

Gate:

- Physical-device MS-AG03, MS-AG05, MS-AG08, MS-AG10, and MS-AG11.

### W8: Atomic Old-Path Deletion

Responsibility:

- Complete every cutover with one live source of truth.

Required deletion checks:

| Replaced concern | New owner | Old path removed when | Zero-reference proof |
|---|---|---|---|
| App lifecycle effects | `MobileLifecycleKernel` | every entry transition uses kernel | scan for direct launch-state mutation |
| Static runtime catalog | executable registry | all runtime owners register lifecycle | scan old descriptor shape |
| Store-owned routes | navigation descriptors | deep link/back/focus pass | scan route use of active store IDs |
| Numeric actor identity | PTID | Station/gateway/session parity passes | scan aliases outside migration ingress |
| URL security scope | `station_peer_id` | handshake migration passes | scan URL-keyed credential/ledger/cache keys |
| Manual/JSON domain path | generated Proto gateway | per-domain parity passes | import/type scan |
| Duplicate outbox/queue | Rust command ledger | all command projections migrate | persistence-owner scan |
| Component-only drafts | Rust draft store | restart recovery passes | storage/write-path scan |
| Duplicate event streams | shared social ingress | domain reconcile passes | stream/listener inventory |

Rollback uses source-control/deployment rollback. No permanent dual-write,
compatibility shim, or hidden feature flag remains after a cutover gate passes.

### W9: Native Acceptance And Readiness Audit

Responsibility:

- Prove the accepted product and architecture on claimed runtime cells.

Deliverables:

- Execute every Acceptance Scenario in §10.
- Produce evidence indexed by every `MS-PAxx` and `MS-AGxx`.
- Record lifecycle generation, Station/PTID scope, command ID, queue depth,
  resource counts, timing percentiles, and typed errors without secrets or PII.
- Run `pt-acceptance-gap-detector`, `pt-quality-check`, and
  `pt-completion-auditor`.

Final gate:

- All required rows are `PASS`.
- Missing, stale, mock-only, single-actor, browser-only, or unindexed evidence
  remains `UNPROVEN` and blocks readiness.

## 8. Workstream Execution Contracts

Commands named below are stable target entrypoints. A workstream that introduces
an entrypoint must add its script/Gate definition before using that command as
evidence.

| Workstream | Required commands | Evidence | Done / non-claim |
|---|---|---|---|
| W-1 | `git fetch origin master`; merge-base/status/path-allowlist checks from W-1 | `tmp/evidence/mobile-shell/<run-id>/W-1/` | Clean latest-master implementation worktree; no product claim |
| W0 | `make acceptance-validate DOMAIN=mobile`; `make acceptance-coverage-report`; `make acceptance-plan ACCEPTANCE_RANGE=origin/master...HEAD`; `python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static` | Acceptance plan/validation roles plus `W0/coverage-gap-matrix.md` | Full Domain trace resolves; native rows remain UNPROVEN |
| W1 | `./model/build.sh`; `./tooling/scripts/proto-gen-mobile.sh`; `(cd apps/station && go test ./...)`; `(cd apps/desktop && pnpm run check && pnpm run test)`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-identity-contract` | `W1/` generated-contract, scan, and switch evidence | All consumers compile PTID-only; no session/Station behavior claim beyond tested cells |
| W2 | `(cd apps/station && go test ./app/subserver/oauth/... ./frame/touch/accessgate/...)`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-access-e2e` | Simulator evidence plus physical Acceptance Gate run and `W2/` attempt/readback evidence | W2-E1 simulator cells pass without claiming provider success; AS-02/AS-03 pass on both physical platforms before MS-AG03 is proven; other business domains not claimed |
| W3 | `pnpm --dir apps/mobile run check:lifecycle-runtime`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-lifecycle-e2e` | `W3/` transition, generation, resource, focus, and navigation evidence | Lifecycle/navigation state graph passes; draft durability remains W4 |
| W4 | `(cd apps/mobile/src-tauri && cargo test --offline)`; `pnpm --dir apps/mobile run check:command-runtime`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-recovery-e2e` | `W4/` ledger/draft/fault-matrix evidence | Ordering, fairness, restart, capacity, readback, and draft scope pass; domain UI remains W6A-W6D |
| W5 | `pnpm --dir apps/mobile run check:social-wire`; `pnpm --dir apps/mobile run check:social-runtime-boundaries`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-social-convergence-e2e` | `W5/` ingress/cursor/readback and zero-duplicate-stream evidence | Generated gateways and one ingress converge; product completeness remains W6A-W6D |
| W6A | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-chat-contacts-e2e` | `W6A/` two-actor/two-Station receiver evidence | AS-05..AS-07 pass; Moments/settings not claimed |
| W6B | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-moments-e2e` | `W6B/` feed/publish/rollback/readback evidence | AS-08 passes; other surfaces not claimed |
| W6C | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-settings-e2e` | `W6C/` account/local/readback/conflict evidence | AS-09/AS-10 settings assertions pass; recovery overlay remains W6D |
| W6D | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-recovery-ui-e2e` | `W6D/` recovery/degraded screenshots, AX, and state evidence | AS-04/AS-06/AS-10..AS-15 visible recovery assertions pass |
| W7 | `pnpm --dir apps/mobile run check:native-platforms`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-platform-e2e` | `W7/ios/`, `W7/android/`, permission/lifecycle/cleanup reports | Both declared native cells pass; browser/prototype evidence is not substituted |
| W8 | `pnpm --dir apps/mobile run check:mobile-shell-deletions`; `python3 tooling/scripts/acceptance-run.py --gate mobile-hard-cut-static` | `W8/` zero-reference report | Every deletion row is zero; no compatibility or runtime claim beyond scans |
| W9 | `make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json`; `python3 tooling/scripts/acceptance-validate.py --domain mobile --require-proven`; `make acceptance-report`; `make acceptance-coverage-report` | Immutable Acceptance runs, validation report, cleanup audit | Only mapped passing runtime cells become PROVEN |

Every workstream must also update affected architecture/platform docs and the
nearest directory README when public paths, contracts, or conventions change.

## 9. End-To-End Lifecycle Coverage

| Lifecycle | Workstreams |
|---|---|
| First Station add → signed pin → Access Gate → Shell | W1, W2, W3 |
| Returning session → validation → bootstrap | W1, W2, W3, W5 |
| Read/write → commit/event → projection | W4, W5, W6A, W6B, W6C |
| Disconnect → unknown outcome → readback → converge | W4, W5 |
| Background → wakeup → validate → reconcile → reopen writes | W3, W5, W7 |
| Station/actor switch → hide → teardown → clear/quarantine → bootstrap | W1, W3, W4, W7 |
| Overload → typed reject/read-only → recovery | W4, W6D |
| Native permission/deep-link/push failure | W2, W3, W7 |
| Old-path removal → single-source verification | W8 |
| Production readiness decision | W9 |

## 10. Acceptance Scenarios

Every scenario starts `pending`. Evidence must come from the stated native
runtime cell; Prototype screenshots establish design intent only.

Closure-level negative coverage:

| Closure | Scenarios | Success | Network error | Timeout | Invalid input | Cancellation |
|---|---|---|---|---|---|---|
| W1 | AS-01, AS-10 | verified add/switch | unreachable Station | handshake expiry | malformed URL/signature/capabilities | keep/remove/replace cancel |
| W2 | AS-02, AS-03 | final grant | provider/Station unavailable | attempt/callback expiry | state/provider/redirect mismatch | provider and gate cancel |
| W3 | AS-04, AS-10, AS-13 | bootstrap/resume/navigation | reconcile unavailable | bounded bootstrap/teardown | unknown route/stale generation | back, logout, Station-switch cancel |
| W4 | AS-06, AS-11, AS-12 | commit/readback/restore | disconnect at three write points | submit/readback deadline | malformed command/draft schema | queued command/draft discard |
| W5 | AS-05..AS-09, AS-12 | shared ingress convergence | stream/domain unavailable | cursor repair deadline | malformed/unknown event | domain action cancellation |
| W6A | AS-05..AS-07 | Chat/contact/group journeys | send/resolve unavailable | upload/resolve timeout | invalid content/actor/role | composer/request/admin cancel |
| W6B | AS-08 | Moments journey | feed/publish unavailable | upload/page timeout | invalid media/audience/comment | composer/reply cancel |
| W6C | AS-09, AS-10 | settings/save/logout | preference/revoke unavailable | save/revoke timeout | invalid preference/profile | discard/stay/logout cancel |
| W6D | AS-04, AS-06, AS-10..AS-15 | visible recovery | degraded/offline | recovery deadline | corrupt state/unsupported schema | keep draft/read-only/back |
| W7 | AS-03, AS-04, AS-10, AS-13 | native lifecycle | OS/network unavailable | native callback/background deadline | invalid deep link/permission payload | OS browser/permission cancel |
| W8 | AS-01..AS-15 rerun | single-path product | inherited scenario failures | inherited scenario timeouts | forbidden-reference injection | inherited scenario cancellation |
| W9 | AS-01..AS-15 | complete planned run | Gate environment failure | Gate timeout | malformed/missing evidence | run cancellation with cleanup |

| Scenario | Product acceptance | Architecture gates |
|---|---|---|
| AS-01 | MS-PA01, MS-PA16, MS-PA25 | MS-AG01, MS-AG02 |
| AS-02 | MS-PA02, MS-PA17 | MS-AG02, MS-AG03 |
| AS-03 | MS-PA03, MS-PA25 | MS-AG03 |
| AS-04 | MS-PA04, MS-PA05, MS-PA14, MS-PA25 | MS-AG02, MS-AG05, MS-AG06 |
| AS-05 | MS-PA06, MS-PA18 | MS-AG04, MS-AG06, MS-AG10 |
| AS-06 | MS-PA07, MS-PA08 | MS-AG04, MS-AG06, MS-AG09 |
| AS-07 | MS-PA09, MS-PA10, MS-PA19 | MS-AG06, MS-AG09 |
| AS-08 | MS-PA11, MS-PA20, MS-PA23 | MS-AG04, MS-AG06, MS-AG10 |
| AS-09 | MS-PA12, MS-PA21, MS-PA24 | MS-AG06, MS-AG08, MS-AG10, MS-AG11 |
| AS-10 | MS-PA13, MS-PA14, MS-PA16, MS-PA25 | MS-AG02, MS-AG05 |
| AS-11 | MS-PA22, MS-PA23 | MS-AG05, MS-AG10 |
| AS-12 | MS-PA26 | MS-AG09 |
| AS-13 | MS-PA24 | MS-AG08, MS-AG11 |
| AS-14 | MS-PA15 | MS-AG07, MS-AG08 |
| AS-15 | MS-PA27 | MS-AG08, MS-AG11 |

### AS-01: First Station Entry And Trust
- **Precondition**: Fresh install with no Station.
- **Action**: User adds a reachable Station and continues.
- **Expected**: Signed identity is shown/pinned, current Access Gate appears,
  and Shell stays hidden before grant.
- **Failure variant**: Invalid address, unreachable target, capability mismatch,
  or changed peer ID yields a typed recoverable/blocking state.
- **Evidence**: iOS/Android UI capture, signed handshake trace, registry readback.
- **Status**: pending

### AS-02: Email And Arbitrary Gate Chain
- **Precondition**: Station requires auth followed by invite/device/terms/custom gates.
- **Action**: User completes or cancels each requested gate.
- **Expected**: Station order is preserved and Shell appears only after final grant.
- **Failure variant**: Denial/expiry remains outside Shell with a valid next action.
- **Evidence**: two-platform DOM/AX capture plus Station decision/audit readback.
- **Status**: pending

### AS-03: OAuth Binding And Replay Defense
- **Precondition**: GitHub/Google gate on a verified Station.
- **Action**: User authorizes and returns through the native deep link.
- **Expected**: The same attempt resumes and later gates continue; session
  activates only after final grant.
- **Failure variant**: Cancel, expiry, replay, provider/Station mismatch, and
  stale generation fail closed without exposing secrets.
- **Evidence**: physical iOS/Android trace plus one-time Station attempt readback.
- **Status**: pending

### AS-04: Session Restore And Revocation
- **Precondition**: Valid session, then separately a revoked session.
- **Action**: User cold-starts and later resumes the app.
- **Expected**: Valid scope restores; revoked scope hides old data and returns to auth.
- **Failure variant**: Validation timeout keeps writes closed and marks stale.
- **Evidence**: cold-start/resume UI, secure-store metadata, Station session readback.
- **Status**: pending

### AS-05: Friend And Group Conversation
- **Precondition**: Two actors on two devices with friend and group conversations.
- **Action**: Send text/media, receive, type, search, edit, recall, delete, and
  change conversation settings.
- **Expected**: Visible states progress monotonically and committed state survives reload.
- **Failure variant**: Permission/upload/network errors preserve readable
  content and actionable recovery.
- **Evidence**: both devices plus Station message/event/settings readback.
- **Status**: pending

### AS-06: Advanced Message Actions And Unknown Outcome
- **Precondition**: Conversation supports reactions, pins, forward, and threads.
- **Action**: Execute each action and disconnect at pre-dispatch,
  post-dispatch, and post-commit.
- **Expected**: Exactly one effect commits; unknown status is visible and
  readback precedes retry.
- **Failure variant**: No outcome API leaves the item visibly unresolved.
- **Evidence**: ten trials per disconnect point, command IDs, Station event/history.
- **Status**: pending

### AS-07: Contacts And Group Administration
- **Precondition**: Local/remote actors and owner/admin/member roles.
- **Action**: Resolve, request, accept/reject, create group, and manage members.
- **Expected**: Relationship and role mutations match Station readback.
- **Failure variant**: No result, duplicate, remote unavailable, and role denial
  remain distinct and recoverable.
- **Evidence**: two actors/two Stations plus relationship/group readback.
- **Status**: pending

### AS-08: Moments Participation
- **Precondition**: Feed with empty, filtered, remote, and policy-hidden fixtures.
- **Action**: Paginate, publish text/images, react, comment, and reply.
- **Expected**: Audience is visible; committed state converges on both actors.
- **Failure variant**: Rejection rolls back optimistic state and preserves draft.
- **Evidence**: two actors/two Stations plus post/comment/reaction readback.
- **Status**: pending

### AS-09: Profile And Settings
- **Precondition**: Account and device preferences with a second-device conflict.
- **Action**: Edit profile, language, notification, privacy, storage, and block settings.
- **Expected**: Account settings converge through Station; device settings remain local.
- **Failure variant**: Dirty exit, permission denial, save failure, and external
  conflict expose save/discard/stay/retry paths.
- **Evidence**: restart/second-device UI plus Station and local readback.
- **Status**: pending

### AS-10: Station Change And Logout
- **Precondition**: Active Shell with streams, timers, drafts, and pending commands.
- **Action**: Change Station or log out during inflight work.
- **Expected**: Old content hides immediately; reverse teardown completes before
  next bootstrap; unresolved local work stays exact-scope quarantined.
- **Failure variant**: Secure-delete failure blocks; remote revoke failure yields
  `remote-revocation-unconfirmed` after local credentials become unusable.
- **Evidence**: ten switches, resource counts, secure-store and projection absence.
- **Status**: pending

### AS-11: Draft And Device-Local Flag
- **Precondition**: Chat/Moments drafts and a locally flagged message.
- **Action**: Unmount detail, background, kill, restart, and inspect a second device.
- **Expected**: Draft restores only in the exact Station/PTID scope; flag remains
  explicitly device-only and absent elsewhere.
- **Failure variant**: Corrupt/unsupported draft schema fails closed without
  leaking plaintext or another scope.
- **Evidence**: encrypted-store metadata, UI captures, second-device absence.
- **Status**: pending

### AS-12: Admission And Event Overload
- **Precondition**: Slow Station, full ledger boundary, and event flood fixture.
- **Action**: Submit 50 intents across eight keys and inject 2,000 data events
  plus revocation.
- **Expected**: Per-key order and cross-key fairness hold; reads remain
  available; writes reject with typed overload; revocation closes admission.
- **Failure variant**: Data overflow marks stale and reconciles; control loss
  revalidates session.
- **Evidence**: queue/worker counters, command IDs, reconcile and Station readback.
- **Status**: pending

### AS-13: Accessibility, Localization, And Layout
- **Precondition**: Smallest/largest viewport, longest locale, maximum text,
  reduced motion, keyboard open/closed.
- **Action**: Complete all primary journeys with VoiceOver and TalkBack.
- **Expected**: Semantic order, labels, focus restore, safe-area clearance, and
  content wrapping remain correct.
- **Failure variant**: Permission/error/recovery surfaces remain operable without
  relying on motion or color alone.
- **Evidence**: AX trees, focus traces, screenshots, and layout assertions.
- **Status**: pending

### AS-14: Long-List Performance
- **Precondition**: Accepted data volumes on pinned lower/current-tier devices.
- **Action**: Switch tabs, return to details, scroll, receive events, and reconcile.
- **Expected**: P95 <= 100 ms, P99 <= 150 ms, no unwaived main-thread task over
  50 ms, stable scroll/focus, and bounded render/memory.
- **Failure variant**: Slow dependency or hidden update does not freeze visible interaction.
- **Evidence**: 5 warmups + 30 runs per route with interaction-linked traces.
- **Status**: pending

### AS-15: Deferred Capability Honesty
- **Precondition**: Shell surfaces where WeChat, call, Docs, and local flag could appear.
- **Action**: Inspect and activate available affordances.
- **Expected**: Deferred capabilities are absent or disabled with a useful
  reason; no fake flow begins; local flag states its device scope.
- **Failure variant**: Any enabled unsupported action fails the scenario.
- **Evidence**: iOS/Android surface inventory and interaction capture.
- **Status**: pending

## 11. Implementation Status

| Workstream | Status | Completion evidence |
|---|---|---|
| W-1 Latest-master and worktree isolation preflight | done | `tmp/evidence/mobile-shell/20260827/W-1/source-baseline.md` |
| W0 Mobile Acceptance Domain onboarding and baseline | done | `tmp/evidence/mobile-shell/20260827/W0/coverage-gap-matrix.md`; D-13 hard cut; structural validation and static Gate PASS; native proof remains UNPROVEN |
| W1 Unified ActorRef identity and Station trust | done | `tmp/evidence/mobile-shell/20260827/W1/progress.md`; PTID-only Proto/API cutover, signed Station verification, atomic schema migrations, scoped Station tests, Desktop/Mobile checks, and identity Gate PASS; MS-AG02 native runtime proof remains explicitly UNPROVEN until the integrated native runtime cell |
| W2 Access Gate and OAuth | in progress | `tmp/evidence/mobile-shell/20260827/W2/progress.md`; W2-A through W2-D and W2-E1 Simulator evidence are done; E2-0 through E2-4 source closures done; D-19 Infra landed (PR #105); E2-5 source-side closure done (finalizer module, registry, baseline, capability YAML, gate catalog, 11 adversarial tests); E2-5 atomic cutover complete; A5-11 main plan update done; E2-6 physical proof remains `UNPROVEN` — requires physical iOS/Android devices and approved provider accounts |
| W3 Lifecycle, runtime graph, and navigation | pending | — |
| W4 InteractionAdmission, command ledger, and draft store | pending | — |
| W5 Generated gateway and Social projection convergence | pending | — |
| W6A Chat, Contacts, and Group product closure | pending | — |
| W6B Moments product closure | pending | — |
| W6C Profile and Settings product closure | pending | — |
| W6D Recovery and degraded-state closure | pending | — |
| W7 Native lifecycle and platform closure | pending | — |
| W8 Atomic old-path deletion | pending | — |
| W9 Native Acceptance and readiness audit | pending | — |

## 12. Risks And Escalation

- W-1 is a hard execution prerequisite, not a waivable risk. Failure to obtain
  latest-master ancestry or path isolation keeps all later workstreams blocked.
- Any required version bump stops for explicit Owner approval.
- Any need for permanent dual paths, a second event stream, a second command
  persistence owner, or URL-keyed security state returns to DESIGN.
- Any undefined product outcome discovered during implementation returns to
  PRODUCT.
- Native evidence infrastructure failure remains `UNPROVEN`; it is not waived
  as flaky without root-cause evidence.

## 13. Final Readiness Gate

`USER_TRIAL_READY` requires:

1. `MS-C01..MS-C10` and degraded `MS-C14` pass all mapped acceptance rows.
2. `MS-C11..MS-C13` remain absent/disabled and are not advertised as ready.
3. `MS-AG01..MS-AG11` have current, indexed evidence.
4. Every atomic deletion scan returns zero live legacy references.
5. iOS and Android native cells pass without mock business APIs.
6. `pt-acceptance-gap-detector`, `pt-quality-check`, and
   `pt-completion-auditor` pass.

Until then, Mobile Shell production readiness is `UNPROVEN`.
