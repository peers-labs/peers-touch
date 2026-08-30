# Mobile Native OAuth Proof — 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team

---

## 1. Contract Boundary

本文件定义 Acceptance runtime artifacts，不定义新的产品业务协议。它们使用
Evidence Store JSON + `ArtifactRef`，不进入普通 Mobile/Station API，也不授权
任何 protocol/version bump。

所有持久化 artifact 都必须经过 redaction、content hash 和 source/run identity
校验。示例中的 `*Ref` 是 opaque logical reference，不是 secret value。

## 2. MobileOAuthFixtureLease

```json
{
  "artifactKind": "mobile-oauth-fixture-lease",
  "fixtureId": "mobile-oauth-negative-fixture",
  "resourceKey": "station/<service-id>/mobile-oauth-fixture",
  "holderRunId": "<run-id>",
  "fenceToken": 11,
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "serviceId": "station-primary",
  "stationPeerId": "<signed-station-peer-id>",
  "serviceAttestation": {
    "artifactKind": "acceptance-artifact-ref"
  },
  "authorization": {
    "destructiveResetApproved": true,
    "deploymentLeaseMatched": true,
    "disposableTargetVerified": true
  },
  "allowedOperations": [
    "prepare_following_gate",
    "expire_awaiting_attempt",
    "read_proof_snapshot",
    "cleanup_run"
  ],
  "state": "LEASED",
  "heartbeatAt": "<UTC timestamp>",
  "renewBefore": "<UTC timestamp>",
  "expiresAt": "<UTC timestamp>",
  "quarantineReason": "",
  "cleanupRegistered": true
}
```

State:

```text
DISCOVERED -> LEASED -> PREPARED -> USED -> CLEANING -> RELEASED
                                      \-> CLEANUP_FAILED -> QUARANTINED
```

Rules:

- lease identity is `run_id + gate_id + service_id`;
- acquisition is atomic on `resourceKey`;
- every Fixture mutation, snapshot and cleanup presents and revalidates
  `(resourceKey, holderRunId, fenceToken)` immediately before DB access;
- only the current fence token may renew or release the lease;
- heartbeat loss quarantines the Station Fixture resource until explicit
  baseline recovery;
- operation not in `allowedOperations` fails before DB access;
- every mutation includes exact run, attempt, Station, device, generation,
  current-state and creation-window predicates;
- affected row count must equal the declared cardinality;
- before snapshot is captured before mutation;
- cleanup restores prior policy and removes/revokes exact run-owned state;
- arbitrary SQL text is never supplied by the Gate or RuntimeManifest.

## 3. NegativeFixtureOperation

```json
{
  "operationId": "<opaque-operation-id>",
  "inputDigest": "sha256:<canonical-operation-input>",
  "resourceKey": "station/<service-id>/mobile-oauth-fixture",
  "holderRunId": "<run-id>",
  "fenceToken": 11,
  "variantId": "expiry-ios",
  "operation": "expire_awaiting_attempt",
  "target": {
    "serviceId": "station-primary",
    "oauthAttemptRef": "<opaque-attempt-ref>",
    "accessAttemptRef": "<opaque-access-ref>",
    "deviceAlias": "alice-ios",
    "lifecycleGeneration": 7
  },
  "precondition": {
    "oauthState": "OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
    "runOwned": true
  },
  "result": {
    "journalState": "COMMITTED",
    "preconditionMatched": true,
    "affectedRows": 1,
    "before": {"artifactKind": "acceptance-artifact-ref"},
    "after": {"artifactKind": "acceptance-artifact-ref"},
    "postCleanup": {"artifactKind": "acceptance-artifact-ref"}
  }
}
```

The operation artifact excludes raw callback, state, PKCE, nonce, attempt
secret, provider subject, token, envelope bytes and database credentials.
`operationId` is the authoritative journal primary key and is unique within the
run/service lease. The operation journal and mutation commit in one Station
database transaction. Retry with the same `operationId + inputDigest` returns
the recorded result; the same ID with different input is a conflict. Cleanup
uses its own operation ID and post-cleanup snapshot.

## 4. NegativeCallbackIntent

