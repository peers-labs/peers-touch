# W2-E2 Mobile Native OAuth Proof — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-30
> **Owner**: Mobile Architecture Team

***

## 1. Objective

完成 W2-E2 physical Mobile OAuth proof，使
`mobile-native-access-e2e` 在同一 source-bound run 中完成 iOS 与 Android
physical cells、全部 16 个 required variants、Station authoritative readback、
browser/account isolation、build provenance 和 zero-residue cleanup。

本计划完成不代表 W2 之外的 Mobile workstreams 已完成，也不授权进入 W3。

## 2. Accepted Inputs

Product sources:

* `docs/architecture/mobile/product-definition.md`

* `docs/architecture/mobile/experience-contract.md`

* `docs/architecture/mobile/product-state-model.md`

* `docs/architecture/mobile/acceptance-matrix.md`

* MS-PA03、MS-PA17、MS-PA25、MS-AG03。

Architecture sources:

* `docs/architecture/mobile/design.md`

* `docs/architecture/mobile/data-model.md`

* `docs/architecture/mobile/integration.md`

* `docs/architecture/access-gates/station-access-gate-architecture.md`

* `docs/architecture/acceptance-framework/`

* `docs/architecture/mobile/native-oauth-proof/`

Accepted decisions:

* MS-D12: native-owned OAuth secrets and credential delivery。

* MS-D13: transactional Station authorization finalizer。

* MS-D14: Appium hybrid native Acceptance。

* MOP-D01: Station-internal negative Fixture adapter。

* MOP-D02: deployment-produced Station proof snapshot。

* MOP-D03: explicit provider account/browser leases。

* MOP-D04: source-bound physical build attestation。

* Acceptance Framework D-18: `EphemeralGateLaunchContext` for non-persisted
  parent-owned capability handoff.

No schema or protocol version change is authorized. If implementation requires
one, stop and request explicit version approval.

## 3. Scope And Non-Scope

In scope:

* Mobile-specific build attestation and runtime identity;

* Station-internal Fixture/proof adapter with no public route;

* provider account, physical device and browser-profile leases;

* Rust production logout/purge and acceptance-only invalid-input adapter;

* RuntimeManifest and Appium fresh-install cutover;

* ten negative variants that were unsupported in the initial 2026-08-29
  baseline and are now source-executable;

* four success, two cancel and ten negative physical cells;

* immutable evidence, redaction and cleanup audit.

Out of scope:

* W3 or later Mobile workstreams;

* generic Acceptance Core redesign;

* simulator evidence as physical proof;

* new OAuth/Access Gate product behavior;

* provider cookie export, password/MFA automation or real credential creation;

* dependency or protocol version upgrades.

## 4. Initial-State Inventory — 2026-08-29

This inventory records the baseline that motivated the plan; it is not the live
status source. Current closure state is maintained in §14.

| Concern             | Initial asset                                                      | Initial state                                                                |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Feature/Capability  | `mobile-access-gate-oauth`, `mobile-station-access`                | connected and structurally valid                                             |
| Gate                | `mobile-native-access-e2e`                                         | registered; 6/16 variants executable                                         |
| Environment         | `tooling/acceptance/environments/mobile-native.yaml`               | versions/devices declared; browser leases declarative only                   |
| Provisioner         | `tooling/acceptance/provisioners/mobile_native.py`                 | physical/toolchain preflight; artifact path only                             |
| Appium              | `tooling/acceptance/gates/mobile/appium.py`                        | native/WebView transport; stale-install policy remains                       |
| Runner              | `tooling/acceptance/gates/mobile/native_e2e.py`                    | four success + two cancel; ten variants unsupported                          |
| Fixture             | `tooling/acceptance/fixtures/mobile_native_reset.py`               | actor reset only                                                             |
| Mobile Harness      | `apps/mobile/src/acceptance/`                                      | production actions; no build identity or invalid-input action                |
| Mobile Rust         | `apps/mobile/src-tauri/src/runtime/oauth/`                         | secret-safe OAuth coordinator; no complete logout/purge or replay handle     |
| Station             | `apps/station/app/subserver/oauth/`                                | binding/finalizer persistence; no internal Acceptance adapter/proof producer |
| Build               | env-backed IPA/APK path                                            | no source/build/signing/runtime identity chain                               |
| Runtime resources   | two provider refs + four clients                                   | no enforceable account/browser/device fencing                                |
| Android destination | physical clients reference a legacy AVD-named destination variable | replace with physical destination class and device-lease refs                |
| Evidence            | client projection, DOM/AX/screenshots                              | no authoritative Station snapshot                                            |

## 5. Traceability

| Plan requirement            | Product assertion                                    | Architecture source       | Decision        | Required evidence                              |
| --------------------------- | ---------------------------------------------------- | ------------------------- | --------------- | ---------------------------------------------- |
| Source-bound physical build | MS-PA03, MS-PA25                                     | native proof design §9    | MOP-D04, MOP-D04-A | build attestation + fresh-install/running identity |
| Trusted negative state      | MS-AG03 contribution to MS-PA17/MS-PA25              | native proof design §6    | MOP-D01         | Fixture lease/operation/before-after artifacts |
| Station truth readback      | MS-PA03 plus MS-AG03 contribution to MS-PA17/MS-PA25 | native proof design §7    | MOP-D02         | per-variant Station proof snapshots            |
| Provider/browser/device isolation | MS-PA03                                       | native proof design §8, §9.1 | MOP-D03, MOP-D03-A | typed device/account/browser leases and terminal outcomes |
| Native invalid-input proof  | MS-AG03 contribution to MS-PA25                      | native proof design §6.3  | MOP-D01, MS-D14 | Rust outcome + Station absence proof           |
| Complete 16-cell Gate       | MS-PA03 plus partial evidence for MS-PA17/MS-PA25    | acceptance matrix MS-AG03 | all four        | one immutable physical run                     |
| Non-persisted authority handoff | E2-5 parent/child boundary                         | acceptance framework design §3.11 | D-18 | generic launch-context closure evidence |

## 6. Dependency Graph

```text
Accepted MOP-D01..MOP-D04 + MOP-D03-A/MOP-D04-A
  -> E2-0 typed interface and artifact-role freeze
       ├──> E2-2 Station Fixture/proof adapter --------+
       ├──> E2-4 Rust cleanup/negative-input adapter --+
       └──> E2-0A amended lease/install contract freeze
              ├──> E2-1 build provenance --------------+
              └──> E2-3 account/device/browser leases -+
                                                         |
                                                         v
                                      D-19 architecture accepted
                                                         |
                                                         v
                              D-19 Infra plan accepted; landing active
                                                         |
                                                         v
                         Mobile D-19 decomposition pending after Infra landing
                                                         |
                                                         v
                                              E2-5 atomic Gate cutover
                                                         |
                                              source closure gates
                                                         |
                                      external physical resources ready
                                                         |
                                                         v
                                              E2-6 16-cell physical proof
                                                         |
                                                         v
                                              cleanup/evidence audit
```

E2-0 owns the original interface freeze. E2-0A atomically amends that freeze
with the accepted MOP-D03-A/MOP-D04-A payloads and relation rules before E2-1
or E2-3 resumes. E2-1 and E2-3 may then run in parallel with non-overlapping
files; shared registrations belong to E2-5. E2-2 and E2-4 remain complete and
must continue to pass against the amended schema. E2-6 cannot start until E2-5
and all external resources pass preflight.

## 7. Execution Closures

This Mobile plan does not define the D-19 Infra implementation closure.
The dedicated D-19 Acceptance Infra execution plan has passed its review gate
and is active. It must land before E2-5 resumes.
The accepted D-19 handoff must then run
`pt-architecture-execution-methodology` for the Mobile-owned requirement
mapping, Catalog configuration, neutral contract migration, protected baseline
and domain finalizer injection before `pt-plan-and-document` persists the E2-5
amendment. D-19 architecture and the v1 principal-loss fail-closed consequence
were accepted by the Owner on 2026-08-31; implementation remains blocked until
the active D-19 Infra execution plan lands.

### E2-0: Typed Interface And Artifact-Role Freeze

Responsibility:

* Convert accepted MOP schemas into one Mobile-owned machine-validatable
  contract before parallel implementation.

Target areas:

* `tooling/acceptance/gates/mobile/proof_contracts.py` (new);

* `tooling/acceptance/gates/mobile/proof_contracts_test.py` (new);

* `tooling/acceptance/gates/mobile/proof-contract.schema.json` (new);

* `tooling/acceptance/gates/mobile/README.md` (ownership documentation).

Deliverables:

* typed validation for build attestation, Fixture lease/operation, Station
  snapshot, account/browser leases and negative callback intent;

* stable run-relative artifact roles with mandatory cardinality per role and
  per variant/client/service;

* a reviewable cutover-inventory specification that declares legacy match
  classes, allowed retained matches, repository roots, consumer ownership and
  the classify-or-block result consumed by `--verify-cutover-inventory`;

* canonical redaction and cross-reference validation;

* protected-path baseline for `model/domain/`, dependency coordinates,
  lockfiles and declared version fields. The guard compares parsed semantic
  values, not whole manifest bytes, so an authorized non-version
  `Cargo.toml` feature declaration may change while any dependency/package/
  schema/protocol version change still fails closed;

* explicit assertion that schema/protocol revision remains unspecified.

Failure behavior:

* malformed identity, stale/missing fence, forbidden field, unknown artifact
  role, changed Proto/lockfile digest or changed protected version field fails
  before any runtime operation.

Focused gate:

```bash
python3 -m unittest tooling.acceptance.gates.mobile.proof_contracts_test
```

Definition of done:

* E2-1..E2-4 can independently produce payloads that pass the same validator;
  no shared registration file is assigned to them.

### E2-0A: Amended Lease And Install Contract Freeze

Responsibility:

* Convert accepted MOP-D03-A/MOP-D04-A into one atomic E2-0 contract amendment
  before E2-1/E2-3 implementation.

Dependency: accepted MOP-D03-A and MOP-D04-A.

Target areas:

* `tooling/acceptance/gates/mobile/proof_contracts.py`;

* `tooling/acceptance/gates/mobile/proof_contracts_test.py`;

* `tooling/acceptance/gates/mobile/proof-contract.schema.json`;

* `tooling/acceptance/gates/mobile/README.md`.

Deliverables:

* typed `PhysicalDeviceLease`, `MobileLeaseOutcome`,
  `MobileFreshInstallTrace` and `MobileInstalledBuildIdentity` payloads;

* exact acquisition-to-outcome correlation for two Fixture, four device, two
  provider-account and four browser-session leases;

* provider operation-summary validation proving completed operations and
  `maxObservedConcurrency=1`;

* platform-specific resolver-argument validation with one
  `resolverArguments` source of truth and explicit inapplicable resolvers;

* iOS `codesign` CDHash/CandidateCDHashFull representation and Android signing
  fields without cross-platform field leakage;

* build-attestation, fresh-install and installed-identity ArtifactRef/hash/run/
  Gate/client/platform correlation;

* retained redaction bans for raw artifact paths, UDID/serial, signing subjects,
  provider identity and credentials;

* no schema/protocol/dependency version change.

Failure behavior:

* stale/missing lease tuple, unsupported terminal code, released-but-unrestored
  baseline, provider concurrency above one, resolver-control mismatch,
  malformed CDHash, install-order mismatch or identity-correlation mismatch
  fails before E2-1/E2-3 consumers can execute.

Focused gate:

```bash
python3 -m unittest tooling.acceptance.gates.mobile.proof_contracts_test
python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-protected-paths
python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-version-policy
python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-cutover-inventory
```

Definition of done:

* all four new payload kinds and their cross-artifact relationships have
  positive and adversarial tests named `test_e20a_*`, so the amendment's
  coverage is distinguishable from the original E2-0 baseline;

* existing E2-0, E2-2 and E2-4 payload/tests remain valid;

* E2-1 and E2-3 consume only the amended frozen contract.

Historical evidence note: E2-0/E2-0A completed against the then-canonical
`gates/mobile/proof_contracts*` paths and the commands above remain the audit
record for that closure. The post-acceptance Mobile E2-5 amendment and landing,
not the D-19 Infra closure, atomically migrate the module, schema, tests, docs
and imports. Until that amendment is accepted and landed, E2-5 and §13 commands
continue to use the current `gates/mobile/proof_contracts*` paths; the amendment
must switch those commands to `contracts/mobile/native_oauth*` atomically with
the source migration.

### E2-1: Source-Bound Mobile Build

Responsibility:

* Produce and verify the exact physical IPA/APK used by Appium.

Dependency: E2-0A.

Target areas:

* `tooling/acceptance/provisioners/mobile_native_build.py` (new);

* `tooling/acceptance/provisioners/mobile_native.py`;

* `tooling/acceptance/tests/test_mobile_native_build.py` (new);

* `apps/mobile/vite.config.ts`;

* `apps/mobile/src-tauri/build.rs`;

* `apps/mobile/src-tauri/src/commands/build_identity.rs` (new);

* `apps/mobile/src-tauri/src/commands/mod.rs` (compile-only module declaration;
  Tauri command registration remains E2-5-owned);

* `apps/mobile/src/acceptance/buildIdentity.ts` (new);

* `apps/mobile/src-tauri/gen/android/{build.gradle.kts,gradle.properties}`;

* `apps/mobile/src-tauri/gen/android/buildSrc/build.gradle.kts` and generated
  Gradle dependency lockfiles;

* Mobile build/check scripts and tests.

Deliverables:

* canonical source/build identity and input/toolchain/environment digests;

* dual Web/Rust embedded identity;

* inspected IPA/APK hash, app ID and signing metadata;

* Acceptance Core-persisted build attestation `ArtifactRef`;

* fresh uninstall/install policy;

* runtime `build.identity` comparison;

* release binary symbol/registration absence check for the negative adapter.

Failure behavior:

* missing input, ambient environment, unlocked/network dependency, hash/signing
  mismatch, stale install or runtime identity mismatch blocks before OAuth.

Deletion obligation:

* remove path-only artifact acceptance and stale-install reuse.

Focused gates:

```bash
python3 -m unittest tooling.acceptance.tests.test_mobile_native_build
python3 -m unittest tooling.acceptance.tests.test_mobile_native_preflight
pnpm mobile:check
```

Definition of done:

* build producer/validator tests prove canonical inputs, dual identity,
  artifact/signing inspection and release symbol absence using controlled
  artifacts. Fresh physical install and running identity proof are deferred to
  E2-6.

### E2-2: Station Fixture And Proof Plane

Responsibility:

* Prepare deterministic negative state and produce authoritative proof without a
  public test endpoint.

Dependency: E2-0.

Target areas:

