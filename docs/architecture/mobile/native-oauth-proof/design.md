# Mobile Native OAuth Proof — 架构设计

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`, `apps/station/app/subserver/oauth/`, `tooling/acceptance/`

---

## 1. Core Principles

1. **Product path remains real**：Fixture 只准备前置状态或无效输入，真实
   Mobile Rust、Station OAuth、Access Gate 和 session finalizer 仍处理结果。
2. **Station proves Station truth**：OAuth attempt、candidate、envelope、session
   和 Access Attempt 的结论来自 Station deployment-owned proof producer。
3. **Provision before proof**：build、device、browser、account、Fixture 和 cleanup
   lease 全部进入 immutable RuntimeManifest 后，Gate 才可启动。
4. **Secrets remain native or secret-side**：callback、state、PKCE、nonce、provider
   subject、cookie 和 credential 不进入 Web、Gate report 或 Evidence Store。
5. **Missing evidence fails closed**：任何 runtime cell、identity、readback 或 cleanup
   缺失都保持 `UNPROVEN`。

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Station 已持久化 Access Attempt、OAuth Attempt、candidate、envelope 和 candidate-keyed session | `verified_fact` | `apps/station/frame/touch/model/db/access_gate.go`; `apps/station/frame/core/facility/session/db_store.go` | high | physical runtime snapshot |
| callback claim 是 conditional one-row consume，binding mismatch 在 provider exchange 前拒绝 | `verified_fact` | `apps/station/app/subserver/oauth/repository.go` | high | physical negative cells |
| OAuth status 可能 re-evaluate/finalize，因此不是只读 proof API | `verified_fact` | `apps/station/app/subserver/oauth/service.go::Status` | high | deployment-owned read-only proof |
| 当前 Gate 的 “Station readback” 实际来自 Mobile projection | `verified_fact` | `tooling/acceptance/gates/mobile/native_e2e.py::_verify_access_readback` | high | Station proof artifact |
| 十个 required physical negative cells 当前为 unsupported | `verified_fact` | `tooling/acceptance/gates/mobile/native_e2e.py::REQUIRED_ACCESS_VARIANTS` | high | trusted Fixture/input contract |
| browser session fields 只被解析并复制，没有 acquire/readback/release 行为 | `verified_fact` | `tooling/acceptance/provisioners/mobile_native.py` | high | browser lease implementation |
| physical app artifact 当前只验证文件存在 | `verified_fact` | `tooling/acceptance/provisioners/mobile_native.py::preflight_mobile_native_inputs` | high | build attestation/runtime identity |
| `physical-device-lease` 只有 Artifact Role，没有 typed payload schema | `verified_fact` | `tooling/acceptance/gates/mobile/proof_contracts.py`; `proof-contract.schema.json` | high | MOP-D03-A |
| `mobile-lease-outcome` 只有 role/cardinality，不能证明 terminal fence、baseline restore 或 quarantine | `verified_fact` | `tooling/acceptance/gates/mobile/proof_contracts.py::_validate_lease_outcomes` | high | MOP-D03-A |
| fresh-install 与 installed-build identity 只有 Artifact Role，没有 typed payload/correlation contract | `verified_fact` | `tooling/acceptance/gates/mobile/proof-contract.schema.json` | high | MOP-D04-A |
| Apple `codesign` 的 `CDHash` 是当前系统选用且截断为 20 bytes 的 CandidateCDHash，不是完整 SHA-256 digest | `verified_fact` | [Apple TN3126](https://developer.apple.com/documentation/Technotes/tn3126-inside-code-signing-hashes) | high | MOP-D04-A |
| Cargo `--frozen` 等价于 `--locked` + `--offline`；Gradle 与 pnpm 的 `--offline` 在 cache miss 时失败 | `verified_fact` | [Cargo CLI](https://doc.rust-lang.org/cargo/commands/cargo.html); [Gradle dependency cache](https://docs.gradle.org/current/userguide/dependency_caching.html#sec:controlling-dependency-caching-command-line); [pnpm install](https://pnpm.io/cli/install) | high | MOP-D04-A |
| Station internal adapter 可在不增加公网测试端点的情况下提供受限 Fixture/proof | `proposal` | MOP-D01、MOP-D02 | medium | Owner review + implementation evidence |
| 两个 provider account lease 加四个独占 browser-profile lease 足以避免 cross-client session 混用 | `proposal` | MOP-D03 | medium | physical provider preflight |
| build attestation、双嵌入 identity、fresh install 和 runtime readback 可闭合 source provenance | `proposal` | MOP-D04 | high | physical install/run evidence |
| typed physical-device lease + immutable terminal outcome closes lease ownership without persisting UDID/serial | `accepted_decision` | MOP-D03-A | high | implementation evidence |
| tool-native offline controls + sanitized environment + typed install/runtime artifacts close source provenance | `accepted_decision` | MOP-D04-A | high | implementation evidence |

## 3. Scope And Non-Scope

In scope:

- MS-AG03 的 GitHub/Google success、following-gate、cancel、expiry、replay、
  provider mismatch 和 Station mismatch physical cells。
- Mobile business-owned Environment、Provisioner、Fixture、Harness 和 Gate 注入。
- Station OAuth/access persistence 的受限 fixture control 与 proof projection。
- physical app build、安装、运行身份和 signing metadata。

Non-scope:

- 修改 OAuth、Access Gate 或 session 的产品结果语义。
- 新增公网或普通客户端可访问的 Acceptance endpoint。
- 将具体 Mobile contract 泛化为 Acceptance Core schema。
- 用 simulator、API-only、unit test 或旧 evidence 替代 physical proof。
- 把 provider cookie 本身持久化为 evidence。

## 4. Target Architecture

```text
Source Snapshot
      |
      v
