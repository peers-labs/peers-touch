# X Config - Product Acceptance Matrix

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform
> **Module**: `apps/x-config/`

---

## 1. Required Acceptance

| Capability | Receiver assertion | Evidence |
|---|---|---|
| Operator login | Only the allowlisted GitHub subject receives a session | Real OAuth redirect/callback/session |
| Operator-state isolation | Login, session readback, CSRF, replay denial, and revocation use only the Home operator database | Local-store diagnostics plus Git path diff |
| Session restart durability | An unexpired session survives API restart and a revoked session stays revoked | Home container restart Journey |
| Draft CAS | Stale revisions cannot overwrite repository state | Admin service and live repository conflict proof |
| Typed validation | Invalid endpoint/release data cannot be saved or published | Go contract tests and console recovery |
| Diff acknowledgement | Publish remains disabled until the exact diff is acknowledged | Focused browser proof |
| Direct publication | Initial, changed, and unchanged renewal publication return a higher sequence and exact signed envelope metadata | Live API and repository readback |
| Atomic persistence | Current metadata, immutable metadata, and envelope land in one Git commit | GitHub tree inspection |
| Public latest | Latest endpoint returns persisted bytes, protobuf type, ETag, and revalidation cache policy | HTTPS readback |
| Public immutable | Sequence endpoint returns the same bytes with immutable cache policy | HTTPS readback |
| Client trust | Deployed bytes pass signature/channel/expiry and reject tamper/rollback | `x-config-core` verifier |
| Restore | Historical content creates a new draft and later a higher publication sequence | Admin service tests |
| Suggestion safety | Client suggestions never mutate verified Station state before signed discovery | Shared core and adapter tests |

## 2. Failure And Recovery

| Failure | Expected result |
|---|---|
| GitHub unavailable | Catalog/publication operations and public origin fail closed; an existing operator session remains locally verifiable |
| Home runtime unavailable | Clients retain cache or embedded fallback |
| Operator database unavailable | Login and protected admin requests fail closed; publication truth is unchanged |
| Operator database recreated empty | Existing sessions are invalid; operator signs in again |
| Signing key missing/mismatched | Service startup/publication fails; no commit |
| Concurrent repository write | Publication returns conflict; no signed state is committed |
| Metadata/envelope digest mismatch | Public read returns unavailable |
| OAuth subject not allowlisted | Session creation denied |
| CSRF absent or invalid | Mutation denied |
| Snapshot tampered | Client rejects and retains last-known-good |
| Lower sequence | Client rejects rollback |
| Equal sequence with different bytes | Client rejects conflict |
| Catalog removes endpoint | Suggestion disappears; verified Station remains |
| Endpoint identity mismatch | Station Access rejects registry mutation |

## 3. Platform Cells

| Surface | Required Preview evidence | Explicitly unproven |
|---|---|---|
| Console browser | login, load, edit, validate, diff, publish, history, conflict | multi-operator RBAC |
| Unified Go service | local auth, CAS, signing, persistence, public read | multi-instance operation |
| Home operator store | transaction atomicity, restart, replay, expiry, revocation | stale database restore |
| GitHub storage | selected repository and catalog/publication paths | path isolation as security boundary |
| Home Preview | exact source/env, state mount, edge, public headers | OAuth Broker storage optimization |
| Desktop kernel | keyring verification and suggestion projection | native selector UI |
| Mobile kernel | keyring verification and suggestion projection | native selector UI |

## 4. Cleanup Acceptance

After cutover:

- Home contains one active X Config runtime and persistent operator-state mount;
- Vercel contains no X Config project or alias;
- GitHub persistence uses only the shared OAuth repository and the
  X Config catalog/publication paths, with no X Config operator-auth writes;
- active source has no obsolete project name, alias, external approval state,
  Git-backed operator store, independent ledger path, publisher CLI, Vercel
  adapter, distribution adapter, or legacy client service variable;
- frozen historical Plan Versions may retain prior facts and are excluded from
  active-source cleanup claims.
