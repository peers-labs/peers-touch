# Relay Attachment Lifecycle

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-14 | **Updated**: 2026-10-15
> **Owner**: Node Connectivity

---

## Product Contract

A Relay invitation and a Station Relay attachment are operator resources.
They have no product expiry:

- an active invitation remains available until it is consumed or deleted;
- an attachment remains desired until the Station Operator deletes it;
- deleting an active invitation removes it;
- consumed invitation rows remain as replay and audit truth;
- reattachment starts from a new invitation.

The permanent operator resource does not make transport authority permanent.
Node credentials, Circuit v2 reservations, signed routes and private grants
remain short-lived and are rotated or renewed automatically.

## Ownership

- Relay Operator creates/deletes invitations and revokes enrollments owned by
  that Relay.
- Station Operator imports invitations, observes attachments, retries recovery
  and deletes local attachment intent.
- Station `AttachmentController` owns durable desired state and projects
  runtime reservation state.
- Relay enrollment repository owns enrollment generation and revocation.
- Standard libp2p Circuit Relay v2 remains the only Relay data plane.

There is no Relay discovery, recommendation, shared cluster identity or
Relay-to-Relay mesh. Migration attaches Relay B, verifies B, then deletes A.

## Implementation

- Dynamic reservation workers:
  `apps/station/frame/core/plugin/native/relay/reservation.go`
- Durable desired state and lifecycle:
  `apps/station/frame/core/plugin/native/relay/attachment_controller.go`
- Station control enrollment/rotation/self-retire:
  `apps/station/frame/core/plugin/native/relay/station_control.go`
- Relay operator and Station endpoints:
  `apps/station/frame/core/plugin/native/subserver/relay/`
- Station Dashboard:
  `apps/station/app/subserver/dashboard/`
- Embedded Relay Console:
  `/relay-console` from the Relay plugin.

The invitation secret is used to complete enrollment and is not stored in the
Station attachment table or browser persistence. Credential material is
persisted before desired intent becomes active.

## Node Scope And Storage

Attachment intent uses the composite primary key
`station_peer_id + node_peer_id + relay_peer_id`. Every list, restore, retry,
delete, tombstone and update is scoped to the current logical Station and Host
Node. Nodes sharing one Station database may attach the same Relay independently.

Credential files use the resolved Station data directory, including
`PEERS_DATA_DIR` and paths-file overrides:
`relay/credentials/<station_peer_id>/<node_peer_id>/<relay_peer_id>.json`.
Boot configuration imports initial intent only. Existing persisted intent owns
target origin, addresses, credential path and TLS CA afterward.

SQLite and PostgreSQL rebuild a legacy Relay-only primary key transactionally.
PostgreSQL holds an exclusive table lock from snapshot through replacement so
legacy writers cannot commit a change that the migration later discards.
Legacy ownership is derived only from a Relay-signed credential. Unverifiable
rows are preserved with empty ownership and an error, remain invisible to Node
runtime queries, block automatic bootstrap for that Relay, and require explicit
operator reconciliation or a new invitation. A verified legacy
credential is copied into scoped storage before its intent path is updated;
migration does not delete the original operator-provided file.
Disabled cleanup-pending rows receive the same scoped copy before retirement;
cleanup never writes or removes the original operator-provided credential.

## Credential Recovery

The existing rotation challenge and token refresh endpoints recover an enrolled
Node after its 15-minute credential expires. An expired credential is a signed
enrollment locator only. Its signature, Relay issuer, audience, type, scope,
issued-at, not-before, enrollment ID, current generation and JTI remain checked.

Recovery also requires a fresh challenge-bound Node signature and currently
valid Station root delegation for the same Station and Node. The authorization
epoch cannot regress. The repository commits replacement JTI, authorization
epoch and expiry together using one conditional transition; a losing recovery
cannot update any of them. Enrollment transitions and transport admission
publication are serialized with revocation in the Relay service. Revoked enrollments,
stale JTIs, other Nodes and replayed challenges cannot recover. Ordinary route
publication and transport authorization continue to reject expired credentials.
The replacement credential is persisted before it enters the Station cache.
Recovery never reuses or reactivates a consumed invitation.

## Detach And Operator API

Detach persists disabled intent, stops its reservation worker and removes the
control/dial target before requesting remote retirement. Remote cleanup operates
on the durable target directly; it never adds that target back to discovery or
dial candidates. An offline Relay leaves cleanup pending while other Relays
remain usable.

Self-retirement conditionally revokes the exact enrollment ID, Station, Node,
generation and JTI. A stale request cannot revoke a replacement enrollment.
The revoked row retains its predecessor JTI for idempotent confirmation.
An expired signed retirement locator can acknowledge that exact revoked
predecessor, but cannot revoke an active enrollment or recover transport access.
Station cleanup sends the persisted credential first and performs one fresh
proof-based rotation only when active retirement requires renewed authority.
Repeated operator revocation does not advance an already-revoked generation.
The Controller persists remote retirement confirmation before removing its
managed credential file. A restarted cleanup can finish local removal without
contacting the Relay again. Repeated deletion of a completed tombstone returns
the detached state and does not recreate cleanup; a fresh invitation resets
that tombstone's retirement confirmation.

Dashboard delete/retry bind the path Relay ID through their typed request DTO.
Relay invitation create/list/delete carry decimal string IDs across the JSON
boundary so browser number precision cannot alter the database identifier.

## Documents

- [Product state model](./product-state-model.md)
- [Integration](./integration.md)