* `apps/station/app/subserver/oauth/acceptance_adapter.go` (new);

* `apps/station/app/subserver/oauth/acceptance_adapter_test.go` (new);

* a run-scoped Acceptance operation journal owned by the adapter in the
  disposable Station database;

* `apps/station/app/cmd/mobile_oauth_acceptance/main.go` (new);

* `tooling/acceptance/fixtures/mobile_oauth_station.py` (new);

* `tooling/acceptance/fixtures/mobile_native_reset.py`;

* `tooling/acceptance/tests/test_mobile_oauth_station_fixture.py` (new).

Deliverables:

* fenced `MobileOAuthFixtureLease`;

* allowlisted prepare/expire/snapshot/cleanup operations;

* same-transaction operation journal and idempotent unknown-outcome recovery;

* journal storage created and removed only by the authorized disposable-target
  adapter, never by Station production AutoMigrate;

* `REPEATABLE READ` read-only Station snapshot producer;

* before, post-action and post-cleanup artifacts;

* exact prior-policy restore with revision conflict detection;

* cross-Station proof set and zero-residue cleanup.

Failure behavior:

* target/attestation/fence mismatch blocks before DB access;

* operation input conflict fails;

* partial/unknown mutation is recovered by operation ID;

* cleanup conflict quarantines the Fixture resource.

Deletion obligation:

* no arbitrary SQL surface, descriptor-only Fixture or client-labeled Station
  readback remains.

Focused gates:

```bash
(cd apps/station && go test ./app/subserver/oauth/... ./frame/touch/accessgate/...)
python3 -m unittest tooling.acceptance.tests.test_mobile_oauth_station_fixture
```

Definition of done:

* every allowed operation is source-bound, idempotent and cleanup-verifiable;
  no public route or success-state injection exists;

* the deployment-owned adapter bootstrap initializes journal storage before
  the first lease, per-run cleanup removes mutable run state and
  terminalizes/deletes journal rows according to the accepted retention policy,
  and adapter teardown removes its disposable schema. Production AutoMigrate
  and a new numeric schema version remain forbidden.

### E2-3: Provider Account And Browser Lease

Responsibility:

* Make account sharing and four physical browser profiles exclusive,
  attributable and crash-safe.

Dependency: E2-0A.

Target areas:

* `tooling/acceptance/fixtures/mobile_resource_lease.py` (new, Mobile-owned);

* `tooling/acceptance/tests/test_mobile_resource_lease.py` (new);

* `tooling/acceptance/environments/mobile-native.yaml`;

* `tooling/acceptance/provisioners/mobile_native.py`;

* `tooling/acceptance/tests/test_mobile_native_preflight.py`.

* historical `tooling/acceptance/gates/mobile/proof_contracts.py` and
  `proof_contracts_test.py` for the canonical Evidence Store manifest-role
  projection; the post-acceptance Mobile E2-5 amendment atomically migrates
  these completed E2-3 changes to the neutral Mobile contract path without
  retaining the old modules.

Deliverables:

* atomic account/device/browser acquire;

* resource key, holder run ID, monotonic fence, heartbeat and expiry;

* operation-level fence validation;

* replace the AVD-named Android input with one explicit
  `PT_MOBILE_ANDROID_PHYSICAL_DESTINATION` build/install-class reference;

* replace raw per-client UDID/serial ownership with four
  `physicalDeviceLease` ArtifactRefs. The secret-side device broker resolves
  each lease to exactly one connected physical UDID/serial immediately before
  Appium use; `alice-ios`, `bob-ios`, `alice-android` and `bob-android` must map
  to four distinct lease resource keys, while the two Android clients share
  only the platform destination class;

* two account leases with serialized provider actions;

* four exclusive physical browser-profile leases;

* secret-side provider identity assertion and run-scoped HMAC correlation;

* baseline restore, release evidence and crash quarantine.

* deterministic projection from unique Evidence Store role-instance keys to
  canonical frozen `ArtifactRecord.role` values, followed by the existing
  exact path/cardinality validator.

Failure behavior:

* conflict, stale fence, unexpected provider identity, heartbeat loss or cleanup
  mismatch blocks/quarantines before another run can reuse the resource.

Deletion obligation:

* remove declarative `"required"` browser markers and unfenced account reuse.

Focused gates:

```bash
python3 -m unittest \
  tooling.acceptance.tests.test_mobile_resource_lease \
  tooling.acceptance.tests.test_mobile_native_preflight
```

Definition of done:

* deterministic tests prove atomic acquire, operation fencing, serialization,
  heartbeat expiry, quarantine, recovery and release. Live account/browser
  baseline proof is deferred to E2-6.

### E2-4: Rust Negative Inputs And Secure Purge

Responsibility:

* Supply negative callback inputs without exposing secrets and make cleanup
  authoritative at the Mobile Rust owner.

Dependency: E2-0.

Target areas:

* `apps/mobile/src-tauri/src/runtime/oauth/acceptance.rs` (new);

* `apps/mobile/src-tauri/src/runtime/oauth/mod.rs`;

* `apps/mobile/src-tauri/src/commands/oauth.rs`;

* `apps/mobile/src-tauri/Cargo.toml`;

* `apps/mobile/src/acceptance/negativeOAuth.ts` (new);

* related Rust/TypeScript tests.

Deliverables:

* production logout/purge operation with secure-storage absence projection;

* volatile `CallbackReplayHandle`;

* acceptance-only `replay`, `provider_mismatch`, `station_mismatch` intents;

* different-after-claim replay semantics;

* compile-time absence outside Acceptance builds;

* zeroization and cancellation on cleanup/restart.

Failure behavior:

* invalid/missing build identity, lease, replay handle or active attempt rejects;

* exact duplicate remains idempotent recovery;

* no negative adapter operation can generate success.

Deletion obligation:

* remove Web-only cleanup claims and any direct secure-store deletion from the
  Harness.

Focused gates:

```bash
(cd apps/mobile/src-tauri && cargo test --offline runtime::oauth)
pnpm --dir apps/desktop exec vitest run \
  --root ../mobile src/acceptance/registry.test.ts
pnpm mobile:check
```

Definition of done:

* secrets remain native, production cleanup proves absence, and release binary
  scans show no negative adapter.

### E2-5: RuntimeManifest And 16-Variant Atomic Cutover

Responsibility:

* Integrate E2-1..E2-4 into one fail-closed physical Gate.

Dependencies: E2-1, E2-2, E2-3, E2-4, accepted D-19 architecture, an
independently reviewed and landed D-19 Acceptance Infra execution plan, and an
accepted Mobile D-19 execution decomposition/plan amendment.

Target areas:

* `tooling/acceptance/environments/mobile-native.yaml`;

* `tooling/acceptance/provisioners/mobile_native.py`;

* `tooling/acceptance/gates/mobile/appium.py`;

* `tooling/acceptance/gates/mobile/native_e2e.py`;

* `tooling/acceptance/gates/mobile/{appium,native_e2e}_test.py`;

* `tooling/acceptance/gates/mobile/{simulator_e2e,simulator_e2e_test}.py`
  (retained simulator consumer adaptation only);

* `tooling/acceptance/fixtures/mobile_native_reset.py`;

* `tooling/acceptance/tests/test_mobile_native_preflight.py`;

* `docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation.md`;

* `apps/mobile/src-tauri/src/commands/mod.rs`;

* `apps/mobile/src/acceptance/{contracts,actions,registry}.ts`;

* Mobile Feature/Capability/Registry contracts when path coverage changes.

Deliverables:

* validated build, Fixture, proof, account and browser lease payloads and
  `ArtifactRef` consumers;

* exact Appium/Driver/WebView identities;

* 16 executable variants with no disabled-support marker;

* per-variant Mobile and Station evidence correlation;

* cross-Station dual snapshots;

* reverse-order cleanup and quarantine.

Ephemeral capability contract:

| Capability ID | Parent-owned authority | Child operations |
|---|---|---|
| `mobile.native.appium-session` | raw physical-device handle, Appium transport/session, fixed Harness execution, capture persistence, install and runtime-identity production | `start`, `stop`, `wait_ready`, `is_alive`, `contexts`, `switch_context`, `harness_inventory`, `harness_action`, `harness_negative_callback`, `refresh_webview`, `find_element`, `click`, `capture_page_source`, `capture_screenshot`, `verify_build_identity` |
| `mobile.native.provider-authorization` | provider credential, account serialization, browser fence and provider identity | `authorize` |
| `mobile.native.station-fixture` | Station Fixture process, correlation authority and authoritative snapshots | `prepare_following_gate`, `expire_awaiting_attempt`, `read_proof_snapshot` |

All operation payloads are typed and identity-bound. Appium session IDs, raw
device identifiers, provider subjects, credentials and correlation keys remain
parent-side. The child cannot submit JavaScript or receive raw page source,
screenshots, element attributes, URLs or replay handles. Parent-owned fixed
Harness operations return only their closed, secret-scanned projections.
Page-source and screenshot captures are written directly through Evidence Store
and cross the channel only as source-bound `ArtifactRef` values. Cleanup-only
operations are not child-callable.
The manifest separates child-visible `required_actions` from the exact
parent-only set `build.identity`, `oauth.replayHandle`, and
`oauth.negativeCallback`; the latter never enter generic `harness_action`
dispatch.

Parent acquisition order:

1. Generic profile/deployment leases and service attestations.
2. Two source-bound Mobile builds and build-attestation ArtifactRefs.
3. Two Station Fixture leases.
4. Four physical-device leases, two provider-account leases and provider
   identity assertions.
5. Four browser-session leases.
6. Register all acquired leases with one heartbeat owner, then start it.
7. Register exactly the three capability handlers and seal the launch context.

Cleanup order:

1. Runner quiesces the launch context.
2. Before every lease terminal transition, check heartbeat health; a failure
   quarantines that lease and every remaining authority.
3. Stop parent-owned Appium sessions, restore browser baselines, transition
   browser leases to `RELEASED/QUARANTINED`, then unregister each terminal lease.
4. Clean Station Fixture state, persist post-cleanup proof/outcomes, transition
   Fixture leases to terminal state, then unregister them.
5. Transition provider-account and physical-device leases to terminal state,
   checking heartbeat health before each transition, then unregister each.
6. After all leases are terminal and unregistered, stop and join the heartbeat
   owner and verify terminal scheduler health.
7. Close and zeroize broker/Fixture authority.
8. Release storage, ports, profile and deployment leases.
9. Runner closes the launch context and verifies handler cleanup.

Failure behavior:

* missing external prerequisites return `blocked/BLOCKED/UNPROVEN`; invalid,
  mismatched or failed artifact/lease/runtime-cell/snapshot/cleanup evidence
  returns `failed/PARTIAL/UNPROVEN`. Both leave MS-AG03 `UNPROVEN`.

Integration invariants:

* Evidence Store run ID and provisioning run ID remain distinct D-18
  identities; neither may be equated, inferred from, or substituted for the
  other.
* Destructive actor reset runs exactly once per declared Station during
  provisioning.
* The heartbeat lifecycle covers all 12 acquired leases, including both
  Station Fixture leases, before Gate launch.

Atomic cutover:

* all consumers switch in one closure;

* path-only artifacts, declarative browser fields, projection-only readback and
  unsupported variants are deleted in the same change;

* no compatibility reader, fallback or second owner remains.

Focused gates:

```bash
python3 -m unittest \
  tooling.acceptance.gates.mobile.proof_contracts_test \
  tooling.acceptance.gates.mobile.appium_test \
  tooling.acceptance.gates.mobile.native_e2e_test \
  tooling.acceptance.gates.mobile.simulator_e2e_test \
  tooling.acceptance.tests.test_mobile_native_build \
  tooling.acceptance.tests.test_mobile_native_preflight \
  tooling.acceptance.tests.test_mobile_oauth_station_fixture \
  tooling.acceptance.tests.test_mobile_resource_lease \
  tooling.acceptance.tests.test_mobile_simulator_provisioner

pnpm mobile:check
make acceptance-validate DOMAIN=mobile
make acceptance-coverage-report
git diff --check -- tooling/acceptance apps/mobile apps/station docs/architecture/mobile
```

Definition of done:

* source-side Gate closure and synthetic integration are complete. A structured
  preflight may remain blocked only on declared external devices, accounts,
  signing inputs, services or physical artifacts; live lease/build/proof
  artifacts are produced only in E2-6.

Historical D-18 execution finding on 2026-08-30 (closed by the update below):

* `acceptance-run.py` launches the Gate through `subprocess.run(...)` after the
  Provisioner has returned a serialized RuntimeManifest;
* the accepted secret boundary permits only in-process memory or an inherited
  anonymous pipe for the provider-correlation key and forbids RuntimeManifest,
  filesystem, environment and network transport;
* the current generic Provisioner/Gate lifecycle has no `pass_fds` or equivalent
  non-persisted handoff contract, so a physical-device broker cannot remain
  fenced across the process boundary without changing Acceptance Infra;
* E2-5 therefore stops with `ACCEPTANCE_INFRA_REQUIRED`. Mobile code must not
  add an environment-secret, persisted broker endpoint, compatibility reader or
  Gate-side reacquisition workaround.

D-18 closure update on 2026-08-30:

* `EphemeralGateLaunchContext` now provides the accepted generic anonymous
  capability channel and has passed both closure reviews, the aggregate
  Acceptance Infra Gate, and exact-scope Gap Detector;
* the D-18 `ACCEPTANCE_INFRA_REQUIRED` instance is cleared; D-19 is a distinct
  later Acceptance Infra dependency and remains open;
* W2-E2B / E2-1 + E2-3 remediation is closed; D-19 architecture and its Infra
  execution plan are accepted, and E2-5 remains blocked by active D-19 Infra
  landing plus the later reviewed Mobile amendment.

### E2-6: Physical 16-Cell MS-AG03 Proof

Responsibility:

* Execute and judge the accepted physical Gate without substituting evidence.

External prerequisites:

* two connected physical iOS devices;

* two connected physical Android devices;

* one approved GitHub and one approved Google disposable account lease;

* two approved disposable Stations and Relay;

* one independently powered external controller host/device whose repo-owned
  runtime, key custody and local journal store have the accepted D-19
  controller-store durability qualification;

* platform signing identities and physical build destinations;

* explicit destructive Fixture authorization.

