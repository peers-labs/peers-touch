# W2-E2 Mobile Native OAuth Proof — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
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

No schema or protocol version change is authorized. If implementation requires
one, stop and request explicit version approval.

## 3. Scope And Non-Scope

In scope:

* Mobile-specific build attestation and runtime identity;

* Station-internal Fixture/proof adapter with no public route;

* provider account, physical device and browser-profile leases;

* Rust production logout/purge and acceptance-only invalid-input adapter;

* RuntimeManifest and Appium fresh-install cutover;

* ten currently unsupported negative variants;

* four success, two cancel and ten negative physical cells;

* immutable evidence, redaction and cleanup audit.

Out of scope:

* W3 or later Mobile workstreams;

* generic Acceptance Core redesign;

* simulator evidence as physical proof;

* new OAuth/Access Gate product behavior;

* provider cookie export, password/MFA automation or real credential creation;

* dependency or protocol version upgrades.

## 4. Current-State Inventory

| Concern             | Current asset                                                      | Current state                                                                |
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

Dependencies: E2-1, E2-2, E2-3 and E2-4.

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

* 16 executable variants with no `supported=False`;

* per-variant Mobile and Station evidence correlation;

* cross-Station dual snapshots;

* reverse-order cleanup and quarantine.

Failure behavior:

* any missing/mismatched artifact, lease, runtime cell, snapshot or cleanup
  returns typed `BLOCKED/FAIL` and leaves MS-AG03 `UNPROVEN`.

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

Execution finding on 2026-08-30:

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

### E2-6: Physical 16-Cell MS-AG03 Proof

Responsibility:

* Execute and judge the accepted physical Gate without substituting evidence.

External prerequisites:

* two connected physical iOS devices;

* two connected physical Android devices;

* one approved GitHub and one approved Google disposable account lease;

* two approved disposable Stations and Relay;

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

* one source-bound run is `PASS / DONE / PROVEN`;

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
| `supported=False` variants                                     | executable scenario registry                                   | all ten negative runners pass focused tests                          | zero unsupported ledger entries                  |
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
! rg -n 'clean_start.*required|readback.*required|cleanup.*required' \
  tooling/acceptance apps/mobile
! rg -n 'supported=False|missing_closure' \
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
| complete 16-cell judgment                         | Mobile Gate                      | E2-6             |

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

Final runtime proof:

```bash
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-native-access-e2e

python3 tooling/scripts/acceptance-artifact.py cat \
  --gate mobile-native-access-e2e \
  --role mobile-native-result

python3 -m tooling.acceptance.gates.mobile.proof_contracts \
  --validate-latest \
  --gate mobile-native-access-e2e

make acceptance-validate DOMAIN=mobile
```

`--validate-latest` may use the mutable latest pointer only to resolve one
immutable result `ArtifactRef`. It then fails unless:

* every mandatory Artifact Role in §9 exists exactly once where cardinality is
  one, and every role/ref resolves to the same `runId`, source commit,
  workspace digest and Gate;

* the final result and lifecycle are exactly `PASS / DONE / PROVEN`;

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
| MOP-D03-A / MOP-D04-A amendment     | done | independent review PASS with 0 P0/P1; three P2 clarifications resolved |
| E2-0 Interface/artifact-role freeze | done | 35 focused contract tests; protected-path, version-policy and cutover-inventory checks PASS |
| E2-0A Amended contract freeze       | done | 45 focused tests; 71 combined Python regressions; three source-policy gates PASS; independent audit 0 P0/P1 |
| E2-1 Build provenance               | done | 55 focused build tests, 31 preflight tests, `pnpm mobile:check`, three source-policy gates and independent audit 0 P0/P1 PASS |
| E2-2 Station Fixture/proof          | done | Go Station adapter/CLI gates and 10 Python Fixture tests PASS |
| E2-3 Provider/browser leases        | done | 83 focused lease tests, real Evidence Store cardinality, crash/restart/fencing tests and independent audit 0 P0/P1 PASS |
| E2-4 Rust negative input/purge      | done | 17 default + 24 Acceptance Rust tests, 9 TS tests, Mobile check and linked release absence scan PASS |
| E2-5 Atomic Gate cutover            | blocked | `ACCEPTANCE_INFRA_REQUIRED`: Appium/Harness/Gate/cleanup source units exist, but the generic runner cannot carry the required non-persisted process-local broker/HMAC channel from Provisioner to Gate |
| E2-6 Physical 16-cell proof         | blocked | physical devices/accounts/services unavailable |

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

W2-E2-B, W2-E2-C and W2-E2-FREEZE are complete. W2-E2-D is the next
dependency-ready Slice. No Slice starts its successor automatically;
`pt-trae-goal-orchestrator NEXT` re-reads this table and selects one
dependency-ready Slice.

Within W2-E2-B, one integrator owns
`tooling/acceptance/provisioners/mobile_native.py`: E2-1 contributes only build
attestation/preflight functions, E2-3 contributes only lease acquisition and
device/browser resolution functions, and the integrator performs the shared
call-site wiring after both focused units pass. Concurrent writers may not edit
that file.

## 16. Final Readiness And Non-Claims

Authoring state: `PLAN_ACCEPTED`.

Approval state: `APPROVED_FOR_EXECUTION` on 2026-08-29. The original plan,
MOP-D03-A/MOP-D04-A architecture amendment and E2-0A plan amendment each passed
independent review with no unresolved P0/P1. The plan-review P1 dependency swap
was corrected; both P2 clarifications were incorporated.

`PLAN_READY_FOR_EXECUTION` requires:

* MOP-D01..MOP-D04 and MOP-D03-A/MOP-D04-A remain accepted and unchanged;

* every source-side closure has an owner, dependency, deletion obligation,
  focused gate and evidence;

* external prerequisites remain explicit;

* plan review has no unresolved P0/P1.

The requirements above are satisfied. W2-E2-A / E2-0, W2-E2-B /
E2-1 + E2-3, W2-E2-C / E2-2 + E2-4 and W2-E2-FREEZE / E2-0A are complete;
the next dependency-ready frontier is W2-E2-D / E2-5.

Until E2-6 passes:

```text
MS-AG03 = UNPROVEN
MS-PA03 / MS-PA17 / MS-PA25 = UNPROVEN
W2 = BLOCKED
Mobile Shell production readiness = UNPROVEN
W3 = NOT STARTED
```
