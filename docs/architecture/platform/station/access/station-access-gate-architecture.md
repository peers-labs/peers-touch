# Station Access Gate Architecture

> Architecture source for Station-driven access gates across Desktop and Mobile.
>
> The signed Station identity and OAuth-attempt binding additions in this
> document were accepted with the Mobile Shell PRODUCT/DESIGN package on
> 2026-08-27.

---

## 1. Problem

Entering a Station is not equivalent to submitting a login form. A Station may require multiple independent gates before a client can enter the authenticated shell:

- Station reachability and capability compatibility.
- Login or session restore.
- Invitation-only access.
- Fixed user allowlist access.
- Device trust.
- Maintenance mode.
- Terms or policy acceptance.

If Desktop and Mobile implement these checks separately, the product will drift and each client will become a partial policy engine. That is forbidden. Station owns access policy; clients execute the gate chain returned by Station.

---

## 2. Design Goal

Define a Station-driven **Access Gate Chain** that is:

- **Station-owned**: Station decides which gates exist, their order, and pass/fail semantics.
- **Dashboard-managed**: invite-only and fixed-user policies are configured in Station Dashboard, not Desktop or Mobile.
- **Client-symmetric**: Desktop and Mobile use the same protocol and lifecycle states.
- **Extensible**: new gates can be added without rewriting each client lifecycle.
- **Proto-first**: gate contracts are defined under `model/domain/` before implementation.

---

## 3. Non-Goals

- Desktop is not an access-policy management surface.
- Mobile is not an access-policy management surface.
- Clients do not own invite lists, allowlists, or policy decisions.
- Gate state must not be mocked locally to make the UI appear complete.
- This architecture does not replace JWT/session validation; it wraps it as one gate in a larger chain.

---

## 4. Ownership

| Owner | Responsibility |
| --- | --- |
| Station | Gate policy, gate order, gate state, final access decision, audit |
| Dashboard | Admin UI/API for invite-only, fixed-user, and future policy configuration |
| Desktop | Gate host UI, credential coordinator, gate action submission, runtime gating |
| Mobile | Gate host UI, credential coordinator, gate action submission, runtime gating |
| Proto | Shared source of truth for gate model and API payloads |

---

## 5. Lifecycle

Both Desktop and Mobile must follow the same top-level lifecycle:

```text
client boot
  -> station selection / identity context
  -> signed station handshake (`station_peer_id`)
  -> access gate chain
      -> station capability gate
      -> auth/session gate
      -> invite / allowlist gate
      -> device / policy gates
  -> access granted
  -> runtime bootstrap
  -> shell
```

The shell is reachable only after Station returns an access-granted decision.

---

## 6. Gate Chain Model

### 6.1 Access Attempt

An access attempt represents one user's attempt to enter one Station from one client device.

Required fields:

- `attempt_id`
- `station_peer_id` from the signed handshake
- `station_url` as a connection hint only
- `client_platform`
- `client_version`
- `device_id`
- `session_id` when available
- `actor_ref` when known
- `created_at`
- `expires_at`

### 6.2 Gate

Each gate is an independent step in the chain.

Required fields:

- `gate_id`
- `type`
- `state`
- `title`
- `description`
- `input_schema`
- `submit_action`
- `blocking_reason`
- `next_gate_id`

Credential collection is one gate stage with alternative actions. The
`auth.login` gate may advertise both an email/password action and one or more
`auth.oauth` actions. Completing any one action establishes the actor candidate
and satisfies the credential stage; clients must never execute both as
sequential mandatory gates.

Gate states:

- `pending`: not evaluated yet.
- `action_required`: client must collect input or trigger an action.
- `passed`: this gate is complete.
- `blocked`: access cannot continue until policy changes.
- `failed`: client action failed but may be retried.
- `skipped`: Station decided the gate is not required for this attempt.

### 6.3 Access Decision

The final decision is owned by Station:

- `granted`: client may bootstrap authenticated runtime.
- `action_required`: client must render the current gate.
- `blocked`: access denied by policy.
- `pending`: async review or external action required.
- `failed`: recoverable error.

---

## 7. Gate Types

