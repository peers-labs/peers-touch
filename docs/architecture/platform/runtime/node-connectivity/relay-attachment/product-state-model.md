# Relay Attachment Lifecycle - Product State Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-14 | **Updated**: 2026-10-15
> **Owner**: Node Connectivity

---

## 1. Canonical Lifecycle

```text
NOT_CONFIGURED
  -> INVITE_ISSUED
  -> PROVING_IDENTITY
  -> ENROLLING
  -> STATION_ACCEPTED
  -> RESERVING
  -> PUBLISHING_ROUTE
  -> ACTIVE

ACTIVE
  -> RENEWING
  -> ACTIVE

ACTIVE | RENEWING
  -> DEGRADED
  -> RECOVERING
  -> ACTIVE

INVITE_ISSUED | PROVING_IDENTITY | ENROLLING | STATION_ACCEPTED |
RESERVING | PUBLISHING_ROUTE | ACTIVE | RENEWING | DEGRADED | RECOVERING
  -> REVOKING
  -> DETACHED
```

The lifecycle is a product projection over multiple owner facts. No single
database row may claim `ACTIVE` without all required readbacks.

Invitation and attachment lifetime is operator-controlled and has no expiry.
Credential, reservation, signed-route and grant expiry remains mandatory and
drives `RENEWING`, `DEGRADED` and `RECOVERING`.

## 2. State Contracts

### NOT_CONFIGURED

Facts:

- Station Node has no desired target for this Relay.
- Relay may have no invitation or an unrelated historical enrollment.

Allowed:

- Relay Operator issues a new invite;
- Station Operator imports a valid invite.

### INVITE_ISSUED

Owner: Relay.

Required facts:

- invitation active and one-use;
- intended `station_peer_id`, quota and Relay identity fixed;
- secret plaintext available only during issuance/handoff.

An active invitation has no expiry. Its outcomes are:

- `consumed`: retained as replay/audit truth;
- `deleted`: the active row is removed by explicit Relay Operator action.

Delete and consume compete atomically; exactly one can win.

### STATION_ACCEPTED

Owner: Station desired state.

Required facts:

- invitation package verified locally;
- intended Station matches current logical Station;
- enrollment completed and the short-lived credential persisted;
- invitation secret discarded;
- desired attachment committed before reservation reconcile starts.

### PROVING_IDENTITY

Owner: Station node signer plus Relay challenge verifier.

Required facts:

- Relay challenge is fresh and bound to invite, Relay PeerID and operation;
- Station response proves current root-to-node authorization.

Identity mismatch is fail-closed and requires a corrected invitation or node.

### ENROLLING

Owner: Relay enrollment repository.

Required facts:

- invitation consumption and enrollment creation commit atomically;
- generation and credential JTI are current;
- capacity is checked before admission.

Quota denial is retriable while the invite remains active. An ambiguous commit
must be read back before retry.

### RESERVING

Owner: standard libp2p Circuit Relay v2.

Required facts:

- Station Host connects to the exact Relay PeerID;
- reservation is live, bounded and tied to the current generation projection.

No signed route may be labeled active before a live reservation exists.

### PUBLISHING_ROUTE

Owner: Station signer; Relay validates and stores the volatile route projection.

Required facts:

- route binds Station, Node, Relay, generation, visibility, SPKI and expiry;
- route generation equals current enrollment generation;
- Relay admission readback accepted it.

### ACTIVE

Required facts:

- Station desired attachment remains enabled;
- enrollment credential is current;
- Circuit reservation is unexpired;
- signed route is unexpired and matches current generation;
- Station and Relay observations are fresh and agree.

`ACTIVE` does not imply that clients must prefer this route. Station Access owns
client route selection.

### RENEWING

The current attachment remains usable within its validity window while one of:

- credential rotation;
- reservation renewal;
- signed route replacement.

Failure becomes `DEGRADED`; it never creates a second attachment generation
without Relay authorization.

### DEGRADED

At least one required active fact is absent, stale or close to expiry.

Visible issue codes:

- `relay_unreachable`
- `control_unavailable`
- `credential_expiring`
- `reservation_lost`
- `route_expired`
- `route_rejected`
- `generation_stale`
- `observation_stale`

The UI lists unaffected Direct/Relay routes separately.

### RECOVERING

Station runtime is retrying the failed owner boundary with bounded backoff.
Operators may retry now, replace invitation when required, migrate, or detach.

### REVOKING

Initiator is explicit:

- `station_detach`: withdraw local use, request remote retirement;
- `relay_revoke`: advance Relay generation and deny stale authority.

The state cannot return to `ACTIVE` with the same revoked generation.

### DETACHED

Local Station runtime no longer uses the Relay. Visible terminal reason:

- `station_detached`
- `relay_revoked`
- `identity_replaced`

Remote cleanup may remain `pending` after a Station-initiated offline detach,
but local route/reservation/credential use is already absent. Reattach starts
from a new invitation.

## 3. Failure Mapping

| Failure | State/result | Retry owner |
|---|---|---|
| invite consumed or deleted | blocked before proof | Relay Operator issues a new invite |
| intended Station mismatch | blocked at `PROVING_IDENTITY` | invitation target or Station selection must change |
| Relay capacity full | blocked at `ENROLLING` | Relay Operator frees/changes quota; Station retries |
| credential refresh fails before expiry | `RENEWING` with warning | Station runtime |
| credential expires | `DEGRADED` | new proof/credential or new invite after revoke |
| reservation lost | `DEGRADED -> RECOVERING` | Station runtime |
| route rejected/expired | `DEGRADED -> RECOVERING` | Station runtime republishes current generation |
| Relay revoke | `REVOKING -> DETACHED` | new invite only |
| Relay outage | affected attachment `DEGRADED` | other routes remain unchanged |

## 4. Multi-Relay Migration

Migration is not one attachment changing its Relay identity.

```text
attachment A (Relay A): ACTIVE
attachment B (Relay B): NOT_CONFIGURED -> ... -> ACTIVE
overlap: A ACTIVE + B ACTIVE
attachment A: REVOKING -> DETACHED
attachment B: ACTIVE
```

Generations are independent per Relay. Failure or revoke at one Relay cannot
advance, remove or rewrite the other Relay's generation or reservation.

## 5. Route Coexistence

The Station route projection may contain:

```text
Direct route       ACTIVE
Relay A Circuit    ACTIVE | DEGRADED
Relay B Circuit    ACTIVE | DEGRADED
```

Attachment state changes only its Circuit candidate. Direct route identity,
binding and validity remain under their existing owner.