Required run:

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-native-access-e2e
```

Required cells:

* iOS and Android: GitHub success, Google success, cancel, following-gate,
  expiry, replay, provider mismatch and Station mismatch.

Evidence:

* build attestations and runtime identities;

* account/browser/device/Fixture leases and provider identity assertions;

* Mobile DOM, AX, screenshots and sanitized projections;

* per-variant Station proof snapshots;

* cross-Station paired snapshots;

* per-client secure-storage absence, HMAC-channel destruction, redaction audit,
  final cleanup and zero-residue snapshots;

* one final 16-cell variant ledger.

Definition of done:

* one source-bound run is `passed/DONE/PROVEN`;

* all 16 cells pass;

* redaction and cleanup pass;

* MS-AG03 may advance to proven;

* MS-PA03 may advance only when its mapped static Gate also passes;

* this run supplies only the MS-AG03 contribution to MS-PA17 and MS-PA25;
  those assertions remain unproven until every mapped Gate passes;

* W2 remains incomplete if any other W2 requirement is unproven.

## 8. Atomic Cutover Matrix

| Old path                                                       | New source of truth                                            | Cutover condition                                                    | Deletion proof                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| env artifact path existence                                    | build attestation + embedded runtime identity                  | E2-1 producer gates pass and E2-5 consumers cut over                 | search finds no unverified artifact consumer     |
| `noReset` stale app reuse                                      | fresh exact-artifact install                                   | all Appium sessions use install policy                               | Appium capability/driver tests                   |
| browser `"required"` strings                                   | account/browser lease ArtifactRefs                             | E2-3 producer gates pass and E2-5 consumers cut over                 | no declarative-only markers                      |
| raw UDID/serial in RuntimeManifest                             | physical-device lease ArtifactRefs + process-local broker handle | E2-3 broker tests pass and E2-5 consumers cut over                 | manifest redaction and old-field search          |
| untyped lease release bookkeeping                              | immutable `MobileLeaseOutcome` for all 12 acquired leases      | E2-0A relation tests and E2-5 cleanup integration pass               | exact acquisition/outcome set equality           |
| client projection as Station readback                          | Station proof ArtifactRef                                      | all variants consume snapshots                                       | no “Station readback” sourced only from Web      |
| disabled physical variants                                    | executable scenario registry                                   | all ten negative runners pass focused tests                          | zero unsupported ledger entries                  |
| Harness secure-store cleanup                                   | Rust production logout/purge                                   | absence readback passes                                              | no Harness direct storage mutation               |
| legacy Android AVD-named destination plus raw device ownership | physical destination class plus four device-lease ArtifactRefs | preflight resolves four current fences and distinct physical devices | tree-wide old-name scan plus lease-mapping tests |

The E2-5 consumer inventory is exhaustive for the physical Gate and is checked
against the repository tree before merge:

* `load_mobile_native_preflight_spec`;

* `preflight_mobile_native_inputs`;

* `MobileNativeProvisioner.provision`;

* `AppiumSession.start`;

* `MobileNativeGate._run_access`;

* `mobile_native_reset.py`;

* physical Gate and preflight unit tests;

* `mobile-native.yaml` plus the parent W2 execution-plan examples;

* Mobile Acceptance contracts, actions and registry.

E2-5 first records the tree-wide matches for each old identifier, assigns every
match to the inventory above, then applies the cutover. An unclassified match
blocks completion. Executable deletion guards:

```bash
legacy_android_destination='PT_MOBILE_ANDROID_''AVD'
! rg -n "$legacy_android_destination" \
  tooling/acceptance apps/mobile docs/architecture/mobile
! rg -n "(clean_start|readback|cleanup)[\"']?\s*:\s*[\"']required" \
  tooling/acceptance/environments/mobile-native.yaml
disabled_variant='supported''=False|missing_''closure'
! rg -n "$disabled_variant" \
  tooling/acceptance/gates/mobile/native_e2e.py \
  tooling/acceptance/gates/mobile/native_e2e_test.py

python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-cutover-inventory
```

`deep_link_for_failure_case` may remain for simulator-owned public invalid URLs;
physical OAuth code/state must never pass through that Driver-visible API.
`appium:noReset=true` may likewise remain in simulator sessions; focused tests
must prove physical sessions uninstall/install the attested artifact while the
simulator contract remains unchanged.

Rollback uses version control and deployment rollback. No permanent dual path is
allowed.

## 9. Artifact Roles

| Role                          | Run-relative path                                                     |
| ----------------------------- | --------------------------------------------------------------------- |
| Mobile proof contract catalog | `runtime/mobile/contracts.json`                                       |
| iOS/Android build attestation | `runtime/mobile/builds/<platform>.json`                               |
| Provider account lease        | `runtime/mobile/leases/accounts/<provider>.json`                      |
| Provider identity assertion   | `runtime/mobile/identities/providers/<provider>.json`                 |
| Physical-device lease         | `runtime/mobile/leases/devices/<client-id>.json`                      |
| Client browser-session lease  | `runtime/mobile/leases/browsers/<client-id>.json`                     |
| Station Fixture lease         | `runtime/mobile/fixtures/<service-id>/lease.json`                     |
| Fixture operation             | `runtime/mobile/fixtures/<service-id>/operations/<operation-id>.json` |
| Fresh-install trace           | `evidence/mobile/runtime/<client-id>/install.json`                    |
| Installed runtime identity    | `evidence/mobile/runtime/<client-id>/build-identity.json`             |
| Mobile visible proof          | `evidence/mobile/<variant-id>/<client-id>/`                           |
| Station proof snapshot        | `evidence/mobile/<variant-id>/station/<service-id>.json`              |
| Secure-storage absence        | `evidence/mobile/cleanup/secure-storage/<client-id>.json`             |
| HMAC-channel destruction      | `evidence/mobile/cleanup/provider-correlation.json`                   |
| Post-cleanup Station proof    | `evidence/mobile/cleanup/station/<service-id>.json`                   |
| Lease release/quarantine      | `evidence/mobile/cleanup/leases/<lease-id>.json`                      |
| Redaction audit               | `evidence/mobile/cleanup/redaction-audit.json`                        |
| Run lifecycle                 | `reports/mobile-native-lifecycle.json`                                |
| Final result/variant ledger   | `reports/mobile-native-result.json`                                   |

Acceptance Core `RunHandle` writes every path above. Producers return redacted
payloads and never write the Evidence Store directly. E2-0 freezes exact role
cardinality for two builds, two provider accounts/identities, four physical
devices/browser profiles/runtime identities/install traces, every
variant-client Station/visible proof relation, both Station cleanup snapshots,
all lease outcomes, one correlation-destruction audit, one redaction audit,
one lifecycle and one final result.

## 10. End-To-End Lifecycle Mapping

| Lifecycle step                                    | Owner                            | Closure          |
| ------------------------------------------------- | -------------------------------- | ---------------- |
| source capture -> physical build -> attestation   | Mobile build owner               | E2-1             |
| account/device/browser acquire -> baseline        | Provisioner/account broker       | E2-3             |
| Station target verify -> Fixture prepare          | deployment owner/Station adapter | E2-2             |
| app install -> Harness/runtime identity           | Appium/Mobile                    | E2-1, E2-5       |
| provider launch -> OS callback -> Rust -> Station | production runtime               | E2-4, E2-5       |
| Station commit -> snapshot -> visible comparison  | Station proof/Gate               | E2-2, E2-5       |
| cancellation/timeout/invalid callback             | production runtime + proof       | E2-4, E2-5       |
| cleanup -> post-cleanup proof -> lease release    | all resource owners              | E2-2, E2-3, E2-5 |
| primary 16-cell behavior judgment                 | Mobile Gate                      | E2-6             |
| final 19-role evidence closure                    | detached Mobile finalizer + Evidence Store monotonic merge | post-acceptance D-19 Infra landing + E2-5 Mobile landing |

No lifecycle step remains unmapped.

Transition coverage:

| State machine transition                                                               | Scenario/evidence         | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| -------------------------------------------------------------------------------------- | ------------------------- | :---------------- | :---------------------- | :------ | :------- | :------------------------- |
| proof `DISCOVERED -> LEASED -> BASELINE_VERIFIED`                                      | W2E2-AS01, W2E2-AS02      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| proof `BASELINE_VERIFIED -> FIXTURE_READY -> GATE_RUNNING`                             | W2E2-AS03..AS09           | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| proof `GATE_RUNNING -> PROOF_CAPTURED -> CLEANING -> RELEASED`                         | W2E2-AS03..AS10           | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| proof `any -> CLEANING -> QUARANTINED`                                                 | W2E2-AS02, W2E2-AS10      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| Fixture `DISCOVERED -> LEASED -> PREPARED -> USED`                                     | W2E2-AS04, W2E2-AS05      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| Fixture `USED -> CLEANING -> RELEASED/CLEANUP_FAILED`                                  | W2E2-AS10                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| browser `DISCOVERED -> LEASED -> BASELINE_VERIFIED -> IN_USE`                          | W2E2-AS02, W2E2-AS03      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| browser `IN_USE -> RESTORING -> RELEASED/QUARANTINED`                                  | W2E2-AS10                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth `idle -> starting`                                                               | W2E2-AS03, W2E2-AS09      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth `launching -> awaiting-provider -> callback-received -> exchanging`              | W2E2-AS03                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth `exchanging -> session-candidate-issued -> access-gate-chain`                    | W2E2-AS04                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth `access-gate-chain -> finalizing` after final grant                              | W2E2-AS04                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth `finalizing -> credential-delivery -> active-session`                            | W2E2-AS03, W2E2-AS04      | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| OAuth \`launching                                                                      | awaiting-provider         | callback-received | exchanging -> cancelled | expired | failed\` | W2E2-AS05, W2E2-AS07..AS09 |
| claimed callback -> typed replay rejection without another transition owner            | W2E2-AS06                 | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| crash after finalization before acknowledgement -> same encrypted envelope recovery    | W2E2-AS03 failure variant | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| cancellation after finalization -> candidate-created session revoked before completion | W2E2-AS09 failure variant | <br />            | <br />                  | <br />  | <br />   | <br />                     |
| exact duplicate during uncertain completion -> same attempt recovery                   | W2E2-AS06 failure variant | <br />            | <br />                  | <br />  | <br />   | <br />                     |

## 11. Acceptance Scenarios

All scenarios begin `pending`. Structural/unit evidence cannot change a
physical scenario to pass.

### W2E2-AS01: Attested Fresh Install

* **Precondition**: Accepted source snapshot and physical device lease.

* **Action**: Acceptance operator starts the run; the system builds, attests,
  replaces the prior app, and the user opens the installed IPA/APK.

* **Expected**: The intended Mobile surface appears only after
  Web/Rust/runtime/app/signing identities match.

* **Failure variant**: Any input, toolchain, artifact, signing or runtime
  mismatch blocks before OAuth.

* **Evidence**: build attestation, Appium install trace, `build.identity`.

* **Status**: pending

### W2E2-AS02: Lease Conflict And Crash

* **Precondition**: Account/browser/device lease is held.

* **Action**: Acceptance operator starts a competing run or resumes a stale run.

* **Expected**: The system rejects provider/Appium work and reports the occupied
  or quarantined resource before the user enters OAuth.

* **Failure variant**: Resource becomes reusable without baseline recovery.

* **Evidence**: lease state, fence checks, quarantine/release artifact.

* **Status**: pending

### W2E2-AS03: GitHub And Google Success

* **Precondition**: Four physical client leases and provider baselines verified.

* **Action**: Users authorize GitHub/Google on iOS/Android.

* **Expected**: Real OS callback returns; Station grants and one session activates.

* **Failure variant**: Provider/network timeout remains recoverable and does not
  mint another session.

* **Evidence**: DOM/AX/screenshot, Mobile projection, Station snapshot.

* **Status**: pending

### W2E2-AS04: Following Gate

* **Precondition**: Fixture installs a real post-OAuth invite gate.

* **Action**: User authorizes provider, then submits the real invite action.

* **Expected**: Candidate remains inactive before final gate and activates once
  after grant.

* **Failure variant**: Invalid/cancelled invite leaves no active session.

* **Evidence**: before/intermediate/final Station snapshots and Mobile UI.

* **Status**: pending

### W2E2-AS05: Expiry

* **Precondition**: Real awaiting attempt; Fixture conditionally expires it.

* **Action**: User returns from the provider after the authorization window has
  expired.

* **Expected**: Mobile shows the localized expired state and keeps the access
  gate available so the user can start a new OAuth attempt; no
  candidate/envelope/session exists.

* **Failure variant**: If Fixture completion is uncertain, the operator retries
  by operation ID while the user remains on the recoverable access gate.

* **Evidence**: Mobile DOM/AX/screenshot, Fixture journal and Station snapshot.

* **Status**: pending

### W2E2-AS06: Replay

* **Precondition**: Real OS callback is claimed once.

* **Action**: User returns through a second callback after the first callback
  has already been accepted.

* **Expected**: Mobile shows the localized invalid/replayed callback state and
  offers restart from the access gate; no second candidate or session appears.

* **Failure variant**: After a crash with uncertain completion, an exact
  duplicate restores the same user-visible attempt/result and never creates a
  second session.

* **Evidence**: DOM/AX/screenshot, callback-handle lifecycle, Mobile projection
  and Station snapshot.

* **Status**: pending

### W2E2-AS07: Provider Mismatch

* **Precondition**: Real provider-bound attempt and valid leases.

* **Action**: User returns from OAuth while the Acceptance-only path presents a
  callback bound to the wrong provider.

* **Expected**: Mobile shows the localized provider-mismatch state and lets the
  user restart with the originally selected provider; no
  candidate/envelope/session exists.

* **Failure variant**: With a missing/stale lease, the run blocks before the
  browser opens and the user is not shown a false OAuth failure.

* **Evidence**: Mobile DOM/AX/screenshot, sanitized Rust result and Station
  snapshot.

* **Status**: pending

### W2E2-AS08: Station Mismatch

* **Precondition**: Two signed Stations and one active Station-bound attempt.

* **Action**: User returns from OAuth while the Acceptance-only path presents
  the callback under the alternate signed Station scope.

* **Expected**: Mobile shows the localized Station-mismatch state, preserves
  the selected trusted Station, and offers restart; no credential or session
  crosses Station scope.

* **Failure variant**: If either Station snapshot is missing, Mobile remains on
  the recoverable access gate and the cell stays unproven.

* **Evidence**: Mobile DOM/AX/screenshot and trust state plus one Station
  snapshot per Station.

* **Status**: pending

### W2E2-AS09: Cancellation

* **Precondition**: OAuth browser or following gate is active.

* **Action**: User cancels.

* **Expected**: User returns to the same access gate; attempt secrets and
  candidate session are unusable.

* **Failure variant**: If cancellation arrives after finalization, the
  candidate-created session is revoked before Mobile reports cancellation; a
  crash after finalization but before credential acknowledgement instead
  resumes the same encrypted envelope and terminal outcome.

* **Evidence**: Mobile projection, Station snapshot, secure-storage absence.

* **Status**: pending

### W2E2-AS10: Cleanup And Baseline Restore

* **Precondition**: Success, failure and interrupted-run states exist.

* **Action**: User exits/cancels the flow and the Acceptance operator closes the
  run.

* **Expected**: The system restores the exact pre-run policy/browser baseline;
  run-owned Station/Mobile resources are absent and leases release.

* **Failure variant**: policy revision conflict, residue or identity mismatch
  quarantines the resource and fails readiness.

* **Evidence**: post-cleanup snapshots, absence readback, port/process/storage
  audit, release/quarantine artifacts.

* **Status**: pending

## 12. Risk And Anti-Regression

| Risk                                | Control                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| Fixture becomes business authority  | operation allowlist, no success mutation, Station-owned adapter |
| Gate self-proves                    | producer/Gate separation and Core-only artifact writer          |
| Callback secret leakage             | Rust-only handle, redaction scan, zeroization                   |
| Cross-client provider contamination | exclusive browser profiles, account fence and serialization     |
| Stale physical app                  | attested artifact, fresh install, runtime identity              |
| Torn Station snapshot               | one read-only repeatable-read transaction                       |
| Cleanup overwrites operator change  | policy revision compare-and-restore                             |
| Runner crash                        | heartbeat expiry -> quarantine, not auto reuse                  |
| Toolchain drift                     | conservative attestation invalidation                           |
| Missing physical resources          | `BLOCKED / UNPROVEN`, no substitute cell                        |

The two-account serial model is reviewed if provider operations cannot complete
within the Gate's existing timeout. Moving to four accounts requires a separate
resource-plan update, not an assertion downgrade.

## 13. Verification

Focused source closure:

```bash
python3 -m unittest \
  tooling.acceptance.gates.mobile.appium_test \
  tooling.acceptance.gates.mobile.native_e2e_test \
  tooling.acceptance.gates.mobile.simulator_e2e_test \
  tooling.acceptance.tests.test_mobile_native_build \
  tooling.acceptance.tests.test_mobile_native_preflight \
  tooling.acceptance.tests.test_mobile_oauth_station_fixture \
  tooling.acceptance.tests.test_mobile_resource_lease \
  tooling.acceptance.tests.test_mobile_simulator_provisioner