| Gate Type | Purpose | Client UI |
| --- | --- | --- |
| `station.capability` | Check Station/client compatibility | Blocking status or upgrade prompt |
| `auth.login` | Collect credentials and create/restore session | Login form |
| `auth.oauth` | Complete provider authorization bound to this attempt/gate | Provider launch, callback progress, cancellation/retry |
| `auth.session_restore` | Validate stored session | Progress/retry state |
| `invite.allowlist` | Enforce invite-only or fixed-user policy after actor is known | Blocked/access pending state |
| `invite.code` | Collect invite code when Station allows self-service invite redemption | Invite code form |
| `device.trust` | Bind or verify trusted device | Device confirmation UI |
| `maintenance` | Block non-admin access during maintenance | Maintenance message |
| `terms.acceptance` | Require terms/policy acceptance | Terms confirmation |
| `custom` | Future Station-defined gate | Schema-driven fallback UI |

---

## 8. Invite Gate MVP

The first gate implementation is invite/fixed-user access.

### 8.1 Policy Modes

| Mode | Meaning |
| --- | --- |
| `open` | Any authenticated user may enter |
| `invite_only` | Only invited/allowed users may enter |
| `fixed_users` | Only explicitly configured users may enter |
| `closed` | No new users may enter except admins |

### 8.2 Dashboard Management

Dashboard must manage:

- current access mode;
- allowed actors/users;
- invite codes if enabled;
- expiration and usage limits;
- revocation;
- audit logs for create/update/revoke/use/deny.

Desktop and Mobile must not expose these management controls.

### 8.3 Evaluation Order

```text
station capability
  -> auth login/session restore
  -> invite allowlist/fixed-user evaluation
  -> access granted or blocked
```

Invite allowlist is evaluated after auth because Station needs the actor identity.

---

## 9. API Shape

Proto-first APIs should be added under `model/domain/access_gate/`.

Suggested RPC-like operations:

- `StartAccessAttempt`
- `GetAccessGatePlan`
- `SubmitAccessGate`
- `GetAccessDecision`
- `CancelAccessAttempt`

OAuth credential acquisition uses Model-owned start/complete/status/cancel
contracts in the OAuth domain. Every OAuth attempt binds the
`station_peer_id`, access `attempt_id`, and current `gate_id`. Completion
returns a PTID-bearing session candidate plus a re-evaluated `AccessDecision`.
The candidate cannot authorize business APIs until the final decision is
`granted`.

### 9.1 OAuth Finalization Amendment

> **Status**: accepted on 2026-08-28.

`auth.oauth` becomes a first-class `AccessGateType` for an alternative action
advertised by the `auth.login` credential-stage gate; clients must not infer it
from a missing type or silently substitute it. The OAuth attempt binds the
exact parent gate ID and OAuth action type, plus device ID, lifecycle
generation, an attempt-secret hash, and a native credential-delivery public key.

The final Access Gate decision and OAuth session activation are committed by one
Station authorization finalizer. It locks the Access Attempt, OAuth Attempt,
and candidate, requires the current decision to be final `granted`, and creates
at most one candidate-keyed session plus one encrypted credential envelope.
Cancellation uses the same lock order and cannot race into a live session.

Status is read/recovery, not credential minting. Before native
acknowledgement it may return the same persisted encrypted envelope; after
acknowledgement it returns only public state. All status, cancel, completion,
and acknowledgement calls require the device-held attempt secret.

The Station-owned authorization endpoint derives actor PTID from an
authenticated subject and explicit consent. Caller-supplied actor identity is
forbidden. Authorization codes are consumed by one conditional database update
before token creation.

Transport can be HTTP/Tauri bridge during implementation, but payload models must come from proto.

---

## 10. Client Integration

### 10.1 Desktop

Desktop integrates the gate chain into its existing lifecycle owner:

- `useAppLifecycle` remains the owner of onboarding/resuming/ready transitions.
- Login UI becomes one renderer inside a gate host, not the whole access model.
- Account picker, PIN unlock, OAuth, and password login remain client UX steps but must map to Station gate actions.
- `ready` is entered only after access decision is `granted`.

### 10.2 Mobile

Mobile integrates the gate chain into:

- `station-selection`
- `station-handshake`
- `access-gate`
- `runtime-bootstrap`
- `shell`

`StationAuthGate` must evolve into an `AccessGateHost`; login is one gate renderer.

---

## 11. Security Rules

- Gate bypass is a server-side vulnerability. Station APIs must check the final access decision, not trust client state.
- URL is not Station identity. Access attempts and credentials bind the signed
  `station_peer_id`; a pinned-ID mismatch fails before credential submission.
- Stored sessions remain scoped to Station and actor.
- OAuth state is consumed atomically by Station. Clients validate their local
  callback binding but cannot declare one-time consumption.
