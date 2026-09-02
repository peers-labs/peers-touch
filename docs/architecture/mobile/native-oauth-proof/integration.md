# Mobile Native OAuth Proof — 集成与映射

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-30
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`, `apps/station/app/subserver/oauth/`, `tooling/acceptance/`

---

## 1. Initial-To-Target Mapping — 2026-08-29

This table records the baseline used to define the architecture. It is not a
live implementation-status ledger; current closure state is owned by
`execution-plans/20260829-mobile-native-oauth-proof.md` §14.

| Concern | Initial state | Target owner/contract |
|---|---|---|
| Negative variant inventory | Ten physical cells are `UNSUPPORTED` in `native_e2e.py` | Mobile Gate consumes executable Fixture/input contracts |
| Fixture authority | Actor reset only; no OAuth negative-state owner | Station-internal adapter under deployment-owned `MobileOAuthFixtureLease` |
| Station readback | Mobile `projection.read` is labeled Station readback | Deployment-produced `StationOAuthProofSnapshot` |
| Browser ownership | `browser_session` contains three `"required"` strings | Account broker + per-client browser-profile leases |
| Device ownership | raw UDID/serial environment values are resolved before a fenced lease exists | Opaque physical-device lease + process-local broker handle |
| Provider automation | Two selector documents are resolved by the Gate | Opaque account leases; Gate receives only approved flow/lease handles |
| Mobile cleanup | Web projection cleanup plus Appium session deletion | Production Rust logout/purge + browser baseline verification + Station zero-residue proof |
| Physical artifact | External path existence | Build attestation, artifact hash, signing inspection, fresh install and runtime identity |
| Android destination | Physical clients still reference an AVD-named input | Physical-device destination/serial lease; emulator identity is rejected |
| App install policy | Appium preserves existing app data and may reuse a stale install | Remove exact app ID, install attested artifact, then verify active identity |
| Harness identity | Required actions are scanned in source | Running Web/Rust embedded identity must match attested artifact |
| Lease cleanup | generic cleanup registration has no typed terminal evidence | one immutable lease outcome for every acquired lease |

## 2. Responsibility Mapping

### Mobile Acceptance Domain

Owns:

- MS-AG03 variant definitions and result judgment;
- concrete Mobile Environment, Provisioner, Fixture, Harness and Gate injection;
- physical client/account/browser/build lease requirements;
- Mobile-visible DOM, AX, screenshot and projection evidence.

Must not own:

- Station OAuth state transitions;
- provider account secret values;
- generic Acceptance Core schemas;
- deployment attestation production.

### Station OAuth/Access Domains

Own:

- real OAuth, candidate, envelope, session and Access Gate semantics;
- internal Fixture operation implementation;
- read-only proof projection over Station persistence;
- compare-and-set and cleanup invariants.

Must not expose:

- a public Acceptance mutation endpoint;
- raw secrets or provider identity in proof artifacts;
- a path that directly sets a successful business result.

### Station Deployment Owner

Owns:

- exact disposable target and service lease;
- invocation of the Station-internal Fixture/proof adapter;
- live Station identity, commit and protocol attestation;
- redacted proof payload production and cleanup invocation.

Acceptance Core `RunHandle` alone persists producer payloads and returns their
immutable `ArtifactRef`s.

### Mobile Build Owner

Owns:

- canonical source/build identity;
- Web and Rust/native identity injection;
- IPA/APK production;
- artifact and signing inspection;
- redacted build-attestation payload returned to Acceptance Core for persistence.

### Provider Account Broker And Browser Lease Owner

Owns:

- approved disposable account inventory;
- opaque account identity and provider authentication material;
- exclusive account lease and serialization;
- per-device browser-profile baseline verification and quarantine.

## 3. Scenario Mapping

| Variant family | Precondition owner | Product path | Authoritative proof |
|---|---|---|---|
| success | Provider/browser lease + actor Fixture | native browser -> OS callback -> Rust -> Station | Station snapshot + Mobile projection |
| cancel | Mobile runtime | production cancel command | Station snapshot + secure-storage absence |
| following-gate | Station Fixture adapter prepares real invite gate | provider callback -> inactive candidate -> real invite submission -> Station session finalizer | before/intermediate/final Station snapshots |
| expiry | Station Fixture adapter conditionally expires awaiting row | real callback/status path | expired Station state; zero active session |
| replay | After one real OS callback is claimed, Rust uses its volatile handle for a different callback | production Rust callback validator/coordinator | typed replay; one consume; at most one candidate/session |
| provider mismatch | Rust negative-input adapter changes only provider discriminator in memory | production validator/Station binding checks | unchanged original attempt; zero candidate/session |
| Station mismatch | two signed Stations plus cross-scope invalid input | production scope and Station binding checks | snapshots from both Stations show no cross-use |

The negative-input adapter is compiled only with the Acceptance Harness and can
make inputs invalid only. It cannot return or create success.

## 4. Required Contract Surfaces

Target logical surfaces:

```text
Mobile build owner
  -> build attestation ArtifactRef

Station deployment owner
  -> fixture lease ArtifactRef
  -> proof snapshot ArtifactRef

Provider account broker
  -> provider account lease ArtifactRef
  -> physical device lease ArtifactRef
  -> per-client browser session lease ArtifactRef

Mobile Provisioner
  -> mobileNative RuntimeManifest projection

Appium Driver
  -> fresh-install trace ArtifactRef
  -> installed build identity ArtifactRef

Mobile Gate
  -> variant result + Mobile evidence + Station proof refs
