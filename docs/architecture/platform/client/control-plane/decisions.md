# X Config - Decisions

> **Status**: active
> **Version**: v2.2
> **Created**: 2026-10-17 | **Updated**: 2026-10-23
> **Owner**: Client Platform

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| CCP-D01 | Separate static client reads from bounded console mutations | superseded |
| CCP-D02 | Cloud entries are suggestions, not Station records | accepted |
| CCP-D03 | Use closed protobuf sections, not generic remote config | accepted |
| CCP-D04 | Verify in one shared core with monotonic local cache | accepted |
| CCP-D05 | Require Station-root consent for public Direct entries | accepted |
| CCP-D06 | Preserve user-owned Station state across catalog changes | accepted |
| CCP-D09 | Use API-only evidence for the initial delivery | accepted |
| CCP-D10 | Deploy on control-data change, not every source commit | superseded |
| CCP-D11 | Consume upstream connection material without redefining trust | accepted |
| CCP-D12 | Admin credentials cannot authorize production signing | superseded |
| CCP-D13 | Go admin reuses narrow infrastructure; OAuth retains its owner | superseded |
| XCFG-D01 | X Config is the sole active module identity | accepted |
| XCFG-D02 | Use one service and shared prefixed repository | superseded |
| XCFG-D03 | Home runtime separates operator state from publication truth | accepted |
| XCFG-D04 | Closed per-key directive sections evaluated client-side | accepted |
| XCFG-D05 | One distribution flavor registry drives build identity and OS install identity | accepted |
| XCFG-D06 | Baked bootstrap origins with signed snapshot-driven origin failover and migration | accepted |

## CCP-D01: Separate Static Client Reads From Console Mutations

**Status**: superseded by XCFG-D02
**Date**: 2026-10-17

### Context

Client reads are small, public, cacheable, and immutable. Operators still need
a console for typed editing, validation, diff, publication, and recovery.

### Decision

One `apps/x-config` source unit produces two separate Vercel projects:

- a credential-free static distribution project;
- a browser operator console and bounded Go admin API for data drafts and
  publication-request/status operations.

Only the trusted publisher can deploy distribution. Admin credentials cannot
deploy that project or call the signer. Public reads never invoke a Function.

### Rationale

Static reads fit the client workload and remain independent from console/API
availability. Rare admin Functions provide the requested control surface
without becoming published truth or signing authority.

Publisher trust cannot be rotated by a snapshot signed with the same trust.
Each new public key must ship in an app release before the publisher switches;
old and new keys overlap for a bounded window.

### Alternatives Considered

- Vercel Function plus Global Config as published truth: rejected because it
  combines mutable runtime and client-read authority.
- Station-hosted catalog: rejected because first-run clients may not yet know a
  Station and no Station should become a global discovery authority.
- Local scripts without a console: rejected because they omit reviewable
  operator journeys, validation feedback, and publication recovery.

### Consequences

Console availability is an editing dependency, not a client-fetch dependency.
Two projects add deployment bookkeeping. Vercel team administrators retain
shared cloud availability authority; isolation concerns the runtime credentials.

## CCP-D02: Cloud Entries Are Suggestions, Not Station Records

**Status**: accepted
**Date**: 2026-10-17

### Context

Station registries persist identity-verified routes. Writing cloud URLs directly
into those registries would bypass Station Access and confuse curation with
identity.

### Decision

Cloud endpoint entries populate a distinct `StationSuggestion` projection.
Selection always invokes existing signed endpoint discovery. Only verified
routes enter the Station registry.

### Rationale

The cloud service can improve discoverability without becoming a trust or
binding owner.

### Alternatives Considered

- Persist cloud entries as offline Station rows: rejected because their
  Station identity and route have not been verified.
- Auto-select the first cloud entry: rejected because remote publication must
  not replace user choice or current scope.

### Consequences

The selector must render verified entries and suggestions as different states.
The first selection may require network discovery before it becomes usable.

## CCP-D03: Closed Protobuf Sections, Not Generic Remote Config

**Status**: accepted
**Date**: 2026-10-17

### Context

The service must later carry release locations and other reviewed client
configuration. A generic JSON map would allow semantics to expand without an
owner or generated consumer.

### Decision