Mobile Build Owner
  -> embedded Web identity
  -> embedded Rust/native identity
  -> inspected IPA/APK + signing metadata
  -> MobileApplicationBuildAttestation
      |
      v
Mobile Native Provisioner
  -> physical device lease
  -> provider account lease
  -> browser-profile lease
  -> Station deployment lease
  -> Fixture lease
  -> immutable RuntimeManifest
      |
      v
Appium Driver
  -> fresh install exact artifact
  -> real native browser
  -> OS deep link
  -> Mobile Rust OAuth coordinator
  -> Station OAuth + Access Gate + session finalizer
      |
      +-------------------------------+
      |                               |
      v                               v
Mobile visible evidence       Station Proof Producer
DOM / AX / screenshot         read-only authoritative snapshot
      |                               |
      +---------------+---------------+
                      v
              Mobile MS-AG03 Gate
                      |
                      v
             immutable Evidence Store
```

## 5. Sources Of Truth And Ownership

| Concern | Source of truth | Mutation authority | Consumer |
|---|---|---|---|
| OAuth/Access/session state | Station persistence and domain services | Station OAuth/access/session owners | proof producer, Mobile |
| Negative Fixture state | run-scoped Station Fixture lease | Station internal adapter through deployment owner | Provisioner |
| Client-visible result | Mobile Rust/runtime projection and rendered app | production Mobile runtimes | Gate |
| Provider account identity | approved secret/account broker | operator-managed disposable account | Provisioner and provider Driver |
| Browser session | physical device browser profile | browser-profile lease owner | provider Driver |
| Build source identity | canonical source snapshot | Mobile build owner | Provisioner, runtime Harness |
| Build artifact identity | inspected IPA/APK bytes | Mobile build owner | Appium Driver |
| Proof judgment | Feature/Capability/Gate contracts | Mobile Acceptance Gate | reviewer |

Acceptance Core supplies generic profile/source exclusion leases, manifests,
ArtifactRefs and lifecycle. Those process-scoped locks do not satisfy MOP-D03.
The durable physical-device/provider/browser lease ledger and all four concrete
proof contracts remain Mobile business injection.

## 6. Contract 1: Trusted Negative Fixture

### 6.1 Owner And Entry

`MobileOAuthFixtureLease` is owned by the Mobile Acceptance domain. Its Station
operations are implemented by a Station-internal adapter and invoked only by
the Station deployment owner.

The adapter:

- has no HTTP/RPC route;
- is unavailable to normal clients and production request handlers;
- accepts only an enum operation and typed identifiers from the current run;
- requires every mutation, snapshot and cleanup call to present the current
  `(resource_key, holder_run_id, fence_token)` and revalidates it immediately
  before database access;
- operates only while an exact deployment lease and destructive authorization
  are valid;
- uses Station models/repositories and compare-and-set transactions;
- returns redacted before/after semantic payloads to the Provisioner;
  Acceptance Core `RunHandle` is the only Evidence Store writer.

### 6.2 Allowed Operations

| Operation | Allowed effect | Required production behavior after setup |
|---|---|---|
| `prepare_following_gate` | Save prior policy; install a run-owned real post-OAuth `invite.code` gate and invite | OAuth completion must return `FOLLOWING_GATE`; real invite submission must produce final grant |
| `expire_awaiting_attempt` | Move only the selected awaiting attempt's `expires_at` behind the controlled observation time | Normal status/callback path must terminalize it as expired |
| `read_proof_snapshot` | Read joined, redacted Station state | No mutation |
| `cleanup_run` | Revoke/delete only run-owned rows and restore exact prior policy | Subsequent snapshot must show zero residue |

Every mutation carries a stable operation ID. The Station adapter records the
operation and business mutation in one database transaction. Retrying the same
ID returns the original semantic result; the same ID with different input is a
conflict. A lost response is recovered from this journal instead of repeating
the mutation blindly.

The adapter must not set `granted`, `activated`, `consumed_at`, candidate,
session, envelope or success result directly. It must not change provider,
Station, state, PKCE, nonce, device or lifecycle bindings. Provider identity
bindings are preconfigured disposable data: the Fixture may assert exactly one
expected binding per provider/actor/Station, but may not create or rewrite one
during a proof run.

### 6.3 Invalid Callback Input

Replay, provider mismatch and Station mismatch do not mutate Station state to
manufacture an outcome. MOP-D01 amends MS-D14: an
acceptance-build-only Rust negative-input adapter may receive only a typed
variant ID and invoke the production callback validator/coordinator. The
adapter and its action registration must be compile-time absent when the
Acceptance Harness is disabled.

For replay, the first callback is a real OS-delivered provider callback. Rust
retains it behind a volatile, run-scoped `CallbackReplayHandle` until the replay
assertion or cleanup. Web and Driver see only the opaque handle. An exact
duplicate while completion outcome is unresolved is idempotent recovery, not
the replay failure cell. The replay cell submits a different callback after the
first callback has been claimed: state and provider remain bound to the
original attempt, while callback code and callback digest differ. It must
receive the typed replay result without another candidate/session.

Provider and Station mismatch use the active secure attempt to construct an
invalid request inside Rust and invoke the same production validator/transport.
These cells prove binding rejection; separate success cells prove the complete
native browser and OS callback route.

It must not:

- return raw callback/state/code/PKCE/nonce/attempt secret to Web or Driver;
- persist the callback replay handle or raw callback after cleanup;
- mutate secure storage directly;
- bypass the production callback validator or Station transport;
- create a successful callback, candidate, envelope or session;
- exist when the Acceptance Harness is absent.

This is a narrow exception to MS-D14's production-action-only Harness rule:
acceptance-only adapters may make an input invalid, but may never inject a valid
business result.

## 7. Contract 2: Authoritative Station Proof

`StationOAuthProofSnapshot` is produced by the Station deployment owner through
a read-only Station-internal proof adapter. It is not the OAuth status API:
status may re-evaluate and finalize state.

The proof producer joins:

- Access Attempt;
- OAuth Attempt;
- OAuth session candidate;
- credential envelope cardinality;
- candidate-keyed session cardinality and revocation state;
- provider identity binding cardinality.

When a candidate exists, provider correlation joins its actor to exactly one
preconfigured `(provider, provider_user_id)` binding and computes the run-scoped
fingerprint. A mismatch scenario with no candidate records binding cardinality
as not applicable and candidate correlation as absent; it relies on the
separate broker identity assertion for the browser baseline.

The Station adapter returns a redacted, service-attested snapshot payload.
Acceptance Core persists it through the run's `RunHandle`; the Gate consumes
the resulting immutable `ArtifactRef`. The Gate never connects to PostgreSQL
and no business producer writes the Evidence Store directly.

All joined rows are read in one PostgreSQL `REPEATABLE READ`, read-only
transaction. The artifact records the transaction snapshot identifier, the
Access decision revision, OAuth row update time and observation time. Capture
must begin after the product action reaches a terminal/expected intermediate
state, complete within 30 seconds, and precede Fixture cleanup. A second,
separate post-cleanup snapshot proves restoration; it cannot be substituted by
the pre-cleanup artifact.

Required invariants include:

- at most one callback claim/consume marker per OAuth attempt;
- at most one candidate and one candidate-keyed session;
- no active session before final Access grant and credential acknowledgement;
- no envelope after successful acknowledgement;
- zero candidate/envelope/session for locally rejected mismatch input;
- Station A and Station B remain disjoint during cross-Station scenarios.

Every cross-Station variant captures one snapshot from each involved Station.
The Gate proves disjointness across the complete snapshot set.

## 8. Contract 3: Provider Account And Browser Session Lease

The environment owns two run-exclusive provider account leases, one GitHub and
one Google. Each account may serve two physical clients only when:

- the two clients use distinct physical devices and browser profiles;
- authorizations for that account are serialized;
- each browser profile is leased exclusively for the full run;
- the expected provider identity maps to the expected Fixture actor on the
  target Station;
- identity checks pass before use and before lease release.

The account broker and Station proof producer receive one run-scoped HMAC key
through a non-persisted secret channel owned by the Provisioner. Each computes
the same provider-subject fingerprint independently. The Gate compares the two
artifacts; it never receives the HMAC key or provider subject.

The channel is in-process memory or a single-use anonymous pipe. Filesystem or
network persistence, inherited environment variables, logs and evidence are
forbidden; cleanup closes the channel and zeroizes the key.

Each of the four clients owns a separate `ProviderBrowserSessionLease`.
The supported baseline is a dedicated, persistently preauthenticated provider
profile. “Clean” means:

- the expected opaque account identity is selected;
- no authorization flow is active;
- Mobile has no live OAuth attempt/session from a prior run;
- Station proof shows no prior run-owned attempt/session.

Forced provider logout or cookie clearing is forbidden as the default cleanup:
it destroys the approved preauthenticated baseline and would require password or
MFA automation. Cleanup instead closes provider authorization UI, restores the
leased baseline, verifies the same opaque account identity and quarantines the
device/account lease on mismatch.

Mobile Rust must provide one production-owned logout/purge operation that
revokes the active Station session when possible, removes the active-attempt
index, attempt secret record, current-session index, credential record and
public OAuth projection, then returns only sanitized presence/absence flags.
The Harness calls this production operation; it cannot delete secure-storage
keys itself.

Provider operations sharing one account lease are strictly serial. Parallel
execution requires distinct account leases.

Account and browser leases use atomic acquire, a stable resource key, holder
run ID, monotonically increasing fence token, heartbeat/expiry and
compare-and-release. A stale holder cannot renew or release a newer lease.
Crash or heartbeat expiry quarantines the resource until baseline verification
and explicit recovery complete.

Every provider authorization, browser/Appium command, baseline check and
cleanup operation must present and revalidate the current resource key, holder
run ID and fence token immediately before touching the resource. Fencing lease
metadata without fencing the operation is invalid.

## 9. Contract 4: Physical Application Build Provenance

A physical client is source-bound, under the reviewed Mobile build producer
trust boundary, only when all identities agree:

```text
source snapshot
  == Web embedded build identity
  == Rust/native embedded build identity
  == inspected IPA/APK attestation
  == identity read from the running app