```json
{
  "variantId": "provider-mismatch-ios",
  "clientId": "alice-ios",
  "operation": "provider_mismatch",
  "requiredLeaseRefs": [
    "<physical-device-lease>",
    "<provider-account-lease>",
    "<browser-session-lease>"
  ],
  "holderRunId": "<run-id>",
  "fenceTokens": {
    "physicalDevice": 9,
    "providerAccount": 42,
    "browserSession": 18
  },
  "callbackReplayHandle": "",
  "replayMode": "",
  "alternateServiceId": "",
  "expectedFailure": "oauthProviderMismatch"
}
```

Allowed operations are `replay`, `provider_mismatch` and `station_mismatch`.
The intent enters the acceptance-build-only Rust adapter, which derives the
invalid input from the active secure attempt and invokes the production callback
validator/coordinator. No callback field or secret is returned to Web.

For replay, `callbackReplayHandle` is an opaque, volatile reference minted by
Rust when the real OS callback arrives. It cannot be persisted, resolved by Web
or reused after the run. `replayMode` is `different_after_claim`; exact
duplicate recovery is not a replay failure cell. Other operations leave both
fields empty.

The adapter rejects any operation capable of producing success, any unknown
variant, a stale/missing lease fence, and any call when the Acceptance Harness
build identity is absent.

## 5. StationOAuthProofSnapshot

```json
{
  "artifactKind": "station-oauth-proof-snapshot",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "variantId": "replay-ios",
  "fixtureId": "mobile-oauth-negative-fixture",
  "snapshotPhase": "post_action",
  "observedAt": "<UTC timestamp>",
  "observation": {
    "isolation": "postgresql-repeatable-read-read-only",
    "transactionSnapshot": "<opaque-db-snapshot>",
    "startedAt": "<UTC timestamp>",
    "completedAt": "<UTC timestamp>",
    "freshnessSeconds": 12
  },
  "service": {
    "serviceId": "station-primary",
    "stationPeerId": "<signed-station-peer-id>",
    "deploymentEnvironment": "<logical-environment>",
    "liveCommit": "<full-commit>",
    "workspaceDigest": "<digest>",
    "protocolDigest": "<sha256>",
    "attestation": {"artifactKind": "acceptance-artifact-ref"}
  },
  "binding": {
    "accessAttemptRef": "<opaque-access-ref>",
    "oauthAttemptRef": "<opaque-attempt-ref>",
    "expectedProvider": "github",
    "gateId": "auth.login",
    "deviceAlias": "alice-ios",
    "lifecycleGeneration": 7
  },
  "access": {
    "status": "action_required",
    "currentGateId": "invite.code",
    "decisionRevision": 3
  },
  "oauth": {
    "state": "OAUTH_ATTEMPT_STATE_FOLLOWING_GATE",
    "result": "OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED",
    "errorCode": "",
    "updatedAt": "<UTC timestamp>",
    "expiresRelation": "future",
    "claimedAtPresent": true,
    "consumedAtPresent": true
  },
  "candidate": {
    "count": 1,
    "state": "inactive",
    "actorPtid": "<fixture-ptid>",
    "sessionRefPresent": false
  },
  "credentialEnvelopeCount": 0,
  "session": {
    "count": 0,
    "activeCount": 0,
    "revokedCount": 0,
    "authMethod": "",
    "decisionRevision": 0
  },
  "providerBinding": {
    "provider": "github",
    "candidateCorrelationPresent": true,
    "providerSubjectFingerprint": "<run-scoped-hmac>",
    "bindingCount": 1
  },
  "fixture": {
    "operationId": "<opaque-operation-id>",
    "journalState": "COMMITTED",
    "policyBaselineDigest": "sha256:<hex>",
    "policyObservedDigest": "sha256:<hex>",
    "policyRestored": false
  },
  "runOwnedResidue": {
    "accessAttempts": 1,
    "oauthAttempts": 1,
    "candidates": 1,
    "credentialEnvelopes": 0,
    "sessions": 0,
    "inviteCodes": 1,
    "policyOverrides": 1,
    "fixtureJournalEntries": 1
  },
  "invariants": {
    "singleConsume": true,
    "singleCandidate": true,
    "noEarlyActiveSession": true,
    "noUnexpectedEnvelope": true
  },
  "redaction": {"status": "passed"}
}
```

Cardinality is derived from Station persistence, not inferred from missing
client fields. The Station producer does not claim an account reference. It
emits a run-scoped HMAC over provider namespace and provider subject; the Gate
compares it with the broker-produced identity assertion. Provider user ID,
HMAC key and email are never persisted. When no candidate exists,
`candidateCorrelationPresent` is false and fingerprint/cardinality are omitted.

