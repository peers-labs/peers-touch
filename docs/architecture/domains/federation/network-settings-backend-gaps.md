# Network Settings — Backend Gap Register

> **Status**: active gap register (pre-implementation). Owner: Architecture.
> **Created**: 2026-10-13.
> **Drives**: the Pending-backend affordances in Desktop
> `Settings → Network → Your Station / Discovery / Federation` and the
> operator-side Station Dashboard network surfaces.
>
> This document maps each designed Network capability to what the Station and
> Desktop actually ship today. It is the work list for the backend project that
> turns the prototype's Pending markers into live controls. Capabilities are
> grouped by the layer that must change; every entry states current evidence,
> the target contract, and the UI marker it unblocks.

---

## 0. Ownership split (target)

| Concern | Owner surface | Who can change |
|---|---|---|
| Bound station identity, authorized devices, switch station | Desktop Settings · Your Station | The signed-in account |
| Account discoverability (master + per federation) and reachability policy | Desktop Settings · Discovery | The signed-in account |
| Join / leave federations, own role, member-station count | Desktop Settings · Federation | Any account on the station |
| Create / archive federation, member approval, ledger, roster, roles | Station Dashboard · Federation | Federation operator / sequencer |
| Directory service switch, rate limits, fan-out behaviour | Station Dashboard · Directory | Station operator |
| Relay mounts/invites/stats, per-federation sync health | Station Dashboard · Transport | Station / relay operator |
| Access gates (invite/policy to join the station) | Station Dashboard · Access | Station operator |

Prototype rule (enforced by the geometry gate): a capability whose backend is
not shipped must render a visible **Pending backend** marker and be
read-only/disabled — never a control that silently does nothing.

---

## 1. Capability status snapshot

| # | Capability | Station backend | Desktop/Tauri | UI today |
|---|---|---|---|---|
| G1 | Single account discoverability (HIDDEN / BY_HANDLE / INDEXED) | Shipped (UpdateProfile) | Wired | Live semantics; INDEXED currently behaves like BY_HANDLE (see G4) |
| G2 | Per-federation visibility + master hide/restore | **Missing model** | none | Pending |
| G3 | Inbound request policy anyone / my federations / nobody | **Missing enforcement** | none | Pending |
| G4 | Cross-station directory (INDEXED enumeration) | **Local-only** catalog | read command only | Pending |
| G5 | Catalog serve kill-switch + rate limits | **Designed only** | none | Operator (Dashboard), Pending |
| G6 | Federation join/leave/role/member-count on Desktop | Shipped on Station | **Read-only client** | Target form; needs shim |
| G7 | Non-sequencer leave correctness | **Suspected defect** | n/a | Blocks reliable Leave |
| G8 | Authorized device list/revoke in Settings | Shipped (`/device/*`) | Tauri exists (im-service) | Needs Settings wiring |
| G9 | Switch station = sign out + reselect station+account | Binding machine shipped; logout gap | partial | Target form; needs client wiring |
| G10 | Rich per-federation/relay health (degraded/lagging/fork) | Partial, not exposed | none | Operator (Dashboard) |
| G11 | `visible_actor_count` / federation station counts | Counts partially available | contexts omit counts | Pending numbers hidden |
| G12 | Cross-surface directory/discoverability contract for INDEXED | Designed only | none | Pending |

---

## 2. Account-level gaps (Desktop Settings)

### G2 — Per-federation visibility with a master hide/restore

- **Current**: one `visibility int16` per actor (`touch_actor.visibility`;
  `Actor.visibility` field 15 / `ActorProfile.discoverability` field 33 in
  `model/domain/actor/actor.proto`), updated through `POST /actor/profile`
  (`UpdateProfileRequest.discoverability`). There is no per-federation storage;
  grep for per-federation visibility returns nothing.
