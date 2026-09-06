# Mobile Shell — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-09-06
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
- `docs/architecture/api-ownership/`
- `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`
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
- Accepted Conversation DDD, resource-owned API, single Chat entry point, and shared
  Federation hard cut required to make W9-D truthful.

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
| Durable commands | Messaging Core owns Chat command/outbox semantics; no Mobile cross-domain ledger | Mobile lacks the Messaging Engine adapter and a non-messaging reliability owner | Complete MP-W09 Mobile adapter; keep the encrypted Rust `commandRuntime` ledger for non-messaging domain writes only |
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

AO-D01..AO-D06 + MP-D30 + Social D-07 --> CA-HC Conversation Authority hard cut
MP-W09 Phase 2 core ownership ----------> CA-HC
W3 + W4 + CA-HC -----------------------> W5 Generated gateway and Social projection convergence

W2 + W5 + CA-HC --> W6A Chat, Contacts, and Group product closure
W2 + W5 --> W6B Moments product closure
W2 + W5 --> W6C Profile and Settings product closure
W3 + W4 + W5 --> W6D Recovery and degraded-state closure

W2 + W3 + W4 + W5 --> W7 Native lifecycle and platform closure

CA-HC + W6A + W6B + W6C + W6D + W7 --> W8 Atomic old-path deletion
W0..W8 --> W9 Native Acceptance and readiness audit
```

Parallelization:

- No implementation work starts before W-1 and W0 pass.
- W2, W3, and W4 may proceed in parallel after W1 contracts are generated.
- MP-W09 Phase 2 must move OpenMLS protocol/state-machine ownership into
  `packages/messaging-core/` before the Mobile adapter can close.
- MP-W09 Phase 4 may proceed in parallel with non-Chat W5 gateway work after
  the shared core contract is complete.
- Station domain implementations inside W2/W4 may proceed in parallel with
  Mobile kernel work in W3 after their Proto contracts stabilize.
- W6B and W6C may run in parallel after W5 establishes one
  gateway/event/admission pattern. W6A remains blocked until CA-HC also completes.
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
- Keep Chat commands out of this generic ledger. Chat uses the Device Messaging
  Engine command/outbox transaction defined by MP-D01 and MP-D16.
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

### CA-HC: Conversation Authority DDD And Messaging Facade Hard Cut

Responsibility:

- Execute the accepted cross-layer prerequisite before W5/W6A/W8/W9-D can close.

Plan:

- `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`

Required result:

- Conversation is one Station DDD bounded context with aggregate/application/
  infrastructure/interface boundaries and one authority UOW/store family.
- Conversation is the sole public Chat entry point; the retired Station Chat facade
  is absent.
- Device, Inbox, Recovery, Key Exchange, Attachment, and Federation APIs are owned by
  their accepted resource domains.
- Internal `packages/messaging-core` remains the Desktop/Mobile protocol engine.
- Shared Federation transport supports both Conversation and Social typed adapters.
- Cross-Station Friend Request passes before Chat/Contacts runs.

Gate:

- `CA-W0..CA-W7` and `CA-AS01..CA-AS08` from the linked plan.

Non-claim:

- Pre-consolidation runtime evidence proves behavior of the retained implementation,
  not compliance with the accepted target architecture.

### W5: Generated Gateway And Social Projection Convergence

Responsibility:

- Converge business domains on generated Proto, one shared event ingress, and
  runtime-owned projection freshness.
- Complete the accepted MP-W09 Mobile adapter dependency before cutting Chat
  and Group consumers over to Device Messaging Engine projections.

Deliverables:

- Quarantine temporary JSON compatibility inside domain API gateways.
- Finish portable OpenMLS ownership in `packages/messaging-core/`, then
  implement the Mobile SQLCipher, key material, transport, lifecycle, and
  projection adapters defined by MP-D16.
- Register typed Mobile Tauri Messaging Engine commands whose Station transports use
  the canonical Conversation/Device/Recovery/Key Exchange/Federation resource routes.
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
- Remove retired Mobile Chat transport semantics and any Chat use of the generic
  `commandRuntime` ledger.

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
- Station Conversation DDD, Conversation Delivery, Social relationship, and
  group handlers.

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
| Duplicate outbox/queue | Messaging Engine outbox for Chat; Rust `commandRuntime` ledger for non-messaging domains | all Chat commands use the Engine and all other durable commands use exactly one generic ledger | persistence-owner and command-kind scan |
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
| CA-HC | Commands and Gates in `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md` §12 | `tmp/evidence/api-ownership/<run-id>/CA-W0..CA-W7/` | CA-W0..CA-W7 and CA-AS01..CA-AS08 pass; Conversation DDD and sole Chat ownership are proven without compatibility paths |
| W5 | `pnpm --dir apps/mobile run check:social-wire`; `pnpm --dir apps/mobile run check:social-runtime-boundaries`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-social-convergence-e2e` | `W5/` ingress/cursor/readback and zero-duplicate-stream evidence | Supplemental simulator evidence may prove only the declared partial MS-AG06 cell; full projection freshness remains owned by the physical Gate |
| W6A | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-chat-contacts-e2e` | `W6A/` two-actor/two-Station receiver evidence | Supplemental simulator evidence may prove only implemented Direct/Group Messaging journeys; full AS-05..AS-07 remains owned by the physical Gate |
| W6B | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-moments-e2e` | `W6B/` feed/publish/rollback/readback evidence | AS-08 passes; other surfaces not claimed |
| W6C | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-settings-e2e` | `W6C/` account/local/readback/conflict evidence | AS-09/AS-10 settings assertions pass; recovery overlay remains W6D |
| W6D | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-recovery-ui-e2e` | `W6D/` recovery/degraded screenshots, AX, and state evidence | AS-04/AS-06/AS-10..AS-15 visible recovery assertions pass |
| W7 | `pnpm --dir apps/mobile run check:native-platforms`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-platform-e2e` | `W7/ios/`, `W7/android/`, permission/lifecycle/cleanup reports | Both declared native cells pass; browser/prototype evidence is not substituted |
| W8 | `pnpm --dir apps/mobile run check:mobile-shell-contracts -- --hard-cut`; `python3 tooling/scripts/acceptance-run.py --gate mobile-hard-cut-static` | `W8/` zero-reference report | Every deletion row is zero; no compatibility or runtime claim beyond scans |
| W9 | `make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json`; `python3 tooling/scripts/acceptance-validate.py --domain mobile --require-proven`; `make acceptance-report`; `make acceptance-coverage-report` | Immutable Acceptance runs, validation report, cleanup audit | Only mapped passing runtime cells become PROVEN |

### W9 Gate Execution Order

Gates must execute in dependency order. A phase failure blocks all subsequent
phases.

| Phase | Gates | Environment | Prerequisite |
|---|---|---|---|
| W9-A Static | MS-AG01 | CI/local | Proto gen clean |
| W9-B Layout/A11y | MS-AG08, MS-AG11 | iOS simulator | Usable app on simulator |
| W9-C Lifecycle | MS-AG02, MS-AG05 | iOS simulator + Station | Station with identity endpoint |
| W9-D Social | `mobile-simulator-social-convergence-e2e` and `mobile-simulator-chat-contacts-e2e`; MS-AG06 partial and MS-AG04 partial only | 2 simulators + 2 dedicated Stations + Relay + 2 disposable accounts; source-bound receiver projections and deterministic cleanup | W9-C, CA-HC, MP-W09 Phase 4, and W5 cutover pass |
| W9-E Stress | MS-AG09, MS-AG10 | simulator + Station | W9-D passes |
| W9-F Physical | MS-AG03, MS-AG04 full, MS-AG06 full, MS-AG07 | `mobile-native-access-e2e` + `mobile-native-recovery-e2e` + `mobile-native-social-convergence-e2e` + physical platform Gates; physical iOS + Android devices | W9-E passes |

**Current blocker (`PLAN_AMENDMENT_REQUIRED`, resolved in this plan)**: W9-D
cannot be implemented as an Acceptance-only change. MP-D01 and MP-D16 already
assign Direct/OpenMLS/queue/recovery to `packages/messaging-core` plus thin
platform adapters, but MP-W09 stopped after Desktop partial extraction and the
Mobile Shell plan omitted that dependency. W5 now depends on completing
portable OpenMLS ownership and the MP-W09 Mobile adapter, then atomically
cutting Mobile Chat/Group off `/friend-chat/*`, `/group-chat/*`, and the generic
command ledger. Only after that cutover may supplemental simulator Gates be
registered. The supplemental Gates use their own simulator resource contract
and emit `PASS / PARTIAL / UNPROVEN`; they do not reuse the OAuth-only physical
proof schema or finalizer. Existing `mobile-native-social-convergence-e2e` and
`mobile-native-chat-contacts-e2e` remain the physical full-proof owners. Their
Provisioner must make Appium, build/device identity, actor Fixture, and service
bindings common while keeping provider credentials, browser leases, OAuth
Fixture operations, proof roles, and finalizer access-only. No shared
development Station may be redeployed or reset.

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
| W3 Lifecycle, runtime graph, and navigation | done | `MobileLifecycleKernel`, `topologicalSort`, `MobileRuntimeDescriptor` types, `AppProviders` bootstrap/teardown; committed `050d488dc` |
| W4 InteractionAdmission, command ledger, and draft store | done | Rust encrypted SQLite ledger (AES-256-GCM), crash recovery, four-key fairness, `DraftStore`, TypeScript `InteractionAdmission` adapter; committed `050d488dc` |
| CA-HC Conversation Authority DDD hard cut | in progress / CA-W1 | Owner approved the formal plan on 2026-09-06. CA-W0 now classifies all 65 governed routes, declares 61 retained capabilities and four deletion-only routes, inventories target-absent stores, and enforces Conversation DDD imports. CA-W1 owns canonical proto consolidation. |
| W5 Generated gateway and Social projection convergence | blocked by CA-HC | MP-W09 Mobile/Core preparation exists and local checks passed, but current adapters still depend on the retired Station Chat facade. W5 resumes only after CA-HC installs canonical resource routes and removes the duplicate authority/facade. Live two-actor/multi-Station receiver, restart, and attachment evidence remains `UNPROVEN`. |
| W6A Chat, Contacts, and Group product closure | blocked by CA-HC | Existing Chat and Group renderer work consumes Device Messaging Engine projections and typed commands, including attachment staging/open, but cannot close against the retired Station Chat facade. Resume only after CA-HC installs the canonical resource owners and Conversation DDD authority. Native receiver/search/recovery and attachment-outcome journeys remain `UNPROVEN`. |
| W6B Moments product closure | done | `MomentsPage` with feed store, composer, reaction picker, inline comments; prototype-aligned `7d4289d85`; committed `050d488dc` + `7d4289d85` |
| W6C Profile and Settings product closure | done | `SettingsPage` with profile header card, stats row, grouped settings, sign-out; prototype-aligned `7d4289d85`; committed `050d488dc` + `7d4289d85` |
| W6D Recovery and degraded-state closure | done | `recoveryProjection` central aggregation for 8 recovery state types, 8 recovery overlay components; prototype-to-production mapping confirmed `7d4289d85`; committed `050d488dc` + `7d4289d85` |
| W7 Native lifecycle and platform closure | done | Rust `lifecycle_bridge` monotonic generation counter, `background_bridge` resume coordination, `permission_bridge`, `network_bridge`, 10 Tauri commands; committed `050d488dc` |
| W8 Atomic old-path deletion | reopened / pending CA-HC | The prior claim proved removal of earlier Chat routes, browser crypto, Sender Keys, and selected Desktop owners, but missed the live duplicate Chat authority. W8 now requires CA-HC completion, sole Conversation ownership, Conversation DDD zero-debt proof, and the semantic ownership Gate. |
| W9 Native Acceptance and readiness audit | in progress | `tmp/evidence/mobile-shell/W9/readiness-audit.md`; W9-C simulator lifecycle evidence PASS at `ad546dac2`; MP-W09 Mobile source cutover and deterministic local gates pass. W9-D source closure now includes account-scoped Messaging/Social Harness actions, closed recursive parent Appium response validation, a transport-neutral Direct/Group journey, two supplemental simulator Gates, and the typed two-client/two-Station `mobile-social-simulator` Provisioner. Current local evidence passes: Messaging Core 104 unit plus 2 integration tests, Mobile Rust 66/66, Mobile Vitest 54/54, Desktop library 24/24, focused Desktop service/source-contract tests 35/35 with one environment-gated test skipped, Mobile TypeScript and production build, Social wire/runtime boundaries, hard-cut scanner regressions 6/6, Mobile Acceptance 107/107, Acceptance runner 66/66, Evidence Store 39/39, runtime-cell/launch-context 114/114 when run without parallel load, Infra-boundary 8/8, validator 20/20, quality-evidence 14/14, plan self-check, and external-Evidence-Store `make acceptance-plan` generation. Local Android tooling is available: Appium UiAutomator2 4.2.9, ADB 37.0.0, and the required `peers_touch_applet_l3_e2e` AVD are installed; runtime invocation must export the discovered SDK root because the active shell does not define `ANDROID_HOME` or `ANDROID_SDK_ROOT`. Reset authorization was granted on 2026-09-04, and both supplemental W9-D Gates then failed closed before resource acquisition with `profile:mobile-social-simulator-services`: the active `one` profile defines neither required Mobile Station binding, `mobile-shell-acceptance` does not exist, and only one deployment environment is currently marked disposable. Protected `:18080` Station profiles cannot substitute for a second disposable target. Their manifests remain source-bound `BLOCKED/UNPROVEN`, report cleanup `passed`, and retain the canonical `secretScan` object. Generated Proto EOF whitespace, unrelated Agent/Home Station business-injection and registry drift, a preoccupied legacy test port, review-rule digest drift, and Desktop binary baseline errors remain outside this local slice. Physical Social runner/proof contracts and authoritative Station history, forced event-loss, native lifecycle, tab-remount timing, and physical iOS/Android receiver evidence remain incomplete, so W9-D runtime and W9-F stay open. |

### W9-D Authorized Runtime Preflight Evidence

- `mobile-simulator-social-convergence-e2e`
  `20260904T170306310235Z-258df2e3d976fabd92bfe6e9e864b69d`:
  source commit `ad546dac2f26dccf48902321339aa91cd711f26c`,
  `BLOCKED/UNPROVEN` at `profile:mobile-social-simulator-services`, zero
  clients and services acquired, cleanup `passed`, and canonical
  `secretScan.status=passed`.
- `mobile-simulator-chat-contacts-e2e`
  `20260904T170323837932Z-bdf06853c0f2a6f24fcfbd61f04ef4eb`:
  source commit `ad546dac2f26dccf48902321339aa91cd711f26c`,
  `BLOCKED/UNPROVEN` at `profile:mobile-social-simulator-services`, zero
  clients and services acquired, cleanup `passed`, and canonical
  `secretScan.status=passed`.
- Both manifests are durable in the external Evidence Store. They are
  superseded by the 2026-09-05 environment acquisition below. Shared Station
  profiles on protected port `18080` remain forbidden reset targets.
- The canonical `mobile-shell-acceptance` profile now resolves two verified
  disposable Station deployments and Relay. The new primary runtime at
  `10.37.118.48:18132` uses isolated Compose project
  `pt-mobile-shell-primary`, separate PostgreSQL and identity volumes, libp2p
  port `4012`, and clean Station commit
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`. The existing secondary runtime
  at `10.37.94.156:18132` runs clean Station commit
  `82073af5dc367ed1fb5184d40c29e50cdd5c4956`. Both expose distinct PeerIDs,
  report federation ready with one connected seed, and pass
  `verify_reset_target`.
- The first authorized runtime attempt,
  `mobile-simulator-social-convergence-e2e`
  `20260905T000126222877Z-6430817fed8cd96883ba20aa830bec56`,
  reached profile-lease acquisition and then failed before Fixture reset with
  `TypeError: __init__() got an unexpected keyword argument 'port'`.
  Provisioner cleanup passed and the canonical secret scan passed. The root
  cause is a partial Acceptance Infra integration:
  `EnvironmentProvisioner.acquire_remote_git_source_lease` passes SSH
  transport arguments that the current `RemoteGitSourceLease` constructor does
  not accept. W9-D remains `UNPROVEN` until that generic constructor/caller
  contract is reconciled and both product Gates execute.

### W9-D Final Simulator Gate Results

- The earlier profile-missing and lease-constructor blockers above are
  superseded. The caller now uses the branch-local
  `RemoteGitSourceLease` constructor contract; the profile-lease and Mobile
  simulator Provisioner suites pass 28/28, and the Infra-boundary, runner,
  validator, and quality-evidence checks pass.
- The primary Station attestation records clean commit
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`; the secondary Station
  attestation records clean commit
  `82073af5dc367ed1fb5184d40c29e50cdd5c4956`. Both Stations expose distinct
  PeerIDs, report federation ready, and passed reset-target verification.
- Final `mobile-simulator-social-convergence-e2e` run
  `20260905T025214693858Z-8fbe271c1ebe7c0858b448d5be2063dc`
  and final `mobile-simulator-chat-contacts-e2e` run
  `20260905T025300285859Z-fff5fd9df9651c8552a6547ab67f9d0c`
  are durable and source-bound to
  `ad546dac2f26dccf48902321339aa91cd711f26c` with workspace digest
  `sha256:5e80b39d46a15d8772fa2d26efa69a8c05dfe2073ac3c9c62a2795977130b41b`.
  Each records both Station deployment attestations before failing closed on
  `station-identity:http://10.37.118.48:18081/app-meta/version`; the shared
  Relay returns HTTP 404 for the required source-attestation endpoint.
- Both final runs are `BLOCKED/UNPROVEN` for product proof, while cleanup is
  independently `passed` and `secretScan.status=passed`. No Fixture reset,
  simulator, emulator, Appium session, client storage, or product journey was
  acquired before the Relay preflight block. The cleanup stack released the
  profile lease and all three remote source leases in reverse registration
  order.
- Mobile structural validation still reports all six capabilities
  `STRUCTURALLY_VALID` when run against an isolated empty Evidence Store. The
  regenerated coverage report remains Mobile 9/9 wired and 0 proven, so the
  structural result is not promoted into W9-D product proof.
- The Acceptance Gap Detector independently classifies both simulator claims
  as `GATE_BLOCKED_BY_ENVIRONMENT` and `UNPROVEN`, with the same Relay
  source-attestation endpoint as the required closure.
- This is an external-runtime hard stop for the current authorized slice.
  Bypassing Relay attestation would weaken source binding, and deploying or
  restarting the shared Relay is not authorized. W9-D remains `UNPROVEN`;
  W9-E, W9-F, and overall Mobile Shell readiness are not claimed.

### W9-D Relay Source-Attestation Diagnosis

- The Relay 404 is a stale deployment, not a missing current-source route.
  `apps/station/app/main.go` unconditionally registers the `app_meta`
  subserver, `apps/station/app/subserver/app_meta/handler.go` owns
  `/app-meta/version`, and the Docker Relay uses the same image and binary as
  Station. The route entered source at
  `0f41bb0965d3fef755c6b051e56ac34b19e9ded5`, which is an ancestor of both the
  bound source and the clean remote checkout.
- The shared Relay remains healthy and exposes
  `/sub-bootstrap/info`, including runtime PeerID
  `12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag`, but
  `/app-meta/version` returns HTTP 404. Its clean remote checkout is
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d` on
  `feat/p0-streaming-runtime-message-actions`; the running
  `pt-relay-relay-1` image was created on 2026-05-15, before the app-meta route,
  and its binary SHA-256 is
  `cde05a041fee6bd9d997e62b84b41b2538939b7109b01b4fcb112178b27a27ec`.
  The runtime therefore cannot be bound to the current clean checkout.
- The remote checkout and this worktree have diverged by 12 remote-only and
  10 local-only commits. Selecting the Relay deployment source is an Owner
  decision; the Acceptance Agent must not choose either history implicitly.
- The configured `relay-1` deployment has no custom build or restart command,
  while the generic Relay fallback invokes a nonexistent `make build-relay`
  target and the actual runtime is Docker Compose project `pt-relay`.
  `make relay` is therefore not a safe executable deployment action for this
  environment without a separately authorized deployment-contract correction.
- Source verification is decisive at the package boundary:
  `go test -race -count=1 ./app/subserver/app_meta/...`
  `./frame/core/plugin/native/subserver/relay/...` passes. A full
  `go build ./app` remains blocked by unrelated pre-existing Agent CLI missing
  symbols (`NormalizeCommand`, `BuildCliPrompt`, `PromptViaArgument`,
  `PromptViaStdin`, and `splitCommandLine`), so no local full-binary smoke is
  claimed.
- Generic Station attestation owner tests remain 3/7 passing because of
  pre-existing tracked-only digest, SSH known-host, invalid-contract, and
  generated-coverage exclusion gaps. They do not explain the Relay 404 and
  were not changed in this source-correct deployment slice.
- At the source-audit checkpoint, status was
  `RELAY_DEPLOYMENT_AUTHORIZATION_REQUIRED`. Closure required the Owner to
  choose the exact source commit, authorize a usable Relay build/recreate
  contract, deploy it, and verify that `/app-meta/version` reported a stable
  `build_commit` matching the clean deployment checkout.

### W9-D Relay Repair And Android Preflight

- The Owner authorized Relay source
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d` and the shared `pt-relay`
  Docker Compose rebuild. The rebuild used a clean Git archive, the existing
  remote Docker context, and the declared `infra` plus `relay` profiles.
- The recreated Relay runs image
  `sha256:5dd89ed47bedb9bc7cbc331dbe3f94b40b3dc7bdb184a5ad69c4443a4ad00ab0`.
  `/app-meta/version` reports the selected clean commit, build label
  `feat/p0-streaming-runtime-message-actions`, build time
  `2026-09-05T03:45:00Z`, and Go `1.24.6`.
- Relay data volumes were preserved, and runtime PeerID
  `12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag` remained unchanged.
  Relay health, `/sub-bootstrap/info`, `/app-meta/version`, both Station
  federation-readiness checks, and profile/source lease cleanup passed.
- The next serial Social run,
  `20260905T033210148918Z-6774c37424af8b51a692a0b761f46ca9`,
  passed service attestation and then failed closed at
  `mobile-simulator:build:android` because the Provisioner did not derive
  `NDK_HOME` from the configured Android SDK. The run is
  `BLOCKED/UNPROVEN`; cleanup and the canonical secret scan passed, and no
  Fixture reset or client session was acquired.
- The dependency-ready correction is a Mobile simulator Provisioner preflight:
  accept an explicit valid `NDK_HOME`, otherwise require exactly one valid NDK
  installation under the configured Android SDK, inject its absolute path into
  the command environment, and fail closed before resource acquisition when
  discovery is absent or ambiguous. Social must pass and clean up before the
  Chat/Contacts Gate runs.
- The Provisioner now implements that preflight before profile lease, runtime
  storage, simulator, emulator, or Fixture acquisition. Explicit, discovered,
  invalid, absent, ambiguous, and command-environment propagation cases are
  covered. The focused profile-lease, provisioning-owner, and Mobile simulator
  suites pass 50/50; Python compilation, scoped diff checks, and real SDK-root
  discovery also pass.
- Social run
  `20260905T040738143171Z-13eef604e43b0b159f131ded9a5b1ed5`
  passed NDK discovery, booted the Android emulator, and entered the Android
  Rust build. It then failed at `mobile-simulator:build:android` because
  Mobile selected rusqlite `bundled-sqlcipher` without cross-compiled OpenSSL;
  `libsqlite3-sys` could not resolve `openssl/crypto.h`. The immutable result is
  `FAILED/PARTIAL/UNPROVEN`, cleanup is `passed`, and
  `secretScan.status=passed`.
- The same run detected source drift because Tauri's deep-link build hook
  rewrote the tracked Android manifest with whitespace-only generated lines.
  The dependency-ready root correction is to use rusqlite's same-version
  `bundled-sqlcipher-vendored-openssl` feature and make the Provisioner restore
  only the verified formatting-only manifest rewrite while rejecting semantic
  build-time mutation.
- The SQLCipher feature, NDK `llvm-ranlib` resolution, and guarded manifest
  restoration are now implemented. The focused suites pass 54/54, the Cargo
  lock is consistent, and Social run
  `20260905T042010710135Z-c034ac2dd68e6205c2d3d1ff5331555f`
  completed both native builds without source drift. It then blocked before
  Fixture reset at
  `fixture-reset:mobile-shell-primary-disposable-station`: importing
  `tooling.acceptance.transports.ssh` first enters
  `core.__init__ -> provisioner -> attestation -> transports.ssh` and raises a
  partially initialized module error. The immutable result is
  `BLOCKED/UNPROVEN`; cleanup and the canonical secret scan passed.
- This import-order failure is a generic Acceptance Infra boundary defect. The
  dependency-ready correction is to remove eager Core-to-transport imports,
  preserve strict SSH behavior through runtime-local transport resolution, and
  add a fresh-process transport-first import regression before rerunning Social.
- The Core-to-transport cycle is now removed through runtime-local SSH transport
  imports in the attestation and remote source lease call sites. The dedicated
  transport-first and strict-host-key regressions pass 2/2, the full
  profile-lease suite passes 11/11, the provisioning-owner suite passes 16/16,
  Python compilation passes, and the scoped diff check is clean.
- The next Social run,
  `20260905T042929248372Z-f5e00e1bdca72d0a0ef36ae1382fb86a`,
  reached `FIXTURE_READY` with clean source attestations for Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `229af39233369388dd729a30e1917416e59f7092`. Both simulator applications
  built, the reset targets were verified, and the actor Fixture completed.
  The Gate then failed closed before client sessions at
  `mobile-simulator:harness-actions` because the
  `mobile-social-simulator` overlay omits the inherited base action
  `projection.read`, even though the production Mobile Harness already
  implements it. The immutable result is `BLOCKED/UNPROVEN`; Provisioner
  cleanup and the canonical secret scan passed, no Appium/emulator process
  remains, and the generated Android manifest has no tracked drift.
- This blocker is a Mobile business-injection contract mismatch rather than an
  Acceptance Infra defect. The dependency-ready root correction is to make the
  social overlay's required action set include every inherited
  `mobile-simulator` base requirement, add a contract regression for that
  subset relationship, and rerun Social before Chat/Contacts. The Owner
  approved that correction on 2026-09-05. The overlay now includes the
  production `projection.read` action, and its contract test requires the
  social action set to contain every base simulator Harness action. The
  Provisioner suite passes 29/29, the Social and Messaging journey suites pass
  7/7, the production Harness registry test passes 12/12, Acceptance plan
  self-check passes, and Mobile is structurally valid against an isolated empty
  Evidence Store. Validation against the durable Evidence Store correctly
  rejects the prior run as stale after this source change.
- Social run
  `20260905T105425416765Z-4ae0a8c1325ce592492f2639b2eeed17`
  proves that correction at runtime: both simulator clients reached
  `messaging-harness-ready`, and the iOS preflight verified all 29 available
  Harness actions. The run retained clean source attestations for Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `229af39233369388dd729a30e1917416e59f7092`.
- A later `DriverError` occurred during the first product action, but
  `SimulatorSocialGate.execute` then replaced its primary `reason` with
  `simulator social cleanup was incomplete` when both product-Harness cleanup
  attempts also failed. The immutable result is `FAILED/PARTIAL/UNPROVEN` and
  therefore cannot identify the first failed product action. Appium session
  teardown, environment cleanup, reverse lease release, the canonical secret
  scan, and generated-source restoration all passed.
- This is a Mobile business-Gate evidence-precedence defect. The base simulator
  Gate already preserves a primary journey error, records a separate
  `cleanupReason`, and replaces `reason` only when the journey itself
  succeeded. The dependency-ready correction is to apply the same rule to
  `SimulatorSocialGate`, add a regression proving cleanup cannot hide the
  primary failure, and rerun Social once to expose the actionable product
  failure. The Owner approved that correction on 2026-09-05. The Social Gate
  now preserves an existing primary `reason`, records cleanup failure
  separately, and replaces `reason` only when the journey had succeeded. The
  Social and Messaging journey suites pass 8/8, the existing base-Gate
  precedence regression passes, Python compilation passes, and scoped diff
  checks are clean.
- Diagnostic Social run
  `20260905T110823920350Z-748263569d7a0b60f2e48a6625c5a504`
  preserved the primary failure:
  `access session invalid: session not found`. Both clients again reached
  `messaging-harness-ready`; iOS verified all 29 Harness actions. Cleanup
  failure remained separate in `cleanupReason`, Appium session teardown and
  Provisioner cleanup passed, the canonical secret scan passed, and no
  simulator or generated-source residue remains.
- The source chain identifies a Mobile auth-runtime ownership defect. Simulator
  reinstall preserves native secure storage, while the authorized Station
  Fixture reset deletes server sessions. `authRuntime` restores the old Mobile
  session and `startAccessAttemptForActiveStation` forwards its stale
  `sessionId`; Station `accessgate.actorRefFromSession` correctly fails closed.
  `App.tsx` contains page-local stale-session clear-and-retry logic, but the
  production Acceptance Harness invokes the runtime owner directly and bypasses
  that page branch. The dependency-ready root correction is to move the
  one-time invalid/revoked/expired-session clear-and-retry behavior into the
  Mobile auth runtime, route the page through that owner, delete the duplicate
  page-local recovery branch, add runtime and source-contract regressions, and
  rerun Social before Chat/Contacts. The Owner approved that correction on
  2026-09-05. `authRuntime` now clears an invalid persisted session and retries
  exactly once without it, while unrelated failures and retry failures still
  propagate. `App.tsx` delegates to that runtime owner and no longer carries a
  duplicate session-error classifier or retry branch. Focused auth-runtime and
  Harness tests pass 20/20, Mobile Web type and boundary checks pass, the
  production Web build passes, and the Social/Messaging Gate suites pass 8/8.
- Social run
  `20260905T111919908059Z-258477d8c6437554d1d49d13f3766142`
  proves the auth-runtime recovery: the primary failure advanced from stale
  session rejection to the login action and now reports `invalid email`. Both
  clients reached `messaging-harness-ready`; iOS verified all 29 Harness
  actions. Provisioner cleanup, reverse lease release, canonical secret scan,
  and generated-source restoration passed.
- The remaining failure is a Mobile Social Gate/Fixture contract mismatch.
  The actor Fixture intentionally emits the durable reference
  `station-account:<email>` in `accountRef`, but `MobileMessagingJourney`
  submits that reference verbatim through the email login field. Existing
  native Gate consumers validate the `station-account:` authority prefix and
  resolve the account value at the consumption boundary. The dependency-ready
  correction is to apply the same fail-closed reference resolution in
  `MobileMessagingJourney`, update its fixtures to use canonical account
  references, add a malformed-reference regression, and rerun Social before
  Chat/Contacts. The Owner approved this exact business-Gate correction on
  2026-09-05. `MobileMessagingJourney` now resolves the typed reference before
  any Station action, sends only the extracted email to `access.submit`, and
  rejects a non-Station reference without side effects. The focused Social and
  Messaging suites pass 10/10, simulator Provisioner tests pass 29/29, Python
  compilation and scoped diff checks pass, Acceptance planning selects the
  expected simulator and native Social/Chat Gates, and isolated Mobile
  structural validation passes.
- Social run
  `20260905T121136502638Z-a41890683cb4f4f38cdbaec5ef3d6c42`
  proves the account-reference correction: both clients authenticated instead
  of failing with `invalid email`, then the first Social action failed with
  `mobile.social.runtimeUnavailable`. Both clients reached
  `messaging-harness-ready`; iOS verified all 29 Harness actions. Relay and
  both Station attestations were source-bound. Provisioner cleanup, reverse
  lease release, canonical secret scan, and generated-source restoration
  passed; Chat/Contacts was not run.
- The new failure is a separate Mobile business-Gate launch-state mismatch.
  Harness `access.submit(login)` persists the production session and updates
  `authStore`, but it does not invoke the page-local `MobileAppRoot.login`
  callback that changes `launchState` to `shell`. `MobileShell` therefore does
  not mount `useSocialRuntime`, so `activeRuntime` remains absent and
  `social.request.send` fails closed. The existing production restart path
  restores the persisted session, revalidates the active Station, enters
  `shell`, and starts the Social runtime. The dependency-ready correction is
  for `MobileMessagingJourney` to request the existing `lifecycle.restart`
  action after login, refresh and re-enter the WebView, wait until
  `social.projection.read.active` is true, and add regression coverage before
  rerunning Social. The Owner approved this exact Gate-source correction on
  2026-09-05. `MobileMessagingJourney` now requests the production WebView
  restart after authentication, re-enters the application WebView, and waits
  for the Social runtime projection to become active before issuing Social
  commands. The focused Social and Messaging journey suites pass 10/10, and
  the simulator Provisioner suite passes 29/29.
- Social run
  `20260905T130047819340Z-5798739c1598c3301eb9efea8259e5ba`
  live-proves the launch-state correction: both clients authenticated, both
  reached `messaging-harness-ready`, the iOS preflight verified all 29 Harness
  actions, and the journey advanced into the real friend-request transport.
  The immutable result then failed with
  `POST /friend-chat/friend-request/send HTTP 404`; it remains
  `FAILED/PARTIAL/UNPROVEN`. Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `d983768315b338e71a5cea48f4eccc95f6a93daa` attestations are source-bound
  and clean. Provisioner cleanup, reverse lease release, the canonical secret
  scan, and generated-source restoration passed. Product-Harness cleanup
  failures remain separately recorded while both Appium sessions were torn
  down.
- The new first failure is a Mobile Social gateway route mismatch.
  `socialGateway.ts` still sends the four Friend Request operations to the
  removed `/friend-chat/*` routes, while the accepted Social Runtime ownership
  plan and the Station Social subserver own send, accept, reject, and list under
  `/api/v1/social/*`. The dependency-ready correction is limited to those four
  Friend Request routes plus a focused route-contract regression; session,
  settings, block, and other legacy routes are outside this correction. On
  2026-09-05 the Owner authorized autonomous execution of all source-backed
  technical corrections inside this W9-D slice without per-fix approval. The
  four Friend Request operations now target their canonical
  `/api/v1/social/*` routes, and the focused gateway regression freezes method,
  path, query, and body mappings. Mobile Vitest passes 57/57, `check:web`
  passes TypeScript plus Social wire/runtime boundary checks, the production
  Web build passes, scoped diff checks pass, and
  `mobile-hard-cut-static` passes through the external Evidence Store at run
  `20260905T132729545320Z-be5a5c97ee2c937187845689cf1e6878`.
- The first route-corrected Social run,
  `20260905T132816833113Z-a1551009a8f05e7d4bfcd7c0049dbdd9`,
  reached both production Harnesses and then failed at the primary Station with
  `POST /api/v1/social/friend-request/send HTTP 500`. The source-bound Station
  log identifies `SQLSTATE 42703: column "actor_ptid" does not exist`.
  The fresh-database migration order created `friend_chat_friendships` through
  a legacy `actor_did` / `peer_did` GORM model after the PTID rename pass had
  already completed. The root correction moves fresh friendship-table creation
  into `MigrateIdentitySchema`, uses only `actor_ptid` / `peer_ptid` model
  columns, and removes the obsolete second migration entrypoint. Fresh-schema
  and legacy-schema regressions plus the complete Social subserver test suite
  pass.
- A leased restart of the dedicated primary disposable Station exercised its
  deployed migration path without changing the attested source commit. Social
  run `20260905T133925954264Z-9b1c57e219f075fd84bc563912d97f4f`
  then passed Friend Request submission and advanced to
  `sim-android friend request did not converge before timeout`. Its immutable
  result is `FAILED/PARTIAL/UNPROVEN`; Provisioner cleanup, reverse lease
  release, source attestations, and the canonical secret scan passed.
- Source and architecture audits agree that this timeout exposes an undefined
  cross-Station Friend Request contract. The current Social service checks and
  writes only the sender Station database, emits only a local notification,
  and has no durable outbox, authenticated remote command, receiver-Station
  materialization, retry/idempotency contract, or cross-Station accept/reject
  routing. The accepted product matrix requires the two-Station receiver
  journey, but existing architecture does not define those semantics.
  Continuing the Social product path therefore requires
  `DESIGN_AMENDMENT_REQUIRED`; changing the Gate to a same-Station fixture or
  duplicating records in the Fixture would weaken the accepted assertion and
  is forbidden.
- Independently, the supplemental Social Gate now emits the canonical
  `acceptance-gate-evidence-report` shape with Gate/Phase/BOM/Spec fields so the
  runner can retain the primary failure trace. Mobile simulator cleanup
  failures also retain their redacted reason. The generic redactor now treats
  exact `errorKey` locale identifiers as non-secret while preserving all other
  key/token detection. Focused Mobile Gate tests pass 28/28, the redaction
  regression passes, and Acceptance runner tests pass 66/66. One unrelated
  pre-existing `local-desktop-gateway` fixture assertion still fails in the
  complete provisioning-model module.
- The Acceptance ownership mapping now includes
  `apps/mobile/src/services/gateways/socialGateway.ts`. Its focused planner
  regression passes and maps the gateway to both simulator Gates plus their
  native full-proof owners. A temporary Git index containing only the 17 files
  changed by this autonomous W9-D closure produced the same canonical mapping,
  while keeping unrelated shared-worktree changes out of the audit.
- Acceptance Gap Detector run
  `20260905T140405687992Z-cad6ff518bdb65f90c1e075bc7c558ec`
  is source-bound to commit
  `ad546dac2f26dccf48902321339aa91cd711f26c` and workspace digest
  `sha256:f830a83ada4c2ddbdb28420393d31bd6a75d0e787cd0aec3822a0db1f965fb49`.
  It correctly returns `UNPROVEN`: the Social simulator Gate is
  `FAILED/PARTIAL/UNPROVEN`, Chat/Contacts was not run because Social did not
  pass, and the selected native/full-proof and Acceptance Infra Gates are not
  silently substituted.
- The scoped Completion Audit confirms that the authorized Fixture reset and
  both target checks passed, all three service attestations were clean and
  source-bound, the Provisioner released actor Fixtures, simulator resources,
  source leases, and the profile lease in reverse order, both Appium sessions
  closed, the allocated ports have no listeners, the owned Android emulator and
  iOS simulator are stopped, and the run-scoped client storage is absent. The
  canonical secret scan passed. The generated Android manifest has no drift;
  unrelated generated Proto and Apple project changes already present in the
  shared worktree remain outside this slice.
- The latest live Social artifact predates the canonical evidence-shape and
  cleanup-reason source corrections. Its wrapper therefore still records
  missing Phase/BOM/Spec/Gate traceability, and its product-Harness cleanup
  entries contain only `DriverError`. Focused tests prove the new source
  behavior, but no later live run proves those two evidence improvements.
  They remain local source closure rather than runtime proof.
- Current deterministic checks pass: Mobile Vitest 57/57, focused gateway
  route regression 1/1, Mobile `check:web`, production Web build, complete
  Station Social tests, simulator Gate tests 22/22, focused redaction and
  planner-mapping regressions, Gap Detector self-tests 22/22, scoped
  `git diff --check`, and current-source `mobile-hard-cut-static` run
  `20260905T140617223630Z-3fadebc71f030eb30e8a11aaecfb47d7`.
  `acceptance-validate --infra` still fails closed because the latest durable
  Acceptance run source digest predates the current uncommitted corrections;
  it is not reported as passing evidence.
- W9-D remains `UNPROVEN`. W9-E, W9-F, and overall Mobile Shell readiness
  remain out of scope for this execution slice. The next product execution
  action is blocked at `DESIGN_AMENDMENT_REQUIRED`: an accepted architecture
  must define Friend Request authority, receiver Home Station resolution,
  authenticated durable cross-Station delivery, retry/idempotency and
  deduplication, receiver materialization, accept/reject routing, and
  event-after-commit projection semantics. Chat/Contacts remains unrun behind
  the W9-D Social prerequisite.
- A second resume audit on 2026-09-05 reverified the immutable worktree binding
  and found no accepted source or implementation that closes this semantic
  gap. `MS-PA19` still requires two actors on two Stations;
  `SendFriendRequestRequest` still carries only receiver PTID and message;
  `StationEnvelope` has no Friend Request payload; and
  `FriendRequestService` still writes only its local repository and local
  notification producer. No additional implementation or Gate run is
  dependency-ready before architecture review.
- A third consecutive Goal audit on 2026-09-05 found the same sole blocker.
  No current Social, Federation, Model, or Mobile source defines the missing
  cross-Station Friend Request authority and delivery contract, and the
  existing immutable Gap Detector result remains `UNPROVEN`. The Goal is
  therefore blocked pending an explicit Owner-reviewed architecture amendment;
  no additional product code or dependent Chat/Contacts Gate may run before
  that decision is accepted.
- After the Owner resumed the blocked Goal, fresh blocked-audit attempt 1 on
  2026-09-05 found no changed architecture, Proto, Station implementation, or
  external state that makes a new Goal Slice dependency-ready. The Goal remains
  active for the resumed audit window, while W9-D itself remains blocked at the
  same DESIGN gate.
- Resumed blocked-audit attempt 2 on 2026-09-05 again found no accepted
  cross-Station Friend Request contract and no relevant source delta. The
  dependency-ready frontier remains empty; Social stays `UNPROVEN` and the
  Chat/Contacts Gate remains forbidden by the W9-D execution order.
- Resumed blocked-audit attempt 3 on 2026-09-05 confirmed the same condition.
  The resumed Goal is blocked again until an Owner-reviewed architecture
  amendment changes the dependency frontier.
- The 2026-09-06 source/history audit expanded the blocker from a missing
  Friend Request transport contract to a verified cross-domain ownership defect.
  Conversation was established as the unified Chat API before the later Device
  Messaging Engine, but the latter introduced duplicate business routes, proto request
  families, and authority stores. MP-D09/MP-D10 required one Conversation framework
  and a hard cut, while W11 measured only exact route prefixes instead of semantic
  capability ownership. This is not a Mobile-specific defect and cannot be repaired by
  adding a Social or Mobile transport silo.
- The formal DESIGN package lives at `docs/architecture/api-ownership/`. Its route,
  caller, and Proto audit found no independent non-Chat public capability for the
  duplicate facade. The package also established receiver-Home-Station Friend
  Request authority, exact retry/dedup, durable result return, relationship convergence,
  event-after-commit, and one domain-neutral durable Federation transport.
- The Owner accepted revised AO-D01..AO-D06, MP-D30, and Federated Social D-07 on
  2026-09-06. The accepted target makes Conversation the sole Chat entry point, retains
  the internal Device Messaging Engine, routes support APIs by resource owner, and
  rebuilds Conversation as a DDD bounded context.
- The dependency-ordered hard-cut plan is
  `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`.
  It is `PLAN_APPROVED`; CA-W0 inventory and the fail-closed ownership Gate are
  complete, and CA-W1 canonical proto consolidation is next. W5, W6A, W8, and W9-D
  remain blocked behind the atomic hard cut. No route
  alias, redirect, dual write, fallback read, or partial production migration is
  permitted.

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