python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-protected-paths

python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-version-policy

python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --verify-cutover-inventory

(cd apps/station && go test ./app/subserver/oauth/... ./frame/touch/accessgate/...)
pnpm mobile:check
make acceptance-validate DOMAIN=mobile
make acceptance-coverage-report
git diff --check -- tooling/acceptance apps/mobile apps/station docs/architecture/mobile
```

Target-state final runtime proof (not executable until the accepted D-19 Infra
plan and Mobile E2-5 amendment have landed):

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-native-access-e2e

python3 tooling/scripts/acceptance-artifact.py cat \
  --gate mobile-native-access-e2e \
  --role mobile-native-result

python3 tooling/scripts/acceptance-artifact.py verify-latest \
  --gate mobile-native-access-e2e \
  --require-authoritative

make acceptance-validate DOMAIN=mobile
```

Target-state `verify-latest --require-authoritative` executes the D-19-aware
Evidence Store reader against the immutable requirement, seal, outcome and
manifest records. It does not import or rerun the current-worktree Mobile
validator. The command may use the mutable latest pointer only to resolve one
immutable run-manifest `ArtifactRef`, and returns a closed
`AuthoritativeLatestResolution` that binds authority mode, interlock/current
generation, enforcement digest, manifest ref/hash and canonical result tuple.
Project-owned planner/runner/readiness consumers reject bare manifests, raw
latest values and free-form legacy verifier output. It then fails unless:

* every mandatory Artifact Role in §9 exists exactly once where cardinality is
  one, and every role/ref resolves to the same `runId`, source commit,
  workspace digest and Gate;

* the final result and lifecycle are exactly `passed/DONE/PROVEN`;

* the variant ledger contains the exact 16 required cells with no unsupported,
  skipped or substituted physical cell;

* every cell correlates build/runtime identity, physical-device,
  provider-account, browser-session and Fixture leases, provider identity,
  Mobile visible evidence and required Station snapshots;

* both Station post-cleanup snapshots prove zero run-owned residue, every lease
  is released or explicitly quarantined, every client has secure-storage
  absence, and the HMAC channel is closed and zeroized;

* the redaction audit passes both schema field deny-lists and byte scanning of
  all durable artifacts for callback/code/state/PKCE/nonce/token/cookie,
  provider identity, absolute path, UDID/serial and certificate-subject
  material.

`make acceptance-validate DOMAIN=mobile` remains structural validation and
cannot satisfy any runtime condition above.

## 14. Status

| Closure                             | Status  | Evidence                                       |
| ----------------------------------- | ------- | ---------------------------------------------- |
| MOP-D03-A / MOP-D04-A amendment     | done | base-plan independent review PASS with 0 P0/P1; three P2 clarifications resolved |
| E2-0 Interface/artifact-role freeze | done | 35 focused contract tests; protected-path, version-policy and cutover-inventory checks PASS |
| E2-0A Amended contract freeze       | done | 45 focused tests; 71 combined Python regressions; three source-policy gates PASS; independent audit 0 P0/P1 |
| E2-1 Build provenance               | done | bounded controlled-build subprocess lifecycle; 59 build tests + 31 preflight tests PASS; final review found no in-scope P0/P1 |
| E2-2 Station Fixture/proof          | done | Go Station adapter/CLI gates and 10 Python Fixture tests PASS |
| E2-3 Provider/browser leases        | done | machine-global authority, canonical ArtifactRecord projection and bounded heartbeat owner; 88 lease + 47 frozen-contract tests PASS |
| E2-4 Rust negative input/purge      | done | 17 default + 24 Acceptance Rust tests, 9 TS tests, Mobile check and linked release absence scan PASS |
| E2-5 Atomic Gate cutover            | blocked | D-18 capability cutover is implemented; D-19 finalization, heartbeat cleanup ordering, neutral contract migration, discriminator closure and final 19-role judgment remain |
| E2-6 Physical 16-cell proof         | unproven / not started | E2-5 is incomplete; physical devices/accounts/services are also unavailable |

### 14.1 W2-E2B Completion Reopen — 2026-08-30

Two fixed-commit reviewers independently audited
`57e4231943ebc0a16143d6c7607a96762a55bb47..9cd61e3e0f39398f15580a6a97d07803031fb598`
without using later worktree state. Both returned `NO-GO`.

Required remediation:

| Finding | Severity | Closure owner | Completion evidence |
|---|---|---|---|
| Physical-resource ledger is partitioned by worktree, allowing duplicate cross-worktree ownership | P0 | E2-3 | process-global authority namespace and two-worktree contention test |
| Lease Artifact writes omit canonical frozen roles | P1 | E2-3 | exact role/cardinality assertions against real Evidence Store |
| Lease heartbeat has no operational owner or scheduler | P1 | E2-3 | bounded lifecycle owner with expiry/quarantine/recovery tests |
| Build subprocesses have no timeout, cancellation or deterministic failure cleanup | P1 | E2-1 | bounded process lifecycle and interrupted-build cleanup tests |
| E2-5 consumer uses the obsolete `AppiumSession` constructor | P1 | E2-5 | atomic consumer cutover after D-18 and W2-E2B close |
| Lease Evidence Store keys use role instances that the frozen validator rejects as unknown roles | P1 | E2-3 | canonical manifest-to-`ArtifactRecord` projection and full inventory validation against frozen paths/cardinalities |
| Default lease authority follows `PT_ACCEPTANCE_ARTIFACT_ROOT`, so different roots can acquire the same physical identity | P0 | E2-3 | one machine-global non-overridable coordination root plus contention proof across worktrees and distinct artifact roots |
| Heartbeat owner exists only as a helper and is not wired to the Provisioner acquisition/cleanup lifecycle | P1 | E2-5 | atomically wire the E2-3 scheduler with lease acquisition and old-input deletion; pre-E2-5 dual wiring is forbidden |
| A hostile build child can call `setsid()` and escape POSIX process-group cleanup | review non-blocker | future design only | MOP-D04-A explicitly trusts the reviewed build owner and disclaims a general hermetic sandbox; expanding to hostile-child containment requires a separate accepted architecture amendment |
| Machine-global `/var/tmp` authority root is rejected on macOS because `/var` is a system symlink | P1 | E2-3 | resolve the trusted OS-owned base to its canonical path before no-follow traversal and construct the production default in a regression test |

### 14.2 W2-E2B Remediation Closure — 2026-08-30

- E2-1 and E2-3 combined focused regression: 225 tests PASS.
- E2-1 uses bounded execution and deterministic process-group cleanup for the
  accepted trusted, no-daemon Mobile build owner. Hostile subprocess sandboxing
  remains outside MOP-D04-A.
- E2-3 uses one machine-global authority independent of worktree and Evidence
  Store root, projects unique manifest role instances onto frozen Artifact
  Roles, and exposes one bounded heartbeat lifecycle owner.
- Independent final review reports no remaining in-scope production P0/P1.
  The final macOS canonical-root evidence gap was closed by constructing the
  production default ledger in the regression suite.
- Heartbeat activation, producer acquisition, D-18 consumer migration and legacy
  input deletion were integrated as the completed D-18 subset of E2-5; no dual
  path was introduced. This is not the full E2-5 source cutover. Heartbeat cleanup
  ordering, D-19 finalization and the reopened discriminator check remain.

### 14.3 E2-5 Review Reopen — 2026-08-30

| Finding | Severity | Required closure |
|---|---|---|
| Gate validates evidence-run ArtifactRefs against the distinct provisioning run ID | P1 | project and validate both identities independently throughout the manifest and Gate |
| Capability quarantine reports success without fencing underlying device/browser/account/Fixture leases | P1 | each handler quarantines every authority it can expose before returning success |
| Heartbeat scheduler failure is not observed by the Provisioner lifecycle | P1 | check heartbeat health before launch-context creation and during cleanup; failure quarantines and fails readiness |
| Appium session survives when fresh-install evidence persistence fails after session creation | P1 | rollback the parent session before propagating evidence-write failure |
| Primary Gate judgment attempted to own complete Artifact Role/relation validation before cleanup-produced evidence existed | P1 | keep only pre-cleanup behavior judgment in the Gate; project the complete sealed inventory and run the neutral 19-role validator in the detached post-cleanup finalizer before final `PROVEN` |
| Physical Appium retains the simulator-only deep-link failure operation | P1 | remove the physical operation and narrow the retained inventory exception to simulator files |
| Protected source verification reports `model/domain` drift | resolved baseline drift | PR #100 added the already-merged `MemberSettings.background_image = 7`; current `model/domain` is clean and the frozen digest is refreshed without a new Proto/version change |

### 14.4 E2-5 Finalization Reopen — 2026-08-30

| Finding | Severity | Required closure |
|---|---|---|
| Cleanup-time heartbeat failure can occur after resources begin releasing | P1 | observe health before every release boundary; on failure quarantine all remaining authorities and fail cleanup |
| Appium evidence-write rollback loses ownership when `stop()` also fails | P1 | register the live session before persistence and retain it for later cleanup until stop succeeds |
| Physical environment still requires obsolete deep-link delivery and omits the production purge action at the Gate | P1 | remove physical deep-link requirement; invoke production Rust purge through the Harness and persist four absence artifacts |
| Fixture outcomes use path-valued roles rather than the frozen `mobile-lease-outcome/<leaseId>` role-instance contract | P1 | emit canonical role instances and include both Fixture outcomes in final cardinality |
| Multi-instance Artifact Role discriminator can disagree with canonical path or payload identity | P1 | require the neutral Mobile contract to validate role-instance discriminator, path dimensions and payload identity as one tuple, with mutation tests for every multi-instance role |
| Several required Artifact Roles only validate generic run/Gate/redaction fields and can accept semantically empty payloads | P1 | define closed payload schema and semantic relations for all 19 roles, with one empty/mismatched adversarial case per role |
| Full 19-role validation runs before parent cleanup can emit lease outcomes, Station cleanup proofs and correlation-destruction evidence | `ACCEPTANCE_INFRA_REQUIRED` | define independent finalizer requirement, sealed role-instance snapshot and detached bounded validator without moving cleanup or authority into the child |

Historical test-count statements prove source coverage only. Reopened closure
requires fresh immutable Gate evidence and a new independent review with no
unresolved P0/P1.

Current open E2-5 set:

1. Until the atomic D-19 activation lands, a fail-closed publication interlock
   must prevent `mobile-native-access-e2e` from publishing `PROVEN` from its
   pre-cleanup Gate result alone. The guard is installed first, after D-19 claim
   consumers and coordinator quiescence land, and remains permanent. The later
   Mobile source cutover installs the requirement and Catalog config; explicit
   generation activation follows before E2-5 may execute or publish.
2. D-19 architecture acceptance, independently reviewed Infra plan and landing.
3. Heartbeat health check before every lease terminal transition, followed by
   terminal-state unregister and only then heartbeat stop/join.
4. Post-acceptance Mobile execution decomposition and reviewed plan amendment
   for neutral contract migration, generated registration, protected baseline
   and detached finalizer injection.
5. Discriminator/path/payload tuple validation and closed semantic schemas plus
   adversarial cases for all 19 roles.
6. Ensure `GateProcessLauncher` terminates and verifies its dedicated process
   group after normal, nonzero, timeout and exceptional direct-child exits; add
   real-process normal/nonzero descendant regression tests.
7. Fresh source-closure regression and two independent reviews with no P0/P1.

All other findings in §14.3 and §14.4 are closed at source level by the current
working tree and prior focused regressions; they are not physical-product proof
and do not change MS-AG03 from `UNPROVEN`.

### 14.5 D-19 Architecture Review Reopen — 2026-08-30

Two independent fixed-snapshot reviewers returned `0 P0 / 5 P1`. The current
architecture revision remediates these findings but remains
`DESIGN_REVIEW_PENDING` until a fresh double review returns no P0/P1:

| Finding | Severity | Required closure |
|---|---|---|
| Proof-admission source graph lacked total classifier precedence, valid grammar/interpreter pairs and exact edge-to-target equality | P1 | define one closed classifier table and fail closed on overlap, ambiguity, invalid pairs or target mismatch |
| Authority runtime refs and persistence request were not explicitly equal to the enclosing authorization ID | P1 | require cross-field authorization ID equality for authority and abort flows |
| Execution-environment identity allowed cross-OS tagged combinations | P1 | split Darwin/Linux environment and termination identities into closed unions with same-OS equality |
| Process-group reap was incorrectly treated as descendant containment | P1 | restrict claim jobs to a verified trusted leaf-process policy; otherwise require complete execution-environment termination |
| Darwin plain fsync was treated as power-loss durability | P1 | bind a platform durability profile; require APFS file full-sync, directory sync and same-volume full-sync anchor, or fail before mutation |