The snapshot contains a versioned protobuf statement with explicit endpoint and
release sections. New sections require a schema change, owner, client consumer,
failure semantics, and architecture review.

### Rationale

Typed sections keep behavior discoverable and prevent arbitrary remote command
execution from appearing as "configuration."

### Alternatives Considered

- JSON plus `type` and `payload`: rejected because validation and ownership
  would be duplicated in each client.
- Generic feature-flag map: rejected until a separate product and policy
  contract exists.

### Consequences

Adding a new control category is slower than adding a key, but produces one
reviewed cross-platform contract.

## CCP-D04: Shared Verification Core And Monotonic Cache

**Status**: accepted
**Date**: 2026-10-17

### Context

Desktop and Mobile already have different registry implementations. Duplicating
signature, expiry, rollback, and merge behavior would create two security
policies.

### Decision

One Rust `x-config-core` package owns exact-byte signature verification,
bounds, channel checks, monotonic sequence, last-known-good selection, and typed
projection. Desktop and Mobile inject platform HTTP and secure persistence.
Station proof delegates to existing `station-trust`; no new Station verifier is
introduced into this package.

### Rationale

The security-sensitive policy is identical while platform lifecycle remains
adapted.

### Alternatives Considered

- Shared TypeScript only: rejected because native startup and trust decisions
  belong below the WebView.
- Independent Rust implementations: rejected as duplicate policy.

### Consequences

The package becomes a canonical consumer of generated protobuf. Both apps must
upgrade it together when the contract changes.

## CCP-D05: Station-Root Consent For Public Direct Entries

**Status**: accepted
**Date**: 2026-10-17

### Context

A reachable Station address is not evidence that its operator wants global
publication.

### Decision

A Direct Station entry references the peer-domain public consent contract owned
by Node Connectivity. The publisher verifies consent and live endpoint
discovery through that owner's verifier before inclusion. Public bootstrap
material contains no connection grant or enrollment secret.

### Rationale

Publication becomes an explicit operator act and cannot be inferred from
network reachability.

### Alternatives Considered

- Repository maintainer assertion only: rejected because it does not prove
  Station owner consent.
- Federation discovery visibility: rejected because Federation membership and
  ordinary Station access have different owners.

### Consequences

Station operator tooling needs an upstream advertisement export capability.
Expiry makes a suggestion non-actionable even inside a longer-lived snapshot.
Withdrawal prevents republication; clients learn it on refresh, bounded by the
signed lifetime. It does not revoke existing client Station bindings.

## CCP-D06: Preserve User-Owned Station State

**Status**: accepted
**Date**: 2026-10-17

### Context

Remote catalog churn must not delete a Station selected or verified by a user.

### Decision

Snapshot replacement owns only cloud suggestions and release projections.
Verified registry entries, active binding, Sessions, local hide state, and
manually added inputs remain client-owned.

### Rationale

Control-plane availability and policy changes must not become destructive local
state transitions.

### Alternatives Considered

- Mirror the catalog exactly into the registry: rejected because removal would
  become remote deletion.

### Consequences

Stale verified entries remain until the user removes them or signed Station
identity/revocation rules reject them.

## CCP-D09: API-Only Initial Evidence

**Status**: accepted
**Date**: 2026-10-17

### Context

The requested initial closure excludes Desktop/Mobile app Acceptance.

### Decision

Initial X Config evidence covers source checks, protobuf compatibility,
client-kernel contracts, admin API and artifact identity. Relay/Station API,
persistence, Circuit and restart proof remains under Node Connectivity.
Focused console browser evidence is separate from native app Acceptance.

### Rationale

This proves the requested infrastructure and integration boundaries without
claiming an app Journey that was not run.

### Alternatives Considered

- Treat unit tests as full product proof: rejected.
- Launch native apps despite the requested scope: rejected.

### Consequences

A later product release may still require native Station selector evidence.

## CCP-D10: Deploy Only When Control Data Changes

**Status**: superseded by XCFG-D02
**Date**: 2026-10-17

### Context

The Hobby team has ample runtime quota, but the repository already drives
multiple builds per source commit. The config artifact changes much less often
than application source.

### Decision

