# Mobile Native OAuth Proof — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| MOP-D01 | Negative Fixture uses a Station-internal deployment-owned adapter | accepted |
| MOP-D02 | Station proof is an immutable deployment-produced persistence snapshot | accepted |
| MOP-D03 | Provider accounts and physical browser profiles use explicit leases | accepted |
| MOP-D04 | Physical builds require attestation, dual embedded identity and fresh install | accepted |
| MOP-D03-A | Device and terminal lease evidence is typed, fenced and immutable | accepted |
| MOP-D04-A | Build isolation and install/runtime identity evidence is explicit | accepted |

## MOP-D01: Station-Internal Negative Fixture Adapter

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

MS-AG03 requires following-gate, expiry, replay, provider mismatch and Station
mismatch on both physical platforms. The current runner names these ten cells
but cannot produce their preconditions. A list of hypothetical operations is
not an executable Fixture, while unrestricted remote SQL or a public test
endpoint would create a second business authority.

### Decision

Use a Station-internal OAuth Fixture adapter invoked only by the Station
deployment owner under an active run/service lease.

The adapter has no public route. It accepts an allowlisted operation enum and
typed run identifiers, verifies the exact disposable deployment and signed
Station identity, uses compare-and-set transactions, and emits before/after
semantic payloads for Acceptance Core to persist through `RunHandle`.

The Fixture lease is atomically acquired by stable Station resource key and
uses holder run ID, monotonic fence token and heartbeat/expiry. Every mutation,
snapshot and cleanup revalidates that tuple before database access; lease
expiry quarantines the resource rather than authorizing a stale operation.

Each mutation and its idempotency journal commit in one Station database
transaction. Retry returns the recorded result; cleanup is separately
journaled and closed only by a post-cleanup zero-residue snapshot.

Allowed mutation is limited to:

- preparing and restoring a run-owned real post-OAuth Access Gate policy;
- conditionally expiring one exact awaiting OAuth attempt;
- revoking or removing exact run-owned attempts, candidates, envelopes and
  sessions during cleanup.

Replay and binding mismatches use real or intentionally invalid inputs through
the production callback path. The Fixture cannot set success, consumption,
candidate, envelope or active-session state.

This decision amends MS-D14. An Acceptance Harness build
may register a Rust-owned negative-input adapter that can only make an input
invalid and invoke the production validator/coordinator. It is compile-time
absent when the Harness is disabled and cannot synthesize success or expose
attempt secrets. Exact duplicate callback delivery during an unresolved
completion remains idempotent recovery; the replay failure cell uses a
different callback after claim.

Release-build verification must inspect binary symbols/strings and prove the
negative-input adapter and its registration are absent.

### Rationale

The Station domain remains the only mutation authority and can preserve its own
invariants. The deployment owner already carries target and source identity,
while the Gate remains a consumer rather than a self-proving DB client.

### Alternatives Considered

- **Unrestricted deployment-side SQL**: rejected as the contract because schema
  knowledge, arbitrary predicates and direct terminal-state writes bypass
  domain invariants.
- **Acceptance-only public endpoint**: rejected because it adds a remotely
  reachable state mutation surface and a new authentication bootstrap problem.
- **Gate-owned mutation helpers**: rejected because the proof judge would also
  manufacture the state it judges.
- **Wait for natural expiry only**: rejected because it makes the Gate slow and
  nondeterministic without solving following-gate setup.

### Consequences

- Positive: deterministic negative preconditions without mocked provider
  success or public backdoors.
- Positive: exact target verification and cleanup remain source-bound.
- Negative: Station owns a non-serving adapter and operation allowlist that must
  evolve with its persistence model.
- Negative: Fixture failures can block physical proof even when product behavior
  is correct.

### Reversal Trigger

Review if production Station gains an already-authorized administrative API
whose normal semantics can prepare every required state without exposing a test
backdoor.

## MOP-D02: Deployment-Produced Station Proof Snapshot

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

The Mobile Gate currently labels client projection as Station readback. The
normal OAuth status operation is not a pure read because it may re-evaluate the
Access Gate and finalize a credential. Client projection cannot prove one-time
consume, candidate/session cardinality, envelope deletion or cross-Station
absence.

### Decision

The Station deployment owner produces an immutable
`StationOAuthProofSnapshot` through a read-only Station-internal adapter.
The snapshot joins Access Attempt, OAuth Attempt, candidate, envelope, session
and provider identity binding state. It is written to the external Evidence
Store and referenced by `ArtifactRef`.

The Gate requests and consumes the artifact but cannot query the database,
choose columns or alter the result. The proof producer binds the snapshot to
the service attestation, run, Gate, variant and observation time.