The first fresh re-review after those changes returned `0 P0 / 4 unique P1`.
The next architecture revision additionally closes:

| Finding | Severity | Required closure |
|---|---|---|
| Authority-runtime persistence could not represent filesystem I/O failure | P1 | add a dedicated I/O code and exact pre-publication `NO_MUTATION` versus post-publication `MAY_BE_DURABLE` matrix |
| Trusted leaf-policy digest had no reconstructible preimage | P1 | persist scanner source, exact forbidden-operation registry, inspected node digests and empty findings in a closed scan object |
| Darwin predecessor termination lacked kernel-bound evidence | P1 | after claim-consumer source cutover, bind a durable pre-reboot boot observation plus boot-boundary helper evidence for the first epoch and exact coordinator process-absence evidence thereafter |
| Linux PID namespace identity/termination was asserted | P1 | bind namespace device/inode and init PID/start/pidfd, wait for init termination, and prove zero surviving namespace members without claiming pin destruction |

The second fresh re-review returned `0 P0 / 5 unique P1`. The current revision
also closes:

| Finding | Severity | Required closure |
|---|---|---|
| Leaf policy omitted same-PID `exec*`, `spawn*`, `popen` and `pty.fork` escape routes | P1 | add exact process-image replacement and process-creation symbols plus adversarial fixtures |
| First Linux epoch could not represent an unnamespaced legacy predecessor | P1 | add explicit Darwin/Linux legacy predecessor unions and require post-source-cutover reboot-boundary evidence on both platforms |
| Boot observation omitted durability-profile identity | P1 | persist and verify the profile digest on every boot observation and authority/abort transition |
| Authority-runtime pre-publication timeout/process failure had no `NO_MUTATION` branch | P1 | permit timeout/process/I/O codes in the rejected branch only when no final path publication was attempted |
| Durability crash fixture was a non-resolvable ID/hash | P1 | use fixed-path content-addressed refs for manifest, power-cut trace, recovery result and probe runtime |

The third fresh re-review returned `0 P0 / 8 unique P1`. The current revision
also closes:

| Finding | Severity | Required closure |
|---|---|---|
| Python stdlib and builtin wrappers could bypass the leaf registry | P1 | enforce an exact direct-stdlib allowlist, reject direct `posix`, and cover every `exec*`/`spawn*`/`popen`/`pty` path |
| Scanner source tuple was caller-describable | P1 | derive it from a fixed `proof_admission.py` entrypoint and deterministic source-only closure rule |
| Legacy boot and Darwin process-absence objects lacked cross-field equality | P1 | require exact observation/environment/workspace/Gate/source/profile/helper/PID/start equality |
| Kernel helpers and pidfd evidence were not reconstructible | P1 | define fixed helper entrypoints/source closures/runtime refs and one non-transferable pidfd owner lifecycle |
| Durability probe runtime omitted capture ID | P1 | define a closed probe runtime manifest including `runtimeCaptureId` |
| Linux boot evidence reused Darwin digest domains | P1 | add dedicated Linux boot observation and boundary domains |
| Authority-runtime post-publication codes conflicted across documents | P1 | use one exhaustive matrix: specific timeout/process/I/O before publication; single publication-uncertain I/O code afterward |
| Reboot-stable profile used live/reusable mount identity and fixture payloads were untyped | P1 | split stable volume from live mount binding and define closed, cross-bound manifest/trace/recovery/runtime artifacts |

The fourth fresh re-review returned `0 P0 / 7 unique P1`. The current revision
also closes:

| Finding | Severity | Required closure |
|---|---|---|
| Allowed stdlib/builtin wrappers could still create or replace processes | P1 | remove `os`/`posix` from the emitter allowlist and reject all non-allowlisted stdlib/native modules |
| Claim code could close or unlock its inherited lease FD | P1 | move the sole lease FD to a fixed wrapper process and pass no descriptor-control capability to claim code |
| Pidfd wait omitted sole-parent/reaper and `SIGCHLD` conditions | P1 | bind owner PID/start, default `SIGCHLD`, no `SA_NOCLDWAIT`, sole waiter, one lease, `POLLIN` and closed `waitid(P_PIDFD)` status; require reboot after owner crash |
| Durability case cardinality and recovery equality were inconsistent | P1 | require one typed trace/recovery pair per case and add backend/sequence/interruption/runtime identity to recovery |
| Post-publication runtime result still allowed timeout/process codes | P1 | map every post-publication uncertainty to only `FINALIZER_AUTHORITY_RUNTIME_IO_FAILED` |
| Scanner parser/runtime could differ from the claim interpreter | P1 | bind executable hash, implementation, version, AST feature version and stdlib digest exactly |
| Platform matrix used `PARTIAL` as proof status | P1 | use `completionStatus=PARTIAL` and `proofStatus=UNPROVEN` |

The fifth fresh re-review returned `0 P0 / 8 unique P1`. The current revision
also closes:

| Finding | Severity | Required closure |
|---|---|---|
| Durability qualification could be reused after host/filesystem drift | P1 | bind tested host build, filesystem implementation/options, stable volume, live mount and typed power interruption evidence |
| Darwin process absence omitted workspace/Gate/epoch/source/profile identity | P1 | add those fields and exact prior-environment equality |
| Linux wait result omitted init PID equality and consuming wait options | P1 | require `siPid == namespaceInitPid`, `P_PIDFD + WEXITED`, no `WNOWAIT`, and reject `ECHILD` |
| Durability platform cardinalities and PASS relation remained ambiguous | P1 | make operation tuples variable with branch-exact values and require exact expected/observed state/hash equality |
| Claim-wrapper completion lacked reconstructible wait evidence | P1 | persist fixed wrapper source/runtime identity and wrapper/claim wait plus post-emission lease release evidence |
| Scanner runtime was split from the executing interpreter | P1 | require exact executable, implementation, version, AST feature version and stdlib equality under a dedicated digest domain |
| Persistence result digest was not equal to requested candidate runtime | P1 | require completed/uncertain result runtime digest equality and null only for rejection |
| Linux stable volume still included live device allocation | P1 | keep filesystem UUID/type in stable identity and derive device/mount identity per operation |

The sixth fresh re-review returned `0 P0 / 8 unique P1` plus one P2. The current
revision also closes:

| Finding | Severity | Required closure |
|---|---|---|
| Durability qualification omitted current host/filesystem and real interruption identity | P1 | bind host build, filesystem implementation/options, live mount and typed physical/VM hard-power event; requalify on drift |
| Darwin process absence was transplantable across authority contexts | P1 | bind workspace/Gate/prior epoch/environment/source/profile/helper and enforce exact equality |
| Linux consuming wait lacked init PID/options equality | P1 | bind `siPid`, `P_PIDFD`, `WEXITED`, no `WNOWAIT`, and reject `ECHILD` |
| Durability operation enums/cardinalities conflicted and PASS was underconstrained | P1 | use one operation enum with platform-exact tuples, prefix equality and expected/observed state/hash equality |
| Wrapper completion lacked closed wait status | P1 | add typed claim/wrapper wait evidence and exact job/wrapper/process equality |
| Scanner runtime digest/domain and executable authority were split | P1 | add the domain and pairwise equality across job executable, interpreter and scanner |
| Canonical result status fields and current platform implementation disagreed | P1 | close status enums and track `runtime_cell.py` canonical tuple migration in D-19 Infra |
| `MaintenanceFailureCode` was referenced but undefined | P1 | define the exact closed alias used by every maintenance result branch |
| `DATA_READ` edge assignments were non-canonical | P2 | require null grammar/interpreter assignment |

The seventh fresh double review returned `0 P0 / 7 unique P1`. The current
revision remediates these findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Claim/wrapper wait evidence is not a closed consuming-wait union | P1 | define exited/signaled branches, waiter/child identity, API/options, returned PID and exact completion equality |
| JSON-only claim code still has builtin filesystem access | P1 | provide a restricted builtin namespace or an equivalent enforceable no-filesystem runtime |
| Darwin coordinator absence does not prove wrapper/claim absence after crash | P1 | require reboot-boundary recovery after coordinator crash or prove every registered wrapper/claim absent |
| Durability expectation can be selected after recovery | P1 | persist a pre-execution backend/boundary expectation matrix |
| Durability host/filesystem/power equality remains under-specified | P1 | add explicit environment references and controller/boot evidence to trace and recovery records |
| `argvDigest`, `wrapperRuntimeDigest` and `scannerRuntimeDigest` lack complete domain/preimage definitions | P1 | define separate domains and exact preimages |
| Runtime Cell migration omits nested cell status normalization | P1 | migrate both aggregate and per-cell status/completion/proof projections in the future D-19 Infra plan |

The eighth fresh double review returned `0 P0 / 9 unique P1`. The current
revision remediates these findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Restricted Python builtins remain escapable and wrapper waits remain open | P1 | remove reflective/file/import capability and define a closed consuming wait union for both wrapper and claim |
| Darwin graceful/crash termination is not distinguishable | P1 | require a durable graceful-shutdown record or boot-boundary recovery after any ambiguous coordinator loss |
| Durability expectations are not committed before interruption | P1 | persist a separate immutable expectation matrix before fixture execution |
| Durability trace/recovery cannot represent all required host/filesystem/mount/power equalities | P1 | bind one qualified-environment object and interruption event through every case artifact |
| `argvDigest`, `wrapperRuntimeDigest`, and `scannerRuntimeDigest` remain incompletely specified | P1 | define distinct domains and exact closed preimages |
| Authority maintenance completed/uncertain results lack request-derived equality | P1 | bind interlock and activation result identities to their exact candidate request fields |
| Canonical result fields permit invalid Cartesian products | P1 | replace independent enums with a closed canonical result tuple union |
| Runtime Cell migration omits nested cell tuple normalization | P1 | migrate aggregate and every cell projection in the future D-19 Infra plan |
| Durability current-runtime qualification remains stale-reusable | P1 | require current host/filesystem/live-mount equality with the tested qualification or requalify |

The ninth fresh double review returned `0 P0 / 7 unique P1`. The current
revision remediates these findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Primary source trace lacked a schema/domain | P1 | define `PrimaryResultSourceTrace`, exact schema ID, ArtifactRefs and digest preimage |
| Durability expectation/start/controller chain lacked causal commitment | P1 | persist expectation and monotonic execution-start records before mutation; bind controller receipt and release token |
| Power-cut boot observations and recovery environment were not independently resolvable | P1 | add typed boot refs, full qualified environment and post-restart observation binding |
| Darwin crash attestation was not epoch-owned | P1 | bind graceful shutdown to exact epoch or require reboot-boundary recovery |
| Abort maintenance results lacked request/event equality | P1 | define exact authorization, attempt, plan, continuation, event and counter derivation |
| Canonical statuses were not a closed tuple union | P1 | replace Cartesian status fields with `CanonicalResultTuple` |
| Runtime Cell target covered neither aggregate nor nested tuples | P1 | define canonical tuples at both levels and track full future source migration |

The tenth fresh double review returned `0 P0 / 10 unique P1`. The current
revision remediates these findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Restricted emitter lacked an output contract and still exposed reflective builtins | P1 | define one authoritative-result binding, a closed AST subset and no callable/module/file/import capabilities |
| Claim wait was represented twice and wrapper waits remained open | P1 | retain only one closed consuming wait chain with exact waiter/child/status equality |
| Darwin graceful shutdown was not durably distinguishable from crash | P1 | add immutable epoch-owned shutdown record; ambiguous loss requires reboot |
| Durability expectation/controller/recovery causality remained self-asserted | P1 | bind pre-mutation execution start, signed controller receipt, boot observations and fresh recovery environment |
| Runtime-critical digest preimages remained incomplete | P1 | define domains and full preimages for argv, scanner, wrapper, waits, controller, expectation and environment records |
| Abort maintenance results lacked request-derived equality | P1 | bind every abort result branch to request and durable event-chain fields |
| Child-facing primary status remained Cartesian | P1 | use `CanonicalResultTuple` in context and invocation identity |
| Maintenance request identity was not fully equal to nested mutation identity | P1 | require workspace/Gate/descriptor/payload equality for all operations and rejected branches |
| Runtime Cell matrix had no named closed target | P1 | define `PlatformCellResult` and `PlatformMatrixResult` with exact key/source/tuple derivation |
| Primary source trace lacked reconstructible semantics | P1 | bind the fixed schema, evidence refs, source tuple and digest domain |

The eleventh valid fresh double review returned `2 P0 / 10 unique P1`; one
parallel review attempt before it was discarded fail-closed because its reported
path/hash mapping did not match the frozen manifest. The current revision
remediates the valid findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Claim output was not bound to durable completion | P0 | define one output binding, JCS byte equality, output digest, and persist it in completed job evidence |
| Durability expectation/start/controller/trace/recovery chain was spliceable | P0 | define one exact causal equality matrix and signed controller receipt |
| Restricted emitter lacked exact binding cardinality | P1 | allow exactly one final `authoritative_result` and reject extra bindings/output |
| Darwin graceful shutdown lacked independent durable identity | P1 | create a fixed-path epoch-owned record before exit and resolve it during successor validation |
| Recovery observation refs were not equal to observed state | P1 | resolve typed post-restart observation bytes and require exact digest/boot/time equality |
| Abort preflight and maintenance result identities were incomplete | P1 | bind CLI rejection and every worker result to request, authorization and durable event-chain identity |
| Durability environment/power evidence remained stale or self-authenticating | P1 | bind current host/filesystem/mount plus pretrusted controller key and exact signature preimage |
| Canonical digest inventory remained incomplete | P1 | define domains and exact preimages for output, matrix, environment, wrapper, scanner, argv and wait records |
| Darwin crash could select the graceful branch | P1 | require the pre-exit shutdown record; otherwise force reboot-boundary recovery |
| Runtime Cell migration target remained incomplete | P1 | define and migrate named nested/aggregate `CanonicalResultTuple` schemas |

