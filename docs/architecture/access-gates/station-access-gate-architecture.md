# Station Access Gate Architecture

> Architecture source for Station-driven access gates across Desktop and Mobile.

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
| Desktop | Gate host UI, credential collection, gate action submission, runtime gating |
| Mobile | Gate host UI, credential collection, gate action submission, runtime gating |
| Proto | Shared source of truth for gate model and API payloads |

---

## 5. Lifecycle

Both Desktop and Mobile must follow the same top-level lifecycle:

```text
client boot
  -> station selection / identity context
  -> station handshake
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
- `station_url`
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
- Stored sessions remain scoped to Station and actor.
- Invite/allowlist decisions are audited.
- Dashboard management requires dashboard authentication and role checks.
- Gate action errors must not leak secrets or policy internals.
- Clients may cache display state, but they must revalidate before runtime bootstrap.

---

## 12. Verification

Implementation is complete only when all are true:

- Proto contracts exist and generation succeeds.
- Station rejects shell/business access when gates are incomplete.
- Dashboard can manage invite/fixed-user policy.
- Desktop renders the gate chain and blocks `ready` until granted.
- Mobile renders the same gate chain and blocks `shell` until granted.
- Invite-only denial is shown consistently on Desktop and Mobile.
- Switching Station clears the active access attempt and session-scoped projections.
