# OAuth Login Broker - Acceptance Matrix

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
> **Owner**: Identity and Access

---

## 1. Acceptance Rules

- Receiver-perspective HTTP behavior and durable repository readback are both
  required for login claims.
- Provider and GitHub integrations use deterministic HTTP fixtures unless live
  credentials are explicitly supplied.
- Unit tests alone cannot prove the cross-instance start/callback journey.
- Tests and evidence must never contain production credentials or raw tokens.
- Real Vercel deployment and live provider authorization remain unproven unless
  separately authorized and executed.

## 2. Capability Crosswalk

| Capability | Journey | Architecture | Receiver assertion | Evidence |
|---|---|---|---|---|
| OLB-C01 | OLB-J01 | OLB-D01, OLB-D04 | start in container A and callback in container B completes once | local HTTP journey plus repository readback |
| OLB-C02 | OLB-J01/J03 | OLB-D03 | operator sees one updated identity and login count | admin JSON/HTML assertion |
| OLB-C03 | OLB-J01/J02/J04 | OLB-D02 | repository contains authenticated ciphertext only | envelope and tamper tests |
| OLB-C04 | OLB-J01/J03 | OLB-D03 | start/success/failure events contain no secret fields | audit schema and redaction tests |
| OLB-C05 | OLB-J02 | OLB-D05 | refresh rotates access token and preserves omitted refresh token | provider fixture and atomic readback |
| OLB-C06 | OLB-J01/J02 | OLB-D04 | callback records move in one fast-forward commit; conflict retries | fake Git Data API tests |
| OLB-C07 | OLB-J03 | OLB-D06 | unauthenticated requests fail; authenticated payload is sanitized | handler/browser tests |
| OLB-C08 | OLB-J01/J02 | OLB-D07 | use cases run against memory and GitHub adapters unchanged | interface/contract tests |
| OLB-C09 | OLB-J01 | OLB-D09 | unapproved redirects and unsigned production startup fail closed | config and HTTP negative tests |

## 3. Gates

### OLB-G01: Durable Authorization

- A transaction created by one store/container is resolved by another.
- State is addressed only by HMAC fingerprint in repository paths.
- PKCE S256 is sent by GitHub and Google and the verifier is used at exchange.
- Expired, mismatched, and consumed state fail before a second completion.

### OLB-G02: Encrypted Atomic Completion

- Transaction, identity, credential, and audit update in one Git commit.
- AES-256-GCM envelopes use random nonces, version and key ID, and path AAD.
- Raw code, state, access token, and refresh token do not appear in paths,
  plaintext records, errors, logs, admin JSON, or HTML.
- A branch conflict retries against the new head and cannot overwrite an
  already consumed transaction.
- Timeout after a successful ref update converges through the same completion
  idempotency key without a duplicate login event.
- Serialized records and all returned errors omit verifier, provider secrets,
  GitHub private key/JWT/installation token, and OAuth token plaintext.

### OLB-G03: Provider Tokens And Refresh

#### OLB-G03A: Provider Token Exchange

- GitHub, Google, and Weixin parse access token, refresh token, type, scope, and
  expiry when supplied.
- Google and GitHub send PKCE verifier during authorization-code exchange.
- Provider expiry is measured from token receipt, before any follow-up userinfo
  request.

#### OLB-G03B: Credential Refresh

- Refresh uses the provider-specific endpoint and retains the old refresh token
  when the response omits it.
- Reusing a completed refresh idempotency key, including after another refresh,
  returns the current credential without another provider call, credential
  generation, or audit event.
- Credential replacement is fenced by the generation observed before the
  provider call; a stale result is discarded and retried from current state.
- After a provider failure, the loser rechecks the same durable operation ID;
  an already committed winner is returned, while no-winner failures remain
  failures.

### OLB-G04: Operator Readback

- Basic auth uses a constant-time password-digest comparison.
- Missing or malformed Basic credentials return before password derivation.
- Supplied credentials use a bounded per-instance password-derivation pool;
  saturation fails closed without starting additional PBKDF2 work.
- Invalid credentials produce `401` before storage reads.
- HTML and JSON expose only identity, aggregate credential metadata, and typed
  audit fields.
- Security, cache, frame, MIME, and robot headers are present.
- Bootstrap failures return the same generic unavailable response and security
  headers as authenticated handler failures.

### OLB-G05: Configuration And Deployment

#### OLB-G05A: Production Safety Bounds

- Vercel refuses an unset or memory storage driver.
- Vercel refuses any site without bridge signing or an explicit return
  destination allowlist, and provider callbacks require HTTPS.
- File-backed sites honor the environment return-destination override, and
  Vercel rejects a plaintext GitHub API base URL.
- GitHub storage uses an explicitly bounded HTTP client.

#### OLB-G05B: Complete Bootstrap And Route Compatibility

- GitHub App private key, repository coordinates, key ring, HMAC keys, and
  admin digest are validated at bootstrap.
- Local memory mode remains available for development.
- Existing provider start/callback and health routes remain available.

### OLB-G06: Complete Key Rotation

- A maintenance command scans transaction, identity, credential, refresh
  operation, and audit prefixes.
- Every old-key envelope is rewritten with the active key while plaintext
  remains unchanged.
- A second run performs no writes.
- Unknown keys and per-record failures are reported without leaking encrypted
  or decrypted payloads.

## 4. Required Runtime Cells

| Cell | Required proof |
|---|---|
| Go source | unit, race-free repository behavior, provider fixtures, config validation |
| Local HTTP | start/callback across separate GitHub-backed adapters and read-only admin surface |
| Fake GitHub API | GitHub App token, bounded response reads, truncated-tree traversal, ref/tree/blob/commit flow, CAS retry |
| Vercel build shape | every route compiles as an independent function |

## 5. Completion Claim

`OAUTH_LOGIN_BROKER_ACCEPTED` requires OLB-G01, OLB-G02, OLB-G03A,
OLB-G03B, OLB-G04, OLB-G05A, OLB-G05B, and OLB-G06, plus the registered
`oauth-login-broker-contract` Gate, architecture governance validation, and
the exact-source local HTTP journey.

The claim excludes live GitHub App installation, live provider consent, Vercel
deployment, production scale, and migration of historical plaintext records.