The twelfth fresh double review returned `2 P0 / 9 unique P1`. The current
revision remediates these findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Completed claim output was absent from durable completion | P0 | persist one output object, require exact JCS bytes/resolution digest, and bind it to completion |
| Durability records remained causally spliceable | P0 | bind case/environment identity through expectation, start, signed controller receipt, trace and recovery |
| Emitter output cardinality and semantics were incomplete | P1 | allow exactly one `authoritative_result` output and reject extra bindings/output |
| Darwin graceful shutdown lacked fixed durable identity | P1 | publish an epoch-owned no-replace shutdown artifact before exit; otherwise reboot |
| Recovery environment and boot refs lacked exact equality | P1 | resolve typed post-restart observation and bind its boot/time/environment digest |
| Abort preflight/result identity was incomplete | P1 | add request/result digests and exact target identity equality outside worker results |
| Maintenance payload/result equality remained partial | P1 | bind every interlock, activation, authorization, tombstone and delete branch to request/event data |
| Canonical result and Runtime Cell schemas were incomplete | P1 | use named closed tuple, cell and matrix schemas with exact source/key/fold rules |
| Remaining runtime/wait/source-trace digests lacked exact preimages | P1 | define domain-separated complete-object or explicit projection preimages |

The thirteenth fresh double review returned `0 P0 / 5 unique P1` plus four P2.
The current revision remediates all five P1 plus the pidfd capability, seal
integrity and canonical Ed25519 encoding P2 findings, then requires another
fresh double review. The principal-loss recovery concern remains an explicit P2
fail-closed availability consequence for Owner disposition:

| Finding | Severity | Required closure |
|---|---|---|
| Durable claim completion did not close external emission crash/ACK semantics | P1 | add bounded idempotent emission intent/acknowledgement state after durable completion |
| Power-controller trust enrollment depended on the durability qualification it bootstraps | P1 | define an owner-approved bootstrap durability root or two-phase promotion bound into authorization and anchor |
| Controller command receipt was not independently durable or replay-safe | P1 | persist pre-mutation acknowledgement and define one-shot command/token consumption linked to the execution receipt |
| `FinalizerInput` duplicated authority identity without one exact projection or persisted input digest | P1 | define complete cross-field equality and bind a canonical input/context digest into durable outcome |
| Runtime Cell tuple migration violated the declared module dependency graph | P1 | place the shared result algebra in a neutral pure module or explicitly permit one canonical dependency |
| Pending authority recovery can be permanently wedged by principal loss | P2 | define an owner-approved disaster-recovery completion path that cannot rebase or roll back frozen intent |
| Linux pidfd wait capability is not an explicit preflight fact | P2 | bind a successful `P_PIDFD + WEXITED` capability probe before allocation |
| Sealed marker lacks a complete-object integrity digest | P2 | add and bind `sealDigest` over the full marker |
| Ed25519 public key, signature and release-token encodings are not canonical | P2 | define raw-byte semantics, canonical encoding and exact lengths |

The fourteenth fresh double review returned `0 P0 / 6 unique P1` plus the same
principal-loss availability P2. The current revision remediates all six P1 and
requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Crash after durable completion but before emission intent had no recovery transition | P1 | deterministically reconstruct and no-replace publish the one intent from completion |
| Power-controller one-shot command journal was prose-only | P1 | define its schema, fixed location, atomic transitions and restart reconciliation |
| Bootstrap candidate did not bind or consume one exact qualification run and active authority could fork | P1 | bind fixture/run identity, persist one-shot consumption and add a singleton active selector |
| Bootstrap boot observations recursively depended on the profile under qualification | P1 | define qualification-scoped boot observations with a finite non-profile context |
| Receipt ArtifactRef raw hash was incorrectly equated with domain object digest | P1 | verify raw stored-byte SHA separately from parsed domain digest |
| Idempotent sink payload bytes were undefined | P1 | define canonical payload bytes/raw hash and deterministic reconstruction from completion |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The first reviewer of the fifteenth frozen snapshot returned `0 P0 / 2 P1`
plus two P2. The paired review is not gate-valid because remediation changed the
snapshot before it completed. The current revision remediates both P1 and the
premature-acknowledgement P2, then requires a fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Bootstrap consumption could become durable before recoverable promotion intent | P1 | persist frozen authorization/anchor/current bytes before consumption and recover only that intent |
| Controller crash in `ARMED` had no safe transition | P1 | cancel without execution after restart and require a fresh command ID |
| Initial receipt claimed acknowledgement before the arm receipt existed | P2 | remove the premature assertion and make arm receipt the sole acknowledgement |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The sixteenth fresh double review returned `0 P0 / 3 unique P1` plus the same
principal-loss availability P2. The current revision remediates all three P1
and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Trust-promotion ordering conflicted between the fixture and digest sections | P1 | make `intent -> consumption -> anchor -> current` the only normative order |
| Capability artifact cardinality omitted qualification observations, receipts and journal states | P1 | define branch-exact complete artifact sets |
| Command journal allowed sibling forks and lacked immutable transition/signature rules | P1 | add one authoritative head, single-successor CAS, immutable identity equality and signature domain |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The corrected seventeenth fresh double review returned `0 P0 / 7 unique P1`
plus the same principal-loss availability P2. The current revision remediates
all seven P1 and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Active trust resolution did not require the complete promotion predecessor chain | P1 | bind and resolve promotion intent plus candidate consumption from current/anchor |
| Qualification observations did not prove a real reboot transition | P1 | require distinct refs/digests, changed boot identity/time and temporal ordering |
| `CANCELLED` journal branch allowed invalid Cartesian combinations | P1 | split accepted-cancel and armed-cancel into exact correlated variants |
| Journal head recovery lacked permanent lock identity and orphan-successor adoption | P1 | define fixed lock, expected-head CAS and exact single-successor recovery |
| Emission acknowledgement did not bind nested sink receipt fields | P1 | require exact sink/protocol/key/payload/timestamp equality |
| Linux census could use procfs mounted from the wrong PID namespace | P1 | bind procfs mount-owner namespace and prove it can observe the target namespace |
| Linux pidfd capability accepted cross-OS host identity | P1 | require `LinuxRuntimeHostBuild` and exact allocation-host equality |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The eighteenth fresh double review returned `0 P0 / 3 unique P1` plus the same
principal-loss availability P2; the schema reviewer independently returned
`0 P0 / 0 P1`. The current revision remediates all three P1 and requires
another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Active trust history omitted `candidate.json` validation | P1 | resolve `current -> anchor -> candidate -> consumption -> promotion intent` with exact equality |
| Controller journal persistent-store continuity and head authenticity were not trust-bound | P1 | bind a closed non-rollback store identity into enrollment/anchor and sign or derive the singleton head |
| Linux procfs equality incorrectly collapsed target namespace into its parent | P1 | require owner/view/parent equality, target inequality and `NS_GET_PARENT` proof |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The nineteenth fresh double review returned `0 P0 / 4 unique P1` plus the same
principal-loss availability P2. The current revision remediates all four P1 and
requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Intermediate signed journal heads were not historically retained | P1 | make head a reconstructible per-command pointer to the signed entry chain |
| Controller persistent-store anti-rollback was asserted without a qualified root | P1 | remove cross-restart recovery and bind every command to one live controller epoch |
| Global head semantics conflicted with new-command initialization | P1 | use one independently locked singleton head per command ID |
| Procfs-view provenance remained unverifiable | P1 | remove procfs census and rely only on consumed pidfd wait plus kernel PID-namespace-init semantics |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twentieth fresh double review returned `0 P0 / 4 unique P1` plus the same
principal-loss availability P2. The current revision remediates all four P1 and
requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Controller runtime epoch and restart invalidation were opaque | P1 | define signed epoch/ref/current/lease objects and bind every command artifact |
| Promotion consumption could not derive the authorization-keyed intent path | P1 | persist the promotion authorization ID and typed intent ref |
| Proof-admission predecessor epoch was digest-only and unresolvable | P1 | add a typed epoch ref carrying epoch ID and digest |
| Linux quality gate still required the rejected procfs census | P1 | remove the stale census assertion and retain only pidfd/init semantics |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-first fresh double review returned `0 P0 / 3 unique P1` plus two P2.
The current revision remediates all three P1 plus the pidfd-evidence P2 and
requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Controller epoch rollover was not serialized with irreversible command execution | P1 | hold one permanent runtime lock across the epoch lifetime and require predecessor-current CAS |
| Runtime epoch signature lacked exact message and trust-key resolution | P1 | define non-cyclic signed projection and resolve the selected trust authority |
| Duplicate command rules conflicted across controller epochs | P1 | separate current-epoch retry, prior terminal lookup and prior nonterminal rejection |
| Pidfd capability probe omitted detailed wait evidence | P2 | bind flags, child identity, POLLIN and consumed siginfo |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-second fresh double review returned `0 P0 / 3 unique P1` plus two
test-coverage P2s. The current revision remediates those listed findings; the
principal-loss P2 remains open for Owner disposition. Another fresh double
review is required:

| Finding | Severity | Required closure |
|---|---|---|
| Runtime epoch/ref/current/lease copies lacked mandatory equality | P1 | define exact identity equality across all repeated fields |
| Runtime lock custody was open across fork/exec/dup | P1 | require atomic close-on-exec, sole descriptor owner and no child/duplicate inheritance |
| Prior-terminal duplicate lookup conflicted with current-epoch mutation checks | P1 | define separate closed read-only historical and current mutation branches |
| Runtime-epoch takeover/duplicate fixtures were incomplete | P2 | add lifetime-lock, predecessor, signature and cross-epoch cases |
| Pidfd quality gate omitted new evidence fields | P2 | add field-level positive and mutation fixtures |

The twenty-third fresh double review returned `0 P0 / 5 unique P1`; it also
confirmed the principal-loss P2 remains open. The current revision remediates
all five P1 and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Command resolution modes were prose-only | P1 | define closed current-mutation, prior-terminal lookup and prior-nonterminal rejection request/result variants |
| `LinuxWaitIdStatus` permitted impossible Cartesian combinations | P1 | split exited, killed and dumped into branch-specific closed variants |
| Controller runtime identity was not qualification-bound | P1 | bind reconstructible source/binary/runtime identity through qualification, trust and epoch |
| Runtime lock backend semantics were unqualified | P1 | restrict to verified local filesystem and bind contention evidence |
| Pidfd readiness required exact `POLLIN` instead of a raw bitmask | P1 | persist raw mask, require `POLLIN`, reject error bits and define `POLLHUP` phase |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-fourth fresh double review returned `0 P0 / 5 unique P1` plus the
same principal-loss availability P2. The current revision remediates all five
P1 and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Command resolution could not represent first transition or bind requested operation | P1 | split initial transition, existing transition, retry and lookup into closed request/result branches |
| Qualified backend digest had conflicting preimages | P1 | use one exact projection including controller runtime and lock backend |
| Pidfd evidence omitted post-consumption `POLLHUP` | P1 | persist post-wait raw mask and require HUP without error bits |
| Signed epoch runtime could differ from qualified controller runtime | P1 | require complete identity equality and live remeasurement |
| Lock locality/contention did not bind the production lock object | P1 | define kernel-derived platform locality evidence and exact lock inode equality |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-fifth lifecycle review returned `0 P0 / 3 P1`; its paired schema
review is invalid because it substituted Mobile architecture files for the
explicit Acceptance Framework hash paths and therefore contributes no gate
evidence. The current revision remediates all three P1 findings and requires a
fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Transition resolution dropped target state and could authorize power too early | P1 | separate journal transition from explicit `EXECUTE_POWER_ACTION` resolution |
| Lock qualification did not bind qualified host/mount/exact production lock | P1 | require host, mount and object equality across backend/locality/contention/lease |
| Pidfd derived flags were not equations over raw masks | P1 | define exact bitwise projections and same-pidfd binding |

The twenty-sixth fresh double review returned `0 P0 / 7 unique P1` plus the
same principal-loss availability P2. The lifecycle/security reviewer returned
`0 P0 / 0 P1`; the schema/ownership reviewer returned all seven P1 findings.
The current revision remediates all seven P1 findings and requires another
fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Maintenance request/result compatibility was not closed by operation | P1 | define one exhaustive operation-specific request/result matrix |
| Command cancellation remained a Cartesian journal record | P1 | split accepted-cancel and armed-cancel into closed entry variants |
| Power interruption evidence admitted incompatible controller kinds and spliceable receipts | P1 | split physical/VM variants and require exact receipt-ref/domain-digest equality |
| Darwin epoch boot identity was digest-only and not resolvable | P1 | bind a typed epoch boot observation ref to environment and termination evidence |
| Claim-emitter AST allowed facade attributes only in prose | P1 | include the exact direct `canonical_json.encode|decode` attribute form in the digest-bound grammar |
| Finalization reservation allowed impossible state/field combinations | P1 | replace the Cartesian record with closed state-specific variants |
| `WORKER_READY` carried an unbound duplicate request-identity digest | P1 | remove it or require exact equality to the embedded identity digest |

The twenty-seventh fresh double review returned `0 P0 / 4 unique P1` plus two
P2 findings. The current revision remediates all four P1 findings and the
Runtime Cell ownership P2, then requires another fresh double review;
principal-loss availability remains for Owner disposition:

| Finding | Severity | Required closure |
|---|---|---|
| Power action could replay after durable `EXECUTION_STARTED` and pre-`EXECUTED` crash | P1 | add a durable one-shot dispatch claim before actuator invocation and reject uncertain retry |
| Current-epoch invalid/stale/missing-head requests lacked typed results | P1 | add a closed current-epoch rejection variant and complete the operation matrix |
| Bootstrap and active boot-observation ArtifactRef names conflicted | P1 | make names exact by expectation trust mode |
| Arm receipt identity remained spliceable across command/epoch/token chains | P1 | require full repeated identity equality across receipt, journal and interruption evidence |
| Runtime Cell matrix ownership wording remained ambiguous | P2 | state that `runtime_cell.py` only consumes and validates the canonical imported contract |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-eighth schema/ownership review returned `0 P0 / 3 P1 / 1 P2`.
The paired lifecycle review is invalid because its tool transport did not expose
the verification output, so it contributes no gate evidence. The current
revision remediates all three P1 findings and requires another fresh double
review:

| Finding | Severity | Required closure |
|---|---|---|
| One current-epoch rejection shape could not represent missing or unequal observed identity | P1 | split missing, unexpected, mismatched, invalid-transition and ineligible-action rejection variants |
| `ACTION_DISPATCHED` omitted exact durable publication and lost-ACK boundaries | P1 | require transition file and head publication durability before inline actuator invocation |
| Arm receipt digest had a domain but no exact signed-object preimage | P1 | define signature-first computation and complete signed-object digest preimage |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The twenty-ninth fresh double review returned `0 P0 / 3 unique P1` plus the
same principal-loss availability P2. Lifecycle/security returned
`0 P0 / 0 P1`; schema/ownership returned the three P1 findings below. The
current revision remediates all three P1 findings and requires another fresh
double review:

