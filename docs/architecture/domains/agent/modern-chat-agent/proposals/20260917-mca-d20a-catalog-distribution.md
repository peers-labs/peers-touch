# MCA-D20A Signed Catalog Distribution Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-17 | **Updated**: 2026-09-17
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `packages/agent-catalog/`,
> `apps/station/app/subserver/agent/`,
> `apps/desktop/src-tauri/src/application/skills_market/`
> **Accepted**: 2026-09-17

---

## 1. Scope

This proposal closes the missing distribution boundary in MCA-D20. It defines
how every Desktop installation obtains a fresh Peers Official signed catalog
without weakening publisher signatures or requiring a GitHub credential.

It does not change package contents, introduce hosted commercial marketplace
behavior, make Station a package-trust authority, or change Agent, Skill, and
MCP installation ownership.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| The configured Peers Official repository is private | `verified_fact` | `gh repo view peers-labs/peers-touch` reports `visibility=PRIVATE` | high | None |
| The configured branch is wrong | `verified_fact` | `trusted_catalog.rs` uses `main`; GitHub reports default branch `master` | high | None |
| Anonymous raw fetch cannot retrieve either README or the catalog | `verified_fact` | Both `raw.githubusercontent.com/.../main/...` probes return HTTP 404 | high | None |
| Desktop has no product GitHub credential suitable for catalog reads | `verified_fact` | Current Marketplace sync uses unauthenticated `reqwest`; accepted product excludes credential bootstrap for this source | high | None |
| Embedded bytes can provide first use but cannot prove fresh synchronization | `verified_fact` | MCA-X3 Harness rejects `stale=true`; embedded reload was removed before checkpoint `e49b8bdf7` | high | None |
| A deployed Station can distribute opaque signed bytes without becoming their trust root | `inference` | Desktop already pins the publisher key and rejects invalid signatures, identities, hashes, timestamps, and rollback | high | Native exact-source Gate |

## 3. Accepted Decision

### MCA-D20A: Station-Distributed, Publisher-Signed Official Catalog

The Peers Official source uses an authenticated, versioned Station API as its
distribution transport. The payload remains an exact publisher-signed
`peers.package-catalog.envelope.v1` document. Desktop Rust remains the verifier
and only publishes a new local snapshot after signature and policy validation.

User-pinned third-party sources retain the accepted public GitHub
repository/branch/manifest contract. The two source kinds are explicit:

```text
official_station
  transport owner: Station
  trust root: Desktop-pinned Peers publisher key

user_pinned_github
  transport owner: configured public GitHub repository
  trust root: user-pinned publisher key
```

No source may infer its kind from a URL, fall back between transports, or supply
its own verification key.

Source state separates trust from transport:

```text
CatalogTrustRoot:
  source_id, publisher_id, signing_key_id, public_key, trust_class

CatalogTransport:
  official_station:
    endpoint_path, distribution_id
  user_pinned_github:
    repository, branch, manifest_path
```

The built-in source fixes `official_station` fields in product code. A user
cannot mutate it into a GitHub source or replace its endpoint, publisher, or
key. User-added sources must explicitly select `user_pinned_github`; their
repository must be public HTTPS GitHub and their key remains user-pinned.

## 4. Ownership

| Concern | Source of truth | Mutation authority | Must not own |
|---|---|---|---|
| Official envelope bytes | `packages/agent-catalog/official-catalog.v1.envelope.json` | Peers release process | Installed package state |
| Official catalog transport | Station Agent package-catalog endpoint | Station deployment | Publisher trust |
| Publisher key pin | Desktop release configuration | Peers Desktop release | Catalog payload |
| Verified catalog cache | Desktop Rust actor/device storage | Desktop verifier | Agent/Skill/MCP target truth |
| Agent and Skill install state | Station Agent/Skill services | Station | Catalog ledger |
| MCP install state | Actor-scoped Desktop MCP service | Desktop Rust MCP service | Catalog ledger |

Station serves bytes. It does not sign, rewrite, normalize, classify, or endorse
them at request time.

## 5. Runtime Topology

```text
Peers release source
  -> one signed envelope build asset
       -> Station image embeds the envelope
       -> Desktop image embeds the same envelope for first use

Desktop authenticated sync
  -> GET /sub-agent/agent/package-catalog/official
  -> Station returns versioned envelope bytes
  -> Desktop verifies pinned key + exact payload
  -> Desktop rejects rollback/revision reuse
  -> Desktop atomically replaces verified cache
```

The neutral `packages/agent-catalog` envelope is the only manually maintained
copy. Desktop Rust uses `include_bytes!` against that repository path for
bootstrap. A Station-local `official_catalog_gen.go` is a generated byte
projection, rebuilt by the catalog package generator and guarded by a
deterministic codegen check. A deterministic check must fail if another
manually maintained envelope appears, the generated projection drifts, or
either build stops consuming the canonical artifact.

## 6. Wire Contract

The Station-to-Desktop contract is proto-first:

```proto
message GetOfficialPackageCatalogRequest {}

message GetOfficialPackageCatalogResponse {
  bytes envelope_json = 1;
  string media_type = 2;       // application/json
  string distribution_id = 3; // peers-official-station-v1
  string envelope_sha256 = 4;  // transport diagnostic, not a trust root
}
```

Endpoint:

```text
GET /sub-agent/agent/package-catalog/official
Authorization: Bearer <actor session>
Accept: application/protobuf
```

Rules:

- Response bytes are bounded to 2 MiB.
- The endpoint returns one immutable envelope per Station build.
- Authentication controls Station access but contributes no catalog trust.
- Desktop verifies the envelope exactly as it verifies a GitHub source.
- `distribution_id` selects transport behavior only and is not signed trust.
- `envelope_sha256` must match the received bytes before signature verification;
  the Ed25519 signature remains authoritative.