- **Target contract**:
  - master off ⇒ the actor is HIDDEN across every federation (DHT tombstone),
    but the last per-federation choices are retained, not reset;
  - master on ⇒ each joined federation has an independent value resolving to
    BY_HANDLE (resolvable by exact handle, not enumerable) or INDEXED
    (enumerable in that federation's directory);
  - changing the joined-federation set (join/leave) reconciles the matrix
    without losing stored choices for re-joined federations.
- **Required work**:
  1. proto: per-actor federation visibility map (actor ↔ federation id ↔
     enum), plus the master flag distinct from the map;
  2. station: migration + repository; locator hook publishes/tombstones per
     federation instead of one global value; UpdateProfile validates the map
     against current memberships;
  3. enforcement: catalog queries (G4) filter by the requesting federation;
  4. desktop: API + settings store; remove the Pending marker.
- **Unblocks**: Discovery “Visible in each federation” matrix and the hidden →
  restore behaviour (prototype already persists intent locally).

### G3 — Inbound friend/group request policy

- **Current**: the only receiver gate is
  `ReceiverFriendRequestPolicy{Blocked, ExistingRelationship}` in
  `app/subserver/social/domain/federated_friend_request.go` (reject if blocked or
  already friends; codes `BLOCKED` / `ALREADY_FRIENDS`). No
  anyone/federations/nobody enum or persisted policy exists.
  `ActorProfile.message_permission` (default `everyone`) and
  `manually_approves_followers` are stored but never read by social
  enforcement.
- **Target contract**: a per-actor inbound policy
  `ANYONE | MY_FEDERATIONS | NOBODY`, enforced at the cross-station friend/group
  request command, where MY_FEDERATIONS means the sender's home station shares
  at least one active federation membership with the receiver's station.
- **Required work**: proto field on the actor profile; migration; enforcement
  in the federated request domain (membership intersection query); reuse
  message_permission semantics rather than introducing a parallel field.
- **Unblocks**: Discovery “Accept requests from”.

### G9 — Switch station semantics and logout session invalidation

- **Current**: the desktop binding machine is
  `unbound → connecting → access_gate → bound`
  (`apps/desktop/src-tauri/src/application/station_binding/mod.rs`); switching
  tears down streams and forces gate/login. Two gaps:
  1. plain `auth_logout` clears the local session/vault but **does not unbind**
     the active station; only removing the selected station resets to unbound;
  2. desktop logout never calls the Station `POST /actor/logout` route, so the
     server-side session is not invalidated.
- **Target contract**: “Switch station” = end session (call `/actor/logout`),
  unbind/remove the active station, and return to onboarding station + account
  selection, keeping local conversation storage.
- **Required work**: client command that performs logout + station unbind in
  one explicit action; wire the Settings control; confirm server `/actor/logout`
  invalidates the access attempt/session used by the client.
- **Unblocks**: Your Station “Switch station” (currently a designed target).

---

## 3. Federation membership gaps

### G6 — Expose join/leave/roster/role to the Desktop client

- **Current**: the federation subserver implements
  `POST /sub-federation/federations/join`,
  `POST /sub-federation/federations/:id/leave`, create/list/delete,
  `GET …/stations` (member roster), ledger sync and governance proposals
  (`apps/station/app/subserver/federation/`). Membership is per-station in
  `federation_station_membership`. The production Tauri client deliberately
  ships only read commands — `federation_resolve`, `federation_catalog_search`,
  `federation_list_contexts` (`apps/desktop/src-tauri/src/interface/tauri_commands/federation.rs`);
  join/leave is invoked only from the acceptance fixture. `list_contexts`
  returns `{federation_id,name,status}` with no counts/role.
- **Required work**: Tauri commands over join, leave, list-with-summary
  (`member_station_count`, `my_role`, `capability`, `status`), and member
  roster; typed errors surfaced to the UI; keep governance/archive on the
  Dashboard.
- **Unblocks**: live Join/Leave, role tag, and station count in Settings.

### G7 — Non-sequencer member leave (fix before enabling Leave broadly)

- **Current**: join posts a `STATION_JOIN_APPROVED` proposal to the remote
  sequencer when local is not the sequencer, but `handleLeaveFederation`
  appends `STATION_LEFT` via local `AppendEvent` directly with no remote
  proposal path (`handler.go` ~194–231). Other members may never observe the
  leave.
- **Required work**: route non-sequencer leave through the same sequencer
  proposal/ledger propagation as join; add a cross-station acceptance test that
  a leave performed on a member station becomes visible at the sequencer and
  other replicas.
- **Severity**: correctness; should block advertising Leave as reliable in
  Settings.

### G11 — Population and exposure of counts

- **Current**: `FederationSummary.member_station_count` exists on the Station
  list path but is absent from the desktop contexts projection.
  `FederationStationEntry.visible_actor_count` is generated in
  `federation_discovery.proto` but never populated; `ListFederationStations`
  has no handler (the live endpoint is `ListMemberStations` →
  `MemberStationView`); the desktop probe parses `label`/`peers_count` from
  `/sub-bootstrap/info`, which the bootstrap handler does not emit.
- **Required work**: decide which single endpoint serves roster + counts;
  populate `visible_actor_count` from the local INDEXED actor index (G4) or
  remove the field; expose counts to the client. Until then the UI hides all
  people/station counts that have no source.

---

## 4. Directory and transport gaps (operator + shared)

### G4 — Cross-station catalog fan-out

- **Current**: `POST /sub-federation/catalog/search` verifies local membership
  and runs a local SQL `LIKE` over `origin='local' AND visibility >= 3`; it
  returns empty for any other station. There is no fan-out, no aggregation.
  The relay frame `fed.catalog.search.v1` and `GET /actor/federation/search`
  exist only in `docs/architecture/domains/identity/federation-catalog.md`.
- **Target contract** (per federation-catalog.md): per-station local trie of
  INDEXED local actors; relay multicast of `fed.catalog.search.v1` to mounted
  stations; originator unions, dedupes by ptid, re-paginates; slow/offline
  stations are elided with `responding_peer_id` attribution; responses carry
  `ActorRef` only; BY_HANDLE actors never appear.
- **Required work**: proto + relay request/response correlation; local trie
  index maintenance; fan-out with the §6 timeout; HTTP entry; metrics.
- **Unblocks**: real meaning for INDEXED and any in-product “find people by
  federation” directory (Settings keeps only the visibility switches).

### G5 — Directory service kill-switch and rate limits

- **Current**: `peers.federation.catalog.serve`, the `403 catalog_disabled`
  branch, token-bucket rate limits (per origin peer id and per IP) and the
  fan-out timeout are specified in federation-catalog.md §5–§7 but exist in no
  Go code or config.
- **Required work**: station config + early-return before index access;
  rate limiter keyed by relay-stamped origin and direct HTTP IP; Dashboard
  switch; when off, the Desktop Discovery matrix shows a read-only operator
  notice instead of a toggle (prototype already models this state).
- **Owner**: Station Dashboard, not user Settings.

### G10 — Rich federation/relay health

- **Current**: relay mount status is binary Online/Offline
  (`relay_mount`, heartbeat staleness). The proto enum
  `SyncStatus {HEALTHY, LAGGING, FORK_DETECTED, REMOTE_UNREACHABLE,
  POLICY_REJECTED}` is generated but unused; the sync loop writes only
  `healthy`/`fork_detected` into `federation_sync_cursor` and no API reads it.
  `MemberStationView.sync_status` is never filled. Public readiness exists
  separately at `GET /actor/federation/health` (DHT readiness/seed counts).
- **Required work**: project sync cursor health to the federation summary /
  member roster; expose relay stats (`online_stations`, streams, mounts,
  invites — already served by relay admin endpoints) in the Dashboard.
- **Owner**: Station Dashboard transport/operations views. User Settings must
  not show degraded/unreachable badges until a real per-federation signal is
  available (the fabricated badges were removed from the prototype).

---

## 5. Already-shipped capabilities to wire (small client work, no new backend)

- **G8 Authorized devices**: `POST /device/enroll`, `GET /device/list`,
  `POST /device/revoke` exist and are already reachable from Tauri
  (`device_list`/`device_revoke`, consumed by im-service). Your Station should
  render this list directly instead of mock devices.
- **G1 discoverability**: persist the single value through
  `profileUpdate({discoverability})`; keep the INDEXED copy honest until G4
  ships (it changes enumeration, not by-handle resolution).
- **Bound station + health**: render the bound station from the binding
  projection and `/actor/federation/health`; do not invent peer/seed tiles.

---

## 6. Suggested sequencing for the backend project

1. **G7 leave correctness** and **G9 logout/unbind** — correctness and trust
   prerequisites for any membership control.
2. **G6/G11 client projection** — expose existing ledger membership, role, and
   counts; wire G8 devices. This makes most of the Federation/Station pages
   live with no new federation behaviour.
3. **G2 per-federation visibility + G3 inbound policy** — proto/migration first,
   then enforcement, then Desktop.
4. **G4 catalog fan-out + G5 serve switch/rate limits + G10 health** — the
   directory and operator layer; land the Dashboard controls alongside.

Each item should land with its own acceptance gate (cross-station where noted)
and, when shipped, the corresponding prototype Pending marker is removed and
the geometry gate updated.

---

## 7. References

- Identity/catalog design:
  [`../identity/federation-catalog.md`](../identity/federation-catalog.md),
  [`../identity/unified-actor-system.md`](../identity/unified-actor-system.md).
- Federation domain: [`.`](./README.md), `design.md`, `data-model.md`,
  `wire-protocol.md`, `integration.md`,
  `execution-plans/phase-1-federation-ledger.md`.
- Station federation implementation:
  `apps/station/app/subserver/federation/` (subserver, handlers, projection,
  sync manager, migrations).
- Actor visibility/profile: `model/domain/actor/actor.proto`,
  `apps/station/frame/touch/actor/{profile.go,locator_hook.go}`,
  `frame/touch/model/db/actor.go`.
- Friend request gate:
  `apps/station/app/subserver/social/domain/federated_friend_request.go`.
- Desktop binding/federation:
  `apps/desktop/src-tauri/src/application/station_binding/mod.rs`,
  `apps/desktop/src-tauri/src/interface/tauri_commands/federation.rs`,
  `apps/desktop/src/store/{federation.ts,session.ts}`.
- Relay: `apps/station/frame/core/plugin/native/subserver/relay/`.
- Prototype contract:
  `docs/client/common/ui-identity/components.md §10 Network Settings Ownership`.