Console edits create only typed data commits. Data pushes may trigger
credential-free validation, never signing. A publication request is signed only
after trusted operator admission against its exact revision/digest. Console
code deploys independently; unrelated monorepo commits do not deploy either
project. A project Skill owns deterministic publication and recovery.

### Rationale

This avoids unrelated build usage and binds deployment to an exact signed
artifact.

### Alternatives Considered

- Connect another always-on monorepo Git build: rejected as unnecessary build
  amplification.
- Serve from the official-site project: rejected because it couples release
  ownership and rollback between unrelated applications.

### Consequences

Publication needs an explicit reviewed source transition and exact artifact
verification. Console and workflow availability add operational dependencies,
but unrelated repository commits do not spend control-plane build quota.

## CCP-D11: Consume Upstream Connection Material

**Status**: accepted
**Date**: 2026-10-17

### Context

Home and personal Stations may be addressed by IP and may not possess a
publicly trusted certificate. Current production clients reject remote HTTP
before they can verify the signed Station discovery response.

### Decision

Cloud seeds reference the accepted Model peer connection contract in
[Node Connectivity](../../runtime/node-connectivity/bootstrap-connection-material.md).
That owner defines CA/SPKI and authenticated expected identity; Station Access
consumes it for discovery and binding.

Production HTTP bootstrap requires an expected identity authenticated before
the request. Bare manual remote HTTP remains rejected. Business traffic uses
the canonical secure route; cloud data cannot choose another TLS policy.

### Rationale

Cryptographic Station identity and route proof can secure bootstrap without
requiring every personal IP endpoint to obtain a public DNS certificate.

### Alternatives Considered

- Require public domains and WebPKI for every Station: rejected because it
  excludes legitimate IP and private-network deployments.
- Disable TLS certificate verification for self-signed origins: rejected
  because it creates an unauthenticated business transport.
- Allow ordinary HTTP business APIs: rejected because signatures do not provide
  payload confidentiality or Session credential protection.

### Consequences

The owner contract needs generation and cross-client proof before
support is advertised. X Config cannot implement a private verifier or
amend the production origin policy by itself.

## CCP-D12: Admin Cannot Authorize Production Signing

**Status**: superseded by XCFG-D02
**Date**: 2026-10-17

### Context

An operator console is required, but placing GitHub App, deployment, and
snapshot signing credentials in the browser or one Vercel Function would
collapse audit and trust boundaries.

### Decision

The console App is installed only on a data-only `x-config-data` repository.
Its permission is repository-wide; an API path/ref allowlist is not a security
boundary against compromise. No code/workflow/ledger repository is installed.

The console saves draft content and a publication request. Trusted publication
runs pinned code outside Vercel, accepts an exact immutable commit/digest only
after external operator review, commits immutable statement bytes and sequence
to a signer-owned ledger, signs, verifies a preview, and then promotes.
No data push or admin-held credential can admit signing or deploy distribution.

An admitted renewal policy lets the trusted scheduled publisher reissue only
the same approved content with new sequence/time bounds. It cannot incorporate
new drafts or extend Station consent. Changes to content, target, signing key
or renewal policy require new approval.

The baseline uses independent trusted operator dispatch and does not assume
paid private-repository branch protection. If protection is available, it is
additional enforcement and the console App has no bypass.

### Rationale

Draft Git history supplies source/audit. Independent admission and signer state
prevent an admin compromise from turning a malicious draft into trusted bytes.

### Alternatives Considered

- Store mutable production config in Vercel Global Config: rejected because
  source review and artifact identity become secondary.
- Put the signing key in Vercel environment variables: rejected because admin
  runtime compromise would become publisher compromise.
- Give the browser a GitHub token or signing key: rejected because browser
  storage and extension compromise would expose mutation authority.
- Auto-sign every admin commit: rejected because it preserves indirect signing
  authority even if the key lives in CI.

### Consequences

Content changes have explicit approval waiting; unchanged approved content can
renew automatically under its bounded policy.
Signer keys/ledger/dispatch credentials are absent from Vercel. Failed attempts
reserve their sequence; retry reuses exact bytes. Preview verification precedes
production promotion. Account compromise outside Vercel remains a separate
trust boundary.

## CCP-D13: Reuse Narrow Go Infrastructure And OAuth Ownership

**Status**: superseded by XCFG-D02
**Date**: 2026-10-18

