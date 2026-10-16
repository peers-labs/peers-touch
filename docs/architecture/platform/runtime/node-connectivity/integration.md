# Node Connectivity - Integration

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-10 | **Updated**: 2026-10-14
> **Owner**: Architecture Team

## 1. Preserved Domain Boundaries

Station Access owns endpoint selection, root pinning, Access attempts, OAuth,
Session class slots and scope teardown. It consumes verified node routes and
does not inspect Circuit wire. `station_peer_id + actor_ptid + device_id +
lifecycle_generation` stays the shared scope; active node/route is transport state.

Federation owns membership, Ledger and peer capability authorization. It selects
a logical destination and consumes node routes. Circuit authentication alone
never establishes Federation membership.

Conversation, device inbox, Social, Events, Agent and OSS retain their public
capability owners. A Frame ingress invokes the same registered methods, paths,
wrappers and protobuf handlers as the user-selected direct HTTP(S) origin. No
second Station command API.

## 2. Current Source Impact

| Surface | Source-backed change |
|---|---|
| `frame/peers.go`, native node/transport/registry/bootstrap/client | inject one owned Host; separate root and node keys |
| `subserver/bootstrap` and peer identity Model | signed delegated identity/route proof |
| native `relay/` + Relay control subserver | library Circuit, ACL, enrollment, permits and renewal |
| Frame server/handler adapters | standard HTTP2 stream ingress with streaming Flush/cancel |
| `frame/core/federation` and native Federation transport | authenticated logical peer routes, canonical HTTP |
| Desktop station_client/station_access/event_stream | source-bound standard Rust transport and route continuity |
| Desktop AppState/composition root | one owned StationRuntime with explicit setup and reverse-order shutdown |
| Desktop Station consumers | injected typed client; no dynamic localhost Station origin |
| Desktop media/object/applet consumers | StationResourceRef materialization or scoped local URI; external URLs remain distinct |
| Mobile Rust transport | dial-only standard Host; shared contracts, separate platform proof |
| `frame/touch/auth`, session DBStore, OAuth attempt owners | retain shared DB path, verify Station keyring and cross-node class activation |
| `app/subserver/events` | transactional sequence, durable target and cross-node wakes/replay |
| Agent lease/recovery | fence completion; exclude healthy foreign leases |
| OSS scheduler/backend | extend lock port and require shared bytes in cluster |
| deployment and Acceptance adapters | existing profiles, finite limits and attach-only source-bound proof |

Implementation updates the corresponding domain/platform docs and matched
knowledge in the same closure. This module states the cluster obligation;
Events, Agent and OSS own its semantics and code.

## 3. Atomic Transport Cut

Before the cut is complete, every consumer must be enumerated by actual imports,
route registration, protocol IDs, generated outputs, runtime scripts and tests.
The cut migrates native clients, Federation callers, bootstrap/discovery,
connection material, server ingress and Relay deployment together.

Delete the custom Relay WSS listener, tunnel protobuf arms, mount framing,
transport ping/reconnect loops, and obsolete custom-message transport consumers.
Retain enrollment, grant, signed identity, operator policy and metrics only
where the new control model actually consumes them. Preserve user-selected
direct HTTP(S) ingress and canonical HTTP/protobuf/SSE.

No runtime compatibility flag or parallel production data plane is permitted.
Incompatible clients fail explicitly. Rollback reverts the self-contained cut
and deploys the matching source; it does not select dormant old code.
Do not copy the candidate worktree or touch unrelated StationPicker edits.

The Desktop refinement is also an atomic consumer cut. Preparation may change
the internal `station-libp2p-http` owner/handle API without registering another
production path. The production cut migrates every Desktop caller to the
app-owned typed client, then deletes process globals, the loopback proxy, raw
HTTP/1 framing and dynamic localhost origin in the same Plan Version.

## 4. One Node To Multiple Nodes

The initial node keeps the logical Station identity. Adding a node creates a new
node key/PeerID, root delegation and registry lease. It never creates another
Actor namespace or Federation membership.

Cluster readiness requires shared domain DB, Access keyring and object backend,
transactional event ordering/targeting and domain fencing. A configured node
stays unready on schema incompatibility, local-only enabled owner or missing
shared backing. No request routing policy compensates for private local state.

Moving from local storage is operator-controlled maintenance: stop admission,
drain jobs, copy/verify bytes and metadata, select the shared owner, validate
keys/schema, then publish readiness. It is not a transparent configuration flip.
Adding capacity after shared owners are ready does not require client re-login.
Storage migration/reset/production mutations need their specific authorization.

## 5. Architecture Gates

These are required contracts for new business injection, not claims that existing
Gates already implement them. Reuse real Journey drivers; formal Gates attach to
one prepared runtime and never build, deploy or create accounts.