`snapshotPhase` is `before`, `post_action` or `post_cleanup`. A
`post_cleanup` snapshot requires all run-owned residue counts to be zero,
`policyRestored=true`, and `policyObservedDigest == policyBaselineDigest`.
Fixture journal history may remain only when the deployment's retention policy
requires it; in that case it is terminal and excluded from residue.
`freshnessSeconds` must be at most the 30-second capture budget; exceeding the
budget makes the snapshot stale.

## 6. ProviderAccountLease

```json
{
  "artifactKind": "provider-account-lease",
  "leaseId": "<opaque-lease-id>",
  "resourceKey": "provider-account/github/<opaque-account-ref>",
  "holderRunId": "<run-id>",
  "fenceToken": 42,
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "provider": "github",
  "accountRef": "github-disposable-account",
  "allowedClientIds": ["alice-ios", "bob-android"],
  "maxConcurrentAuthorizations": 1,
  "heartbeatAt": "<UTC timestamp>",
  "renewBefore": "<UTC timestamp>",
  "state": "LEASED",
  "acquiredAt": "<UTC timestamp>",
  "expiresAt": "<UTC timestamp>",
  "quarantineReason": "",
  "releaseEvidence": null
}
```

The secret/account broker retains the provider identity and authentication
material. The RuntimeManifest contains only lease/account references.
Every provider authorization operation must present and revalidate the account
lease `resourceKey`, `holderRunId` and current `fenceToken`; the same fence
serializes the two client profiles sharing that account.

The broker returns this redacted payload for Acceptance Core to persist:

```json
{
  "artifactKind": "provider-identity-assertion",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "provider": "github",
  "accountRef": "github-disposable-account",
  "providerSubjectFingerprint": "<run-scoped-hmac>",
  "identityMatched": true,
  "observedAt": "<UTC timestamp>"
}
```

The HMAC key remains secret-side and is shared only with the Station proof
producer for that run through a non-persisted Provisioner channel. It never
enters RuntimeManifest or an artifact. The Gate compares fingerprints and
booleans; it cannot resolve the provider subject.

The channel is process memory or a single-use anonymous pipe inherited by the
two producers. Filesystem storage, environment inheritance, network transport,
logs and evidence are forbidden. Cleanup evidence proves the pipe is closed and
the in-memory key is zeroized.

## 7. ProviderBrowserSessionLease

```json
{
  "artifactKind": "provider-browser-session-lease",
  "leaseId": "<opaque-lease-id>",
  "resourceKey": "physical-device/<alias>/browser/<profile-ref>",
  "holderRunId": "<run-id>",
  "fenceToken": 18,
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "clientId": "alice-ios",
  "platform": "ios",
  "physicalDeviceLeaseRef": "<opaque-device-lease>",
  "browserProfileRef": "<opaque-browser-profile>",
  "providerAccountLeaseRef": "<opaque-account-lease>",
  "baseline": "preauthenticated-exclusive",
  "checks": {
    "expectedIdentityMatched": true,
    "authorizationInProgress": false,
    "mobileOAuthStateAbsent": true,
    "stationRunStateAbsent": true
  },
  "cleanupPolicy": "preserve-login-verify-identity",
  "heartbeatAt": "<UTC timestamp>",
  "renewBefore": "<UTC timestamp>",
  "expiresAt": "<UTC timestamp>",
  "state": "BASELINE_VERIFIED",
  "quarantineReason": "",
  "releaseEvidence": null
}
```

State:

```text
DISCOVERED -> LEASED -> BASELINE_VERIFIED -> IN_USE
  -> RESTORING -> RELEASED
  -> QUARANTINED
```

Rules:

- one browser-profile lease belongs to exactly one physical client;
- acquire is atomic on `resourceKey`; an existing live holder blocks;
- only the current `fenceToken` may renew, mutate lease state or release;
- every provider authorization, browser/Appium operation, baseline check and
  cleanup call must present and revalidate
  `(resourceKey, holderRunId, fenceToken)` immediately before execution;
- provider account authorization is serialized across leases sharing one
  account;
- identity mismatch, unexpected account chooser state or cleanup failure moves
  the lease to `QUARANTINED`;