- No private key or GitHub token exists in Station, Desktop, profile, or
  response data.

## 7. Synchronization State

```text
BOOTSTRAP_VERIFIED
  -> SYNCING
  -> FRESH_VERIFIED
  -> SYNCING
  -> STALE_VERIFIED

SYNCING
  -> INVALID_REJECTED
```

- `BOOTSTRAP_VERIFIED` is usable before the first network call.
- `FRESH_VERIFIED` requires a current Station response that passes all MCA-D20
  checks and rollback protection.
- Network, auth, old-Station endpoint absence, timeout, and invalid response
  retain the last verified snapshot as `STALE_VERIFIED` with a visible error.
- Invalid signature, identity, hash, schema, timestamp, or revision reuse never
  replaces the cache.
- There is no Station-to-GitHub fallback and no embedded-byte sync fallback.

## 8. Security And Operational Semantics

- The response is public catalog material carried over the user's authenticated
  Station channel; actor authentication does not elevate trust.
- The GET is side-effect free and idempotent. Retries may return the same
  immutable build asset and never mutate Station or Desktop package targets.
- A compromised Station can withhold or replay bytes, but cannot forge a newer
  accepted catalog without the publisher private key.
- Desktop rollback checks compare parsed RFC3339 instants and reject
  same-revision byte changes.
- Key rotation requires a Desktop release that pins the successor key before a
  catalog signed only by that key is accepted.
- Request timeout uses the existing bounded interactive Station transport.
- The endpoint owns no queue or per-request persistence; normal Station request
  admission and the 2 MiB response bound cap resource use.
- Concurrent syncs serialize through the existing Marketplace store lock only
  for cache replacement; network I/O occurs outside the lock.
- Multiple Desktop windows consume the same actor/device catalog cache and do
  not create independent source truth.
- Shutdown or cancellation leaves the last verified snapshot intact.

## 9. Allowed And Forbidden Relationships

Allowed:

- Station distributes exact opaque signed bytes.
- Desktop verifies and caches those bytes.
- Third-party public GitHub sources use explicit repository, branch, manifest,
  publisher, and pinned key fields.

Forbidden:

- Station signing or mutating the official payload at request time.
- Treating Station authentication as publisher verification.
- Desktop embedding a GitHub token or accepting private-repository credentials.
- Falling back from `official_station` to arbitrary GitHub or embedded bytes
  while reporting a fresh sync.
- Maintaining separate independently edited Station and Desktop envelope files.
- Reporting `freshSignedSynchronization=true` from bootstrap or stale cache.

## 10. Canonical Module Layout

```text
model/domain/agent/package_catalog.proto
  GetOfficialPackageCatalogRequest
  GetOfficialPackageCatalogResponse

packages/agent-catalog/
  official-catalog.v1.envelope.json   # sole manually maintained signed asset

apps/station/app/subserver/agent/catalog/
  official_catalog_gen.go             # generated immutable byte projection
  generate/                            # deterministic generator
  official_catalog_test.go

apps/station/app/subserver/agent/handler/
  package_catalog_handler.go
  package_catalog_handler_test.go

apps/desktop/src-tauri/src/application/skills_market/
  trusted_catalog.rs                  # verifier + canonical bootstrap include
  mod.rs                              # transport selection and cache commit
```

Target deletion:

- Remove
  `apps/desktop/src-tauri/src/application/skills_market/official-catalog.v1.envelope.json`.
- Remove the private `peers-labs/peers-touch` repository from the built-in
  source registration.
- Keep GitHub repository, branch, and manifest fields only for
  `user_pinned_github` sources.
- Expand the accepted X3 write set to `packages/agent-catalog` before
  implementation; do not smuggle the shared asset through the existing
  `packages/locales` claim.

## 11. Alternatives Considered

- **Keep private GitHub raw URL**: rejected because anonymous product clients
  receive 404 and no product credential exists.
- **Add a GitHub token to Desktop or profile**: rejected because it introduces
  secret distribution and makes catalog availability depend on developer
  credentials.
- **Publish to the historical public Station repository**: rejected because it
  is not the current source/deployment mirror and would create a second release
  truth.
- **Reload embedded bytes during sync**: rejected because it cannot prove a
  network refresh and the native Gate correctly rejects it as stale.
- **Create a hosted marketplace service**: rejected as outside X3 and the
  accepted non-goals.

## 12. Consequences

Positive:

- Every deployed profile can perform a fresh signed sync without GitHub access.
- Signature trust remains independent of the serving Station.
- First-use and remote-sync bytes share one release artifact.
- The solution stays inside existing Station/Desktop ownership and deployment.

Negative:

- Old Stations without the endpoint yield a visible stale state.
- Catalog publication is coupled to Station release cadence.
- Key rotation requires coordinated Station asset and Desktop key-pin releases.
- The Station API and shared proto surface expand by one read-only endpoint.

## 13. Required Evidence

`agent-marketplace-catalog-e2e` must additionally prove:

1. The deployed Station and Desktop report the same exact source commit.
2. Sync traffic reaches the Station catalog endpoint.
3. The returned envelope differs from no-op bootstrap loading only by allowed
   signed revision semantics and is accepted as fresh.
4. A tampered Station response is rejected while the last verified snapshot is
   retained as stale.
5. An old Station without the endpoint yields typed stale state.
6. No GitHub credential, private key, arbitrary URL fallback, or embedded sync
   fallback is used.

## 14. Owner Acceptance

Owner verdict:

```text
APPROVE MCA-D20A
```

The Owner accepted MCA-D20A on 2026-09-17. Formal architecture and Plan
incorporation may proceed; product-code implementation remains subject to the
active X3 Task, declaration, checkpoint, and exact-source native proof.