All joined rows are observed in one PostgreSQL `REPEATABLE READ`, read-only
transaction with a recorded transaction snapshot and decision revision. A
separate post-cleanup snapshot proves restoration. Stale, torn or over-budget
snapshots cannot satisfy a Gate.

### Rationale

Station persistence is the shared truth source. A deployment-produced snapshot
preserves producer/verifier separation without adding a client-facing API.

### Alternatives Considered

- **OAuth status response**: rejected because it can mutate/finalize and omits
  required cardinality and audit information.
- **Mobile projection**: rejected because it is a client cache and cannot prove
  absence or atomic persistence.
- **Gate-side SQL**: rejected because it gives the judge schema and credential
  ownership.
- **Dashboard proof endpoint**: rejected because Dashboard is an operator
  projection, not OAuth truth, and would add a production attack surface.

### Consequences

- Positive: replay, mismatch, following-gate and cleanup claims become
  falsifiable from Station truth.
- Positive: proof contains no provider token, callback or credential material.
- Negative: the Station deployment must make the proof adapter available to
  authorized Acceptance runs.
- Negative: schema changes require coordinated proof-adapter updates.

### Reversal Trigger

Review if the Station domain publishes a read-only, authenticated audit contract
with equivalent attempt/candidate/session cardinality and no mutation side
effects.

## MOP-D03: Explicit Provider Account And Browser Leases

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

The environment currently has two provider credential references and four
declarative browser sessions, but no code acquires, verifies, serializes or
releases them. Clearing browser cookies would destroy the preauthenticated
baseline and introduce password/MFA automation.

### Decision

Use:

- one run-exclusive GitHub account lease;
- one run-exclusive Google account lease;
- four physical-device/browser-profile leases, one for each client.

The same provider account may be used by two different physical browser
profiles only when operations are serialized by the account lease. Each browser
profile remains persistently authenticated to one approved disposable account.

Clean baseline means the expected opaque account identity is present, no
provider authorization is active, Mobile has no prior OAuth attempt/session,
and Station has no prior run-owned state. Cleanup preserves provider login,
restores that baseline, verifies identity again and quarantines the lease on
mismatch.

Fixture policy cleanup restores the exact pre-run policy snapshot. A concurrent
operator revision causes cleanup conflict/quarantine rather than being
overwritten by a presumed deployment default.

Account and browser leases use atomic acquire, stable resource keys,
run-holder identity, monotonic fence tokens, heartbeat/expiry and
compare-and-release. Crash or heartbeat loss quarantines the resource; a stale
holder cannot renew or release a newer lease.

Every provider authorization, browser/Appium operation, baseline check and
cleanup call revalidates the same fence tuple before touching the resource.

### Rationale

Isolation is provided by exclusive device/browser-profile ownership, not by
forcing provider logout. Two accounts are sufficient for the current sequential
Gate and minimize external account inventory while still preventing cross-client
cookie sharing.

### Alternatives Considered

- **Two unleased shared accounts**: rejected because concurrent or stale browser
  state cannot be attributed.
- **Four distinct accounts**: valid but not required while provider operations
  are serialized and browser profiles are physically distinct.
- **Forced logout/cookie clearing**: rejected because it requires provider
  credentials/MFA and is not uniformly controllable on physical iOS.
- **Ephemeral native auth sessions**: rejected for this amendment because the
  product currently uses the system browser opener; changing it would alter the
  production OAuth experience.

### Consequences

- Positive: current provider/browser product path remains unchanged.
- Positive: provider cookies and identity never enter evidence.
- Negative: the two account leases become a serial bottleneck.
- Negative: a dirty browser identity quarantines the physical device until an
  operator restores its approved baseline.
- Negative: Mobile requires a production-owned logout/purge operation with
  secure-storage absence readback.

### Reversal Trigger

Adopt four provider accounts when parallel physical execution is required.
Reconsider ephemeral native sessions only through a separate product and native
plugin decision.

## MOP-D04: Source-Bound Physical Build Attestation

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

The physical provisioner accepts arbitrary artifact paths and checks only file
existence. Source-tree Harness registration does not prove that the installed
app contains that Harness or that Web and Rust/native code came from the same
source snapshot. Appium's current reset policy can also reuse a stale install.

### Decision

The Mobile build owner produces one canonical source/build identity, embeds it
in both Web and Rust/native outputs, builds one immutable IPA/APK, inspects
application/signing metadata and hashes the exact artifact. It returns the
redacted `MobileApplicationBuildAttestation` payload to Acceptance Core;
`RunHandle` is the sole Evidence Store writer.

The Provisioner accepts only that attested artifact. Appium performs a fresh
install. Before product actions, Harness action `build.identity` compares Web
and Rust/native embedded identities with the attestation and active application
identity.

An exact dirty workspace digest may support development evidence scoped to that
digest and producing run; it is non-reproducible. Merge and
production-readiness proof requires clean source plus exact commit.