| Finding | Severity | Required closure |
|---|---|---|
| Rejection results were not all bound to the exact originating request | P1 | bind every rejection operation/request digest/epoch/expected command identity |
| Identical retry after `ACTION_DISPATCHED` selected stale-head rejection | P1 | give observed dispatched state precedence over stale-head classification |
| Arm signature preimage omitted exact byte framing | P1 | define UTF-8 RFC 8785 domain/payload bytes before Ed25519 signing |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirtieth fresh double review returned `0 P0 / 3 unique P1` plus two P2
findings. The current revision remediates all three P1 findings and the
same-epoch recovery wording P2, then requires another fresh double review;
principal-loss availability remains for Owner disposition:

| Finding | Severity | Required closure |
|---|---|---|
| Controller journal storage was incorrectly equated to the interrupted target host | P1 | independently qualify controller-store and target environments, then bind both into each command |
| Already-dispatched retry conflicted with generic expected-head equality | P1 | split a dedicated dispatched-uncertain rejection with exact predecessor/current-head relation |
| Prior-epoch identity mismatch had no representable result | P1 | add a prior identity-mismatch rejection before terminal classification |
| Unheaded successor recovery wording conflicted with restart invalidation | P2 | limit adoption to same live process/epoch lost-ACK recovery |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-first fresh double review returned `0 P0 / 4 unique P1` plus two P2
findings. The current revision remediates all four P1 findings and the
same-process recovery P2, then requires another fresh double review;
principal-loss availability remains for Owner disposition:

| Finding | Severity | Required closure |
|---|---|---|
| External controller journal had no independent crash-durability profile | P1 | qualify controller-store durability separately and bind it through trust, epoch and command identity |
| Prior lookup/retry with no head had no result variant | P1 | add a typed prior-epoch missing-head rejection |
| Same-process unheaded adoption had no safe continuation | P1 | bind one dispatch attempt and continue the original operation through exactly one actuator call |
| External controller runtime lacked a module owner | P1 | assign runtime, key, store, journal and actuator ownership to `core/power_controller.py` |
| Unheaded adoption wording could imply cross-process recovery | P2 | limit adoption to the original still-live process/epoch; restart invalidates the command |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-second fresh double review returned `0 P0 / 6 unique P1` plus the
same principal-loss availability P2. The current revision remediates all six P1
findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Controller-store profile recursively depended on its bootstrap candidate | P1 | keep only a prequalification store identity in the candidate and add the qualified profile at promotion |
| Controller-store profile admitted cross-OS Cartesian combinations | P1 | split Linux and Darwin closed variants with exact operations/anchor nullability |
| Controller-store case refs were cross-run spliceable | P1 | add controller-store refs carrying exact fixture/run/qualification/controller identity |
| Prior mutation with no head had no coherent result identity | P1 | split present-head and missing-head mutation rejection variants |
| Controller-store self-power-cut could not complete its own command lifecycle | P1 | use a distinct operator/witness qualification interruption branch with no production authority |
| Caller-provided dispatch attempt ID did not prove original stack ownership | P1 | use an internal non-serializable invocation capability and persist only its digest |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-third fresh double review returned `0 P0 / 4 unique P1` plus the
same principal-loss availability P2. The current revision remediates all four
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Bootstrap candidate still had a stale qualified-profile equality | P1 | remove candidate/profile equality and bind the profile only at promotion/anchor |
| Controller-store refs omitted case identity | P1 | bind case/run/qualification/controller/environment identity in every ref and resolved object |
| Qualification witness non-authority was prose-only | P1 | add a signed qualification-only witness identity disjoint from every production key |
| Dispatch capability used an undefined request identity field | P1 | bind the capability digest to exact `resolutionRequestDigest` and expected head |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-fourth fresh double review returned `0 P0 / 4 unique P1` plus the
same principal-loss availability P2. Lifecycle/security returned
`0 P0 / 0 P1`; schema/ownership returned the four P1 findings below. The
current revision remediates all four P1 findings and requires another fresh
double review:

| Finding | Severity | Required closure |
|---|---|---|
| Bootstrap controller-store identity admitted cross-OS combinations | P1 | split Darwin/Linux bootstrap store variants and require same-OS nested identity |
| Controller-store cases did not distinguish before/after boot observations | P1 | use phase-tagged refs and require changed boot identity plus temporal order |
| Qualification witness signature was self-authenticating | P1 | bind the witness key through prior immutable owner authorization and verify raw key hash |
| Dispatch digest copies lacked mandatory equality | P1 | require capability, journal entry and result digests to be byte-equal before adoption/invocation |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-fifth schema/ownership review returned `0 P0 / 3 P1` plus the same
principal-loss availability P2. The lifecycle reviewer found no D-19 document
P0/P1, but independently reproduced a normal-exit descendant orphan in existing
E2-5 implementation; that out-of-snapshot implementation blocker is recorded
in the open E2-5 set above and is not counted as a D-19 architecture finding.
The current D-19 revision remediates all three P1 findings and requires another
fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| OS-specific bootstrap variants still permitted cross-OS nested identities | P1 | require same-OS host/stable-volume/mount/locality/kernel-probe equality |
| Signed interruption was not equal to case boot refs and recovery | P1 | define exact ref/digest and temporal equality across case, interruption, observations and recovery |
| Witness authorization lacked a persistence owner and command protocol | P1 | assign fixed namespace and no-replace/re-sync semantics to the authority CLI |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-sixth schema/ownership review returned `0 P0 / 2 P1` plus the same
principal-loss availability P2. The paired lifecycle review is invalid because
it rejected the verifier-produced worktree-set digest despite matching the
bound branch, workspace, HEAD and all file hashes; it contributes no gate
evidence. The current revision remediates both P1 findings and requires another
fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| OS-specific bootstrap variants did not constrain nested host/kernel probe fields | P1 | require exact branch-local host, volume, mount, locality and kernel-probe equality |
| Boot evidence lacked exact phase/ref/domain-digest equations | P1 | bind before/after refs to phase-tagged observations, signed interruption digests and recovery after-ref |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-seventh fresh double review returned `0 P0 / 3 unique P1` plus the
same principal-loss availability P2. The current revision remediates all three
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Witness authorization omitted candidate binding, deterministic retry identity and permanent production-key exclusion | P1 | bind candidate, derive authorization ID deterministically and reserve witness key in a permanent deny namespace |
| Controller-store recovery evidence was not witness-authenticated | P1 | bind witness authorization and sign the complete recovery payload |
| Signed interruption host remained cross-OS capable | P1 | require exact equality to the qualified controller environment host and OS branch |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-eighth fresh double review returned `0 P0 / 3 unique P1` plus the
same principal-loss availability P2. The current revision remediates all three
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Witness-key exclusion digest lacked domain/preimage | P1 | define a dedicated complete-object digest and equality |
| Separate witness authorization/exclusion files were not crash-atomic or deterministically retryable | P1 | publish one canonical key-indexed immutable authorization/exclusion record with frozen retry bytes |
| Signed recovery omitted exact interruption ref/digest | P1 | include both fields in the signed recovery payload and bind them to the case |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The thirty-ninth fresh double review returned `0 P0 / 3 unique P1` plus the
same principal-loss availability P2. The current revision remediates all three
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Deterministic witness authorization ID lacked exact encoding/domain | P1 | define lowercase SHA-256 over one RFC 8785 domain/payload projection |
| Signed recovery was not explicitly equal to the case interruption | P1 | require nested ref byte equality and resolved interruption digest equality |
| Gate-scoped witness-key exclusion was not globally permanent | P1 | move the canonical key-indexed exclusion record to artifact-root scope and consult it for every Gate/workspace |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The fortieth fresh double review returned `0 P0 / 2 unique P1` plus the same
principal-loss availability P2. The current revision remediates both P1
findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Global witness exclusion raced with candidate creation/promotion | P1 | serialize all three operations under one artifact-root global exclusion lock with fixed lock ordering |
| Outer case PASS could disagree with witness-signed recovered state/hash | P1 | make signed recovery authoritative and require exact case state/hash/result equality |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-first fresh double review returned `0 P0 / 2 unique P1` plus the same
principal-loss availability P2. The current revision remediates both P1
findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Artifact-root exclusion lock lacked permanent inode identity and operation binding | P1 | assign Evidence Store ownership, durable no-replace creation, no-follow reopen and exact lock identity across witness/candidate/promotion |
| Controller-store expected recovery was not committed before interruption | P1 | add immutable candidate-bound expectation record and bind it through interruption, recovery, qualification and promotion |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-second fresh double review returned `0 P0 / 1 unique P1` plus the
same principal-loss availability P2. Both reviewers identified the same lock
identity gap. The current revision remediates it and requires another fresh
double review:

| Finding | Severity | Required closure |
|---|---|---|
| Artifact-root exclusion lock could split across replaced inodes | P1 | define canonical root identity, permanent durable lock creation, anchored no-follow reopen, post-acquire revalidation and exact equality through witness/candidate/promotion |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-third fresh double review returned `0 P0 / 1 unique P1` plus the
same principal-loss availability P2. Both reviewers found that a permanent
witness-key deny registry cannot derive its authority from the replaceable,
not-yet-qualified artifact root it protects. The current revision removes that
mutable authority entirely: qualification witnesses use a closed canonical
P-256 credential type, production controllers use Ed25519, and neither schema
can parse the other's key or signature. Candidate-local immutable witness
authorization remains auditable without becoming production authority. Another
fresh double review is required:

| Finding | Severity | Required closure |
|---|---|---|
| Global witness-key exclusion was self-authorized by a replaceable, prequalification artifact root | P1 | replace mutable deny-list authority with cryptographically disjoint witness and production credential types; remove the global exclusion namespace/lock and bind candidate-local witness authorization through qualification |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-fourth fresh double review returned `0 P0 / 7 unique P1` plus the
same principal-loss availability P2. The current revision remediates all seven
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Witness CLI still requested an Ed25519 key | P1 | require canonical P-256 SEC1 input and reject Ed25519/cross-decoded input before authorization construction |
| Darwin controller-store profile referenced an undefined anchor type | P1 | use the defined `DurabilitySyncAnchorIdentity` with exact Darwin branch constraints |
| Active-profile boot observations had no closed payload schema | P1 | define Linux/Darwin active-profile observation variants and exact mode/ref/cardinality/equality rules |
| Controller-store ArtifactRefs did not explicitly separate raw-byte and domain-object integrity | P1 | require exact byte length/raw SHA-256 before parsing, then recompute the artifact-specific domain digest |
| `power_controller.py` lacked an explicit dependency boundary | P1 | add allowed dependencies and forbid Evidence Store/finalizer reverse ownership |
| Linux crash recovery did not bind reboot evidence to failed and successor supervisor boots | P1 | bind predecessor/successor Linux epoch boot observations and temporal equality through reboot attestation |
| Emission recovery did not freeze the sink destination before claim execution | P1 | persist a closed sink identity/configuration in the immutable job and bind it through completion, intent and recovery |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-fifth fresh double review returned `0 P0 / 4 unique P1` plus the
same principal-loss availability P2. The current revision remediates all four
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Witness authorization left `witnessId` underived from CLI input | P1 | derive it from the canonical P-256 key and include it in the deterministic authorization-ID preimage |
| Production signature domains and canonical Ed25519 verification were inconsistent | P1 | define one domain-wrapped RFC 8785 preimage and strict RFC 8032 decoding for every production signed object |
| Controller epoch and lease schemas admitted cross-OS identities | P1 | add exhaustive same-OS constraints across process, host, backend, mount, locality, contention and profile identities |
| Frozen sink identity lacked an immutable resolver and had an invalid timestamp equality | P1 | bind a fixed source/backend/store resolver into the job and use ordered receipt/acknowledgement timestamps |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The forty-sixth fresh double review verified the exact frozen document set and
both reviewers returned `0 P0 / 0 P1 / 1 P2 / GO`. D-19 remains
`DESIGN_REVIEW_PENDING` until explicit Owner acceptance. The only open review
item is the known availability consequence:

| Finding | Severity | Required closure |
|---|---|---|
| Pending authority recovery can be permanently wedged by principal loss | P2 | Owner accepts permanent fail-closed behavior for v1 or separately approves a non-rebasing disaster-recovery protocol |

The post-ledger current-snapshot double review returned `0 P0 / 2 unique P1`
plus the same principal-loss availability P2. The current revision remediates
both P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Proof-admission job runtime OS was not bound to its epoch execution environment | P1 | require exact `hostOsFamily == executionEnvironmentIdentity.osFamily` equality through job, scanner and wrapper runtime projections |
| Controller trust could not requalify after host/filesystem/key drift because current authority was permanently single-write | P1 | define monotonic trust generations, immutable predecessor-linked anchors/revocations and a CAS current selector with explicit rotation/revocation semantics |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next current-snapshot double review returned `0 P0 / 3 unique P1` plus the
same principal-loss availability P2. The current revision remediates all three
P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Revocation did not durably publish its frozen intent and generation before current CAS | P1 | require reservation, revocation intent, revocation and generation durability before selector CAS |
| Sibling trust-generation successors could be published before one won current CAS | P1 | claim one predecessor-keyed immutable transition reservation before descendant publication |
| Scanner and wrapper runtime projections omitted the epoch host identity | P1 | carry exact OS-specific host build through environment, job, scanner and wrapper identities and reject mismatch before registration |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The following frozen-snapshot double review returned `0 P0 / 3 unique P1` plus
two P2 findings. The current revision remediates all P1 findings and the
same-OS cross-host fixture P2, then requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Same-build hosts could satisfy runtime equality without sharing host/boot identity | P1 | define closed Darwin/Linux runtime-host identities and bind exact host plus current boot through epoch, job, scanner, wrapper and process identities |
| Historical trust resolution did not require the predecessor-keyed transition reservation | P1 | derive and resolve every edge reservation and compare its embedded frozen intent/candidates before accepting the generation |
| Revocation authorization could identify a controller different from the revoked anchor | P1 | require controller, key, fixture/run, approval and source equality through authorization, reservation, intent, revocation and predecessor anchor |
| Same-OS cross-host mutation coverage was absent | P2 | add per-projection cross-host and cross-boot adversarial fixtures |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot review produced one lifecycle `GO` and one schema
`NO-GO`, with `0 P0 / 2 unique P1` plus the known principal-loss P2. The
current revision remediates both P1 findings and requires another fresh double
review:

