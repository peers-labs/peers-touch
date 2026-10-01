# OAuth Login Broker - Acceptance Matrix

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
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
- Desktop account-login proof requires the native receiver, broker, and Station
  perspectives. A broker-only callback fixture cannot prove login.

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
| OLB-C12 | OLB-J05 | OLB-D11-D13 | logged-out Desktop receives a Station-issued session only after a valid signed callback | native Desktop plus Station readback |
| OLB-C13 | OLB-J01/J05 | OLB-D14 | private-email GitHub and no-email providers produce safe identities without unverified email linking | provider fixtures plus Station identity tests |

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
- A durable refresh claim commits before the provider call. A retry observing
  an unresolved claim does not call the provider and reports an explicit
  uncertain/reauthorization outcome.

### OLB-G04: Operator Readback

- Basic auth uses a constant-time password-digest comparison.
- Missing or malformed Basic credentials return before password derivation.
- Supplied credentials use a bounded per-instance password-derivation pool;
  saturation fails closed without starting additional PBKDF2 work.
- Invalid credentials produce `401` before storage reads.
- HTML and JSON expose only identity, aggregate credential metadata, and typed
  audit fields.
- A bounded read returns the newest events when more than the requested limit
  share one month, without fetching blobs outside the selected path set.
- HMAC-only legacy audit paths fail closed before any audit blob is fetched,
  and separate failed requests retain separate event identities.
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
- CAS retries reuse one bounded candidate set; a lost successful ref-update
  response is confirmed by exact ciphertext readback and counted once.
- Completion is explicit; callers never infer exhaustion from a retry-affected
  committed count, and any retry requires one subsequent fresh pass.
- A second run performs no writes.
- Unknown keys and per-record failures are reported without leaking encrypted
  or decrypted payloads.

### OLB-G06A: Live API And Repository

- GitHub and Google authorization starts use HTTPS authorization endpoints,
  PKCE S256, opaque state, exact callback URIs, and the accepted scopes.
- Non-GET API requests return `405` with `Allow: GET`; callbacks containing
  both `code` and `error` fail with `invalid_callback_result`.
- A fresh broker process reads the real GitHub and Google identities from the
  private GitHub repository through the configured GitHub App.
- Transaction, identity, credential, refresh-operation, and audit paths exist
  only as authenticated encrypted envelopes under the active key.
- A refresh claim is visible to another store instance, cannot be acquired
  twice, and can be released and reacquired without exposing its operation ID.
- A second live rotation pass reports zero rewritten records.

### OLB-G07A: Desktop/Station Handoff Contract

- Logged-out Desktop starts account login without an existing actor or token.
- The broker accepts only the explicitly configured loopback callback template;
  arbitrary localhost hosts, paths, ports, userinfo, and fragments are rejected.
- The broker and Station produce and verify the same versioned canonical
  assertion bytes.
- Desktop rejects a callback whose signed receiver or purpose differs from the
  active loopback attempt, and Station rejects replayed assertion IDs.
- Station rejects device or lifecycle-generation values that do not match the
  referenced Access Attempt.
- Missing Station secret, stale timestamp, unsupported version, modified
  identity field, and malformed signature all fail before actor/session
  mutation.
- The Station OAuth bridge route is registered and reachable without JWT while
  retaining common public-route controls.
- Desktop persists neither an active account nor an OAuth connection before
  Station returns a valid session.
- Provider denial reaches the transaction-owned Desktop receiver as a typed
  failure, consumes the authorization transaction, and creates no Station or
  Desktop session.
- Authenticated connector linking cannot use the account-login path.
- Provider usernames and display names that do not satisfy the Station handle
  grammar are normalized to a stable provider-scoped handle before signup.
- Lost acknowledgement responses preserve a durable local recovery record and
  converge through polling or process restart; the recovery journal is
  encrypted and owner-readable only.
- Renderer timeout uses the native loopback expiry and requests cancellation
  before presenting failure. Cancellation clears candidates that are waiting
  on a later gate, while an already activated session wins a late cancellation
  race and remains active.
- Station startup and periodic sweeps revoke abandoned candidate sessions and
  delete credential envelopes without request traffic.

This contract is enforced by `oauth-login-broker-handoff-contract`. It is
source and service evidence, not native Desktop proof.

### OLB-G07B: Native Desktop Station Handoff

- The exact-source native Tauri window starts from a logged-out state.
- A non-production provider authorization traverses the isolated broker,
  Desktop loopback receiver, Station Access Attempt, credential envelope,
  local persistence, acknowledgement, and authenticated shell.
- Restart restores the same actor only after acknowledgement recovery confirms
  Station activation.
- Timeout cancellation produces no late authenticated shell.
- Evidence identifies the native runtime, source, broker, Station, provider,
  account, and cleanup without secret values.

OLB-G07B remains `UNPROVEN` after the OAuth2-only
`OLB-LIVE-20261001` closure. It requires a separately authorized follow-up
Plan through `pt-dev-runtime-handoff`; no OAuth2 service or local source Gate
may claim it.

## 4. Required Runtime Cells

| Cell | Required proof |
|---|---|
| Go source | unit, race-free repository behavior, provider fixtures, config validation |
| Local HTTP | start/callback across separate GitHub-backed adapters and read-only admin surface |
| Fake GitHub API | GitHub App token, bounded response reads, truncated-tree traversal, ref/tree/blob/commit flow, CAS retry |
| Vercel build shape | every route compiles as an independent function |
| Native Desktop + Station | system-browser callback, signed assertion, Station session, local durable account activation |
| Live test deployment | isolated GitHub data repository, Vercel deployment, real provider consent and denial |

## 5. Completion Claim

`OAUTH2_CLIENT_ACCEPTED` requires OLB-G01, OLB-G02, OLB-G03A, OLB-G03B,
OLB-G04, OLB-G05A, OLB-G05B, OLB-G06, and OLB-G06A through the registered
oauth2-client durability, refresh, rotation, operator, architecture, contract,
and live repository Gates. It does not claim Desktop or Station behavior.

`OAUTH_LOGIN_BROKER_NATIVE_ACCEPTED` additionally requires OLB-G07A and
OLB-G07B, the registered architecture and contract Gates, and the exact-source
native Desktop-to-Station journey.

The local claim excludes Vercel deployment, production scale, and migration of
historical plaintext records. Live GitHub App installation and GitHub/Google
provider consent require separate evidence from the isolated
`oauth2-client-test` environment; they do not prove the Native Desktop cell.