### Context

OAuth Broker already implements GitHub App authentication, token caching and
optimistic Git Data transactions in Go. Its existing identity assertion is
bound to Station login or connector linking, not X Config console login.

### Decision

Use React/Vite with the existing Peers UI system for the console and Go Vercel
Functions for admin/publisher code. Extract only App authentication and bounded
immutable-read/CAS mechanics into a neutral shared Go package; migrate the
OAuth adapter to that package in the same cut. OAuth record encryption, paths,
identity policy and domain errors stay with OAuth.

Operator sign-in requires the OAuth-owner
[audience-bound login contract](../../../domains/identity/oauth-login-broker/operator-login.md).
Do not reinterpret an account-login assertion or share a Station bridge secret.

### Rationale

Reuse infrastructure while retaining separate service trust and business
owners. Do not write a second provider callback flow or Station verifier.

### Alternatives Considered

- Reimplement GitHub App/CAS in TypeScript: rejected as duplicate infrastructure.
- Import Go `internal` packages across apps: rejected by language and ownership
  boundaries.
- Use OAuth's encrypted store as the catalog store: rejected as domain coupling.

### Consequences

The implementation needs one bounded shared-package extraction, OAuth contract
amendment and regression proof. Go selection is a source-reuse choice, not a
claim that TypeScript serverless is inherently unsuitable.

## XCFG-D01: X Config Is The Sole Active Module Identity

**Status**: accepted
**Date**: 2026-10-19

### Context

The previous name was an implementation-oriented description, not the accepted
product identity. It was repeated across source paths, protobuf packages and
message names, signature domains, client persistence keys, deployment tooling,
Acceptance contracts, OAuth bindings, and Vercel resource names. A display-only
alias would create two active names for one capability.

The current branch has not delivered this module to released clients. The two
Vercel projects exist but have no deployments, so there is no production
compatibility requirement for the old identifiers.

### Decision

`X Config` is the sole human-facing name and `x-config` is the canonical
machine identifier. Language-specific forms are:

- paths, package names and cloud resources: `x-config`;
- protobuf, Rust modules and internal keys: `x_config`;
- exported types: `XConfig`;
- environment prefixes: `X_CONFIG`.

The cut is atomic across active source, generated outputs, clients, tests,
Acceptance, documentation, skills, OAuth site/audience bindings and Vercel
projects. The protobuf field numbers and semantics remain unchanged, but the
protobuf package/message names and signature domain move to X Config. Existing
development snapshots, secure watermarks and caches are not migrated or
dual-read; they are regenerated from the new contract.

Frozen Plan Versions remain immutable historical evidence and may retain their
original identifiers. They are not active aliases or runtime compatibility
contracts.

### Rationale

One canonical identity keeps source discovery, deployment automation, evidence
and product language aligned. The absence of released consumers makes a clean
cut safer than retaining aliases, signature compatibility, dual cache keys or
two cloud project families.

### Alternatives Considered

- Rename only visible copy: rejected because active source, deployment and
  evidence would continue to use a second name.
- Preserve the old signature domain and storage keys: rejected because it
  creates permanent protocol and persistence aliases without a compatibility
  requirement.
- Run old and new Vercel projects in parallel: rejected because both existing
  projects are empty and can be renamed before first deployment.

### Consequences

The cut invalidates development snapshots and local X Config cache state.
Clients retain verified Station entries, active bindings and Sessions because
those remain owned by Station Access. OAuth operator sessions are reissued
under the new site and audience. Preview deployment and exact readback must
pass before any Production promotion; Production promotion remains separately
authorized.

## XCFG-D02: One Service And Shared Prefixed Repository

**Status**: superseded by XCFG-D03
**Date**: 2026-10-19

### Context

The original architecture separated console, external approval, publisher,
ledger, data repository, and static distribution. That boundary is appropriate
for multiple operators and independent production authority, but it creates
unnecessary services, repositories, credentials, and recovery states for the
current single-user Preview.

The human owner explicitly accepts that compromise of the X Config service can
sign and publish, and requires configuration and publication to work without a
separate approval or serial-ledger service.

### Decision

Use one Vercel project named `peers-x-config`. The service:

- authenticates the single allowlisted operator through the existing OAuth
  broker;