| Finding | Severity | Required closure |
|---|---|---|
| Revocation did not fence an already-live controller epoch before irreversible dispatch | P1 | bind active current generation into epoch/command identity and re-resolve it under the shared Gate publish lock immediately before dispatch |
| Boot equality incorrectly referenced boot fields on stable `RuntimeHostIdentity` | P1 | compare stable host fields only to host identity and compare process boot fields to the resolved epoch boot observation |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot review produced one lifecycle `NO-GO` and one schema
`GO`, with `0 P0 / 2 unique P1` plus the known principal-loss P2. The current
revision remediates both P1 findings and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| Proof-admission boot-boundary observations lacked stable host identity | P1 | bind Darwin/Linux observations to the predecessor and successor environment host identities while requiring a changed boot identity |
| Linux pidfd capability was reusable across same-build hosts | P1 | bind the probe to `LinuxRuntimeHostIdentity` and require exact allocation-environment equality |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot double review returned `0 P0 / 2 unique P1` plus the
known principal-loss P2. The current revision remediates both P1 findings and
requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| First-epoch reboot evidence did not bind the successor stable host | P1 | require legacy prior observation and first policy-governed successor environment to share one stable host identity while changing boot identity |
| Controller dispatch fencing required a forbidden direct Evidence Store dependency | P1 | introduce an Acceptance Infra-owned read-only trust-admission mediator that holds the shared publish lock and returns a non-serializable dispatch lease |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot review produced one lifecycle `GO` and one schema
`NO-GO`, with `0 P0 / 2 unique P1` plus the known principal-loss P2. The
current revision remediates both P1 findings and requires another fresh double
review:

| Finding | Severity | Required closure |
|---|---|---|
| First-epoch successor boot ref was not equal to attestation current observation | P1 | require exact successor ref/digest/boot equality for both Darwin and Linux first epochs |
| `TrustDispatchLease` lacked closed equality and held-lock lifecycle rules | P1 | bind lease holder, exact opened publish lock, ACTIVE current generation, epoch and command; hold through actuator return and forbid serialization/reuse |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot double review returned `0 P0 / 1 unique P1` plus the
known principal-loss P2. Both reviewers identified the same remaining gap. The
current revision remediates it and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| `TrustDispatchLease` could be reused by another command in the same epoch | P1 | bind exact command ID/identity, resolution request, expected head and command-lock identity into the non-serializable lease |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The next frozen-snapshot double review produced one lifecycle `GO` and one
schema `NO-GO`, with `0 P0 / 1 unique P1` plus the known principal-loss P2.
The current revision remediates the P1 and requires another fresh double review:

| Finding | Severity | Required closure |
|---|---|---|
| `TrustDispatchLease` nonce had no canonical JSON encoding | P1 | represent the 32 random bytes as exactly 64 lowercase hex characters before digest construction |
| Pending authority recovery can be permanently wedged by principal loss | P2 | retain as explicit fail-closed availability consequence for Owner disposition |

The final exact-snapshot double review returned
`0 P0 / 0 P1 / 1 P2 / GO` from both independent reviewers. The remaining P2 is
the already documented principal-loss availability consequence. The Owner
accepted D-19 and that v1 fail-closed consequence on 2026-08-31.

## 15. Goal Slices

The plan is not one TRAE Goal:

| Slice   | Closures    | Completion boundary                                                |
| ------- | ----------- | ------------------------------------------------------------------ |
| W2-E2-A | E2-0        | proof schemas, artifact roles and protected-path baseline pass     |
| W2-E2-FREEZE | E2-0A | amended device/outcome/install/runtime contracts pass deterministic tests |
| W2-E2-B | E2-1 + E2-3 | build and resource-lease source contracts pass deterministic tests |
| W2-E2-C | E2-2 + E2-4 | Station proof/Fixture and Rust negative/purge contracts pass       |
| W2-E2-D | E2-5        | all source consumers cut over; source closure gates pass           |
| W2-E2-E | E2-6        | external resources ready and one physical 16-cell run is proven    |

W2-E2-B remediation is closed by the 2026-08-30 evidence in §14.2. W2-E2-C
and W2-E2-FREEZE remain complete. D-18 is closed. W2-E2-D is blocked by the
accepted D-19 architecture with active Infra landing and remaining E2-5 review
remediation. No Slice starts its successor automatically;
`pt-trae-goal-orchestrator NEXT` re-reads this table and selects one
dependency-ready Slice.

Within W2-E2-B, one integrator owns
`tooling/acceptance/provisioners/mobile_native.py`: E2-1 contributes only build
attestation/preflight functions, E2-3 contributes only lease acquisition and
device/browser resolution functions, and the integrator performs the shared
call-site wiring after both focused units pass. Concurrent writers may not edit
that file.

## 16. Final Readiness And Non-Claims

Base-plan authoring state: `PLAN_ACCEPTED`.

Base-plan approval state: `APPROVED_FOR_EXECUTION` on 2026-08-29. The original plan,
MOP-D03-A/MOP-D04-A architecture amendment and E2-0A plan amendment each passed
independent review with no unresolved P0/P1. The plan-review P1 dependency swap
was corrected; both P2 clarifications were incorporated.

D-19 amendment state: `DRAFT` (Appendix A). D-19 Infra landed via PR #105
(234 tests PASS). W2-E2-D is unblocked from the Infra dependency; it now
requires the Mobile E2-5 amendment (Appendix A) to pass independent review
before E2-5 source cutover can execute.

`PLAN_READY_FOR_EXECUTION` requires:

* MOP-D01..MOP-D04 and MOP-D03-A/MOP-D04-A remain accepted and unchanged;

* every source-side closure has an owner, dependency, deletion obligation,
  focused gate and evidence;

* external prerequisites remain explicit;

* plan review has no unresolved P0/P1.

The requirements are not currently satisfied. D-18 and W2-E2-B / E2-1 + E2-3
are complete; D-19 Infra has landed (PR #105). W2-E2-D / E2-5 is unblocked
from the Infra dependency and has a DRAFT Mobile D-19 amendment (Appendix A)
pending independent review.

Until E2-6 passes:

```text
MS-AG03 = UNPROVEN
MS-PA03 / MS-PA17 / MS-PA25 = UNPROVEN
W2 = BLOCKED
Mobile Shell production readiness = UNPROVEN
W3 = NOT STARTED
E2-6 = UNPROVEN / NOT STARTED
```

---

## Appendix A: Mobile D-19 Amendment — Finalizer Registration And E2-5 Scope

> **Amendment status**: DONE (reviewed, P0/P1 fixed, source-side closure complete)
> **Created**: 2026-09-02
> **Depends on**: D-19 Infra (PR #105 landed); E2-0..E2-4 closed
> **Methodology**: `pt-architecture-execution-methodology` Mobile requirement mapping

### A.1 Requirement Mapping

D-19 Acceptance Infra defines a domain-neutral post-cleanup evidence finalizer
framework. Mobile must inject the following business-domain content:

| D-19 Infra slot | Mobile injection |
|---|---|
| Concrete finalizer ID | `mobile.native.oauth-cleanup-evidence` |
| Gate requiring finalizer | `mobile-native-access-e2e` |
| Finalizer entrypoint | `tooling.acceptance.gates.mobile.cleanup_evidence_finalizer` |
| Source paths | `tooling/acceptance/gates/mobile/cleanup_evidence_finalizer.py`, `tooling/acceptance/gates/mobile/proof_contracts.py` |
| Evidence role names | `station-post-cleanup-proof`, `mobile-lease-outcome`, `mobile-redaction-audit` |
| Finalizer registry file | `tooling/acceptance/gates/mobile/finalizer-registry.json` |
| Protected baseline file | `tooling/acceptance/gates/mobile/finalizer-baseline.json` |
| Execution config | timeout 300s, input byte limit 67108864 (64 MiB) |

### A.2 Catalog Configuration

Add `evidenceFinalizer` to the `mobile-native-access-e2e` gate entry in
`tooling/acceptance/gates.yaml`:

```yaml
"mobile-native-access-e2e": {
  ...existing fields...,
  "evidenceFinalizer": {
    "id": "mobile.native.oauth-cleanup-evidence",
    "timeoutSeconds": 300,
    "inputByteLimit": 67108864
  }
}
```

No other Mobile gate requires a finalizer in v1. The lifecycle, recovery,
social-convergence, chat-contacts, moments, settings, and platform gates do
not produce cleanup evidence that requires post-Gate finalization.

### A.3 Neutral Contract Migration

The existing `proof_contracts.py` already defines `station-post-cleanup-proof`,
`mobile-lease-outcome`, and `mobile-redaction-audit` artifact roles. No role
schema changes are required. The amendment adds:

1. A new `cleanup_evidence_finalizer.py` module that receives a
   `FinalizerInput` (containing `FinalizerContext` and
   `ReadOnlyEvidenceSnapshot`), validates cleanup evidence against the proof
   contract schema, and writes a `FinalizerChildOutcome` to stdout. There is
   no named `FinalizerEntrypoint` protocol; the supervisor imports the module
   and calls its main function.

2. A `finalizer-registry.json` declaring the single registry entry with
   source digest, contract role projection digest, and evidence role names.

3. A `finalizer-baseline.json` anchoring the protected requirement mapping
   digest, registry file digest, and gate/finalizer binding.

The migration is additive. Existing proof contract tests continue to pass
unchanged. The finalizer module imports only from `proof_contracts` and
`core.finalization_contracts`; it introduces no new external dependency.

### A.4 Protected Baseline

The protected baseline binds (all 11 `FinalizerProtectedBaseline` fields):

- `gateId`: `mobile-native-access-e2e`
- `finalizerId`: `mobile.native.oauth-cleanup-evidence`
- `requirementMappingDigest`: computed from the `RequiredFinalizerMapping`
  canonical form
- `registryFilePath`: `tooling/acceptance/gates/mobile/finalizer-registry.json`
- `registryFileDigest`: SHA-256 of the registry file bytes
- `contractSchemaPath`: `tooling/acceptance/gates/mobile/proof-contract.schema.json`
- `contractSchemaDigest`: SHA-256 of the schema file bytes
- `entrypointSourcePath`: `tooling/acceptance/gates/mobile/cleanup_evidence_finalizer.py`
- `entrypointSourceDigest`: SHA-256 of the entrypoint source bytes
- `generatorSourcePath`: `tooling/acceptance/gates/mobile/proof_contracts.py`
- `generatorSourceDigest`: SHA-256 of the generator source bytes

The baseline JSON is generated by computing all digests from the worktree and
committed alongside the registry and capability declaration. Any future
source-path, role, or schema change invalidates the baseline and requires
re-generation.

### A.5 Domain Finalizer Injection Steps

E2-5 executes the following in one atomic closure:

| Step | Action | Target file(s) |
|---|---|---|
| A5-1 | Create `cleanup_evidence_finalizer.py` with `FinalizerInput` consumer and `FinalizerChildOutcome` producer | `gates/mobile/cleanup_evidence_finalizer.py` |
| A5-2 | Create `finalizer-registry.json` with single entry | `gates/mobile/finalizer-registry.json` |
| A5-3 | Create `finalizer-baseline.json` with all 11 `FinalizerProtectedBaseline` fields | `gates/mobile/finalizer-baseline.json` |
| A5-4 | Add `evidenceFinalizer` to gate catalog entry | `gates.yaml` |
| A5-5 | Create capability YAML with `finalizerRegistry` and `requiredEvidenceFinalizers` | `capabilities/mobile.yaml` |
| A5-6 | Add `requiredFinalizer` declaration to provisioner/gate launcher | `provisioners/mobile_native.py`, `gates/mobile/native_e2e.py` |
| A5-7 | Update `mobile-native.yaml` environment with finalizer runtime deps | `environments/mobile-native.yaml` |
| A5-8 | Add Mobile Feature/Capability contract for finalizer registration | `apps/mobile/src/acceptance/contracts.ts` |
| A5-9 | Update `apps/mobile/src-tauri/src/commands/mod.rs` if command surface changes | conditional |
| A5-10 | Add focused tests for finalizer integration | `gates/mobile/cleanup_evidence_finalizer_test.py` |
| A5-11 | Update `20260827-mobile-shell-implementation.md` W2 status | main plan |

### A.6 Consumer Inventory And Cutover Matrix

Source consumers that must switch in the atomic cutover:

| Consumer | Current state | Target state |
|---|---|---|
| `native_e2e.py` Gate launcher | No finalizer awareness | Register `RequiredFinalizerMapping`, pass sealed snapshot to finalizer |
| `mobile_native.py` provisioner | No finalizer lifecycle | Include finalizer registry validation in preflight |
| `proof_contracts.py` role validation | Roles exist but no finalizer binding | Roles unchanged; finalizer reads roles through sealed snapshot |
| `gates.yaml` catalog | No `evidenceFinalizer` field | `evidenceFinalizer` added to `mobile-native-access-e2e` |
| `capabilities/` directory | No capability YAML | New `mobile.yaml` with `finalizerRegistry` and `requiredEvidenceFinalizers` |
| `mobile-native.yaml` env | No finalizer deps | Add finalizer timeout and resource declarations |

No compatibility reader, fallback, or dual-owner path is permitted. All
consumers switch in one commit.

### A.7 Focused Gates

```bash
python3 -m unittest \
  tooling.acceptance.gates.mobile.cleanup_evidence_finalizer_test \
  tooling.acceptance.gates.mobile.proof_contracts_test \
  tooling.acceptance.gates.mobile.appium_test \
  tooling.acceptance.gates.mobile.native_e2e_test \
  tooling.acceptance.tests.test_finalization_contracts \
  tooling.acceptance.tests.test_mobile_native_preflight

make acceptance-validate DOMAIN=mobile
```

### A.8 Definition Of Done

- Finalizer registry, baseline, and catalog config are source-consistent.
- `cleanup_evidence_finalizer.py` passes adversarial tests with forged,
  missing, extra, and schema-violating snapshots.
- All existing Mobile proof contract tests pass unchanged.
- All D-19 finalization contract tests (234) continue to pass.
- `make acceptance-validate DOMAIN=mobile` passes.
- No compatibility reader, fallback, re-export shim, or legacy authority.
- E2-5 atomic cutover is one commit with no disabled-support marker.

### A.9 Amendment Status Tracking

```text
Amendment D-19 mapping    = DONE (review passed, P0/P1 fixed)
A5-1 finalizer module     = DONE (cleanup_evidence_finalizer.py)
A5-2 registry JSON        = DONE (finalizer-registry.json)
A5-3 baseline JSON        = DONE (finalizer-baseline.json)
A5-4 catalog update       = DONE (evidenceFinalizer in gates.yaml)
A5-5 capability YAML      = DONE (mobile.yaml updated)
A5-6 provisioner/gate     = SKIPPED (no runtime changes needed for source-side closure)
A5-7 environment          = SKIPPED (no runtime changes needed for source-side closure)
A5-8 client contracts     = SKIPPED (no Rust/TS surface change)
A5-9 Rust commands        = SKIPPED (no command surface change)
A5-10 focused tests       = DONE (11 adversarial tests)
A5-11 main plan update    = DONE
E2-5 atomic cutover       = DONE (source-side closure complete, main plan updated)
```
