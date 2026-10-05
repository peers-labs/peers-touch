# OAuth Login Broker - Design Decisions

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| OLB-D01 | Durable store is mandatory on Vercel | accepted |
| OLB-D02 | All records use versioned AES-256-GCM envelopes | accepted |
| OLB-D03 | Raw code and raw state are never persisted | accepted |
| OLB-D04 | Git Data commits are the callback transaction boundary | accepted |
| OLB-D05 | Provider gateways return refreshable token sets | accepted |
| OLB-D06 | Administration is authenticated and read-only | accepted |
| OLB-D07 | Domain ports isolate the GitHub backend | accepted |
| OLB-D08 | Provider-supported PKCE is mandatory | accepted |
| OLB-D09 | Redirects are restricted to site-owned destinations | accepted |
| OLB-D10 | Audit paths are chronologically sortable | accepted |
| OLB-D11 | Native loopback uses one explicit callback template | accepted |
| OLB-D12 | Broker assertions use one versioned canonical signature | accepted |
| OLB-D13 | Station verifies before Desktop activates local identity | accepted |
| OLB-D14 | Missing provider email never implies account linking | accepted |
| OLB-D15 | Refresh is claimed durably before provider rotation | accepted |
| OLB-D16 | Native bridge assertions are purpose-bound and one-time | accepted |
| OLB-D17 | Broker login reuses the Station OAuth candidate lifecycle | accepted |

## OLB-D01: Durable Store Is Mandatory On Vercel

**Status**: accepted

**Date**: 2026-09-30

### Context

Vercel functions may not reuse one process between start and callback.

### Decision

Vercel startup fails unless `OAUTH_STORAGE_DRIVER=github` is fully configured.
The memory adapter remains available only outside Vercel for tests and local
development.

### Rationale

An implicit production memory fallback turns valid OAuth callbacks into random
state failures.

### Alternatives Considered

- Keep memory as a fallback: rejected as nondeterministic.
- Require Redis immediately: rejected for the current single-operator scope.

### Consequences

Deployment requires GitHub App and encryption environment variables before it
becomes healthy.

## OLB-D02: All Records Use Versioned AES-256-GCM Envelopes

**Status**: accepted

**Date**: 2026-09-30

### Context

Private Git history retains old blobs and may contain identity PII, verifier
material, and provider credentials.

### Decision

Encrypt transaction, identity, credential, and audit payloads with AES-256-GCM.
Each envelope records version, key ID, algorithm, nonce, ciphertext, and update
time. The version, key ID, algorithm, update time, repository path, and record
kind are associated data.

### Rationale

Repository privacy controls access but does not replace record-level
confidentiality or integrity.

### Alternatives Considered

- Encrypt only credentials: rejected because transaction verifier and identity
  records are also sensitive.
- Store plaintext in a private repository: rejected.

### Consequences

Backups and history hold ciphertext. Old keys must remain available until the
explicit maintenance rotation has rewritten every live record.

## OLB-D03: Raw Code And Raw State Are Never Persisted

**Status**: accepted

**Date**: 2026-09-30

### Context

The authorization code is one-time exchange material; state is a bearer
correlation secret.

### Decision

Authorization code remains request-local. State is used only to calculate a
keyed storage fingerprint. Audit may retain a separate keyed code fingerprint.

### Rationale

Token refresh requires refresh tokens, not historical authorization codes.
Persisting codes adds exposure without a recovery benefit.

### Alternatives Considered

- Encrypt and retain authorization codes: rejected because replay is not a
  valid recovery path.
- Use a plain SHA-256 state path: rejected because low-entropy implementation
  mistakes would become enumerable.

### Consequences

If exchange succeeds but durable completion fails, the user must start a new
login.

## OLB-D04: Git Data Commits Are The Callback Transaction Boundary

**Status**: accepted

**Date**: 2026-09-30

### Context

The callback must consume state, upsert identity, replace credentials, and
append audit without partial success.

### Decision

Create all blobs and one tree/commit, then move the configured branch ref with
`force=false`. Retry bounded non-fast-forward conflicts from a new head.

### Rationale

Independent Contents API writes would expose partially completed callbacks.

### Alternatives Considered

- One commit per record: rejected due partial state.
- Force-update the branch: rejected due lost updates.

### Consequences

Each mutation uses several GitHub API calls and is suitable only for the
accepted low-volume operating scope. Completion records retain a stable
idempotency key so a retry after a lost branch-update response converges.

## OLB-D05: Provider Gateways Return Refreshable Token Sets

**Status**: accepted

**Date**: 2026-09-30

### Context

Before the durable broker cutover, provider adapters discarded refresh token,
expiry, type, and scope.

