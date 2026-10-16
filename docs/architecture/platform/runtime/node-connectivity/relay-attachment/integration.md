# Relay Attachment Lifecycle - Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-14 | **Updated**: 2026-10-15
> **Owner**: Node Connectivity

---

## 1. Current Source Mapping

| Current source | Retained responsibility | Target delta |
|---|---|---|
| `native/subserver/relay/handler_admin.go` | invitation/enrollment operator actions | generated contract, pagination, observation and idempotency |
| `native/subserver/relay/handler_station.go` | challenge/register/credential rotation | typed errors and attachment operation readback |
| Relay `application/service.go` | identity proof, atomic invite consumption, generation | preserve authority; expose unambiguous readback |
| Relay repository | durable invite/enrollment truth | remains the only enrollment/generation authority |
| `native/relay/attachment_controller.go` | durable Station attachment intent | single desired-state owner and runtime projection |
| `native/relay/station_control.go` | enroll, rotate, self-retire and signed route publication | consumes Controller-owned dynamic targets |
| `native/relay/reservation.go` | independent Circuit v2 reservations | one cancellable worker per Relay target |
| `native/relay/config.go` | boot-time Relay pool target config | bootstrap import only; Controller state wins afterward |
| Station Dashboard | Station operator shell | authenticated list/import/delete/retry API and page |
| Relay role composition | minimal Relay plugin only | embedded Relay Console; no Station application subserver |
| `access_endpoint.proto` | route/grant/endpoint contracts | consumed unchanged |
| `station_identity.proto` | logical Station/node proof | consumed unchanged |

## 2. Retained Boundaries

- Relay remains standard Circuit v2, opaque to application payload.
- Station root/node identity and signed route contracts remain upstream.
- Relay repository remains the only enrollment/generation authority.
- Station Access remains the route binding/selection owner for ordinary clients.
- Direct and Circuit route candidates retain transport-independent Station scope.
- Relay A and Relay B state remain independent.

## 3. Replaced Boundaries

The target state removes these limitations rather than preserving parallel owners:

- boot-only `InviteToken` as the sole attachment setup path;
- raw credential file path as the Dashboard-facing lifecycle model;
- Relay JSON DTOs as cross-runtime semantic truth;
- operator inference from separate enrollment, reservation and route screens;
- generic fleet/PKI/backup operations product scope.

Configuration files may import initial intents, but runtime and UI read one
Station Attachment Controller projection afterward.

## 4. Station Dashboard Integration

Allowed:

- list current Node attachments and route candidates;
- parse/verify invitation package;
- submit accept/retry/migrate/detach commands;
- render lifecycle and owner readback.

Forbidden:

- call Relay repository or libp2p objects directly from web code;
- store invitation/credential plaintext in browser persistence;
- create Relay invitations with Station admin authority;
- claim active before runtime projection.

The Dashboard backend talks only to the local Station Attachment Controller.

## 5. Relay Console Integration

Allowed:

- call operator-protected Relay plugin endpoints;
- issue/list/revoke invitations;
- list/revoke admitted attachments;
- render capacity and current observation.

Forbidden:

- mount Station Dashboard application backend;
- load Actor/Session/Federation/business routes;
- mutate Station desired state or route visibility;
- expose application data.

Static console assets are an interface of the Relay plugin's operator listener,
not a new subserver or runtime role.

## 6. Invitation Handoff

The Relay returns one invitation package with:

- exact Relay identity/origin/dial addresses;
- intended Station identity;
- bounded quota;
- one-time secret.

Transfer may be copy/paste or deep link. The secret belongs in the fragment or
opaque body, not query/server logs. The invitation remains active until consumed
or explicitly deleted. Station verifies metadata, completes enrollment and
persists the short-lived credential before committing desired attachment state.
The invitation secret is never stored in the Station attachment table.

The invitation does not authorize a client, Session, Federation membership or
business action.

## 7. Migration And Detach Integration

Migration:

- creates destination attachment B;
- waits for B active readback;
- leaves Access route selection unchanged until verified candidates update;
- retires source A only after explicit operator confirmation.

Detach:

- first disables local reconcile and withdraws route;
- closes reservation and clears in-memory credential state;
- invokes Relay self-retire when reachable;
- persists retirement confirmation before removing the scoped credential file;
- records remote cleanup pending without reactivating local use.

The control target is removed before the retirement network request. Remote
cleanup reads the durable target directly without registering it as a dial
candidate. A pending cleanup retains the scoped credential file for retirement
only and removes it after remote acknowledgement.
Cleanup sends the persisted credential before attempting rotation. An expired
signed credential can confirm the exact already-revoked predecessor; an active
enrollment requires live authority and one fresh proof-based recovery on 401.
The conditional retirement cannot revoke a newer enrollment.
Confirmed cleanup can finish local removal after restart without the deleted
credential or another Relay request. Repeated deletion of a completed tombstone
remains detached.

Relay revoke:

- advances generation in Relay repository;
- invalidates route/grant projections and admission;
- Station observes terminal reason and destroys local credential.

## 8. Prototype Integration

The canonical `station-dashboard` prototype is replaced in place:

- one Portal card;
- Station and Relay role surfaces in one demonstration package;
- no generic Fleet, Trust, Policies, Backup or Operations Service pages;
- no fake Messaging/Federation management;
- RAL capability/Journey/state IDs in docs and test selectors;
- production Dashboard component stack and shared UI Identity.

## 9. Verification

Source checks:

- role allowlists and prohibited imports;
- generated contract ownership;
- no custom mount/forwarding data plane;
- no browser secret persistence;
- no attachment mutation of business domains.

Functional checks:

- targeted invitation and mismatch denial;
- current generation registration/renewal;
- joined active readback;
- two-Relay overlap;
- local detach and Relay revoke;
- restart/recovery.

Formal proof:

- RAL-G01..RAL-G08;
- NCP-G07/NCP-G08;
- native client Direct/Circuit route verification;
- secret/log/evidence scan and cleanup.

## 10. Proof Status

Implemented source and focused tests prove:

- permanent one-use invitation schema and delete/consume fencing;
- dynamic per-Relay reservation worker add/remove/retry;
- credential-before-intent persistence;
- local-disable-before-remote-cleanup detach ordering;
- cleanup-pending retry;
- Station-authenticated idempotent self-retire;
- Station Dashboard API/build and embedded Relay Console packaging.

The defect regression checks cover:

- registered typed Dashboard path-ID binding;
- lossless browser JSON invitation-ID create/list/delete;
- same-Station multiple-Node and cross-Station attachment isolation;
- transactional primary-key migration on SQLite and temporary PostgreSQL;
- expired credential and expired delegation recovery through registered HTTP
  wrappers, real Station/Node signatures and the persisted Station control client;
- stale JTI, wrong Node and revoked enrollment denial;
- offline detach removing control targets while preserving other Node intent;
- preservation of binary Host key bytes.

Still unproven:

- exact-source two-Relay migration through real Station and Relay processes;
- restart recovery against deployed PostgreSQL and credential storage;
- native client Direct/Circuit route continuity;
- production SLOs and browser accessibility/performance evidence.