- provider screenshot, AX, username, email, subject, cookie and token are
  transient and excluded from Evidence Store;
- evidence retains only aliases, refs, booleans and typed failure codes.
- heartbeat loss or runner crash quarantines the resource; expiry alone never
  makes it reusable without baseline recovery and release evidence.

## 8. MobileApplicationBuildIdentity

The build owner creates one canonical JSON value before Web and Rust/native
compilation:

```json
{
  "schema": "peers-mobile-build-identity",
  "buildId": "<random-build-id>",
  "platform": "ios",
  "configuration": "acceptance-debug",
  "sourceCommit": "<full-git-oid>",
  "workspaceState": "clean",
  "workspaceDigest": "sha256:<hex>",
  "buildInputsDigest": "sha256:<hex>",
  "allowlistedEnvironmentDigest": "sha256:<hex>",
  "applicationId": "com.peers.touch.mobile",
  "harnessEnabled": true
}
```

The exact canonical bytes are embedded independently into:

- the Mobile Web bundle;
- the Rust/native payload.

Harness action `build.identity` returns only the parsed public fields and an
`embeddedIdentitySha256`. It fails if the two embedded values differ.

The accepted design deliberately leaves the initial schema revision
unspecified. Assigning a numeric schema or protocol version requires explicit
version approval before implementation.

`workspaceDigest` reuses
`tooling.acceptance.core.attestation.source_workspace_digest`: hash the binary
`git diff HEAD`, then each non-ignored untracked repository-relative path and
its bytes in sorted order with NUL separators. A clean tree is represented as
`clean`.

This algorithm is part of the accepted contract. Changing it requires a
coordinated Mobile/Acceptance design update and invalidates prior build
attestations; callers may not silently substitute another digest.

## 9. MobileApplicationBuildAttestation

```json
{
  "artifactKind": "mobile-application-build-attestation",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "producer": "mobile-native-build",
  "producerSourceDigest": "sha256:<hex>",
  "toolchainDigest": "sha256:<hex>",
  "buildIsolation": {
    "environmentPolicy": "empty-base-explicit-allowlist",
    "dependencyPolicy": "locked-preseeded-offline",
    "resolverArguments": {
      "pnpm": ["--offline", "--frozen-lockfile"],
      "cargo": ["--frozen"],
      "gradle": ["--offline"]
    },
    "inapplicableResolvers": ["xcode"],
    "cacheMissPolicy": "BLOCK",
    "ambientEnvironmentInherited": false
  },
  "buildIdentity": {
    "schema": "peers-mobile-build-identity",
    "buildId": "<random-build-id>",
    "platform": "android",
    "configuration": "acceptance-debug",
    "sourceCommit": "<full-git-oid>",
    "workspaceState": "dirty",
    "workspaceDigest": "sha256:<hex>",
    "buildInputsDigest": "sha256:<hex>",
    "allowlistedEnvironmentDigest": "sha256:<hex>",
    "applicationId": "com.peers.touch.mobile",
    "harnessEnabled": true
  },
  "embeddedIdentitySha256": "<sha256>",
  "artifact": {
    "kind": "apk",
    "sha256": "<sha256>",
    "sizeBytes": 123456,
    "artifactRef": {"artifactKind": "acceptance-artifact-ref"}
  },
  "signing": {
    "policyId": "mobile-acceptance-debug",
    "certificateSha256": "<sha256>",
    "applicationIdentifier": "com.peers.touch.mobile",
    "debuggable": true,
    "signerCertificateSha256": "sha256:<hex>",
    "enabledSigningSchemes": ["v2", "v3"]
  },
  "createdAt": "<UTC timestamp>"
}
```

iOS replaces the Android-only signing fields with:

```json
{
  "teamIdentifier": "<team-id>",
  "applicationIdentifierEntitlement": "<team-id>.com.peers.touch.mobile",
    "cdHash": {
      "source": "codesign",
      "algorithm": "sha256",
      "valueHex": "<40-lowercase-hex>",
      "candidateFullValueHex": "<64-lowercase-hex>"
    }
}
```

iOS uses `kind: ipa` and also records Team Identifier,
application-identifier entitlement and the typed `codesign` CDHash object shown
above. Android omits `cdHash` and records signer certificate SHA-256 and enabled
signing schemes. Private keys, provisioning profiles and certificate subjects
are forbidden.