- writes the existing OAuth storage repository only under `x-config/`;
- saves typed drafts with repository-head CAS;
- reads the current publication sequence inside the same CAS snapshot;
- builds and signs the next statement;
- atomically stores publication metadata and exact envelope bytes;
- serves those persisted bytes from latest and immutable public endpoints.

Reuse the existing selected-repository GitHub App installation. Do not create a
separate X Config App, data repository, ledger repository, publisher process,
approval service, or distribution project.

The env repository is the only deployment truth. The application repository
contains adapters and validation, not placement decisions.

### Rationale

One Git transaction provides the required sequence and byte consistency without
a second authority or database. Prefix ownership avoids domain collisions in
the shared repository. The design is proportionate to one operator and removes
all partial states between request, approval, signing, upload, and promotion.

### Alternatives Considered

- Keep the independent approval/ledger/distribution design: rejected as
  disproportionate for one operator.
- Add a second GitHub App but share the repository: rejected because it adds
  credential lifecycle without creating path-level security isolation.
- Keep separate repositories but collapse Vercel projects: rejected because it
  retains unnecessary cross-repository CAS and recovery.
- Store sequence in Vercel memory or mutable config: rejected because it is not
  durable or atomic with signed bytes.

### Consequences

The X Config runtime holds the signing private key and repository write
credential. Runtime compromise can publish a valid snapshot. Git history,
client monotonic watermarks, key rotation, exact-byte readback, and Preview
verification remain defenses, but they do not recreate independent approval.

Production promotion remains separately authorized. If multi-operator
separation becomes a real requirement, it requires a new accepted architecture
decision rather than reviving deleted compatibility paths.

## XCFG-D03: Home Runtime Separates Operator State From Publication Truth

**Status**: accepted
**Date**: 2026-10-20

### Context

X Config now runs as one long-lived Home service behind the HTTPS edge
declared by the environment repository. The OAuth Broker already owns provider
callback, state, PKCE, identity normalization, and the audience-bound one-time
handoff.
X Config owns only receiver binding, subject authorization, CSRF, and its
application session.

The previous Vercel design selected one GitHub storage driver for both catalog
publication and operator authentication. In the Home runtime this makes login
attempts, assertion consumption, session creation, session readback, and
revocation remote Git transactions. It couples short-lived online
authentication state to the repository CAS needed for durable publication and
adds remote commits to every sign-in without strengthening the OAuth protocol.

### Decision

Home is the sole target X Config runtime. The existing OAuth Broker contract is
retained unchanged: X Config does not implement provider callbacks, PKCE,
provider token exchange, or provider identity normalization.

X Config uses two persistence owners:

- GitHub CAS remains the sole truth for catalogs, publication sequence,
  publication metadata, and exact signed snapshot bytes.
- A Home-local SQLite database is the sole truth for login attempts, consumed
  assertion identities, operator sessions, CSRF digests, expiry, and
  revocation.

The operator database lives on a dedicated persistent Home volume. Production
startup requires an explicit SQLite path and fails closed if the database,
schema, permissions, or record-encryption key is unavailable. There is no
production memory fallback and no GitHub-backed operator store.

Login completion uses one local transaction after Broker redemption: it
verifies that the attempt is current and unconsumed, records attempt and
assertion consumption, and creates the session atomically. Session
authentication and logout read or mutate only that database. Expired state is
cleaned without making any token, attempt, or assertion reusable.

Only one active X Config process may own the Home database. Database loss
invalidates operator login state and requires sign-in again; it never affects
catalogs or signed publications and is not restored from stale backups.

### Rationale

OAuth ownership stays with the mature Broker flow while application sessions
remain owned by the relying service. SQLite provides local ACID transactions
and restart durability for a single Home process. GitHub remains where history,
review, sequence CAS, and exact-byte publication are product requirements,
rather than serving as an online session database.

### Alternatives Considered

- Seal the receiver verifier into a browser cookie: rejected because it moves
  replay and lifecycle state into a custom browser protocol and does not supply
  durable revocation.
- Merge or cache GitHub authentication writes: rejected because it retains the
  wrong persistence owner and turns latency into an implementation tuning
  problem.
