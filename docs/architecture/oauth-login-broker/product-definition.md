# OAuth Login Broker - Product Definition

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
> **Owner**: Identity and Access

---

## 1. Product Thesis

Peers applications need one small hosted OAuth broker that reliably completes
GitHub, Google, and Weixin sign-in across serverless invocations while retaining
the minimum durable identity and credential material required for later token
refresh.

The initial target is one trusted operator using a private GitHub repository as
the persistence backend. End users interact only with provider authorization
and the final application redirect. The operator receives a protected,
read-only view of identities and login outcomes.

## 2. Product Promise

An OAuth attempt started on one Vercel function instance can finish on another,
and a successful callback durably records the provider identity, login event,
and encrypted refreshable token set before redirecting to the calling
application.

## 3. Capability Profile

| ID | Capability | Class | Product result |
|---|---|---|---|
| OLB-C01 | Durable authorization transaction | required | State and PKCE survive serverless instance changes and are one-time consumable |
| OLB-C02 | Provider identity ledger | required | The latest identity and login count are durably readable |
| OLB-C03 | Encrypted token custody | required | Access and refresh tokens are retained only as authenticated ciphertext |
| OLB-C04 | Login audit history | required | Start, success, and typed failure outcomes are recorded without secrets |
| OLB-C05 | Provider refresh contract | required | A stored refresh token can produce and atomically replace a token set |
| OLB-C06 | Private GitHub storage | required | One callback result is one optimistic, atomic Git commit |
| OLB-C07 | Operator readback | required | A protected dashboard/API shows users and events but never token material |
| OLB-C08 | Replaceable persistence | required | Use cases depend on domain ports, not GitHub payloads |
| OLB-C09 | Redirect trust boundary | required | Only configured callback destinations receive a production signed identity result |
| OLB-C10 | Dedicated database backend | deferred | Future scale can replace GitHub without changing use cases |
| OLB-C11 | Multi-operator RBAC | deferred | Initial deployment has one administrator |

GitHub, Google, and Weixin are integrations, not product benchmarks. No
benchmark disposition document is required.

## 4. Users And Jobs

### Application user

- Start provider sign-in from a Peers application.
- Return to the exact validated application destination after success.
- Receive an actionable failure redirect when state, provider, exchange, or
  persistence fails.

### Operator

- Confirm which provider identities have logged in and when.
- Distinguish successful logins from typed failures.
- Confirm whether a credential is refreshable and when it expires.
- Never retrieve access tokens, refresh tokens, authorization codes, raw state,
  encryption keys, GitHub App credentials, or provider secrets from the UI.

## 5. Required Outcomes

- Cross-instance callback succeeds against durable storage.
- `return_to` is accepted only when its normalized scheme, authority, and path
  exactly match a per-site allowlist entry.
- Replay of a consumed state fails before another durable success.
- A successful provider exchange is not reported to the caller until the
  transaction, identity, credential, and audit event are committed.
- Credential encryption is authenticated and path-bound.
- Key identifiers support rotation; an explicit maintenance command rewrites
  every old-key record class under the active key.
- Provider refresh keeps the previous refresh token when a provider rotates
  only the access token.
- All operator responses are non-cacheable and protected by Basic auth over
  HTTPS.
- Production startup requires a bridge signing secret for every configured
  site; callback errors route only through the transaction's site.

## 6. Non-Goals

- Persisting raw authorization codes.
- Persisting raw OAuth state as a repository path, audit value, or log field.
- Exposing provider tokens to the browser or administrator.
- Building user account linking, account merging, deletion, or consent
  management.
- Replacing Station authentication or issuing Station sessions.
- Performing production deployment, creating the GitHub App, or creating the
  private repository in this Plan.

## 7. Platform Matrix

| Capability | Vercel/browser | Local server | Desktop/Mobile caller |
|---|---|---|---|
| Start and callback | required | required | consumes redirect contract |
| GitHub repository persistence | required | configurable | no direct access |
| Memory persistence | unsupported | development-only | no direct access |
| Operator dashboard | required | required | out of scope |
| Credential refresh use case | server-side | server-side | no public token API |

## 8. Feasibility

| Capability | Existing foundation | Missing closure | Executable proof |
|---|---|---|---|
| OLB-C01 | `AuthSession` and state validation | durable encrypted store and PKCE wiring | cross-container callback integration test |
| OLB-C02-C04 | provider identity extraction | atomic completion records | fake GitHub Git Data API contract test |
| OLB-C05 | provider token endpoints | token-set model and refresh methods | provider HTTP fixture tests |
| OLB-C06/C08 | DDD package boundaries | GitHub App client and repository adapter | optimistic conflict/retry tests |
| OLB-C07 | Go HTTP handlers | Basic auth and sanitized renderers | local HTTP handler tests and browser check |

## 9. Product Gate

Current status: `PRODUCT_READY_FOR_ARCHITECTURE`.

No material UI prototype is required. The operator surface is a read-only table
with no workflow decisions beyond authentication and filtering-free inspection;
its visual and behavioral contract is fully testable in the production handler.