### Decision

Exchange returns identity plus a normalized token set. Each provider implements
refresh. A refresh response that omits a refresh token retains the existing
one.

### Rationale

Refresh behavior belongs to provider adapters while persistence and atomic
replacement belong to the application/store boundary.

### Alternatives Considered

- Persist only access tokens: rejected because sessions cannot outlive access
  expiry.
- Put refresh logic in GitHub storage: rejected as a dependency inversion.

### Consequences

The service stores provider credentials but does not expose a public token API
in this release.

## OLB-D06: Administration Is Authenticated And Read-Only

**Status**: accepted

**Date**: 2026-09-30

### Context

One operator needs operational visibility without a full identity platform.

### Decision

Use HTTPS Basic auth backed by an environment username and PBKDF2-SHA256
password verifier. Expose only GET routes and sanitized projections.

### Rationale

This is sufficient for the accepted private, single-operator deployment and
keeps mutation out of browser reach.

### Alternatives Considered

- Build RBAC and sessions: deferred until multi-operator use exists.
- Display decrypted tokens: rejected.

### Consequences

Credential rotation and record repair remain deployment operations, not UI
actions.

## OLB-D07: Domain Ports Isolate The GitHub Backend

**Status**: accepted

**Date**: 2026-09-30

### Context

GitHub is a temporary persistence choice and must not shape OAuth use cases.

### Decision

Application code depends on one cohesive OAuth Store port with domain methods.
Memory and GitHub implementations satisfy the same interface.

### Rationale

A cohesive completion method preserves transaction semantics better than
exposing file or commit primitives to use cases.

### Alternatives Considered

- Expose GitHub client methods to use cases: rejected.
- Split four repositories without a unit-of-work boundary: rejected for
  callback atomicity.

### Consequences

A future database adapter must preserve the same idempotency and atomic
completion semantics.

## OLB-D08: Provider-Supported PKCE Is Mandatory

**Status**: accepted

**Date**: 2026-09-30

### Context

Before this decision was implemented, the service created a verifier but did
not use it.

### Decision

GitHub and Google authorization use S256 challenge and exchange uses the stored
verifier. Weixin remains on its supported provider-specific flow.

### Rationale

Generating but ignoring a verifier provides no interception protection.

### Alternatives Considered

- Remove the verifier: rejected.
- Send PKCE fields to Weixin without provider support: rejected.

### Consequences

Provider fixture tests must assert challenge and verifier behavior.

## OLB-D09: Redirects Are Restricted To Site-Owned Destinations

**Status**: accepted

**Date**: 2026-09-30

### Context

Before this decision was implemented, the start endpoint accepted any HTTP(S)
`return_to`, callback errors used callback-supplied `site_id`, and bridge
signing was optional.

### Decision

Each site declares exact allowed return destinations by normalized scheme,
authority, and path. Unapproved values fall back to `success_url`. Callback
errors derive their site from the stored transaction, never query input.
Vercel requires a bridge secret for every site and raw state is never reflected
in redirects or response bodies.

### Rationale

Provider identity and state must not be redirected to an attacker-controlled
origin or emitted unsigned in production.

### Alternatives Considered

- Preserve arbitrary HTTP(S) redirects: rejected as an exfiltration boundary.
- Trust callback `site_id`: rejected because it is unauthenticated input.
- Make production signing optional: rejected.

### Consequences

Deployments using custom schemes must add their callback destination to the
site allowlist before rollout.

## OLB-D10: Audit Paths Are Chronologically Sortable

**Status**: accepted

**Date**: 2026-10-01

### Context

The operator contract returns the newest bounded audit events and applies the
limit before fetching encrypted blobs. A month bucket followed only by an HMAC
event ID cannot order events within the same month.

### Decision

Prefix each audit filename with its fixed-width UTC occurrence timestamp and
retain the HMAC event ID as the opaque uniqueness suffix. Failure-event
fingerprints include the occurrence timestamp so distinct failed requests do
not reuse one event ID. Descending path order must therefore match descending
`occurred_at` order before any blob is fetched.

### Rationale

This preserves one append-only audit record tree and makes bounded readback
correct without introducing a separate index or reading an unbounded month.

### Alternatives Considered

- Read every event in the newest month before sorting: rejected because one
  active month becomes an unbounded read.
- Add a separate time index: rejected because it creates another atomic record
  and source of truth.
- Keep HMAC-only names and return an arbitrary bounded subset: rejected because
  it violates the accepted recent-event operator contract.

### Consequences