```

The normal Station Mobile OAuth API remains unchanged unless implementation
planning finds a product-contract defect. Proof and Fixture adapters have no
public route.

## 5. Retain

- MS-D12 native secret ownership.
- MS-D13 Station transactional finalizer.
- MS-D14 Appium/XCUITest/UiAutomator2 architecture and simulator/physical split.
- Current real browser opener and OS deep-link path.
- Existing OAuth state/result enums and product APIs.
- External immutable Evidence Store and typed `ArtifactRef`.
- Environment/Provisioner/Gate responsibility split.

## 6. Replace Or Delete At Cutover

Replace:

- path-only physical artifact inputs with attested build references;
- declarative browser `"required"` markers with acquired lease artifacts;
- client projection mislabeled as Station readback with Station proof snapshots;
- unsupported negative variants with source-backed scenario implementations.

Delete:

- any Gate-side DB query or arbitrary SQL facility;
- any descriptor-only Fixture that cannot execute/read back/cleanup;
- any account/session sharing without an exclusive lease;
- stale-app reuse in physical proof;
- persisted provider-page screenshots, callback data or account PII.

No compatibility alias or dual read path is retained after cutover.

## 7. Required Runtime Behavior

### Before Gate

- source/build identity and artifact signing match;
- exact artifact is freshly installed;
- four physical device/browser-profile leases are exclusive;
- two provider account leases are acquired;
- account operations are serialized;
- browser and Mobile/Station baselines are verified;
- Station Fixture leases and cleanup are registered.

### During Gate

- Appium drives the real app and system browser;
- callback enters the OS deep-link path;
- Rust owns callback secrets and Station transport;
- Station performs business transitions;
- Gate records only sanitized Mobile evidence and proof references.

### After Each Variant

- Station proof snapshot is captured;
- visible projection and Station truth are compared;
- temporary invalid-input state is removed;
- provider/browser identity remains under the same lease.

### Final Cleanup

- active OAuth attempts are cancelled;
- candidate-created sessions are revoked;
- Rust attempt/session/credential storage is absent;
- Web projections and Station registry are cleared;
- Fixture policy and rows are restored;
- browser profile returns to its approved preauthenticated baseline;
- Appium/process/port/storage leases are released;
- every acquired lease has exactly one typed `RELEASED` or `QUARANTINED`
  terminal outcome;
- any failure quarantines the affected resource and leaves MS-AG03 unproven.

## 8. Acceptance Framework Boundary

D-18 and accepted D-19 are explicit generic Acceptance Infra dependencies;
D-19 implementation remains active:

- D-18 carries process-local Mobile capability without persisting authority;
- D-19 generic Infra must validate and execute the Mobile-owned
  `mobile.native.oauth-final-roles` requirement for
  `mobile-native-access-e2e`, seal the complete role-instance inventory after
  cleanup, and run the detached Mobile validator before publish; Infra does not
  author that business requirement or validator;
- RuntimeManifest remains durable runtime truth, while Evidence Store owns the
  sealed snapshot and one-shot manifest lifecycle.

Mobile owns Artifact Role, discriminator/path/payload identity and relation
semantics in the neutral Mobile contract module. Mobile code must not embed
those semantics into Acceptance Core or move cleanup/authority into the Gate
child.
Before the atomic D-19 activation, `mobile-native-access-e2e` must have a
fail-closed publication interlock that rejects pre-cleanup `PROVEN`. The
interlock remains permanent: it is satisfied only when the Capability
requirement, matching Catalog config, current gate-scoped enforcement
generation, generated registration and post-cleanup Evidence Finalizer outcome all validate.
The Mobile cutover activates those inputs atomically; it does not delete or
bypass the guard. The guard is not a fallback validator or a second proof path.

## 9. Current Impact Surface

Likely downstream owners, for later planning only:

- `tooling/acceptance/environments/mobile-native.yaml`
- `tooling/acceptance/provisioners/mobile_native.py`
- `tooling/acceptance/fixtures/mobile_native_reset.py`
- `tooling/acceptance/gates/mobile/native_e2e.py`
- `tooling/acceptance/gates/mobile/appium.py`
- `apps/mobile/src/acceptance/`
- `apps/mobile/src-tauri/src/runtime/oauth/`
- `apps/mobile/src-tauri/src/commands/`
- `apps/station/app/subserver/oauth/`
- Station deployment-owned Acceptance command surface

This list is not an execution plan and does not authorize edits.

## 10. Design-To-Acceptance Trace

| Contract | Product acceptance | Architecture Gate |
|---|---|---|
| Trusted negative Fixture | MS-PA17, MS-PA25 | MS-AG03 |
| Station proof snapshot | MS-PA03, MS-PA17, MS-PA25 | MS-AG03 |
| Provider/browser/device leases | MS-PA03 | MS-AG03 |
| Build provenance + fresh-install/runtime identity | MS-PA03, MS-PA25 | MS-AG01, MS-AG03 |
| D-19 sealed post-cleanup 19-role snapshot | MS-PA03, MS-PA17, MS-PA25 | accepted target `mobile.native.oauth-final-roles`; Infra/Mobile landing pending |
| D-19 monotonic final publication | MS-PA03, MS-PA17, MS-PA25 | D-19-aware Evidence Store latest validation |

MOP-D03-A and MOP-D04-A passed independent review with no P0/P1 and were
accepted on 2026-08-29. The completed execution order placed the E2-0 contract
amendment before E2-1/E2-3 implementation; current open work is listed in the
focused W2-E2 plan §14.