`artifact.sha256` is not embedded into the app because that would be
self-referential. `buildId + embeddedIdentitySha256` joins the embedded identity
to the post-build artifact hash.

`buildInputsDigest` is canonical JSON over repository-relative lockfiles,
Mobile package/Cargo manifests, Tauri config, Vite/Rust build scripts,
generated Xcode/Gradle project settings, platform manifests/entitlements,
target/configuration and Harness flag. `toolchainDigest` covers the exact
Node/pnpm, Rust/Cargo, Tauri, Xcode/Swift or Java/Gradle/Android SDK identities.
The build subprocess receives a sanitized environment assembled from a fixed
allowlist; it does not inherit ambient variables. Non-secret semantic values
are included in `allowlistedEnvironmentDigest`; signing secrets remain
references. The producer source digest binds the reviewed build implementation.
Signing metadata proves packaging authority, not source correctness.

Canonical input paths:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
apps/mobile/package.json
apps/mobile/index.html
apps/mobile/vite.config.ts
apps/mobile/tsconfig*.json
apps/mobile/src/**
apps/mobile/src-tauri/Cargo.toml
apps/mobile/src-tauri/Cargo.lock
apps/mobile/src-tauri/build.rs
apps/mobile/src-tauri/tauri.conf.json
apps/mobile/src-tauri/capabilities/**
apps/mobile/src-tauri/icon-source.png
apps/mobile/src-tauri/icons/**
apps/mobile/src-tauri/src/**
apps/mobile/src-tauri/plugins/**
apps/mobile/src-tauri/gen/apple/**
apps/mobile/src-tauri/gen/android/**
model/domain/{access_gate,actor,auth,oauth,peer}/**
tooling/scripts/proto-gen-mobile.sh
apps/mobile/scripts/**
resolved transitive workspace package closure from package/Cargo manifests
```

The transitive workspace closure currently includes
`packages/client-chat-core/**`, `packages/client-media-security/**`,
`packages/client-storage/**`, `packages/locales/**` and
`packages/messaging-core/**`; the producer derives this list from manifests and
fails on an unresolved local dependency rather than relying on this prose list.

The complete tracked native project trees include Xcode project/scheme files,
Asset Catalogs, Storyboards, plist/entitlements, Podfile and native scripts, plus
Android Gradle build logic/wrapper, manifests, Kotlin/Java sources, resources
and ProGuard rules. Only generated build outputs and caches are excluded:

```text
**/build/**
**/DerivedData/**
**/.gradle/**
**/Pods/**
apps/mobile/src-tauri/target/**
apps/mobile/dist/**
```

Credentials, provisioning profiles, local SDK-location files and signing
private keys are excluded as secret/runtime inputs and represented by approved
references or inspected output fingerprints. Any other file beneath a declared
input root participates in the digest. A required path that is absent,
unreadable, a symlink escape or outside the repository blocks the build.

Canonical JSON uses UTF-8, lexicographically sorted object keys, declared array
order, POSIX repository-relative paths, decimal integers, lowercase SHA-256 and
no insignificant whitespace.

Constructed build environment names:

```text
PATH HOME TMPDIR
DEVELOPER_DIR SDKROOT
JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
CARGO_HOME RUSTUP_HOME
VITE_ACCEPTANCE_HARNESS
PT_MOBILE_BUILD_IDENTITY_JSON
```

No variable above is inherited blindly. The producer resolves tool/SDK
locations first, records canonical path, executable hash and version, then
constructs `PATH`. `HOME`, `TMPDIR`, `CARGO_HOME` and `RUSTUP_HOME` point to
run-scoped controlled directories. SDK variables contain the exact probed
installation paths and participate in the environment digest.

Signing inputs are separately declared secret references. The child build
starts from an empty environment containing only the constructed names and
approved signing references. All other caller variables are removed. Missing
required variables, unlocked dependency resolution or build-time network
access blocks the build.

The example above is Android. For iOS, `gradle` is omitted,
`inapplicableResolvers` contains `gradle`, and `xcode` records
`-disableAutomaticPackageResolution`. When the Xcode project declares Swift
package references, a committed `Package.resolved` is mandatory; when it does
not, the producer records that check as not applicable. Any other dependency
manager discovered in the platform project requires its own frozen,
preseeded/offline control before the build may start.

Toolchain probes:

```text
node --version
pnpm --version
rustc -Vv
cargo -V
pnpm exec tauri --version
xcodebuild -version / swiftc --version
java -version / Gradle --version / adb version
```

The platform-inapplicable probes are omitted explicitly; a required probe that
fails or cannot be parsed blocks attestation.

Toolchain invalidation is intentionally conservative: any probed identity
change invalidates the attestation even when resulting bytes might be
equivalent.

## 10. RuntimeManifest Mapping

The concrete Mobile injection extends `mobileNative`:

```json
{
  "mobileNative": {
    "applications": {
      "ios": {
        "buildAttestation": {"artifactKind": "acceptance-artifact-ref"}
      },
      "android": {
        "buildAttestation": {"artifactKind": "acceptance-artifact-ref"}
      }
    },
    "providerAccountLeases": {
      "github": {"artifactKind": "acceptance-artifact-ref"},
      "google": {"artifactKind": "acceptance-artifact-ref"}
    },
    "clients": {
      "alice-ios": {
        "browserSessionLease": {"artifactKind": "acceptance-artifact-ref"}
      }
    },
    "oauthFixtureLeases": {
      "station-primary": {"artifactKind": "acceptance-artifact-ref"},
      "station-secondary": {"artifactKind": "acceptance-artifact-ref"}
    }
  }
}
```

This is Mobile business injection. It does not add generic
`RuntimeManifest.builds` or change Acceptance Core in this decision.

## 11. Evidence Correlation

Every variant result must correlate:

```text
runId
  + variantId
  + clientId
  + buildId
  + physicalDeviceLeaseRef
  + providerAccountLeaseRef
  + browserSessionLeaseRef
  + serviceId / stationPeerId
  + accessAttemptRef / oauthAttemptRef
  + StationOAuthProofSnapshot ArtifactRef
  + DOM / AX / screenshot ArtifactRefs
  + cleanup result
```

Missing any required link makes that variant `UNPROVEN`.

## 12. Redaction

Forbidden in durable evidence:

- password, MFA material, cookie and browser storage;
- provider username, email or subject ID;
- callback URL, authorization URL, code and state;
- PKCE verifier/challenge, nonce and attempt secret;
- bearer/refresh credential, envelope ciphertext and private key;
- absolute artifact path, physical UDID/serial and certificate subject.

Allowed:

- opaque account/device/attempt/lease refs;
- PTID when required by the existing actor proof contract;
- Station peer ID;
- hashes, app IDs, signing fingerprints and build IDs;
- enum state/result/error codes and cardinalities;
- sanitized DOM/AX/screenshots after redaction validation.

## 13. PhysicalDeviceLease

```json
{
  "artifactKind": "physical-device-lease",
  "leaseId": "<opaque-lease-id>",
  "resourceKey": "physical-device/<opaque-device-ref>",
  "holderRunId": "<run-id>",
  "fenceToken": 9,
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "clientId": "alice-ios",
  "platform": "ios",
  "physicalDeviceRef": "device-ref/alice-ios",
  "destinationClassRef": "ios-physical",
  "brokerRef": "mobile-physical-device-broker",
  "checks": {
    "connected": true,
    "physical": true,
    "simulator": false,
    "platformMatched": true
  },
  "heartbeatAt": "<UTC timestamp>",
  "renewBefore": "<UTC timestamp>",
  "acquiredAt": "<UTC timestamp>",
  "expiresAt": "<UTC timestamp>",
  "state": "BASELINE_VERIFIED",
  "quarantineReason": "",
  "releaseEvidence": null
}
```

The broker resolves `physicalDeviceRef` to a raw UDID/serial only in process
memory. The resolved value is represented by a non-serializable
`ResolvedPhysicalDeviceHandle` and never enters RuntimeManifest, logs, command
arguments captured as evidence, screenshots or durable artifacts.

State:

```text
DISCOVERED -> LEASED -> BASELINE_VERIFIED -> IN_USE
  -> RESTORING -> RELEASED
  -> QUARANTINED
```

Every inventory, install, launch, Appium or cleanup operation revalidates the
current `(resourceKey, holderRunId, fenceToken)` immediately before resolving
or using the handle. A disconnected device, simulator/emulator result, platform
mismatch, stale fence or heartbeat expiry quarantines the lease.

## 14. MobileLeaseOutcome

```json
{
  "artifactKind": "mobile-lease-outcome",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "leaseId": "<opaque-or-derived-lease-id>",
  "leaseKind": "physical-device",
  "resourceKey": "<stable-resource-key>",
  "holderRunId": "<run-id>",
  "fenceToken": 9,
  "acquisition": {"artifactKind": "acceptance-artifact-ref"},
  "finalState": "RELEASED",
  "cleanupCompleted": true,
  "baselineRestored": true,
  "identityReverified": true,
  "operationSummary": {
    "started": 2,
    "completed": 2,
    "maxObservedConcurrency": 1,
    "fenceValidated": true
  },
  "failureCode": "",
  "observedAt": "<UTC timestamp>"
}
```

`leaseKind` is one of `fixture`, `physical-device`, `provider-account` or
`provider-browser-session`. The Gate requires exactly one outcome for each
acquired lease: two Fixture, four physical-device, two provider-account and
four browser-session outcomes.

Rules:

- `leaseId`, `resourceKey`, `holderRunId` and `fenceToken` exactly match the
  acquisition artifact;
- `RELEASED` requires all three booleans to be true and `failureCode` empty;
- provider-account `RELEASED` additionally requires `operationSummary.started`
  to equal `operationSummary.completed`,
  `maxObservedConcurrency=1`, and `fenceValidated=true`;
- non-provider outcomes omit `operationSummary`;
- `QUARANTINED` requires a non-empty typed `failureCode`;
- expiry or crash cannot produce `RELEASED`;
- acquisition artifacts remain immutable and keep `releaseEvidence: null`;
- the outcome references the acquisition artifact, never the reverse.

Allowed non-empty failure codes are:

```text
LEASE_FENCE_STALE
LEASE_HEARTBEAT_EXPIRED
LEASE_DEVICE_DISCONNECTED
LEASE_SIMULATOR_DETECTED
LEASE_PLATFORM_MISMATCH
LEASE_IDENTITY_MISMATCH
LEASE_BASELINE_RESTORE_FAILED
LEASE_CLEANUP_FAILED
LEASE_OPERATION_INCOMPLETE
```

## 15. MobileFreshInstallTrace

```json
{
  "artifactKind": "mobile-fresh-install-trace",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "clientId": "alice-ios",
  "platform": "ios",
  "physicalDeviceLease": {"artifactKind": "acceptance-artifact-ref"},
  "buildAttestation": {"artifactKind": "acceptance-artifact-ref"},
  "applicationId": "com.peers.touch.mobile",
  "artifactSha256": "sha256:<hex>",
  "uninstall": {
    "stepIndex": 1,
    "requested": true,
    "priorInstallationAbsent": true,
    "completedAt": "<UTC timestamp>"
  },
  "install": {
    "stepIndex": 2,
    "completed": true,
    "applicationPresent": true,
    "completedAt": "<UTC timestamp>"
  },
  "observedAt": "<UTC timestamp>"
}
```

The trace is valid only when uninstall is attempted before install, post-remove
readback proves absence, install consumes the artifact referenced by the build
attestation, and the same fenced physical-device lease remains current
throughout. Step indexes are exactly `1` then `2`; UTC completion times satisfy
`uninstall.completedAt <= install.completedAt <= observedAt`.

## 16. MobileInstalledBuildIdentity

```json
{
  "artifactKind": "mobile-installed-build-identity",
  "runId": "<run-id>",
  "gateId": "mobile-native-access-e2e",
  "clientId": "alice-ios",
  "platform": "ios",
  "buildAttestation": {"artifactKind": "acceptance-artifact-ref"},
  "freshInstallTrace": {"artifactKind": "acceptance-artifact-ref"},
  "buildId": "<random-build-id>",
  "activeApplicationId": "com.peers.touch.mobile",
  "webEmbeddedIdentitySha256": "sha256:<hex>",
  "rustEmbeddedIdentitySha256": "sha256:<hex>",
  "attestedEmbeddedIdentitySha256": "sha256:<hex>",
  "allIdentitiesMatch": true,
  "observedAt": "<UTC timestamp>"
}
```

The Harness compares canonical Web identity bytes with Rust/native identity
bytes before returning this projection. The Gate then correlates both digests
and `buildId` with the build attestation and fresh-install trace. Missing
identity, malformed JSON, hash mismatch, app-ID mismatch or a stale device
lease blocks before OAuth.
