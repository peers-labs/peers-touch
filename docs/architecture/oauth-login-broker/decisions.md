# OAuth Login Broker - Design Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
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

Backups and history hold ciphertext. Old keys must remain available until lazy
rotation is complete.

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

Current provider adapters discard refresh token, expiry, type, and scope.

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

The current service creates a verifier but does not use it.

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

The current start endpoint accepts any HTTP(S) `return_to`, callback errors use
callback-supplied `site_id`, and bridge signing is optional.

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