- Reuse the Broker session or Station session: rejected because provider
  authentication, X Config authorization, and Station identity have distinct
  audiences and owners.
- Import the Station session facility: rejected because X Config is not a
  Station subserver and also needs atomic attempt and assertion consumption.
- Add a remote managed database for X Config: rejected for the current
  single-process Home scope; reconsider only if multi-instance availability is
  accepted later.

### Consequences

The catalog and public snapshot paths retain Git history and CAS behavior.
Operator sign-in and authenticated API reads no longer depend on X Config
GitHub mutations. The Home runtime gains one persistent volume, schema
migration boundary, bounded SQLite lock policy, cleanup policy, and exact-source
restart proof.

The former Vercel X Config runtime is not a supported parallel path. Rollback is
a versioned Home deployment or VCS revert, not a storage toggle. OAuth Broker
latency remains owned and measured separately by the Identity domain; changing
its `OAuthStore` adapter does not belong to this decision.

## XCFG-D04: Closed Per-Key Directive Sections Evaluated Client-Side

**Status**: accepted
**Date**: 2026-10-23

### Context

Operators need to publish client defaults that vary by audience, region, and
build — for example the default relay or default seed Station for a dedicated
distribution build. CCP-D03 deliberately chose closed protobuf sections over a
generic remote-config map. Targeted defaults must not reopen that decision.

The catalog already carries two locally-evaluated dimensions: endpoint seeds
are tagged with regions, and releases are matched client-side by platform,
architecture, and semantic version. Public snapshot serving is anonymous,
cache-friendly, and free of per-request client attributes.

### Decision

Add a new closed catalog section, `directives`, governed by a curated key
registry. A directive is one registered key, an ordered list of rules, and a
required fallback. A rule matches a targeting context (product, platform,
architecture, flavor, channel, environment, regions, semantic-version
constraints, named labels) with AND across fields and OR within repeated
fields; the first matching rule wins, otherwise the fallback applies. A stable
HMAC permille bucket on the client's existing stable identity supports staged
rollout without sending a new identifier.

Directive values are a closed `oneof` (`string_value`, `bool_value`,
`int_value`, `endpoint_seed_id`). `endpoint_seed_id` must reference an
endpoint seed in the same snapshot, and the key registry constrains which seed
kind is admissible. Initial registered keys are `network.default_relay`
(relay seed only) and `network.default_station` (direct-station seed only).
Secrets are never directive values: snapshots are broadcast to all subscribers.

Evaluation happens client-side against the signed snapshot, following the
release-selection precedent. The service never renders per-client responses
and adds no client-attribute endpoint. Stale persisted snapshots remain usable
as last-known-good; consumers must mark results stale and prefer explicit local
configuration. Directives are added as a new protobuf field on the existing
snapshot message and catalog; `schema_version` stays `1` and the proto package
name is unchanged. No release exists yet and protobuf field additions are
ignored by older generated clients, so no schema bump, hard cut, or dual
publication is warranted. Operator validation rejects unknown keys, value-type
mismatches, dangling or wrong-kind seed references, duplicate rule IDs,
missing fallbacks, unregistered flavors, oversize directives, and (as
warnings) unreachable shadowed rules.

The Rust and Go evaluators must agree on one shared JSON conformance-vector
suite; the vectors are the only semantic source of truth.

### Rationale

Signed whole-snapshot distribution preserves offline use, CDN caching, and the
zero-request-metadata privacy posture. A per-key ordered-rules model with
mandatory fallback is the industry-standard shape (LaunchDarkly/Statsig/Unleash
mobile SDKs): bounded, auditable, and testable, while the curated registry keeps
CCP-D03's closed-section guarantee.

### Alternatives Considered

- Server-side evaluation keyed by region/version headers: rejected because it
  creates a tracking endpoint, breaks offline evaluation, and forks the trust
  model.
- Open string KV remote config: rejected by CCP-D03; untyped keys cannot be
  validated or safely consumed.
- Flat global priority instead of ordered per-key rules: rejected because it
  cannot express fallback guarantees or rule-order overrides per concern.
- Geo-IP region detection: rejected for the initial model; region comes from
  the build or explicit operator/user setting, defaulting to `unknown` which
  matches only global rules. Revisit requires a separate privacy review.

### Consequences