```

The Mobile build owner:

1. captures exact commit, workspace state and canonical workspace digest;
2. hashes the canonical source snapshot, declared build inputs, allowlisted
   environment and toolchain identities, then generates one random `build_id`;
3. embeds the same canonical identity in Web and Rust/native outputs;
4. builds an immutable IPA/APK with Acceptance Harness enabled;
5. hashes the exact artifact and inspects application/signing metadata;
6. returns a redacted attestation payload that Acceptance Core persists through
   `RunHandle` and exposes as an `ArtifactRef`.

The Provisioner rejects a raw artifact path without that attestation. Appium
removes the previous application, installs the exact attested artifact and
verifies active application identity. Before OAuth, `build.identity` compares
Web and Rust/native identities with the attestation.

Canonical build inputs include lockfiles, Mobile package/Cargo manifests,
Tauri config, Vite/Rust build scripts, generated Xcode/Gradle project settings,
Info.plist/entitlements/Android manifest, target/configuration and the
Acceptance Harness flag. Toolchain identity includes Node/pnpm, Rust/Cargo,
Tauri, Xcode/Swift or Java/Gradle/Android SDK versions. Paths are repository
relative, keys are sorted, and values outside the allowlist are excluded.

The build does not inherit the caller's ambient environment. The build owner
constructs a sanitized environment from an explicit allowlist plus required
platform variables, records their names and hashes their non-secret semantic
values. Secret signing inputs remain references and are represented only by the
resulting certificate/signing fingerprints.

Workspace digest reuses the canonical Acceptance source algorithm: SHA-256 over
the binary `git diff HEAD`, followed by every non-ignored untracked
repository-relative path and file bytes in sorted order with NUL separators.

The attestation does not cryptographically prove an arbitrary compiler was
honest. It proves source binding within the explicitly trusted, reviewed build
producer. Application signing proves authorized packaging, not source
correctness.

An exact dirty workspace digest may produce development evidence scoped only to
that digest and producing run. Dirty evidence is intentionally non-reproducible
and cannot support merge or production-readiness claims. Release evidence
requires a clean source state and exact commit. Any toolchain identity change
invalidates the attestation conservatively even when output bytes might match.

### 9.1 MOP-D03-A Lease Evidence Amendment

The physical device broker returns a process-local
`ResolvedPhysicalDeviceHandle` containing the raw UDID/serial. That handle is
never serialized. The durable `PhysicalDeviceLease` contains only the stable
client alias, opaque device reference, platform, destination-class reference,
lease tuple, physical/connected/simulator assertions, timestamps and state.

Every acquired Fixture, physical-device, provider-account and browser-session
lease has exactly one immutable `MobileLeaseOutcome`. The outcome references
the acquisition artifact and repeats the exact
`resourceKey + holderRunId + fenceToken` tuple. `RELEASED` requires successful
cleanup, baseline restoration where applicable and identity revalidation.
Expiry, stale fence, identity mismatch, or cleanup failure produces
`QUARANTINED`; expiry never makes a resource reusable.

Provider-account outcomes additionally record an aggregate authorization
operation summary. A released account requires every started operation to have
completed and `maxObservedConcurrency=1`; provider identity and operation input
remain excluded.

The acquired lease artifact is immutable and therefore cannot later point to
its outcome. Existing `releaseEvidence` fields are fixed to `null`; the
terminal outcome points back to the acquisition ArtifactRef. This removes the
otherwise cyclic or mutable evidence relationship.

### 9.2 MOP-D04-A Build Evidence Amendment

The attestation adds a typed `buildIsolation` object:

```text
environmentPolicy = empty-base-explicit-allowlist
dependencyPolicy  = locked-preseeded-offline
pnpm              = --offline + --frozen-lockfile
cargo             = --frozen
android/gradle    = --offline; xcode not applicable
ios/xcode         = -disableAutomaticPackageResolution; gradle not applicable
swift packages    = committed Package.resolved when references exist
cacheMissPolicy   = BLOCK
ambientEnvironmentInherited = false
```

These controls make dependency resolution fail closed. They do not claim a
general-purpose hermetic compiler sandbox; the reviewed Mobile build owner
remains the trust boundary. Any subprocess not covered by a declared offline
control is rejected before build. The producer records the effective resolver
argv/control for every applicable pnpm, Cargo, Gradle or Xcode phase; a
top-level Tauri command alone is insufficient unless propagation to each child
resolver is verified. A discovered dependency manager without a declared
locked, preseeded/offline control blocks the build.

The same canonical public identity bytes enter both compilation paths from one
`PT_MOBILE_BUILD_IDENTITY_JSON` value and are embedded through two independent
mechanisms:

- Vite config reads the explicitly allowlisted process value and statically
  replaces one dedicated compile-time constant with
  `JSON.stringify(canonicalBytes)` in the Web bundle;
- Cargo `build.rs` emits one `cargo::rustc-env` value consumed at compile time
  by Mobile Rust.

The identity contains no secret. No broad `VITE_*` prefix is introduced. Vite
documents `define` as compile-time global constant replacement and warns that
client-exposed environment values are bundled into client code. Cargo documents
`cargo::rustc-env` as the compile-time metadata mechanism.

Apple signing evidence is parsed from `codesign`, not reconstructed from code
signature internals. `cdHash` records:

```text
source = codesign
algorithm = sha256
valueHex = 40 lowercase hex characters
candidateFullValueHex = 64 lowercase hex characters
```

Apple documents that `CDHash` is the strongest candidate understood by the
current system and that the non-full candidate is truncated to 20 bytes.
Unexpected algorithms or lengths fail closed and require design review rather
than silent normalization.

`MobileFreshInstallTrace` proves uninstall-before-install ordering for the
attested application on a fenced physical-device lease.
`MobileInstalledBuildIdentity` then correlates that trace, the build
attestation, active application ID, and equal Web/Rust embedded identity
digests. Neither artifact persists an artifact path, UDID/serial, signing
subject, provider identity, or credential material.

Official platform evidence:

- [Apple TN3126](https://developer.apple.com/documentation/Technotes/tn3126-inside-code-signing-hashes):
  “The `CDHash` property is the cdhash value used by this Mac” and the non-full
  candidate “is truncated to 20 bytes to match SHA-1.”
- [Cargo CLI](https://doc.rust-lang.org/cargo/commands/cargo.html):
  “`--frozen` [is] equivalent to specifying both `--locked` and `--offline`.”
- [Gradle dependency caching](https://docs.gradle.org/current/userguide/dependency_caching.html#sec:controlling-dependency-caching-command-line):
  offline mode “will not attempt to access the network for dependency
  resolution” and fails when required modules are absent from cache.
- [pnpm install](https://pnpm.io/cli/install): `--offline` uses only cached
  packages and fails when a package is not available locally.
- [Apple CI package guidance](https://developer.apple.com/documentation/xcode/building-swift-packages-or-apps-that-use-them-in-continuous-integration-workflows)
  requires committed `Package.resolved` for Swift package dependencies and
  `-disableAutomaticPackageResolution` for direct `xcodebuild` use.
- [Vite shared options](https://vite.dev/config/shared-options.html#define)
  defines `define` as global constant replacement and requires string constants
  to be explicitly quoted; its
  [environment documentation](https://vite.dev/guide/env-and-mode) warns that
  client-exposed values are bundled into client code.
- [Cargo build-script documentation](https://doc.rust-lang.org/cargo/reference/build-scripts.html#rustc-env)
  defines `cargo::rustc-env` for embedding compile-time metadata.

## 10. Lifecycle

```text
DISCOVERED
  -> LEASED
  -> BASELINE_VERIFIED
  -> FIXTURE_READY
  -> GATE_RUNNING
  -> PROOF_CAPTURED
  -> CLEANING
  -> RELEASED