The canonical input set includes repository-relative lockfiles, Mobile
manifests/config/build scripts, generated native project settings,
platform manifests/entitlements, target/configuration, allowlisted build
environment and exact toolchain identities. The attestation is trusted because
it is produced by the reviewed build owner; app signing proves packaging
authority, not compiler honesty or source correctness by itself.

The build owner invokes tools from a sanitized, allowlisted environment rather
than inheriting ambient caller variables. Workspace identity uses the canonical
Acceptance diff-plus-untracked-content digest.

Any toolchain identity change invalidates the attestation conservatively, even
when output bytes might be equivalent.

### Rationale

Artifact hash, embedded identity and runtime readback form a continuous chain
from source to the app under observation. No single self-reported identity is
sufficient.

### Alternatives Considered

- **Artifact path plus app ID**: rejected because a stale or unrelated build can
  share the same ID.
- **Artifact-side attestation only**: rejected because it does not prove the
  running Web/Rust payloads match the attestation.
- **Embedded identity only**: rejected because it does not identify the exact
  signed artifact supplied to Appium.
- **Allow Appium to reuse installed app state**: rejected because source
  identity cannot then be tied to the running binary.

### Consequences

- Positive: physical evidence is bound to exact source, inputs, artifact and
  running runtime.
- Positive: signing metadata is verified without exposing signing secrets.
- Negative: physical builds require a dedicated build producer and attestation
  step.
- Negative: every source or build-input change invalidates the artifact.

### Reversal Trigger

Review if the mobile platform supplies a stronger signed runtime measurement
that binds source, Web assets, native code and installed package with equivalent
fresh-install guarantees.

## MOP-D03-A: Typed Device And Terminal Lease Evidence

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

MOP-D03 defines run-exclusive device/browser/account ownership, but E2-0 froze
only provider-account and browser-session payloads. `physical-device-lease`
and `mobile-lease-outcome` have Artifact Roles without complete payload
contracts. The current Provisioner therefore cannot prove physical device
ownership, operation fencing, baseline restoration or quarantine without
persisting raw UDID/serial values.

### Decision

Add a typed `PhysicalDeviceLease` artifact for each of the four physical
clients. It contains:

- stable client ID, platform, opaque device reference and destination-class
  reference;
- `leaseId + resourceKey + holderRunId + fenceToken`;
- physical, connected and non-simulator assertions;
- heartbeat, renewal, expiry and lifecycle state;
- no raw UDID, serial, provider identity or browser storage.

The secret-side device broker alone resolves the opaque device reference to a
raw platform identifier. It returns a non-serializable process-local handle.
Every Appium/device operation revalidates the exact lease tuple before using
that handle.

Add one typed immutable `MobileLeaseOutcome` for every acquired Fixture,
physical-device, provider-account and browser-session lease. It references the
acquisition ArtifactRef and repeats the exact lease tuple.

`RELEASED` requires cleanup completion, baseline restoration where applicable
and identity revalidation. Any stale fence, heartbeat expiry, identity
mismatch, incomplete restore or cleanup failure yields `QUARANTINED`. Expiry
never returns a resource to the available pool.

A provider-account outcome also records started/completed operation counts and
maximum observed concurrency. `RELEASED` requires all started operations to
complete and maximum concurrency to equal one.

Acquisition artifacts remain immutable. Their existing `releaseEvidence`
fields are constrained to `null`; the terminal outcome points to the
acquisition artifact instead of creating a mutable or cyclic reference.

### Rationale

The lease ledger must prove both exclusive ownership before an operation and a
safe terminal state after cleanup. Keeping raw device identifiers only in a
process-local broker handle preserves operational capability without leaking
device identity into RuntimeManifest or Evidence Store.

### Alternatives Considered

- **Reuse generic `ProfileLease`**: rejected because process-exit unlock has no
  monotonic fence, heartbeat, quarantine or recovery proof.
- **Persist UDID/serial in RuntimeManifest**: rejected because durable proof
  explicitly forbids physical device identifiers.
- **Treat expiry as release**: rejected because an interrupted provider/browser
  operation may leave a contaminated baseline.
- **Mutate the acquisition artifact with release evidence**: rejected because
  Evidence Store artifacts are immutable.

### Consequences

- Positive: every resource operation and cleanup can be correlated to one
  current fence without exposing physical identity.
- Positive: the existing 12-outcome cardinality becomes semantically
  enforceable.
- Negative: expired resources require explicit recovery and baseline proof.
- Negative: the device broker and lease ledger become mandatory preflight
  dependencies.

### Reversal Trigger

Review if the platform supplies an authenticated physical-device lease service
with equivalent fencing, non-disclosure, recovery and immutable evidence.

## MOP-D04-A: Explicit Build Isolation And Runtime Correlation