Clients gain a targeting context assembled from build identity and runtime
context. Endpoint defaults are resolved seed IDs that flow through the existing
discovery path; no parallel connection channel is introduced. Station (Go)
needs its own snapshot fetch/verify/evaluate implementation in
`apps/station/frame/touch/xcontrol`, semantically locked to the shared vectors.

## XCFG-D05: One Distribution Flavor Registry Drives Build Identity And OS Install Identity

**Status**: accepted
**Date**: 2026-10-23

### Context

Dedicated builds (geek audience builds, partner builds, internal dev builds)
need a baked distribution identity for directive targeting, and some builds
must install side-by-side on the same machine. Today the desktop dev-install
path hard-codes one identifier, display name, and URL scheme, and no package
target exists.

### Decision

Introduce one checked-in registry, `tooling/distribution/flavors.json`, as the
single source for distribution identity. Each flavor declares a display name,
optional identifier suffix, URL-scheme suffix, default channel, default region,
and an allowlist of distribution labels. All distribution builds run through
`make package PRODUCT=… FLAVOR=…`, which fails closed on unknown flavors or
labels.

One build manifest is produced and projected to three places:

1. Compile-time distribution environment consumed by a shared Rust
   `BuildIdentity` in x-config-core (and a Go embed for Station): product,
   flavor, channel, semver, source commit, platform, architecture, default
   region, labels.
2. Platform metadata via Tauri `--config` overrides: identifier, product name,
   version, Android version code, deep-link scheme, and release channel path.
3. A sidecar `build-manifest.json` inside the bundle for diagnostics; the
   compile-time copy remains authoritative at runtime.

Identifier mapping is fixed: `com.peers.touch.{product}` plus
`.{identifier_suffix}` when present. The `geek` flavor occupies the canonical
suffix-less identifier; partner flavors use their suffix and therefore install
side-by-side, with isolated data containers, distinct URL schemes
(`peers-touch[-suffix]`), and distinct update channels. Flavors sharing the
canonical identifier are mutually exclusive installs. Build number is
`git rev-list --count HEAD` mapped into each platform's numeric version field.

Packaging is one local command (`make package`) for every audience: internal
and formal builds run the identical script and differ only in parameters. The
build never uploads; distributing the produced artifact (internal file share
versus a formal GitHub Release) is a separate manual step outside packaging.
Artifact file names carry only platform-mandated segments; commit/region never
appear in file names. A remote artifact directory layout is deferred until the
formal updater channel is actually built.

### Rationale

A registry makes the coexistence topology explicit and impossible to bypass via
ad-hoc command-line values. Reusing the existing Tauri override and build.rs
`rustc-env` mechanisms avoids a parallel packaging system. Keeping identity out
of artifact file names respects OS install semantics and updater contracts.

### Alternatives Considered

- Encode the full identity string in the artifact file name: rejected because
  installed runtimes cannot read installer names and OS version grammars reject
  the string.
- One identifier for all flavors: rejected for partner builds that must coexist
  with the public build.
- Separate packaging scripts per client: rejected as a chimney; desktop and
  mobile share the registry, manifest, and override generator.

### Consequences

The legacy hard-coded dev identity becomes a registered `dev` flavor. The
committed `.dev2` identifier is a development-only artifact; distribution
builds derive canonical identifiers from the registry. Deep-link schemes and
update endpoints are flavor-scoped, and each mobile suffix requires its own
platform App ID / push topic when push is enabled.

## XCFG-D06: Baked Bootstrap Origins With Signed Snapshot-Driven Origin Failover And Migration

**Status**: accepted
**Date**: 2026-10-24

### Context

`PT_DIST_*` bakes flavor/channel identity (XCFG-D05) but packages bake no
snapshot origin: client resolution reads only runtime/compile-time
`PEERS_X_CONFIG_URL`, so an installed app with no process environment never
fetches (`verified_fact`: `configured_remote_url` in Desktop and Mobile
runtimes). The same channel also serves a single origin today: an operator
cannot stand up a mirror or move the service without an app release, and a
single origin outage leaves clients on stale snapshots.