Any state -> CLEANING -> QUARANTINED
  when cleanup, identity, source, or lease verification fails
```

Rules:

- cleanup actions register immediately after each resource acquisition;
- Fixture cleanup occurs after proof capture and before deployment lease release;
- cleanup is idempotent and journaled; retry resumes the incomplete restore;
- cleanup success requires a distinct post-cleanup Station snapshot;
- policy cleanup restores the exact pre-run snapshot, not a presumed deployment
  default; a conflicting policy revision fails cleanup instead of overwriting
  an operator change;
- browser/account identity is rechecked before its lease is released;
- app/session/secure-storage absence and Station zero-residue snapshot are both
  mandatory;
- quarantined resources cannot be selected by another run.

## 11. Allowed And Forbidden Relationships

Allowed:

- Provisioner -> deployment owner -> Station internal Fixture/proof adapter.
- Appium -> physical app/native browser/OS deep link.
- acceptance Harness -> production intents or typed negative-input adapter.
- Gate -> immutable RuntimeManifest and proof ArtifactRefs.
- Proof producer -> Station persistence through read-only/query ownership.

Forbidden:

- Gate -> direct PostgreSQL connection.
- Mobile Web/Driver -> OAuth secret, provider subject or cookie.
- Fixture -> direct success/session/envelope creation.
- Public Station endpoint -> Acceptance mutation or proof API.
- Provisioner -> product pass/fail decision.
- Browser session -> sharing across clients without an exclusive lease.
- Raw environment artifact path -> physical proof without build attestation.
- Simulator evidence -> MS-AG03 physical proof.

## 12. Failure Semantics

| Failure | Result |
|---|---|
| Fixture authorization/target/lease mismatch | `ACCEPTANCE_FIXTURE_RESET_UNAUTHORIZED` |
| Fixture compare-and-set or restore failure | Fixture failure; cleanup continues; proof `UNPROVEN` |
| Station proof absent/stale/mismatched | `ACCEPTANCE_EVIDENCE_MISSING` |
| Account/browser identity mismatch | Environment blocked; lease quarantined |
| Account lease concurrent use | Environment blocked before provider launch |
| Build identity/hash/signing mismatch | `ACCEPTANCE_DRIVER_SMOKE_FAILED` |
| Runtime build identity unavailable | `ACCEPTANCE_HARNESS_UNAVAILABLE` |
| Negative adapter exposes secret or can produce success | security design violation |
| Cleanup residue | readiness failure; observed behavior may be retained but MS-AG03 is not proven |

No failure may select another platform, browser shell, account, old artifact or
prior evidence as fallback.

## 13. Architecture Quality Gates

The design is satisfied only when:

- every one of the 16 physical variants has either a production action or the
  MOP-D01 negative-input adapter, plus a matching Station proof invariant;
- Fixture operations are allowlisted, target-verified, transaction-fenced and
  fully restored;
- provider account and four browser leases are acquired, identity-checked,
  serialized and released/quarantined;
- the exact installed IPA/APK is bound to source, dual embedded identity,
  signing metadata and runtime readback;
- release-build inspection proves negative-input adapter registration and
  symbols are absent;
- Mobile visible evidence and Station proof agree for each variant;
- secret/redaction audit and reverse-order cleanup pass;
- missing physical resources leave MS-AG03 `UNPROVEN`.