Repository readers can infer the exact UTC occurrence time from an audit path,
in addition to the already exposed record class and month. Event identity,
state, provider subject, codes, tokens, and payload fields remain opaque or
encrypted. HMAC-only legacy audit paths are rejected before blob reads; this is
a hard cut, so a repository containing that pre-release layout requires a
separately authorized migration or a fresh data branch before rollout.

## OLB-D11: Native Loopback Uses One Explicit Callback Template

**Status**: accepted

**Date**: 2026-10-01

### Context

Desktop already owns a run-scoped loopback listener, but the broker's exact
allowlist only accepts a custom-scheme callback. The random loopback port is
therefore discarded and the caller waits until timeout.

### Decision

Use loopback as the sole native Desktop callback transport. A site may opt in
with `http://127.0.0.1/callback`; this template accepts only a literal IPv4
loopback host, a non-zero ephemeral port, fixed path, no userinfo, and no
fragment. Other destinations retain exact normalized matching.

### Rationale

Loopback works for local development and packaged Desktop without depending on
OS custom-scheme registration while preserving a narrow, reviewable trust
boundary.

### Alternatives Considered

- Restore custom-scheme deep links: rejected because development and packaged
  registration behavior differs by platform.
- Allow arbitrary localhost URLs: rejected as an identity exfiltration path.

### Consequences

Deployments must opt in explicitly. Browser-only Desktop cannot claim native
account-login support.

## OLB-D12: Broker Assertions Use One Versioned Canonical Signature

**Status**: accepted

**Date**: 2026-10-01

### Context

The broker signs sorted URL-encoded callback fields while Station verifies a
four-field colon-delimited string, so legitimate callbacks cannot pass.

### Decision

`bridge_version=v1` defines one sorted URL-encoded canonical field set shared
by broker tests, the protobuf contract, Desktop forwarding, and Station
verification. Station rejects missing secrets, unsupported versions, stale
timestamps, malformed signatures, and any field modification.

### Rationale

One canonical message eliminates independently reconstructed security
contracts and makes interoperability testable.

### Alternatives Considered

- Retain the legacy four-field signature: rejected because it omits material
  identity fields.
- Verify in Desktop: rejected because a public client cannot custody the
  shared signing secret.

### Consequences

The bridge protobuf expands before consumers, and broker and Station contract
tests must use the same vectors.

## OLB-D13: Station Verifies Before Desktop Activates Local Identity

**Status**: accepted

**Date**: 2026-10-01

### Context

Desktop currently persists an active connection before bridge success and
swallows bridge failure. The login command also requires an actor that cannot
exist for a logged-out user.

### Decision

Account login and connector linking are explicit loopback intents. Login starts
without a local actor, calls the public verified Station bridge, and persists
the returned local account/session only after success. Connector linking
requires an existing actor and uses an authenticated Station verification path
that does not issue or replace a login session.

Desktop stages the prior account, session, and connector projections while
applying the verified result. Any local persistence failure restores those
snapshots instead of publishing a partially active identity.

### Rationale

Station remains the sole session authority and local state cannot advertise an
unverified identity.

### Alternatives Considered

- Retry an unsigned connection later: rejected as fail-open authentication.
- Treat connector linking as login: rejected because the two capabilities have
  different actors and side effects.

### Consequences

The old generic callback persistence path is removed. Bridge unavailability is
a visible terminal attempt failure.

## OLB-D14: Missing Provider Email Never Implies Account Linking

**Status**: accepted

**Date**: 2026-10-01

### Context

GitHub may omit public email and Weixin does not provide email, while Station
currently requires email and uses it to find an existing actor.

### Decision

GitHub verifies profile email through `/user/emails` and, when profile email is
empty, selects a verified address while preferring primary. The broker signs
`email_verified`.
Station may match by email only when that flag is true. Otherwise it creates a
stable provider-scoped synthetic address under the reserved invalid domain and
uses the provider binding for subsequent login.

Station also normalizes provider usernames into its lowercase ASCII handle
grammar. If normalization is empty or shorter than the signup minimum, a
stable provider-and-subject hash suffix supplies the canonical handle.

### Rationale

Provider subject is the authentication identity. Missing or unverified email
must neither block supported providers nor merge unrelated accounts.

### Alternatives Considered

- Require email from every provider: rejected because valid providers omit it.
- Link using any returned email: rejected as an account-takeover risk.

### Consequences

Synthetic addresses are internal identifiers and must not be presented as a
verified user contact address.

## OLB-D15: Refresh Is Claimed Durably Before Provider Rotation

**Status**: accepted

**Date**: 2026-10-01

### Context

GitHub may invalidate both old tokens when it returns a rotated refresh token.
A crash or durable-store failure after that response can otherwise cause a
retry with the invalid old token.

### Decision