Snapshots are already integrity-protected independently of transport:
ed25519 over a domain-separated statement, verified against the app-embedded
publisher keyring, with monotonic-sequence watermark protection
(`verified_fact`: x-config-core `SnapshotCoordinator`). Origin admission
follows the closed policy in x-config-core `origin.rs`: HTTPS for any host,
plain HTTP only for loopback/RFC1918/link-local IP literals (IPv6 loopback
only).

### Decision

**Bootstrap origins are baked per channel at package time.** A checked-in
channel registry (`tooling/distribution/channels.json`) maps each channel to
an ordered bootstrap origin list. `make package` fails closed on unknown
channels and bakes the list as `PT_DIST_X_CONFIG_URLS`; the compiled list
ships in the manifest, `BuildIdentity`, and bundle diagnostics.

**Signed snapshots carry future fetch origins.** Statement field 9 is an
additive closed section:

```proto
message DistributionConfig { repeated DistributionOrigin origins = 1; }
message DistributionOrigin { string origin = 1; }
// XConfigSnapshotStatement.distribution = 9
```

No schema/version bump: older clients ignore field 9. Catalog publication
validates origins against the client admission policy (same rules as
`origin.rs`, independent of the publisher's own deployment flag), caps the
list, rejects duplicates/query/fragment/credentials, and emits the section in
deterministic statement order.

**The client maintains three origin classes, merged per refresh into one
ordered fetch list (deduplicated preserving first occurrence, capped at 8):**

1. the development override `PEERS_X_CONFIG_URL` (runtime then compile
   time), first in order when present — an explicit local choice always
   wins;
2. operator-advertised origins from the last accepted, signed snapshot
   itself (the snapshot cache is the channel-scoped persistence, updated
   only through `accept_remote`; at most 4 per snapshot);
3. baked bootstrap origins, always retained as tail anchors.

Each entry passes the same admission validation (`origin.rs`). Refresh tries
entries in order: transport, timeout, non-2xx, and oversize responses advance
to the next origin; a cryptographic or watermark rejection on one response
also advances to the next origin but never downgrades the current snapshot.
The first accepted outcome wins; its origin is the active origin exposed in
the projection (`active_origin` / `activeOrigin`). A `304` is success when a
current snapshot exists; without one the same origin is refetched
unconditionally before advancing.

### Rationale

Baked origins solve the packaged-app bootstrap without inventing a runtime
config channel. Letting signed snapshots mutate the fetch set gives operators
mirrors and zero-release migration; trusting it is safe because transport
choice grants no trust — only keyring-validated, watermark-monotonic bytes are
accepted, so a hostile origin without the publisher key gains nothing. Keeping
baked origins pinned at the tail guarantees an operator-controlled recovery
path even if a snapshot advertises an unreachable set. The explicit
development override stays first so local/test work always pins the fetch
target despite whatever a production snapshot advertises; advertised
origins precede only the baked anchors, giving operators zero-release
failover and migration over the package defaults.

### Alternatives Considered

- Runtime-only `PEERS_X_CONFIG_URL` with baked channel but no origin:
  rejected; installed apps have no such environment and cannot bootstrap.
- DNS-based stable name for every channel: rejected for corp channels whose
  origin is a private IP literal, and it still offers no multi-origin failover.
- Signed snapshots may also rotate publisher keys: rejected; publisher trust
  must ship in an app release (XCFG-D01/CCP-era key-rotation rule). Origins
  ride on existing publisher trust and do not extend it.
- Drop baked origins after the first snapshot: rejected; a poisoned snapshot
  set could strand clients with no operator-reachable anchor.
- Unordered origin set: rejected; operators need deterministic primary/mirror
  selection rather than client-chosen randomness.

### Consequences

- Fresh packages fetch without any process environment; the dev override
  remains the highest-priority entry for local work.
- Operators publish mirrors/new origins through the normal signed-catalog
  path (same skill as seed refresh); clients adopt them on the next accepted
  snapshot and retain them across restarts.
- Persisted advertised origins are control-plane state; clients store only
  validated origin strings with channel scoping and never accept unsigned
  origin updates.
- Mirror operators must serve the exact same signed envelopes (same sequence
  and statement bytes); divergent valid histories at one channel remain
  impossible under one key.
- Up to a bounded number of origins per refresh round; latency on dead
  origins is bounded per-entry, and bootstrap lists should stay short.