**Status**: accepted
**Date**: 2026-08-29 | **Accepted**: 2026-08-29

### Context

MOP-D04 defines source-bound artifacts but leaves four implementation-critical
semantics incomplete:

- offline dependency resolution and ambient-environment exclusion;
- native Apple CDHash representation;
- fresh-install evidence;
- installed Web/Rust identity correlation.

The current E2-0 schema incorrectly treats Apple `CDHash` as a full prefixed
SHA-256 digest and gives the install/runtime Artifact Roles no typed payload.

### Decision

The Mobile build owner starts child builds from an empty environment populated
only by a fixed allowlist and approved signing references. Dependency
resolution is fail-closed:

- pnpm uses `--offline --frozen-lockfile`;
- Cargo uses `--frozen`;
- Android uses Gradle `--offline` and marks Xcode inapplicable;
- iOS uses `-disableAutomaticPackageResolution`, marks Gradle inapplicable and
  requires committed `Package.resolved` when Swift package references exist;
- a missing cache, lock, resolved dependency or declared offline control blocks
  before artifact acceptance.

This is a locked, preseeded, tool-native offline boundary, not a claim of a
general-purpose hermetic compiler sandbox. Each resolver's effective
argv/control is recorded; invoking Tauri alone is insufficient unless the
producer proves propagation to every applicable resolver.

One explicitly allowlisted `PT_MOBILE_BUILD_IDENTITY_JSON` value supplies the
canonical public bytes to both compilation paths. Vite config reads it and uses
one dedicated `define` constant with `JSON.stringify(canonicalBytes)`; Rust
embeds the same value through `cargo::rustc-env`. The value is public metadata
and cannot contain credentials or private paths. A broad `VITE_*` environment
surface is not introduced.

iOS signing inspection uses `codesign` output as the authority. For the current
accepted toolchain, `cdHash` records `source=codesign`, `algorithm=sha256`, a
20-byte lowercase hexadecimal `valueHex`, and the 32-byte
`candidateFullValueHex`. Any other algorithm/length is a fail-closed
toolchain-identity change.

Add typed `MobileFreshInstallTrace` and
`MobileInstalledBuildIdentity` artifacts. The former proves ordered
uninstall-before-install of the attested artifact on a fenced device lease.
The latter proves:

```text
attested build identity
  == Web embedded identity
  == Rust/native embedded identity
  == active application identity after fresh install
```

Both artifacts contain only logical refs, hashes, booleans, app IDs and
timestamps. Artifact paths, UDID/serial, signing subjects and credentials are
forbidden.

### Rationale

Official tooling already exposes the required fail-closed mechanisms:

- [Cargo](https://doc.rust-lang.org/cargo/commands/cargo.html) documents
  `--frozen` as `--locked` plus `--offline`;
- [Gradle](https://docs.gradle.org/current/userguide/dependency_caching.html#sec:controlling-dependency-caching-command-line)
  and [pnpm](https://pnpm.io/cli/install) offline modes fail when dependencies
  are not cached;
- [Apple](https://developer.apple.com/documentation/xcode/building-swift-packages-or-apps-that-use-them-in-continuous-integration-workflows)
  requires committed `Package.resolved` and
  `-disableAutomaticPackageResolution` for deterministic CI package
  resolution when Swift package references exist;
- [Vite](https://vite.dev/config/shared-options.html#define) defines build-time
  constant replacement and requires string constants to be explicitly quoted;
- [Cargo build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html#rustc-env)
  provide `cargo::rustc-env` for compile-time metadata;
- [Apple TN3126](https://developer.apple.com/documentation/Technotes/tn3126-inside-code-signing-hashes)
  documents `CDHash` as the current-system candidate truncated to 20 bytes,
  distinct from the full candidate hash.

### Alternatives Considered

- **Claim a hermetic sandbox from environment filtering alone**: rejected
  because filtering does not prevent every arbitrary subprocess network call.
- **Keep `CDHash` as `sha256:<64 hex>`**: rejected because it conflates Apple's
  truncated `CDHash` with `CandidateCDHashFull`.
- **Trust installed app ID only**: rejected because it does not bind Web/Rust
  payloads to source or artifact bytes.
- **Allow stale installed app reuse**: rejected because runtime evidence could
  observe a prior artifact.

### Consequences

- Positive: E2-1 has executable, typed source/build/install/runtime evidence
  boundaries.
- Positive: offline dependency failure is distinguished from general network
  sandboxing.
- Negative: all required dependency caches and `Package.resolved` inputs must
  be prepared before the build.
- Negative: a toolchain that changes CDHash format blocks until reviewed.

### Reversal Trigger

Review if Tauri or the platform provides a stronger signed build manifest and
installed-runtime measurement that spans Web, Rust/native and package identity.