| ID | Runtime / action | Binary oracle |
|---|---|---|
| NCP-G01 | two node keys, one root; forged delegation/route/Relay/SPKI | distinct PeerIDs and one Station scope; all forgeries rejected before credentials |
| NCP-G02 | one-node direct/circuit HTTP2 with real handlers | same Login/Access result, router inventory, protobuf errors, SSE Flush and upload/download digest |
| NCP-G03 | two native Desktop actors exercise Direct-only, Relay-only and a real Direct-fault `AUTO` transition through an opaque TCP fault proxy, then exchange text/read receipt and a 32 MiB attachment via Circuit | typed no-route/policy-conflict, ordered Direct-failed then Relay-connected diagnostics, stable Session/lifecycle, fenced old lease, canonical Profile mutation/readback, receiver render and attachment digest |
| NCP-G04 | two Station nodes, shared DB/object backend; send on A, subscribe on B; kill A | committed ordered events reach B, device-only events stay private, cursor resumes within 30 s |
| NCP-G05 | Access attempt on A, acknowledge/use Session on B; concurrent same-class activation | one class winner, prior same-class revoked, other classes preserved, same logical Station |
| NCP-G06-AGENT | healthy Agent lease on A; boot B, expire/take over, then resume A | healthy work survives B boot, takeover advances the token, stale A cannot commit, one terminal domain record |
| NCP-G06-OSS | upload/read across two OSS processes; hold GC on A, expire/take over on B, replace bytes, resume A | digest-equal authorized read, healthy lease exclusion, higher-token takeover, replacement generation survives stale delete, stale completion rejected, valid quota/refcount |
| NCP-G06 | healthy Agent lease on A; start B, pause A, expire/takeover and resume A; concurrent OSS GC | healthy work survives B boot, stale token cannot commit, one domain effect and valid object refcounts |
| NCP-G07 | forced short test reservation renewal, route refresh, revoke, slow consumer and quota exhaustion | renewal preserves healthy SSE, revoke denies/retires node circuits, finite memory/admission and typed recovery |
| NCP-G08 | constructor/consumer inventory and final source-bound native proof | one Host/process, no old production data plane, Mobile contract builds; Mobile runtime remains unproven until native check |
| DSR-G01 | Native Desktop boot, repeated route/Station switches and process exit | one transport owner; zero leaked listeners/workers; bounded drain and joined shutdown |
| DSR-G02 | Private Relay material, Desktop quit/relaunch and fresh reauthorization | same-Relay PeerID is stable, different Relay scopes expose distinct PeerIDs, consumed material stays replay-protected, fresh material reconnects |
| DSR-G03 | Direct/Circuit typed request/resource matrix under failover, cancellation and saturation | SSE/files/resources stream, WebView projection works, safe reads retry once, ambiguous mutations do not replay, overload is bounded |

For native product operations, route selection/login/send/attachment use the
existing native DOM event driver. Frame/server observation, controlled node
termination, ACL mutation and authoritative database readback use Suite harness.
Touch injection cannot substitute for native send/receiver rendering.

Evaluation records exact source, binary digest, profile, identities, selected
multiaddrs, measured Circuit limits, sequence/lease outcomes and bounded timing.
No raw credentials, messages or key material enter logs. Performance sampling
uses identical data/runtime and reports distributions; “faster” is not a criterion.

## 6. Architecture Review

Findings-first review of target relationships and current evidence:

- **Identity collision** resolved by separate logical root and per-node keys;
  even N=1 uses the same delegation model.
- **Gateway duplication** resolved by one Frame ingress adapter and two roles.
- **HTTP2/Hertz context** resolved by a standard server and streaming loopback
  adapter to the existing Hertz router; no second handler registry.
- **Private Circuit admission gap** resolved by source-transport-key proof,
  idempotent grant redemption before standard CONNECT, and a bounded,
  read-only ACL permit projection whose accounting cannot burn on an upstream
  reservation or quota rejection.
- **Default Relay limits** resolved by explicit finite connection budgets and
  bulk/realtime separation; no measured-capacity claim.
- **Renewal disconnect risk** resolved by renewal without epoch/connection reset;
  actual revocation deliberately retires affected node connections.
- **Cluster replay/privacy** resolved by transactional per-Actor sequence,
  persisted device target, high-watermark replay and wake-loss repair.
- **Cross-node auth** resolved by retaining the real DBStore/class locks and
  requiring shared Access key material; no replacement memory Session service.
- **Healthy task corruption** resolved by domain fencing and expired-owner
  recovery; existing lease/lock ports are extended.
- **Opaque external effects** retain interrupted/ambiguous outcomes; leases do
  not claim provider exactly-once.
- **Object delete fencing** requires an atomically claimed immutable generation;
  a stale idempotent delete cannot remove replacement bytes.

Verdict: architecture relationships accepted. Design is implementation input;
NCP-G01..NCP-G08 are **NOT RUN / UNPROVEN**. The generated Plan North Star still
needs its own explicit approval before implementation.

## 7. Evidence And Authorization Boundaries

Design acceptance and Plan validation prove target coherence only. Final
product claims require actual native Journeys and formal exact-source evidence;
source/build checks remain source evidence. Candidate Plan authoring does not
replace an existing PlanMount or create execution/evidence state. Runtime,
storage migration and delivery use their separately authorized owning controls.