- Invite/allowlist decisions are audited.
- Dashboard management requires dashboard authentication and role checks.
- Gate action errors must not leak secrets or policy internals.
- Clients may cache display state, but they must revalidate before runtime bootstrap.

---

## 12. Verification

Implementation is complete only when all are true:

- Proto contracts exist and generation succeeds.
- Signed handshake pins the expected `station_peer_id`; URL identity mismatch
  blocks access and cannot reuse credentials or cache.
- Station rejects shell/business access when gates are incomplete.
- Dashboard can manage invite/fixed-user policy.
- Desktop renders the gate chain and blocks `ready` until granted.
- Mobile renders the same gate chain and blocks `shell` until granted.
- GitHub/Google OAuth remains bound to the originating Station/access gate;
  cancel, expiry, replay, and mismatch fail closed.
- Invite-only denial is shown consistently on Desktop and Mobile.
- Switching Station clears the active access attempt and session-scoped projections.

Mobile lifecycle and OAuth refinement:

- `docs/architecture/platform/client/mobile/design.md`
- `docs/architecture/platform/client/mobile/data-model.md`
- `docs/client/mobile/lifecycle.md`

---

## 13. Wire Format Contract

The gate chain crosses three runtimes (Go Station, Rust Desktop kernel, TS clients), so the JSON encoding of `AccessDecision` is a hard contract, not an implementation detail.

### 13.1 Station encoding

Station serializes responses with protojson using:

```go
protojson.MarshalOptions{EmitUnpopulated: true, UseProtoNames: true}
```

Consequences every client MUST tolerate:

- Keys are **snake_case** (`attempt_id`, `current_gate_id`, `blocking_reason`, `input_schema_json`).
- Enums serialize as their **string name** (`ACCESS_DECISION_STATE_GRANTED`, `ACCESS_GATE_TYPE_INVITE_CODE`), not the numeric value.
- All fields are emitted even when zero/empty.

Station accepts requests with `UnmarshalOptions{DiscardUnknown: true}`, so clients may send either snake_case or camelCase keys and either numeric or string enum values.

### 13.2 Client normalization

Because a future Station build (or a proxy) could emit camelCase or numeric enums, clients normalize defensively:

- Mobile: `normalizeDecision` in [`apps/mobile/src/features/auth/authSession.ts`](../../../../../apps/mobile/src/features/auth/authSession.ts).
- Desktop: `normalizeDecision` in [`apps/desktop/src/services/accessGate.ts`](../../../../../apps/desktop/src/services/accessGate.ts).

Both read `snake_case ?? camelCase` for every field and match enums by **both** the numeric constant and the string name. State/type predicates (`isAccessGranted`, `isInviteCodeGate`, …) MUST keep both forms or the chain silently stalls.

### 13.3 Schema-driven gate rendering

The `invite.code` gate carries its form in `input_schema_json`:

```json
{ "fields": [ { "name": "invite_code", "type": "text", "required": true, "label": "Invite code" } ] }
```

Clients parse this into a field list (`parseGateFields`) and render the placeholder/label from it, falling back to a localized default. A gate's form can therefore change without a client release.

---

## 14. Delivery Status (2026-06-16)

| Layer | Status | Key artifacts |
| --- | --- | --- |
| Proto contract | shipped | `model/domain/access_gate/access_gate.proto` |
| Station registry + orchestrator | shipped | `apps/station/frame/touch/accessgate/` (`service.go`, `gatekeeper/`, `builtin_gatekeepers.go`) |
| Attempt persistence + state machine | shipped | `apps/station/frame/touch/accessgate/attempt_store.go` |
| Self-service invite code | shipped | `apps/station/frame/touch/accessgate/invite_code.go` (transactional row-locked redemption) |
| Dashboard policy + invite management | shipped | `apps/station/app/subserver/dashboard/web/src/pages/AccessGatesPage.tsx` |
| Mobile gate host | shipped | `apps/mobile/src/features/auth/AccessGateHost.tsx`, `authSession.ts` |
| Desktop interactive gate chain | shipped | Rust: `access_start` / `access_submit_invite_code` / `access_submit_login`; TS: `accessGate.ts`, `LoginPage.tsx` |

The desktop chain reuses the existing `LoginPage` as the gate host: an `invite.code` `action_required` decision pauses the login submit, renders the schema-driven invite form, and resumes into the `auth.login` gate once the code passes — symmetric with the mobile `AccessGateHost`.