Commit a generation-bound refresh claim before the provider call. Only the
claim creator may call the provider. Commit replacement, completion marker, and
audit atomically. A retry observing an unresolved claim returns
`credential_refresh_uncertain` and requires reauthorization.

### Rationale

The broker cannot make a third-party rotating-token exchange transactional, so
it must expose uncertainty instead of risking a second destructive call.

### Alternatives Considered

- Keep optimistic replacement after the provider call: rejected because it
  cannot distinguish safe retry from token loss.
- Persist provider tokens before the call returns: impossible without provider
  transaction support.

### Consequences

Rare ambiguous failures require user reauthorization, trading availability for
credential integrity.

## OLB-D16: Native Bridge Assertions Are Purpose-Bound And One-Time

**Status**: accepted

**Date**: 2026-10-01

### Context

A valid signed callback could be replayed during its timestamp window, and the
same assertion could be submitted to either the public account-login route or
the authenticated connector-link route.

### Decision

Every native broker assertion carries a signed `purpose`, opaque
`assertion_id`, and Desktop `receiver_id`. Desktop rejects a callback whose
receiver or purpose does not match the active loopback attempt. Station
requires the route to match the signed purpose and atomically inserts a hash of
the assertion ID into its durable store before actor or session mutation. A
duplicate insert fails as `OAuth bridge assertion already consumed`. Expired
replay records are removed while consuming later assertions.

### Rationale

Timestamp validation bounds age but does not provide one-time semantics.
Purpose binding prevents a connector authorization from being upgraded into an
account-login session.

### Alternatives Considered

- An in-memory replay cache: rejected because restart and multi-instance
  Station deployments would lose the fence.
- Trusting the Desktop-selected endpoint: rejected because Desktop is not the
  assertion signer.

### Consequences

A Station failure after assertion consumption requires a fresh provider
authorization. This fail-closed recovery is preferable to issuing two sessions
from one captured callback.

## OLB-D17: Broker Login Reuses The Station OAuth Candidate Lifecycle

**Status**: accepted

**Date**: 2026-10-01

### Context

The public broker bridge currently calls `IssueTokenAndSession` directly and
checks only the legacy actor allowlist afterward. That bypasses the canonical
Access Attempt gate chain and revokes an existing session before Desktop has
durably stored the replacement. Station already has one native OAuth lifecycle
that binds an inactive candidate to an Access Attempt, seals credential
delivery for the requesting device, and activates the session only after
acknowledgement.

### Decision

Broker-backed Desktop login starts a normal Access Attempt and submits the
signed broker identity assertion as the `auth.oauth` action for its current
login gate. `/actor/oauth-bridge` delegates candidate creation, later-gate
evaluation, credential-envelope creation, status, cancellation, and
acknowledgement to the existing Station OAuth service and persistence model.

The signed receiver challenge is also the hash of the Desktop-held attempt
secret. Desktop supplies a per-attempt X25519 public key, persists the decrypted
credential and local account projections, and only then calls the existing
OAuth acknowledgement endpoint. Station keeps the candidate session revoked
until that acknowledgement atomically activates it and revokes replaced
sessions.

### Rationale

One Station-owned candidate lifecycle preserves Access Gate policy, device and
lifecycle binding, encrypted credential delivery, crash recovery, and
acknowledged session takeover for both native provider exchange and broker
identity exchange.

### Alternatives Considered

- Keep direct bridge session issuance and add more post-checks: rejected
  because it still bypasses the Access Attempt state machine and revokes the
  prior session before Desktop persistence.
- Add a second bridge-only candidate table and acknowledgement endpoint:
  rejected as duplicate session truth and protocol drift.
- Move provider tokens or the bridge secret into Desktop: rejected because a
  public client cannot own server credentials.

### Consequences

The bridge request carries Station, Access Attempt, gate, device, lifecycle,
and credential-delivery bindings in addition to the signed broker assertion.
The bridge response no longer carries an active plaintext session; it carries
the canonical OAuth candidate, Access Decision, and encrypted credential
envelope. A later actionable gate is completed against the same Access Attempt,
after which Desktop resumes the candidate and acknowledges only after durable
local persistence. Acknowledgement replay is idempotent, lost responses are
resolved by canonical status readback, and Desktop durably retains the
acknowledgement binding plus rollback snapshot until activation is confirmed.
Polling and process restart both resume that record; an unobservable outcome
does not delete the only local credential. The renderer takes its timeout from
the native receiver and sends cancellation before presenting timeout.

Station performs the same transactional expiration at startup and on a
periodic sweep, so cleanup does not depend on a later OAuth request. Expiry
revokes any unacknowledged candidate session before deleting its recoverable
envelope.
